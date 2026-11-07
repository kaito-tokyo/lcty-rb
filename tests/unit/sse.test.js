// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1006: the scenarios of docs/specs/LCTYSP-1006_sse.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// js/llm/sse.js needs no browser: parseSSE runs in Node.js (node-unit.js), whose ReadableStream and TextDecoderStream
// are the web's. Its body is a ReadableStream built from the chunks of a test (as bytes, so a character can be split
// between two chunks), so no request is made.

import { expect, publicUrl, scenario } from "./node-unit.js";

const { parseSSE } = await import(publicUrl("js/llm/sse.js"));

/** The bytes of a text. */
const bytes = (text) => [...Buffer.from(text, "utf8")];

/** The bytes of text cut into chunks of size bytes. */
function cut(text, size) {
	const all = bytes(text);
	const chunks = [];
	for (let i = 0; i < all.length; i += size)
		chunks.push(all.slice(i, i + size));
	return chunks;
}

/**
 * A body: a ReadableStream that gives chunks (arrays of bytes) one per read, then closes, or with fail fails with that
 * message.
 */
function makeBody(chunks, { fail } = {}) {
	let i = 0;
	return new ReadableStream({
		async pull(c) {
			if (i < chunks.length) c.enqueue(new Uint8Array(chunks[i++]));
			else if (fail) {
				await new Promise((r) => setTimeout(r, 50));
				c.error(new Error(fail));
			} else c.close();
		},
	});
}

/** Read body with parseSSE: {events: ["name \"data\"", …], error}, the data written as a JS string. */
async function readBody(body) {
	const events = [];
	let error = null;
	try {
		for await (const ev of parseSSE(body))
			events.push(`${ev.event} ${JSON.stringify(ev.data)}`);
	} catch (e) {
		error = e.message;
	}
	return { events, error };
}

async function whenParseSSEReads(step, body) {
	let result;
	await step("When parseSSE reads it", async () => {
		result = await readBody(body);
	});
	return result;
}

async function thenItYields(step, result, events) {
	const line = events.length
		? `Then it yields ${events.join(", ")}`
		: "Then it yields nothing";
	await step(line, () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual(events);
	});
}

/** A Scenario of the form: Given a body that arrives as <given> / When parseSSE reads it / Then it yields <events>. */
function bodyScenario(title, given, chunks, events) {
	scenario(title, async ({ step }) => {
		let body;
		await step(`Given a body that arrives as ${given}`, () => {
			body = makeBody(chunks);
		});
		const result = await whenParseSSEReads(step, body);
		await thenItYields(step, result, events);
	});
}

// ---- Scenarios ----

bodyScenario(
	"An event is yielded at its blank line",
	'the chunk "data: hello\\n\\n"',
	[bytes("data: hello\n\n")],
	['message "hello"'],
);

bodyScenario(
	"One chunk may hold several events",
	'the chunk "data: a\\n\\ndata: b\\n\\ndata: c\\n\\n"',
	[bytes("data: a\n\ndata: b\n\ndata: c\n\n")],
	['message "a"', 'message "b"', 'message "c"'],
);

bodyScenario(
	"An event may be split across chunks anywhere",
	'the chunks "da", "ta: hel", "lo\\n", "\\nda", "ta: wor", "ld\\n\\n"',
	["da", "ta: hel", "lo\n", "\nda", "ta: wor", "ld\n\n"].map(bytes),
	['message "hello"', 'message "world"'],
);

bodyScenario(
	"A body that arrives one byte at a time gives the same events",
	'one-byte chunks of "event: delta\\ndata: one\\ndata: two\\n\\n: note\\ndata: three\\n\\n"',
	cut("event: delta\ndata: one\ndata: two\n\n: note\ndata: three\n\n", 1),
	['delta "one\\ntwo"', 'message "three"'],
);

bodyScenario(
	"The data lines of one event are joined with a line feed",
	'the chunk "data: one\\ndata: two\\ndata: three\\n\\n"',
	[bytes("data: one\ndata: two\ndata: three\n\n")],
	['message "one\\ntwo\\nthree"'],
);

bodyScenario(
	"The event line names the event, only until its blank line",
	'the chunk "event: response.output_text.delta\\ndata: a\\n\\ndata: b\\n\\n"',
	[bytes("event: response.output_text.delta\ndata: a\n\ndata: b\n\n")],
	['response.output_text.delta "a"', 'message "b"'],
);

bodyScenario(
	"Comments are skipped",
	'the chunk ": keep-alive\\n\\ndata: a\\n: between\\ndata: b\\n\\n"',
	[bytes(": keep-alive\n\ndata: a\n: between\ndata: b\n\n")],
	['message "a\\nb"'],
);

bodyScenario(
	"An event without data is not yielded and its name is forgotten",
	'the chunk "event: ping\\n\\ndata: a\\n\\n"',
	[bytes("event: ping\n\ndata: a\n\n")],
	['message "a"'],
);

bodyScenario(
	"Fields other than event and data are ignored",
	'the chunk "id: 7\\nretry: 1000\\nfoo: bar\\ndata: a\\n\\n"',
	[bytes("id: 7\nretry: 1000\nfoo: bar\ndata: a\n\n")],
	['message "a"'],
);

bodyScenario(
	"Only one space after the colon is dropped",
	'the chunk "data:a\\n\\ndata:  b\\n\\ndata: c: d \\n\\n"',
	[bytes("data:a\n\ndata:  b\n\ndata: c: d \n\n")],
	['message "a"', 'message " b"', 'message "c: d "'],
);

bodyScenario(
	"An empty data line is data",
	'the chunk "data:\\n\\ndata\\ndata\\n\\n"',
	[bytes("data:\n\ndata\ndata\n\n")],
	['message ""', 'message "\\n"'],
);

bodyScenario(
	"Lines may end in CRLF",
	'the chunk "event: x\\r\\ndata: a\\r\\ndata: b\\r\\n\\r\\n"',
	[bytes("event: x\r\ndata: a\r\ndata: b\r\n\r\n")],
	['x "a\\nb"'],
);

bodyScenario(
	"A CRLF may be split across chunks",
	'the chunks "data: a\\r", "\\n\\r", "\\ndata: b\\r", "\\n\\r\\n"',
	["data: a\r", "\n\r", "\ndata: b\r", "\n\r\n"].map(bytes),
	['message "a"', 'message "b"'],
);

bodyScenario(
	"A character split across chunks is decoded whole",
	'the bytes of "data: こんにちは🎉\\n\\n" in chunks of 4 bytes',
	cut("data: こんにちは🎉\n\n", 4),
	['message "こんにちは🎉"'],
);

bodyScenario(
	"A byte order mark at the start is dropped",
	'the bytes EF BB BF followed by the chunk "data: a\\n\\n"',
	[[0xef, 0xbb, 0xbf], bytes("data: a\n\n")],
	['message "a"'],
);

bodyScenario(
	"At the end of the stream the last event is yielded without its blank line",
	'the chunks "data: a\\n\\n", "event: last\\ndata: b\\n"',
	[bytes("data: a\n\n"), bytes("event: last\ndata: b\n")],
	['message "a"', 'last "b"'],
);

bodyScenario(
	"A last line without its line feed is not read",
	'the chunks "data: a\\n\\n", "data: partial"',
	[bytes("data: a\n\n"), bytes("data: partial")],
	['message "a"'],
);

for (const { body, chunks } of [
	{ body: "no chunks", chunks: [] },
	{ body: 'the chunk "\\n\\n\\n"', chunks: [bytes("\n\n\n")] },
	{
		body: 'the chunk ": only a comment\\n\\n"',
		chunks: [bytes(": only a comment\n\n")],
	},
	{
		body: 'the chunk "event: ping\\nid: 1\\n\\n"',
		chunks: [bytes("event: ping\nid: 1\n\n")],
	},
]) {
	bodyScenario(
		`A body without events yields nothing (${body})`,
		body,
		chunks,
		[],
	);
}

scenario(
	"Events are yielded as they arrive, before the stream ends",
	async ({ step }) => {
		const state = { closed: false };
		let events;
		await step(
			'Given a body that has sent the chunk "data: first\\n\\n" and stays open',
			() => {
				const chunk = bytes("data: first\n\n");
				const body = new ReadableStream({
					start(c) {
						c.enqueue(new Uint8Array(chunk)); // and never closes
					},
					cancel() {
						state.closed = true;
					},
				});
				events = parseSSE(body);
			},
		);
		let result;
		await step("When parseSSE reads its first event", async () => {
			let timer;
			const timeout = new Promise((r) => {
				timer = setTimeout(() => r("timeout"), 2000);
			});
			const next = await Promise.race([events.next(), timeout]);
			clearTimeout(timer);
			result =
				next === "timeout"
					? { timeout: true }
					: { value: next.value, done: next.done };
		});
		await step(
			'Then it yields message "first" while the body is still open',
			() => {
				expect(result).toEqual({
					value: { event: "message", data: "first" },
					done: false,
				});
				expect(state.closed).toBe(false);
			},
		);
	},
);

scenario(
	"A failed body rejects after the events that arrived before it",
	async ({ step }) => {
		let body;
		await step(
			'Given a body that sends the chunk "data: a\\n\\n" and then fails with the error "network lost"',
			() => {
				body = makeBody([bytes("data: a\n\n")], { fail: "network lost" });
			},
		);
		const result = await whenParseSSEReads(step, body);
		await step('Then it yields message "a"', () => {
			expect(result.events).toEqual(['message "a"']);
		});
		await step('And it then rejects with the error "network lost"', () => {
			expect(result.error).toBe("network lost");
		});
	},
);
