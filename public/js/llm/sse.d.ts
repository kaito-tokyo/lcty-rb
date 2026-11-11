// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Server-Sent Events parser. Turns a fetch ReadableStream into a sequence of {event, data}.

/**
 * Yield the events of an SSE body: event is the event field ("message" when absent), data the data fields joined with
 * "\n". Lines may end with "\n" or "\r\n"; comment lines (":") and other fields are ignored; an event without data is
 * not yielded; one left unterminated at the end of the stream is still yielded. The reader's lock is released at the
 * end, also when the consumer stops early.
 */
export function parseSSE(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }, void, undefined>;
