// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Saved data → Responses API input (LCTYSP-0002).
// To keep the cache effective, this is a pure function that lays out the saved strings mechanically, without changing
// them.
//  - past thinking is not sent
//  - assistant messages with an empty body (aborted by an error) are not sent
//  - assistant items require type: "message" (400 without it)
//  - messages copied from the fork source (inherited) are treated like any other message

/** One item of the Responses API input. */
export type InputItem =
	| { role: "user"; content: string }
	| { type: "message"; role: "assistant"; content: string };

/**
 * The request for the saved messages: {instructions ("" when absent), input}. User messages are sent as they are;
 * assistant messages with a body as type "message" items, without their thinking; other messages are left out.
 */
export function buildRequest(saved: {
	instructions?: string;
	messages: { role: string; content?: string; [key: string]: unknown }[];
}): { instructions: string; input: InputItem[] };
