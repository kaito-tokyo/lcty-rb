// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1006: the scenarios of docs/specs/LCTYSP-1006_sse.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// parseSSE runs in a real browser on the test server's origin. Its body is a ReadableStream built in the page from the
// chunks of a test (as bytes, so a character can be split between two chunks), so no request is made.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** The bytes of a text, as a plain array that crosses into the page. */
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
 * Make the body in the page (window.lctyBody): a ReadableStream that gives chunks (arrays of bytes) one per read,
 * then closes, or with fail fails with that message.
 */
function makeBody(page, chunks, { fail } = {}) {
	return page.evaluate(
		({ chunks, fail }) => {
			let i = 0;
			window.lctyBody = new ReadableStream({
				async pull(c) {
					if (i < chunks.length) c.enqueue(new Uint8Array(chunks[i++]));
					else if (fail) {
						await new Promise((r) => setTimeout(r, 50));
						c.error(new Error(fail));
					} else c.close();
				},
			});
		},
		{ chunks, fail },
	);
}

/** Read window.lctyBody with parseSSE: {events: ["name \"data\"", …], error}, the data written as a JS string. */
function readBody(page) {
	return page.evaluate(async () => {
		const { parseSSE } = await import("/js/llm/sse.js");
		const events = [];
		let error = null;
		try {
			for await (const ev of parseSSE(window.lctyBody))
				events.push(`${ev.event} ${JSON.stringify(ev.data)}`);
		} catch (e) {
			error = e.message;
		}
		return { events, error };
	});
}

async function whenParseSSEReads(page) {
	let result;
	await test.step("When parseSSE reads it", async () => {
		result = await readBody(page);
	});
	return result;
}

async function thenItYields(result, events) {
	const line = events.length
		? `Then it yields ${events.join(", ")}`
		: "Then it yields nothing";
	await test.step(line, () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual(events);
	});
}

/** A Scenario of the form: Given a body that arrives as <given> / When parseSSE reads it / Then it yields <events>. */
function scenario(title, given, chunks, events) {
	test(title, async ({ page, context }) => {
		await givenAPage(page, context);
		await test.step(`Given a body that arrives as ${given}`, () =>
			makeBody(page, chunks));
		const result = await whenParseSSEReads(page);
		await thenItYields(result, events);
	});
}

// ---- Scenarios ----

scenario(
	"An event is yielded at its blank line",
	'the chunk "data: hello\\n\\n"',
	[bytes("data: hello\n\n")],
	['message "hello"'],
);

scenario(
	"One chunk may hold several events",
	'the chunk "data: a\\n\\ndata: b\\n\\ndata: c\\n\\n"',
	[bytes("data: a\n\ndata: b\n\ndata: c\n\n")],
	['message "a"', 'message "b"', 'message "c"'],
);

scenario(
	"An event may be split across chunks anywhere",
	'the chunks "da", "ta: hel", "lo\\n", "\\nda", "ta: wor", "ld\\n\\n"',
	["da", "ta: hel", "lo\n", "\nda", "ta: wor", "ld\n\n"].map(bytes),
	['message "hello"', 'message "world"'],
);

scenario(
	"A body that arrives one byte at a time gives the same events",
	'one byte at a time as "event: delta\\ndata: one\\ndata: two\\n\\n: note\\ndata: three\\n\\n"',
	cut("event: delta\ndata: one\ndata: two\n\n: note\ndata: three\n\n", 1),
	['delta "one\\ntwo"', 'message "three"'],
);

scenario(
	"The data lines of one event are joined with a line feed",
	'the chunk "data: one\\ndata: two\\ndata: three\\n\\n"',
	[bytes("data: one\ndata: two\ndata: three\n\n")],
	['message "one\\ntwo\\nthree"'],
);

scenario(
	"The event line names the event, only until its blank line",
	'the chunk "event: response.output_text.delta\\ndata: a\\n\\ndata: b\\n\\n"',
	[bytes("event: response.output_text.delta\ndata: a\n\ndata: b\n\n")],
	['response.output_text.delta "a"', 'message "b"'],
);

scenario(
	"Comments are skipped",
	'the chunk ": keep-alive\\n\\ndata: a\\n: between\\ndata: b\\n\\n"',
	[bytes(": keep-alive\n\ndata: a\n: between\ndata: b\n\n")],
	['message "a\\nb"'],
);

scenario(
	"An event without data is not yielded and its name is forgotten",
	'the chunk "event: ping\\n\\ndata: a\\n\\n"',
	[bytes("event: ping\n\ndata: a\n\n")],
	['message "a"'],
);

scenario(
	"Fields other than event and data are ignored",
	'the chunk "id: 7\\nretry: 1000\\nfoo: bar\\ndata: a\\n\\n"',
	[bytes("id: 7\nretry: 1000\nfoo: bar\ndata: a\n\n")],
	['message "a"'],
);

scenario(
	"Only one space after the colon is dropped",
	'the chunk "data:a\\n\\ndata:  b\\n\\ndata: c: d \\n\\n"',
	[bytes("data:a\n\ndata:  b\n\ndata: c: d \n\n")],
	['message "a"', 'message " b"', 'message "c: d "'],
);

scenario(
	"An empty data line is data",
	'the chunk "data:\\n\\ndata\\ndata\\n\\n"',
	[bytes("data:\n\ndata\ndata\n\n")],
	['message ""', 'message "\\n"'],
);

scenario(
	"Lines may end in CRLF",
	'the chunk "event: x\\r\\ndata: a\\r\\ndata: b\\r\\n\\r\\n"',
	[bytes("event: x\r\ndata: a\r\ndata: b\r\n\r\n")],
	['x "a\\nb"'],
);

scenario(
	"A CRLF may be split across chunks",
	'the chunks "data: a\\r", "\\n\\r", "\\ndata: b\\r", "\\n\\r\\n"',
	["data: a\r", "\n\r", "\ndata: b\r", "\n\r\n"].map(bytes),
	['message "a"', 'message "b"'],
);

scenario(
	"A character split across chunks is decoded whole",
	'the bytes of "data: こんにちは🎉\\n\\n" in chunks of 4 bytes',
	cut("data: こんにちは🎉\n\n", 4),
	['message "こんにちは🎉"'],
);

scenario(
	"A byte order mark at the start is dropped",
	'the bytes EF BB BF followed by the chunk "data: a\\n\\n"',
	[[0xef, 0xbb, 0xbf], bytes("data: a\n\n")],
	['message "a"'],
);

scenario(
	"At the end of the stream the last event is yielded without its blank line",
	'the chunks "data: a\\n\\n", "event: last\\ndata: b\\n"',
	[bytes("data: a\n\n"), bytes("event: last\ndata: b\n")],
	['message "a"', 'last "b"'],
);

scenario(
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
	scenario(`A body without events yields nothing (${body})`, body, chunks, []);
}

test("Events are yielded as they arrive, before the stream ends", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await test.step('Given a body that has sent the chunk "data: first\\n\\n" and stays open', async () => {
		await page.evaluate(async (chunk) => {
			const { parseSSE } = await import("/js/llm/sse.js");
			window.lctyBody = { closed: false };
			const body = new ReadableStream({
				start(c) {
					c.enqueue(new Uint8Array(chunk)); // and never closes
				},
				cancel() {
					window.lctyBody.closed = true;
				},
			});
			window.lctyEvents = parseSSE(body);
		}, bytes("data: first\n\n"));
	});
	let result;
	await test.step("When parseSSE reads its first event", async () => {
		result = await page.evaluate(async () => {
			const timeout = new Promise((r) => setTimeout(() => r("timeout"), 2000));
			const next = await Promise.race([window.lctyEvents.next(), timeout]);
			return next === "timeout"
				? { timeout: true }
				: { value: next.value, done: next.done };
		});
	});
	await test.step('Then it yields message "first" while the body is still open', async () => {
		expect(result).toEqual({
			value: { event: "message", data: "first" },
			done: false,
		});
		expect(await page.evaluate(() => window.lctyBody.closed)).toBe(false);
	});
});

test("A failed body rejects after the events that arrived before it", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await test.step('Given a body that sends the chunk "data: a\\n\\n" and then fails with the error "network lost"', () =>
		makeBody(page, [bytes("data: a\n\n")], { fail: "network lost" }));
	const result = await whenParseSSEReads(page);
	await test.step('Then it yields message "a"', () => {
		expect(result.events).toEqual(['message "a"']);
	});
	await test.step('And it then rejects with the error "network lost"', () => {
		expect(result.error).toBe("network lost");
	});
});
