// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1008: the scenarios of docs/specs/LCTYSP-1008_llm-request.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// js/llm/history.js needs no browser: buildRequest, a pure function, runs in Node.js (node-unit.js). The conversation
// is given as plain objects, so it makes no request.

import { expect, publicUrl, scenario } from "./node-unit.js";

const { buildRequest } = await import(publicUrl("js/llm/history.js"));

const user = (content, extra = {}) => ({ role: "user", content, ...extra });
const assistant = (content, extra = {}) => ({
	role: "assistant",
	content,
	...extra,
});
const sentUser = (content) => ({ role: "user", content });
const sentAssistant = (content) => ({
	type: "message",
	role: "assistant",
	content,
});

async function whenBuilt(
	step,
	conv,
	line = "When buildRequest is called with them",
) {
	let request;
	await step(line, () => {
		request = buildRequest(conv);
	});
	return request;
}

// ---- Scenarios ----

scenario(
	"A user message is sent with its role and content",
	async ({ step }) => {
		let conv;
		await step(
			'Given the messages [{"role": "user", "content": "Hello"}]',
			() => {
				conv = { messages: [user("Hello")] };
			},
		);
		const request = await whenBuilt(step, conv);
		await step(
			'Then the input is [{"role": "user", "content": "Hello"}]',
			() => {
				expect(request.input).toStrictEqual([sentUser("Hello")]);
			},
		);
	},
);

scenario("An assistant message is sent as a message item", async ({ step }) => {
	let conv;
	await step(
		'Given the messages [{"role": "assistant", "content": "Hi there"}]',
		() => {
			conv = { messages: [assistant("Hi there")] };
		},
	);
	const request = await whenBuilt(step, conv);
	await step(
		'Then the input is [{"type": "message", "role": "assistant", "content": "Hi there"}]',
		() => {
			expect(request.input).toStrictEqual([sentAssistant("Hi there")]);
		},
	);
});

scenario("A conversation is sent in its order", async ({ step }) => {
	let conv;
	await step(
		'Given a conversation of a user message "1", an assistant message "2", a user message "3" and an assistant message "4"',
		() => {
			conv = {
				messages: [user("1"), assistant("2"), user("3"), assistant("4")],
			};
		},
	);
	const request = await whenBuilt(
		step,
		conv,
		"When buildRequest is called with it",
	);
	await step(
		'Then the input holds the four messages in that order, with type "message" on the assistant\'s',
		() => {
			expect(request.input).toStrictEqual([
				sentUser("1"),
				sentAssistant("2"),
				sentUser("3"),
				sentAssistant("4"),
			]);
		},
	);
});

scenario("The instructions go to the top level", async ({ step }) => {
	let conv;
	await step(
		'Given the instructions "Be brief" and a user message "Hello"',
		() => {
			conv = { instructions: "Be brief", messages: [user("Hello")] };
		},
	);
	const request = await whenBuilt(step, conv);
	await step(
		'Then the request is {"instructions": "Be brief", "input": [{"role": "user", "content": "Hello"}]}',
		() => {
			expect(request).toStrictEqual({
				instructions: "Be brief",
				input: [sentUser("Hello")],
			});
		},
	);
});

for (const { instructions, value } of [
	{ instructions: "not set" },
	{ instructions: "null", value: null },
	{ instructions: '""', value: "" },
]) {
	scenario(
		`Missing instructions become an empty string (${instructions})`,
		async ({ step }) => {
			const conv = { messages: [user("Hi")] };
			await step(
				`Given a conversation whose instructions are ${instructions}`,
				() => {
					if (instructions !== "not set") conv.instructions = value;
				},
			);
			const request = await whenBuilt(
				step,
				conv,
				"When buildRequest is called with it",
			);
			await step('Then the request\'s instructions are ""', () => {
				expect(request.instructions).toBe("");
			});
		},
	);
}

scenario("Past thinking is not sent", async ({ step }) => {
	let conv;
	await step(
		'Given an assistant message with the thinking "Let me think" and the content "Answer"',
		() => {
			conv = { messages: [assistant("Answer", { thinking: "Let me think" })] };
		},
	);
	const request = await whenBuilt(
		step,
		conv,
		"When buildRequest is called with it",
	);
	await step(
		'Then the input is [{"type": "message", "role": "assistant", "content": "Answer"}]',
		() => {
			expect(request.input).toStrictEqual([sentAssistant("Answer")]);
		},
	);
});

for (const { content, reply } of [
	{ content: '""', reply: assistant("") },
	{ content: "not set", reply: { role: "assistant", thinking: "…" } },
	{ content: "null", reply: assistant(null) },
]) {
	scenario(
		`An assistant message with an empty body is not sent (${content})`,
		async ({ step }) => {
			let conv;
			await step(
				`Given a user message "Q", an assistant message whose content is ${content} and a user message "Q again"`,
				() => {
					conv = { messages: [user("Q"), reply, user("Q again")] };
				},
			);
			const request = await whenBuilt(step, conv);
			await step("Then the input holds only the two user messages", () => {
				expect(request.input).toStrictEqual([
					sentUser("Q"),
					sentUser("Q again"),
				]);
			});
		},
	);
}

scenario(
	"Messages copied by a fork are sent like any other",
	async ({ step }) => {
		let conv;
		await step(
			"Given a user message and an assistant message marked inherited, then a user message of this conversation",
			() => {
				conv = {
					messages: [
						user("old question", { inherited: true }),
						assistant("old answer", { inherited: true }),
						user("new question"),
					],
				};
			},
		);
		const request = await whenBuilt(step, conv);
		await step(
			"Then the input holds the three messages, without the mark",
			() => {
				expect(request.input).toStrictEqual([
					sentUser("old question"),
					sentAssistant("old answer"),
					sentUser("new question"),
				]);
			},
		);
	},
);

scenario(
	"Only the role and the content of a message are sent",
	async ({ step }) => {
		let conv;
		await step(
			"Given a user message and an assistant message that also have an id, a time, content_html and other fields",
			() => {
				const extra = {
					id: "0190d6a8-0000-7000-8000-000000000001",
					at: "2026-11-07T00:00:00.000Z",
					content_html: "<p>x</p>",
					backend: "local",
					usage: { input_tokens: 1 },
				};
				conv = { messages: [user("Q", extra), assistant("A", extra)] };
			},
		);
		const request = await whenBuilt(step, conv);
		await step(
			"Then each item of the input has only role and content, and type for the assistant's",
			() => {
				expect(request.input).toStrictEqual([
					sentUser("Q"),
					sentAssistant("A"),
				]);
			},
		);
	},
);

scenario("The saved strings are sent exactly as they are", async ({ step }) => {
	const question = "  spaced\r\n**bold**\n\n";
	const answer = "```js\nx\n```\n ";
	let conv;
	await step(
		'Given a user message "  spaced\\r\\n**bold**\\n\\n" and an assistant message "```js\\nx\\n```\\n "',
		() => {
			conv = { messages: [user(question), assistant(answer)] };
		},
	);
	const request = await whenBuilt(step, conv);
	await step(
		"Then the contents in the input are those strings, unchanged",
		() => {
			expect(request.input.map((m) => m.content)).toStrictEqual([
				question,
				answer,
			]);
		},
	);
});

scenario("No messages give an empty input", async ({ step }) => {
	let conv;
	await step('Given the instructions "Be brief" and no messages', () => {
		conv = { instructions: "Be brief", messages: [] };
	});
	const request = await whenBuilt(step, conv);
	await step(
		'Then the request is {"instructions": "Be brief", "input": []}',
		() => {
			expect(request).toStrictEqual({ instructions: "Be brief", input: [] });
		},
	);
});

scenario(
	"The next turn starts with the input of the turn before",
	async ({ step }) => {
		let conv;
		await step("Given a conversation of a user message and its reply", () => {
			conv = {
				instructions: "Be brief",
				messages: [user("Q1"), assistant("A1", { thinking: "t1" })],
			};
		});
		let first;
		let second;
		await step(
			"When buildRequest is called with it, and again after a reply and the next user message are added",
			() => {
				first = buildRequest(conv);
				second = buildRequest({
					...conv,
					messages: [
						...conv.messages,
						user("Q2"),
						assistant("A2", { thinking: "t2" }),
						user("Q3"),
					],
				});
			},
		);
		await step(
			"Then the second input starts with the whole first input",
			() => {
				expect(second.instructions).toBe(first.instructions);
				expect(first.input).toHaveLength(2);
				expect(second.input.slice(0, first.input.length)).toStrictEqual(
					first.input,
				);
				expect(second.input).toHaveLength(5);
			},
		);
	},
);

scenario("The given conversation is left as it was", async ({ step }) => {
	let conv;
	await step(
		"Given a conversation with instructions, thinking and an assistant message with an empty body",
		() => {
			conv = {
				instructions: "Be brief",
				messages: [
					user("Q"),
					assistant("", { thinking: "t" }),
					user("Q again"),
					assistant("A", { thinking: "t2", id: "x" }),
				],
			};
		},
	);
	let copy;
	await step("When buildRequest is called with it", () => {
		copy = structuredClone(conv);
		buildRequest(conv);
	});
	await step(
		"Then the conversation is still equal to a copy made before the call",
		() => {
			expect(conv).toStrictEqual(copy);
		},
	);
});
