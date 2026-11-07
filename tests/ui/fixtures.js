// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Shared fixtures of the UI tests.
//
// - llm: a fake llama-server. The browser talks to llama-server directly (LCTYSP-0001, LCTYSP-0002), so the tests point
//   the settings at LLM_URL and answer its requests inside the browser context (POST /v1/responses as SSE,
//   POST /v1/embeddings). Replies are queued per test with llm.reply(…); with none queued it answers DEFAULT_REPLY.
// - Helpers that create conversations through the HTTP API (LCTYSP-0006) and that wait until a page's module has
//   attached its features.

import { randomBytes, randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";

export { expect };

export const LLM_URL = "http://llm.test";
export const DEFAULT_REPLY = "了解しました。";
const SETTINGS_KEY = "lcty.settings.v1"; // js/common.js
const EMBEDDING_DIM = 768; // js/search/vectors.js FULL_DIM

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** One Responses API stream (the events js/llm/responses.js reads). */
function sseBody({ text = "", thinking = "" }) {
	const events = [];
	if (thinking)
		events.push({ type: "response.reasoning_text.delta", delta: thinking });
	// Split into a few deltas, as a real stream would arrive
	for (const delta of text.match(/[\s\S]{1,8}/g) || [])
		events.push({ type: "response.output_text.delta", delta });
	events.push({
		type: "response.completed",
		response: { usage: { input_tokens: 10, output_tokens: 5 } },
		timings: { prompt_n: 10, predicted_n: 5, predicted_per_second: 50 },
	});
	return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
}

class FakeLlm {
	/** @type {Array<{text?: string, thinking?: string, status?: number, error?: string, hang?: boolean}>} */
	queue = [];
	/** Bodies of the POST /v1/responses requests, in order */
	requests = [];
	#hanging = [];

	/** Queue the answer to the next generation request. */
	reply(r) {
		this.queue.push(typeof r === "string" ? { text: r } : r);
		return this;
	}

	async handle(route) {
		const req = route.request();
		if (req.method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: CORS });
		const path = new URL(req.url()).pathname;
		if (path === "/v1/embeddings") {
			const { input } = req.postDataJSON();
			const data = input.map((_, index) => ({
				index,
				embedding: Array.from({ length: EMBEDDING_DIM }, (_, k) =>
					k === 0 ? 1 : 0,
				),
			}));
			return route.fulfill({ headers: CORS, json: { data } });
		}
		if (path === "/v1/responses") {
			this.requests.push(req.postDataJSON());
			const r = this.queue.shift() || { text: DEFAULT_REPLY };
			if (r.hang) {
				// Never answers: the page stops it (the request is aborted). Released at the end of the test
				await new Promise((resolve) => this.#hanging.push(resolve));
				return route.abort().catch(() => {});
			}
			if (r.status)
				return route.fulfill({
					status: r.status,
					headers: CORS,
					json: { error: { message: r.error || "error" } },
				});
			return route.fulfill({
				headers: { ...CORS, "Content-Type": "text/event-stream" },
				body: sseBody(r),
			});
		}
		return route.fulfill({ status: 404, headers: CORS, body: "not found" });
	}

	release() {
		for (const resolve of this.#hanging.splice(0)) resolve();
	}
}

export const test = base.extend({
	llm: [
		async ({ context }, use) => {
			const llm = new FakeLlm();
			// Point the browser settings at the fake (only when the test has not stored settings of its own)
			await context.addInitScript(
				({ key, url }) => {
					if (!localStorage.getItem(key))
						localStorage.setItem(
							key,
							JSON.stringify({ base_url: url, api_key: "test" }),
						);
				},
				{ key: SETTINGS_KEY, url: LLM_URL },
			);
			await context.route(`${LLM_URL}/**`, (route) => llm.handle(route));
			await use(llm);
			llm.release();
		},
		{ auto: true },
	],
});

// ---- Data through the HTTP API (LCTYSP-0006) ----

/** A UUIDv7 (message ids must be one, LCTYSP-0003). */
export function uuidv7() {
	const b = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
	b.writeUIntBE(Date.now(), 0, 6);
	b[6] = (b[6] & 0x0f) | 0x70;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = b.toString("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A word no other conversation contains, for searching. */
export function uniqueWord(prefix = "word") {
	return `${prefix}${randomBytes(4).toString("hex")}`;
}

/**
 * Create a conversation through the API. messages: [["user", "…"], ["assistant", "…"], …].
 * Returns { id, messages } (messages with their ids).
 */
export async function createConversation(
	request,
	{ title = "テスト会話", messages = [], instructions = "", tags = [] } = {},
) {
	const id = `t-${randomBytes(6).toString("hex")}`;
	const at = new Date().toISOString();
	const msgs = messages.map(([role, content]) => ({
		id: uuidv7(),
		role,
		content,
		at,
		...(role === "assistant" ? { status: "completed" } : {}),
	}));
	const res = await request.post("/v1/conversations", {
		data: {
			meta: { id, created_at: at, instructions, tags },
			lines: [
				{ type: "title", title, at },
				...msgs.map((m) => ({ type: "message", ...m })),
			],
		},
	});
	expect(res.ok(), await res.text()).toBeTruthy();
	return { id, messages: msgs };
}

/** The messages the server has saved for a conversation (GET /v1/conversations/:id). */
export async function savedMessages(request, id) {
	const res = await request.get(`/v1/conversations/${encodeURIComponent(id)}`);
	expect(res.ok(), await res.text()).toBeTruthy();
	return (await res.json()).messages;
}

/** Wait until the server has saved n messages (saving runs after the screen has been updated). */
export async function waitForSaved(request, id, n) {
	await expect
		.poll(async () => (await savedMessages(request, id)).length)
		.toBe(n);
}

/** Replace every tag definition (PUT /v1/tags, LCTYSP-0009). */
export async function putTags(request, tags) {
	const res = await request.put("/v1/tags", { data: { tags } });
	expect(res.ok(), await res.text()).toBeTruthy();
}

// ---- Pages ----

/** The composer's textarea (inside <lcty-composer>'s Shadow DOM; Playwright's CSS pierces open shadow roots). */
export function composerInput(page) {
	return page.locator('[part~="lcty-composer__input"]');
}

export function messages(page, role) {
	return page.locator(
		role
			? `lcty-c > lcty-message[data-role="${role}"]`
			: "lcty-c > lcty-message",
	);
}

/** The text of a user message (its Light DOM body; the head and foot are Shadow DOM). */
export function userText(message) {
	return message.locator(":scope > .user-text");
}

/**
 * A message's action button ("undo", "fork", "regenerate"). The actions show only while the message is hovered
 * (lcty.v1.css), so the message is hovered first.
 */
export async function messageAction(message, name) {
	await message.hover();
	return message.locator(`[part~="lcty-message__action--${name}"]`);
}

/** Open the new conversation page /c/ and wait until js/pages/new.js has started (the tag list ends with its ⚙︎ button). */
export async function openNewPage(page, path = "/c/") {
	await page.goto(path);
	await expect(page.locator("#setup-tags > button")).toBeVisible();
}

/** Open a conversation and wait until lcty.v1.module.js has started (it sets data-tag-defs once the tags arrived). */
export async function openConversation(page, id) {
	await page.goto(`/c/${id}.html`);
	await expect(page.locator("lcty-c")).toHaveAttribute("data-tag-defs", /.*/);
}

/** The conversation id of the page that is open (/c/<id>.html). */
export function conversationIdOf(page) {
	return decodeURIComponent(
		new URL(page.url()).pathname.replace(/^\/c\/|\.html$/g, ""),
	);
}

/**
 * Send the first message from the open / page; resolves on the new conversation's page once the reply has been
 * generated. Returns the conversation id.
 */
export async function sendFirstMessage(page, text) {
	await composerInput(page).fill(text);
	await composerInput(page).press("Enter");
	await page.waitForURL(/\/c\/[^/]+\.html$/);
	await expect(messages(page, "assistant").last()).toHaveAttribute(
		"data-status",
		"completed",
	);
	return conversationIdOf(page);
}

/** Open / and start a conversation with a first message (see sendFirstMessage). */
export async function startConversation(page, text) {
	await openNewPage(page);
	return sendFirstMessage(page, text);
}
