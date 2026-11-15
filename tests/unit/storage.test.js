// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1009: the scenarios of docs/specs/LCTYSP-1009_storage-api.feature that run in Node.js, written by hand. Each
// test has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two
// read side by side.
//
// js/api/storage.js runs in Node.js (node-unit.js): every request it makes is answered by the test through
// routeFetch(), which replaces the global fetch, so its requests resolve against the test server's origin as in a page.
// A request that fails without an answer is a fetch that rejects with a TypeError, as fetch does. A call of the
// feature, such as getConversation("c1"), is the function's name and JSON arguments.

import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const storage = await import(publicUrl("js/api/storage.js"));

// ---- Background ----

/**
 * Every request to /v1/ answered by answer(request), which the test sets. requests: {method, url (path and query),
 * contentType, body, bytes}, in order.
 */
async function background(step, t) {
	const server = {
		answer: () => Response.json({ ok: true }),
		requests: [],
	};
	await step(
		"Given requests to /v1/ are answered by the test, which records them",
		() => {
			routeFetch(t, async (request) => {
				const url = new URL(request.url);
				if (!url.pathname.startsWith("/v1/"))
					throw new TypeError(`not answered: ${request.url}`);
				const buffer =
					request.body === null
						? null
						: Buffer.from(await request.clone().arrayBuffer());
				server.requests.push({
					method: request.method,
					url: url.pathname + url.search,
					contentType: request.headers.get("content-type"),
					body: buffer ? buffer.toString("utf8") : null,
					bytes: buffer ? [...buffer] : null,
				});
				return server.answer(request);
			});
		},
	);
	return server;
}

// ---- Calling the module ----

/** "name(args…)" → {name, args}, the arguments being JSON. */
function parseCall(call) {
	const m = /^(\w+)\((.*)\)$/s.exec(call);
	return { name: m[1], args: JSON.parse(`[${m[2]}]`) };
}

/** Call a function of storage.js: {value} or {error: {name, message}}. */
async function callStorage(name, args) {
	try {
		return { value: await storage[name](...args) };
	} catch (e) {
		return { error: { name: e.name, message: e.message } };
	}
}

async function whenCalled(step, call) {
	let result;
	await step(`When ${call} is called`, async () => {
		const { name, args } = parseCall(call);
		result = await callStorage(name, args);
	});
	return result;
}

async function givenTheServerAnswers(step, server, json) {
	await step(
		`Given the server answers ${JSON.stringify(json).replace(/([:,])/g, "$1 ")}`,
		() => {
			server.answer = () => Response.json(json);
		},
	);
}

async function givenTheStatus(step, server, status, text, line) {
	await step(
		line ??
			`Given the server answers with the status ${status} and the text "${text}"`,
		() => {
			server.answer = () =>
				new Response(text, {
					status,
					headers: { "Content-Type": "text/plain" },
				});
		},
	);
}

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
	["getDefaults()", "GET", "/v1/defaults.json", "none", "none"],
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
]) {
	scenario(
		`Each function sends its request and resolves to the answer (${call})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenTheServerAnswers(step, server, { ok: true });
			const result = await whenCalled(step, call);
			await step(`Then one request ${method} ${url} is sent`, () => {
				expect(server.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
					`${method} ${url}`,
				]);
			});
			await step(`And its body is ${body}`, () => {
				expect(server.requests[0].body).toBe(body === "none" ? null : body);
			});
			await step(`And its Content-Type is ${type}`, () => {
				expect(server.requests[0].contentType).toBe(
					type === "none" ? null : type,
				);
			});
			await step('And it resolves to {"ok": true}', () => {
				expect(result).toEqual({ value: { ok: true } });
			});
		},
	);
}

scenario(
	"An Error of a request that is not OK carries the status",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheStatus(step, server, 404, "not found");
		let error;
		await step('When getConversation("nope") is called', async () => {
			error = await storage.getConversation("nope").catch((e) => e);
		});
		await step(
			'Then it rejects with the Error "404 not found" whose status is 404',
			() => {
				expect(error).toBeInstanceOf(Error);
				expect(error.message).toBe("404 not found");
				expect(error.status).toBe(404);
			},
		);
	},
);

for (const [call, status, text, message] of [
	["listConversations()", 500, "boom", "500 boom"],
	['getConversation("nope")', 404, "not found", "404 not found"],
]) {
	scenario(
		`An answer that is not OK becomes an Error with the status and the body (${call})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenTheStatus(step, server, status, text);
			const result = await whenCalled(step, call);
			await step(`Then it rejects with the Error "${message}"`, () => {
				expect(result).toEqual({ error: { name: "Error", message } });
			});
		},
	);
}

scenario("A long error body is cut to 200 characters", async ({ step, t }) => {
	const server = await background(step, t);
	const text = Array.from({ length: 300 }, (_, i) => "abcdefghij"[i % 10]).join(
		"",
	);
	await givenTheStatus(
		step,
		server,
		500,
		text,
		"Given the server answers with the status 500 and a text of 300 characters",
	);
	const result = await whenCalled(step, "listConversations()");
	await step(
		'Then it rejects with the Error "500 " followed by the first 200 characters of the text',
		() => {
			expect(result.error.message).toBe(`500 ${text.slice(0, 200)}`);
		},
	);
});

scenario(
	"An OK answer that is not JSON rejects with a SyntaxError",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheStatus(step, server, 200, "not json");
		const result = await whenCalled(step, "listConversations()");
		await step("Then it rejects with a SyntaxError", () => {
			expect(result.error?.name).toBe("SyntaxError");
		});
	},
);

scenario(
	"A request that fails without an answer rejects with a TypeError",
	async ({ step, t }) => {
		const server = await background(step, t);
		await step(
			"Given the request to the server fails without an answer",
			() => {
				server.answer = () => {
					throw new TypeError("fetch failed");
				};
			},
		);
		const result = await whenCalled(step, "listConversations()");
		await step("Then it rejects with a TypeError", () => {
			expect(result.error?.name).toBe("TypeError");
		});
	},
);
