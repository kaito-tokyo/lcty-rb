// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1009: the scenarios of docs/specs/LCTYSP-1009_storage-api.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by
// side.
//
// js/api/storage.js runs in a real browser on the test server's origin. Every request to /v1/ is answered by a route
// (routes also catch the meta sync worker's GET /v1/meta-all.json, answered with an empty list), so the server's data
// does not matter. A call of the feature, such as appendLines("c1", []), is the function's name and JSON arguments.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const META_ALL = "/v1/meta-all.json";

// ---- Background ----

/**
 * A page on the server's origin, and every request to /v1/ answered by answer(route), which the test sets.
 * requests: the requests other than GET /v1/meta-all.json, {method, url (path and query), contentType, body}, in
 * order; syncs: the times (Date.now()) GET /v1/meta-all.json was requested.
 */
async function background(page, context) {
	const server = {
		answer: (route) => route.fulfill({ json: { ok: true } }),
		requests: [],
		syncs: [],
	};
	await givenAPage(page, context);
	await test.step("And requests to /v1/ are answered by the test, which records them", async () => {
		await context.route(
			(url) => url.pathname.startsWith("/v1/"),
			(route) => {
				const req = route.request();
				const url = new URL(req.url());
				if (url.pathname === META_ALL) {
					server.syncs.push(Date.now());
					return route.fulfill({ json: [] });
				}
				const buffer = req.postDataBuffer();
				server.requests.push({
					at: Date.now(),
					method: req.method(),
					url: url.pathname + url.search,
					contentType: req.headers()["content-type"] ?? null,
					body: buffer ? buffer.toString("utf8") : null,
					bytes: buffer ? [...buffer] : null,
				});
				return server.answer(route);
			},
		);
	});
	return server;
}

// ---- Calling the module, from the page ----

/** "name(args…)" → {name, args}, the arguments being JSON. */
function parseCall(call) {
	const m = /^(\w+)\((.*)\)$/s.exec(call);
	return { name: m[1], args: JSON.parse(`[${m[2]}]`) };
}

/** Call a function of storage.js in the page: {value} or {error: {name, message}}. */
function callStorage(page, name, args) {
	return page.evaluate(
		async ({ name, args }) => {
			const storage = await import("/js/api/storage.js");
			try {
				return { value: await storage[name](...args) };
			} catch (e) {
				return { error: { name: e.name, message: e.message } };
			}
		},
		{ name, args },
	);
}

async function whenCalled(page, call) {
	let result;
	await test.step(`When ${call} is called`, async () => {
		const { name, args } = parseCall(call);
		result = await callStorage(page, name, args);
	});
	return result;
}

async function givenTheServerAnswers(server, json) {
	await test.step(`Given the server answers ${JSON.stringify(json).replace(/([:,])/g, "$1 ")}`, () => {
		server.answer = (route) => route.fulfill({ json });
	});
}

async function givenTheStatus(server, status, text, line) {
	await test.step(
		line ??
			`Given the server answers with the status ${status} and the text "${text}"`,
		() => {
			server.answer = (route) =>
				route.fulfill({ status, contentType: "text/plain", body: text });
		},
	);
}

async function thenTheSyncFetches(server) {
	await test.step("And the meta sync worker then fetches GET /v1/meta-all.json", async () => {
		await expect
			.poll(() => server.syncs.length, { timeout: 15000 })
			.toBeGreaterThan(0);
		expect(server.requests).toHaveLength(1);
		expect(server.syncs[0]).toBeGreaterThanOrEqual(server.requests[0].at);
	});
}

/** toLine(message) in the page, with the message as it is after the call. */
function toLine(page, message) {
	return page.evaluate(async (message) => {
		const { toLine } = await import("/js/api/storage.js");
		const line = toLine(message);
		return { line, message };
	}, message);
}

async function whenToLine(page, message) {
	let result;
	await test.step("When toLine is called with it", async () => {
		result = await toLine(page, message);
	});
	return result;
}

// ---- Scenarios: toLine ----

test("A user message becomes a message line without HTML", async ({
	page,
	context,
}) => {
	await background(page, context);
	let message;
	await test.step('Given the user message {"id": "m1", "role": "user", "content": "**Hi**", "at": "2026-11-07T00:00:00.000Z"}', () => {
		message = {
			id: "m1",
			role: "user",
			content: "**Hi**",
			at: "2026-11-07T00:00:00.000Z",
		};
	});
	const { line } = await whenToLine(page, message);
	await test.step('Then it returns {"type": "message", "id": "m1", "role": "user", "content": "**Hi**", "at": "2026-11-07T00:00:00.000Z"}', () => {
		expect(line).toStrictEqual({
			type: "message",
			id: "m1",
			role: "user",
			content: "**Hi**",
			at: "2026-11-07T00:00:00.000Z",
		});
	});
});

test("A reply carries its content rendered as HTML", async ({
	page,
	context,
}) => {
	await background(page, context);
	let message;
	await test.step('Given the assistant message {"id": "m2", "role": "assistant", "content": "**bold** text"}', () => {
		message = { id: "m2", role: "assistant", content: "**bold** text" };
	});
	const { line } = await whenToLine(page, message);
	await test.step('Then it returns {"type": "message", "id": "m2", "role": "assistant", "content": "**bold** text", "content_html": "<p><strong>bold</strong> text</p>"}', () => {
		expect(line).toStrictEqual({
			type: "message",
			id: "m2",
			role: "assistant",
			content: "**bold** text",
			content_html: "<p><strong>bold</strong> text</p>",
		});
	});
});

test("The HTML of a reply is what renderMarkdown makes of its content", async ({
	page,
	context,
}) => {
	await background(page, context);
	let message;
	await test.step("Given an assistant message whose content has a heading, a list, a table, a code block and a link", () => {
		message = {
			role: "assistant",
			content:
				"# Title\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\nSee [docs](https://example.com).",
		};
	});
	let result;
	await test.step("When toLine is called with it", async () => {
		result = await page.evaluate(async (message) => {
			const { toLine } = await import("/js/api/storage.js");
			const { renderMarkdown } = await import("/js/ui/markdown.js");
			return {
				html: toLine(message).content_html,
				expected: renderMarkdown(message.content),
			};
		}, message);
	});
	await test.step("Then its content_html equals renderMarkdown of the content", () => {
		expect(result.html).toBe(result.expected);
		expect(result.html).toContain("<h1>");
		expect(result.html).toContain("<table>");
	});
});

test("A reply without content carries empty HTML", async ({
	page,
	context,
}) => {
	await background(page, context);
	let message;
	await test.step('Given the assistant message {"id": "m3", "role": "assistant"}', () => {
		message = { id: "m3", role: "assistant" };
	});
	const { line } = await whenToLine(page, message);
	await test.step('Then it returns {"type": "message", "id": "m3", "role": "assistant", "content_html": ""}', () => {
		expect(line).toStrictEqual({
			type: "message",
			id: "m3",
			role: "assistant",
			content_html: "",
		});
	});
});

test("toLine leaves the message as it was", async ({ page, context }) => {
	await background(page, context);
	let message;
	await test.step("Given an assistant message with content", () => {
		message = { id: "m4", role: "assistant", content: "*hi*" };
	});
	const result = await whenToLine(page, message);
	await test.step("Then the message has no type and no content_html", () => {
		expect(result.message).toStrictEqual(message);
	});
});

// ---- Scenarios: the requests ----

for (const [call, method, url, body, type] of [
	["listConversations()", "GET", "/v1/conversations", "none", "none"],
	[
		'getConversation("a b/c")',
		"GET",
		"/v1/conversations/a%20b%2Fc",
		"none",
		"none",
	],
	[
		'createConversation({"id": "c1", "tags": []}, [{"type": "message"}])',
		"POST",
		"/v1/conversations",
		'{"meta":{"id":"c1","tags":[]},"lines":[{"type":"message"}]}',
		"application/json",
	],
	[
		'appendLines("a b", [{"type": "title", "title": "T"}])',
		"POST",
		"/v1/conversations/a%20b/lines",
		'[{"type":"title","title":"T"}]',
		"application/json",
	],
	[
		'popMessages("c1", 2)',
		"POST",
		"/v1/conversations/c1/pop",
		'{"from":2}',
		"application/json",
	],
	[
		'deleteConversation("c/1")',
		"DELETE",
		"/v1/conversations/c%2F1",
		"none",
		"none",
	],
	["getDefaults()", "GET", "/v1/defaults.json", "none", "none"],
	[
		'vectorsPending("eg/2")',
		"GET",
		"/v1/vectors/pending?model=eg%2F2&limit=16",
		"none",
		"none",
	],
	[
		'vectorsPending("eg", 4)',
		"GET",
		"/v1/vectors/pending?model=eg&limit=4",
		"none",
		"none",
	],
	[
		'searchConversations({"q": "x", "tags": ["t"], "limit": 5})',
		"POST",
		"/v1/search",
		'{"q":"x","tags":["t"],"limit":5}',
		"application/json",
	],
	[
		'fetchSnippets(["r1", "r2"], "x")',
		"POST",
		"/v1/snippets",
		'{"ids":["r1","r2"],"q":"x"}',
		"application/json",
	],
	["getTags()", "GET", "/v1/tags", "none", "none"],
	[
		'putTags({"tags": [{"name": "t", "prompt": ""}]})',
		"PUT",
		"/v1/tags",
		'{"tags":[{"name":"t","prompt":""}]}',
		"application/json",
	],
	[
		'addMemory("a/b", {"text": "t", "source": "s"})',
		"POST",
		"/v1/tags/a%2Fb/memory",
		'{"text":"t","source":"s"}',
		"application/json",
	],
]) {
	test(`Each function sends its request and resolves to the answer (${call})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheServerAnswers(server, { ok: true });
		const result = await whenCalled(page, call);
		await test.step(`Then one request ${method} ${url} is sent`, () => {
			expect(server.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
				`${method} ${url}`,
			]);
		});
		await test.step(`And its body is ${body}`, () => {
			expect(server.requests[0].body).toBe(body === "none" ? null : body);
		});
		await test.step(`And its Content-Type is ${type}`, () => {
			expect(server.requests[0].contentType).toBe(
				type === "none" ? null : type,
			);
		});
		await test.step('And it resolves to {"ok": true}', () => {
			expect(result).toEqual({ value: { ok: true } });
		});
	});
}

test("putVectors sends the vector binary with its query", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheServerAnswers(server, { accepted: 2, stale: [] });
	const bytes = Array.from({ length: 16 }, (_, i) => i + 1);
	let result;
	await test.step('When putVectors is called with the model "eg/2", the revs [["r1", 3], ["r2", 4]] and a body of 16 bytes for 2 records of 8 bytes', async () => {
		result = await page.evaluate(async (bytes) => {
			const { putVectors } = await import("/js/api/storage.js");
			return {
				value: await putVectors(
					"eg/2",
					[
						["r1", 3],
						["r2", 4],
					],
					{ body: new Uint8Array(bytes), size: 8, count: 2 },
				),
			};
		}, bytes);
	});
	await test.step("Then one request PUT /v1/vectors?model=eg%2F2&magic=lctyvLE0&size=8&entry_count=2&rev=r1:3,r2:4 is sent", () => {
		expect(server.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
			"PUT /v1/vectors?model=eg%2F2&magic=lctyvLE0&size=8&entry_count=2&rev=r1:3,r2:4",
		]);
	});
	await test.step("And its Content-Type is application/octet-stream and its body is the 16 bytes", () => {
		expect(server.requests[0].contentType).toBe("application/octet-stream");
		expect(server.requests[0].bytes).toEqual(bytes);
	});
	await test.step('And it resolves to {"accepted": 2, "stale": []}', () => {
		expect(result).toEqual({ value: { accepted: 2, stale: [] } });
	});
});

for (const [call, status, text, message] of [
	["listConversations()", 500, "boom", "500 boom"],
	['getConversation("nope")', 404, "not found", "404 not found"],
	["createConversation({}, [])", 409, "already exists", "409 already exists"],
	['popMessages("c1", 0)', 409, "too far back", "409 too far back"],
	['putVectors("eg", [], {})', 400, "bad magic", "400 bad magic"],
	['addMemory("t", {})', 404, "no such tag", "404 no such tag"],
]) {
	test(`An answer that is not OK becomes an Error with the status and the body (${call})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheStatus(server, status, text);
		const result = await whenCalled(page, call);
		await test.step(`Then it rejects with the Error "${message}"`, () => {
			expect(result).toEqual({ error: { name: "Error", message } });
		});
	});
}

test("A long error body is cut to 200 characters", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const text = Array.from({ length: 300 }, (_, i) => "abcdefghij"[i % 10]).join(
		"",
	);
	await givenTheStatus(
		server,
		500,
		text,
		"Given the server answers with the status 500 and a text of 300 characters",
	);
	const result = await whenCalled(page, "listConversations()");
	await test.step('Then it rejects with the Error "500 " followed by the first 200 characters of the text', () => {
		expect(result.error.message).toBe(`500 ${text.slice(0, 200)}`);
	});
});

test("An OK answer that is not JSON rejects with a SyntaxError", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheStatus(server, 200, "not json");
	const result = await whenCalled(page, "listConversations()");
	await test.step("Then it rejects with a SyntaxError", () => {
		expect(result.error?.name).toBe("SyntaxError");
	});
});

test("A request that fails without an answer rejects with a TypeError", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step("Given the request to the server fails without an answer", () => {
		server.answer = (route) => route.abort("failed");
	});
	const result = await whenCalled(page, "listConversations()");
	await test.step("Then it rejects with a TypeError", () => {
		expect(result.error?.name).toBe("TypeError");
	});
});

// ---- Scenarios: the sync of the meta ----

for (const call of [
	'createConversation({"id": "c1"}, [])',
	'appendLines("c1", [])',
	'popMessages("c1", 2)',
	'deleteConversation("c1")',
	'putTags({"tags": []})',
]) {
	test(`A change of conversations asks for a sync of the meta (${call})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheServerAnswers(server, { ok: true });
		const result = await whenCalled(page, call);
		await test.step("Then it resolves", () => {
			expect(result).toEqual({ value: { ok: true } });
		});
		await thenTheSyncFetches(server);
	});
}

for (const { answer, fulfill } of [
	{
		answer: "the server answers with the status 500",
		fulfill: (route) => route.fulfill({ status: 500, body: "boom" }),
	},
	{
		answer: "the request to the server fails without an answer",
		fulfill: (route) => route.abort("failed"),
	},
]) {
	test(`A change of conversations that fails still asks for a sync (${answer})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await test.step(`Given ${answer}`, () => {
			server.answer = fulfill;
		});
		const result = await whenCalled(page, 'appendLines("c1", [])');
		await test.step("Then it rejects", () => {
			expect(result.error).toBeDefined();
		});
		await thenTheSyncFetches(server);
	});
}

test("Replacing the tag definitions still asks for a sync when it fails", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheStatus(server, 500, "boom");
	const result = await whenCalled(page, 'putTags({"tags": []})');
	await test.step('Then it rejects with the Error "500 boom"', () => {
		expect(result).toEqual({ error: { name: "Error", message: "500 boom" } });
	});
	await thenTheSyncFetches(server);
});

test("Requests that do not change conversations do not ask for a sync", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheServerAnswers(server, { ok: true });
	await test.step("When listConversations, getConversation, getDefaults, vectorsPending, putVectors, searchConversations, fetchSnippets and getTags are called", async () => {
		const results = await page.evaluate(async () => {
			const s = await import("/js/api/storage.js");
			return Promise.all([
				s.listConversations(),
				s.getConversation("c1"),
				s.getDefaults(),
				s.vectorsPending("eg"),
				s.putVectors("eg", [["r1", 1]], {
					body: new Uint8Array(8),
					size: 8,
					count: 1,
				}),
				s.searchConversations({ q: "x" }),
				s.fetchSnippets(["r1"], "x"),
				s.getTags(),
			]);
		});
		expect(results).toHaveLength(8);
		expect(server.requests).toHaveLength(8);
	});
	await test.step("Then no GET /v1/meta-all.json is fetched within 3 seconds", async () => {
		await page.waitForTimeout(3000);
		expect(server.syncs).toEqual([]);
	});
});
