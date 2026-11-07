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
// feature, such as appendLines("c1", []), is the function's name and JSON arguments.
//
// Stand-ins: toLine renders replies with js/ui/markdown.js, whose code blocks call tr() of js/i18n.js, so the global
// LctyT is made by useLctyT() (English). The requests that change conversations call requestMetaDbSync() of
// js/api/meta-db.js, which waits for requestIdleCallback and then starts the meta sync worker; Node.js has neither, so
// requestIdleCallback is a stand-in that never calls back: no sync runs here. The Scenarios about the sync (the meta
// sync worker fetching GET /v1/meta-all.json, or not) run in the browser, in tests/unit/storage.spec.js.

import {
	expect,
	publicUrl,
	routeFetch,
	scenario,
	useLctyT,
} from "./node-unit.js";

globalThis.requestIdleCallback = () => 0;
await useLctyT();
const storage = await import(publicUrl("js/api/storage.js"));
const { renderMarkdown } = await import(publicUrl("js/ui/markdown.js"));

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

/** toLine(message), with the message as it is after the call. */
function toLine(message) {
	const line = storage.toLine(message);
	return { line, message };
}

async function whenToLine(step, message) {
	let result;
	await step("When toLine is called with it", () => {
		result = toLine(message);
	});
	return result;
}

// ---- Scenarios: toLine ----

scenario(
	"A user message becomes a message line without HTML",
	async ({ step, t }) => {
		await background(step, t);
		let message;
		await step(
			'Given the user message {"id": "m1", "role": "user", "content": "**Hi**", "at": "2026-11-07T00:00:00.000Z"}',
			() => {
				message = {
					id: "m1",
					role: "user",
					content: "**Hi**",
					at: "2026-11-07T00:00:00.000Z",
				};
			},
		);
		const { line } = await whenToLine(step, message);
		await step(
			'Then it returns {"type": "message", "id": "m1", "role": "user", "content": "**Hi**", "at": "2026-11-07T00:00:00.000Z"}',
			() => {
				expect(line).toStrictEqual({
					type: "message",
					id: "m1",
					role: "user",
					content: "**Hi**",
					at: "2026-11-07T00:00:00.000Z",
				});
			},
		);
	},
);

scenario(
	"A reply carries its content rendered as HTML",
	async ({ step, t }) => {
		await background(step, t);
		let message;
		await step(
			'Given the assistant message {"id": "m2", "role": "assistant", "content": "**bold** text"}',
			() => {
				message = { id: "m2", role: "assistant", content: "**bold** text" };
			},
		);
		const { line } = await whenToLine(step, message);
		await step(
			'Then it returns {"type": "message", "id": "m2", "role": "assistant", "content": "**bold** text", "content_html": "<p><strong>bold</strong> text</p>"}',
			() => {
				expect(line).toStrictEqual({
					type: "message",
					id: "m2",
					role: "assistant",
					content: "**bold** text",
					content_html: "<p><strong>bold</strong> text</p>",
				});
			},
		);
	},
);

scenario(
	"The HTML of a reply is what renderMarkdown makes of its content",
	async ({ step, t }) => {
		await background(step, t);
		let message;
		await step(
			"Given an assistant message whose content has a heading, a list, a table, a code block and a link",
			() => {
				message = {
					role: "assistant",
					content:
						"# Title\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\nSee [docs](https://example.com).",
				};
			},
		);
		let result;
		await step("When toLine is called with it", () => {
			result = {
				html: storage.toLine(message).content_html,
				expected: renderMarkdown(message.content),
			};
		});
		await step(
			"Then its content_html equals renderMarkdown of the content",
			() => {
				expect(result.html).toBe(result.expected);
				expect(result.html).toContain("<h1>");
				expect(result.html).toContain("<table>");
			},
		);
	},
);

scenario("A reply without content carries empty HTML", async ({ step, t }) => {
	await background(step, t);
	let message;
	await step(
		'Given the assistant message {"id": "m3", "role": "assistant"}',
		() => {
			message = { id: "m3", role: "assistant" };
		},
	);
	const { line } = await whenToLine(step, message);
	await step(
		'Then it returns {"type": "message", "id": "m3", "role": "assistant", "content_html": ""}',
		() => {
			expect(line).toStrictEqual({
				type: "message",
				id: "m3",
				role: "assistant",
				content_html: "",
			});
		},
	);
});

scenario("toLine leaves the message as it was", async ({ step, t }) => {
	await background(step, t);
	let message;
	await step("Given an assistant message with content", () => {
		message = { id: "m4", role: "assistant", content: "*hi*" };
	});
	const result = await whenToLine(step, message);
	await step("Then the message has no type and no content_html", () => {
		expect(result.message).toStrictEqual({
			id: "m4",
			role: "assistant",
			content: "*hi*",
		});
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
	"putVectors sends the vector binary with its query",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheServerAnswers(step, server, { accepted: 2, stale: [] });
		const bytes = Array.from({ length: 16 }, (_, i) => i + 1);
		let result;
		await step(
			'When putVectors is called with the model "eg/2", the revs [["r1", 3], ["r2", 4]] and a body of 16 bytes for 2 records of 8 bytes',
			async () => {
				result = {
					value: await storage.putVectors(
						"eg/2",
						[
							["r1", 3],
							["r2", 4],
						],
						{ body: new Uint8Array(bytes), size: 8, count: 2 },
					),
				};
			},
		);
		await step(
			"Then one request PUT /v1/vectors?model=eg%2F2&magic=lctyvLE0&size=8&entry_count=2&rev=r1:3,r2:4 is sent",
			() => {
				expect(server.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
					"PUT /v1/vectors?model=eg%2F2&magic=lctyvLE0&size=8&entry_count=2&rev=r1:3,r2:4",
				]);
			},
		);
		await step(
			"And its Content-Type is application/octet-stream and its body is the 16 bytes",
			() => {
				expect(server.requests[0].contentType).toBe("application/octet-stream");
				expect(server.requests[0].bytes).toEqual(bytes);
			},
		);
		await step('And it resolves to {"accepted": 2, "stale": []}', () => {
			expect(result).toEqual({ value: { accepted: 2, stale: [] } });
		});
	},
);

for (const [call, status, text, message] of [
	["listConversations()", 500, "boom", "500 boom"],
	['getConversation("nope")', 404, "not found", "404 not found"],
	["createConversation({}, [])", 409, "already exists", "409 already exists"],
	['popMessages("c1", 0)', 409, "too far back", "409 too far back"],
	['putVectors("eg", [], {})', 400, "bad magic", "400 bad magic"],
	['addMemory("t", {})', 404, "no such tag", "404 no such tag"],
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
