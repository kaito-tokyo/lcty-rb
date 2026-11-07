// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1018: the scenarios of docs/specs/LCTYSP-1018_tags.feature that need no browser, written by hand. Each test has
// the title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side
// by side.
//
// sortTags, composeDraft and proposeMemory of js/tags.js need no DOM: they run in Node.js (node-unit.js). The editor
// and the dialogs (renderTagsEditor, initTagsDialog, openMemoryDialog) stay in the browser, in tests/unit/tags.spec.js.
// Importing js/tags.js needs nothing absent in Node.js (its imports api/storage.js, api/meta-db.js and ui/markdown.js
// only touch Worker, IndexedDB and localStorage when called). tr() needs the global LctyT and
// document.documentElement.lang, made by useLctyT() (the stand-in of node-unit.js). GET and PUT /v1/tags,
// POST /v1/tags/:name/memory and the fake llama-server at http://llm.test are answered by routeFetch(), which also
// records what was sent.

import {
	expect,
	publicUrl,
	routeFetch,
	scenario,
	setLang,
	useLctyT,
} from "./node-unit.js";

await useLctyT({ lang: "en", langs: ["ja"] });
const T = await import(publicUrl("js/tags.js"));

const LLM_URL = "http://llm.test";

/** A Responses API stream (the events js/llm/responses.js reads) of these events, then [DONE]. */
function sse(events) {
	return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
}

/** A reply whose text is text, in deltas of 7 characters, completed with timings. */
function replyWith(text, timings = { prompt_n: 3, predicted_n: 9 }) {
	return () =>
		new Response(
			sse([
				...(text.match(/[\s\S]{1,7}/g) || []).map((delta) => ({
					type: "response.output_text.delta",
					delta,
				})),
				{ type: "response.completed", response: {}, timings },
			]),
			{ headers: { "Content-Type": "text/event-stream" } },
		);
}

// ---- Background ----

async function background(step, t) {
	const server = {
		tags: { tags: [] },
		puts: [],
		memory: [],
		llm: [],
		get: () => Response.json(server.tags),
		put: () => Response.json({ ok: true }),
		addMemory: () =>
			Response.json({ id: "m", text: "t", at: "now" }, { status: 201 }),
		answerLlm: replyWith('{"proposals":[]}'),
	};
	await step(
		"Given /v1/tags, /v1/tags/:name/memory and the llama-server at http://llm.test are answered by the test",
		() => {
			routeFetch(t, async (req) => {
				const url = new URL(req.url);
				if (url.origin === LLM_URL) {
					server.llm.push({
						url: req.url,
						authorization: req.headers.get("authorization"),
						body: await req.json(),
					});
					return server.answerLlm(req);
				}
				if (url.pathname === "/v1/tags") {
					if (req.method === "PUT") {
						server.puts.push(await req.json());
						return server.put(req);
					}
					return server.get(req);
				}
				const m = url.pathname.match(/^\/v1\/tags\/([^/]+)\/memory$/);
				if (m) {
					server.memory.push([decodeURIComponent(m[1]), await req.json()]);
					return server.addMemory(req);
				}
				return new Response("not found", { status: 404 });
			});
		},
	);
	return server;
}

// ---- Definitions ----

const RUBY = {
	name: "ruby",
	prompt: "Ruby prompt",
	memory: [{ text: "fact" }, { text: "rules" }],
};
const GO = { name: "go", prompt: "Go prompt", memory: [] };

// ---- sortTags and composeDraft ----

scenario(
	"Tag names are sorted in the order of the definitions",
	async ({ step, t }) => {
		await background(step, t);
		let defs;
		await step('Given the definitions "ruby", "go" and "rust"', () => {
			defs = [{ name: "ruby" }, { name: "go" }, { name: "rust" }];
		});
		let sorted;
		await step(
			'When sortTags sorts "rust", "zig", "ruby", "ada" and "rust"',
			() => {
				sorted = T.sortTags(defs, ["rust", "zig", "ruby", "ada", "rust"]);
			},
		);
		await step('Then it returns "ruby", "rust", "zig" and "ada"', () => {
			expect(sorted).toEqual(["ruby", "rust", "zig", "ada"]);
		});
	},
);

const compose = (defs, selected) =>
	T.composeDraft(structuredClone(defs), selected);

scenario(
	"The draft follows the definitions, not the order of the choice",
	async ({ step, t }) => {
		await background(step, t);
		let defs;
		await step(
			'Given the definitions "ruby" with a prompt and two memory items and "go" with a prompt and no memory',
			() => {
				defs = [RUBY, GO];
			},
		);
		let draft;
		await step(
			'When composeDraft composes the draft of "go" and "ruby"',
			() => {
				draft = compose(defs, ["go", "ruby"]);
			},
		);
		await step(
			'Then it is the prompt of "ruby", its memory under "# Memory (ruby)" and the prompt of "go", joined by blank lines',
			() => {
				expect(draft).toBe(
					"Ruby prompt\n\n# Memory (ruby)\n- fact\n- rules\n\nGo prompt",
				);
			},
		);
	},
);

scenario(
	"Empty prompts and blank memory items are left out of the draft",
	async ({ step, t }) => {
		await background(step, t);
		let defs;
		await step(
			'Given the definitions "a" with a blank prompt and the memory items " x " and "  ", "b" with neither and "c" with the prompt " only "',
			() => {
				defs = [
					{
						name: "a",
						prompt: " \n ",
						memory: [{ text: " x " }, { text: "  " }],
					},
					{ name: "b" },
					{ name: "c", prompt: " only " },
				];
			},
		);
		let draft;
		await step(
			'When composeDraft composes the draft of "a", "b" and "c"',
			() => {
				draft = compose(defs, ["a", "b", "c"]);
			},
		);
		await step('Then it is "# Memory (a)\\n- x\\n\\nonly"', () => {
			expect(draft).toBe("# Memory (a)\n- x\n\nonly");
		});
		await step('And the draft of no tags is ""', () => {
			expect(compose(defs, [])).toBe("");
		});
	},
);

scenario(
	"The memory heading of the draft is in the page's language",
	async ({ step, t }) => {
		await background(step, t);
		await step("Given the page is in Japanese", () => {
			setLang("ja");
			t.after(() => setLang("en"));
		});
		let draft;
		await step(
			'When composeDraft composes the draft of a tag "ruby" with the memory item "x"',
			() => {
				draft = compose(
					[{ name: "ruby", prompt: "", memory: [{ text: "x" }] }],
					["ruby"],
				);
			},
		);
		await step('Then it is "# メモリ（ruby）\\n- x"', () => {
			expect(draft).toBe("# メモリ（ruby）\n- x");
		});
	},
);

// ---- proposeMemory ----

/** proposeMemory: {result} or {error}, and the conversation's messages afterwards. */
async function propose({
	conv,
	defs,
	backend = { base_url: LLM_URL, model: "m" },
}) {
	// A copy, as page.evaluate passed one in the browser, so the test's own objects are what it compares with
	conv = structuredClone(conv);
	try {
		const result = await T.proposeMemory({
			conv,
			backend,
			defs: structuredClone(defs),
		});
		return structuredClone({ result, messages: conv.messages });
	} catch (e) {
		return { error: e.message, messages: structuredClone(conv.messages) };
	}
}

const PROMPT = [
	"From this conversation so far, propose what should be added to the memory of the following tags.",
	"Follow the policy written in each system prompt about what to remember. For a tag without a policy, you need not propose anything.",
	"Do not propose what is already in memory or what matters only for this conversation. Write each item in one or two sentences that can be understood on their own.",
	"If there is nothing to add, make proposals an empty array.",
	"",
	'- Current memory of the tag "ruby":',
	"  - existing",
	'- Current memory of the tag "go":',
	"  (none yet)",
].join("\n");

scenario(
	"A memory proposal continues the conversation with one temporary message",
	async ({ step, t }) => {
		const server = await background(step, t);
		let defs;
		await step(
			'Given the definitions "ruby" with the memory item "existing", "go" without memory and "python"',
			() => {
				defs = [
					{ name: "ruby", prompt: "p", memory: [{ text: "existing" }] },
					{ name: "go", prompt: "p" },
					{ name: "python", prompt: "p", memory: [] },
				];
			},
		);
		const messages = [
			{ id: "u1", role: "user", content: "q" },
			{ id: "a1", role: "assistant", content: "a", thinking: "t" },
			{ id: "a2", role: "assistant", content: "", error: "failed" },
		];
		let conv;
		await step(
			'And a conversation with the tags "ruby", "unknown" and "go", the instructions "Be brief" and a user message, a reply and an empty reply',
			() => {
				conv = {
					meta: { id: "c1", instructions: "Be brief" },
					tags: ["ruby", "unknown", "go"],
					messages,
				};
			},
		);
		await step(
			'And the model replies with proposals for "ruby", "python", "go" with blank text and "go"',
			() => {
				server.answerLlm = replyWith(
					JSON.stringify({
						proposals: [
							{ tag: "ruby", text: "  New fact  " },
							{ tag: "python", text: "Py fact" },
							{ tag: "go", text: "   " },
							{ tag: "go", text: "Go fact" },
						],
					}),
					{ prompt_n: 12, predicted_n: 30 },
				);
			},
		);
		let out;
		await step(
			'When proposeMemory asks for proposals with the backend "m" at http://llm.test/ and the key "k"',
			async () => {
				out = await propose({
					conv,
					defs,
					backend: {
						base_url: `${LLM_URL}/`,
						api_key: "k",
						model: "m",
						extra: { temperature: 0.2 },
					},
				});
			},
		);
		await step(
			"Then one request is sent to http://llm.test/v1/responses with the key as a bearer token",
			() => {
				expect(server.llm.map((r) => [r.url, r.authorization])).toEqual([
					[`${LLM_URL}/v1/responses`, "Bearer k"],
				]);
			},
		);
		await step(
			"And its body has the backend's extra, the model \"m\", stream, the instructions and the conversation's user message and reply",
			() => {
				const { body } = server.llm[0];
				expect(body).toMatchObject({
					temperature: 0.2,
					model: "m",
					stream: true,
					instructions: "Be brief",
				});
				expect(body.input.slice(0, -1)).toEqual([
					{ role: "user", content: "q" },
					{ type: "message", role: "assistant", content: "a" },
				]);
			},
		);
		await step(
			'And its last input is the temporary user message listing the current memory of "ruby" and "go"',
			() => {
				expect(server.llm[0].body.input.at(-1)).toEqual({
					role: "user",
					content: PROMPT,
				});
			},
		);
		await step(
			'And its response_format is the JSON schema "memory_proposals" with the tags "ruby" and "go"',
			() => {
				expect(server.llm[0].body.response_format).toEqual({
					type: "json_schema",
					json_schema: {
						name: "memory_proposals",
						schema: {
							type: "object",
							properties: {
								proposals: {
									type: "array",
									items: {
										type: "object",
										properties: {
											tag: { type: "string", enum: ["ruby", "go"] },
											text: { type: "string" },
										},
										required: ["tag", "text"],
									},
								},
							},
							required: ["proposals"],
						},
					},
				});
			},
		);
		await step(
			'And it returns the trimmed proposals for "ruby" and "go", the tags "ruby" and "go" and the timings of the reply',
			() => {
				expect(out.result).toEqual({
					proposals: [
						{ tag: "ruby", text: "New fact" },
						{ tag: "go", text: "Go fact" },
					],
					tags: ["ruby", "go"],
					timings: { prompt_n: 12, predicted_n: 30 },
				});
			},
		);
		await step("And the conversation's messages are unchanged", () => {
			expect(out.messages).toEqual(messages);
		});
	},
);

scenario(
	"A conversation without defined tags gets no proposal",
	async ({ step, t }) => {
		const server = await background(step, t);
		let defs;
		let conv;
		await step('Given the definitions "ruby"', () => {
			defs = [{ name: "ruby", prompt: "p" }];
		});
		await step('And a conversation with the tags "unknown"', () => {
			conv = { meta: {}, tags: ["unknown"], messages: [] };
		});
		let out;
		await step("When proposeMemory asks for proposals", async () => {
			out = await propose({ conv, defs });
		});
		await step('Then it throws "The conversation has no defined tags"', () => {
			expect(out.error).toBe("The conversation has no defined tags");
		});
		await step("And nothing is sent to the model", () => {
			expect(server.llm).toEqual([]);
		});
	},
);

async function givenRubyAndAConversation(step) {
	const defs = [{ name: "ruby", prompt: "p" }];
	const conv = {
		meta: {},
		tags: ["ruby"],
		messages: [{ role: "user", content: "q" }],
	};
	await step('Given the definitions "ruby"');
	await step('And a conversation with the tags "ruby"');
	return { defs, conv };
}

scenario("A reply without proposals proposes nothing", async ({ step, t }) => {
	const server = await background(step, t);
	const { defs, conv } = await givenRubyAndAConversation(step);
	await step('And the model replies with "{}"', () => {
		server.answerLlm = replyWith("{}");
	});
	let out;
	await step("When proposeMemory asks for proposals", async () => {
		out = await propose({ conv, defs });
	});
	await step('Then it returns no proposals and the tags "ruby"', () => {
		expect(out.result).toMatchObject({ proposals: [], tags: ["ruby"] });
	});
});

scenario("Proposals that are not objects are skipped", async ({ step, t }) => {
	const server = await background(step, t);
	const { defs, conv } = await givenRubyAndAConversation(step);
	await step(
		'And the model replies with the proposals null, 5, "x", a list and one for "ruby"',
		() => {
			server.answerLlm = replyWith(
				JSON.stringify({
					proposals: [null, 5, "x", ["ruby", "y"], { tag: "ruby", text: "ok" }],
				}),
			);
		},
	);
	let out;
	await step("When proposeMemory asks for proposals", async () => {
		out = await propose({ conv, defs });
	});
	await step('Then it returns only the proposal for "ruby"', () => {
		expect(out).toMatchObject({
			result: { proposals: [{ tag: "ruby", text: "ok" }], tags: ["ruby"] },
		});
	});
});

for (const { answer, message, fulfill } of [
	{
		answer: "replies with text that is not JSON",
		message: "Could not read the proposal as JSON",
		fulfill: replyWith("Sure! Here are some proposals"),
	},
	{
		answer: 'replies with "null"',
		message: "Could not read the proposal as JSON",
		fulfill: replyWith("null"),
	},
	{
		answer: "replies with a list",
		message: "Could not read the proposal as JSON",
		fulfill: replyWith('[{"tag":"ruby","text":"x"}]'),
	},
	{
		answer: "replies with proposals that is a text",
		message: "Could not read the proposal as JSON",
		fulfill: replyWith('{"proposals":"ruby: x"}'),
	},
	{
		answer: 'sends the error event "overloaded"',
		message: "overloaded",
		fulfill: () =>
			new Response(
				sse([
					{ type: "response.output_text.delta", delta: '{"prop' },
					{ type: "error", error: { message: "overloaded" } },
				]),
				{ headers: { "Content-Type": "text/event-stream" } },
			),
	},
	{
		answer: 'answers with the status 500 and "boom"',
		message: "HTTP 500: boom",
		fulfill: () =>
			Response.json({ error: { message: "boom" } }, { status: 500 }),
	},
]) {
	scenario(`A failed proposal throws (${answer})`, async ({ step, t }) => {
		const server = await background(step, t);
		const { defs, conv } = await givenRubyAndAConversation(step);
		await step(`And the model ${answer}`, () => {
			server.answerLlm = fulfill;
		});
		let out;
		await step("When proposeMemory asks for proposals", async () => {
			out = await propose({ conv, defs });
		});
		await step(`Then it throws "${message}"`, () => {
			expect(out.error).toBe(message);
		});
	});
}
