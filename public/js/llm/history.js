// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Saved data → Responses API input (LCTYSP-002).
// To keep the cache effective, this is a pure function that lays out the saved strings mechanically, without changing them.
//  - past thinking is not sent
//  - assistant messages with an empty body (aborted by an error) are not sent
//  - assistant items require type: "message" (400 without it)
//  - messages copied from the fork source (inherited) are treated like any other message

export function buildRequest({ instructions, thinking, messages }) {
	const input = [];
	for (const m of messages) {
		if (m.role === "user") {
			input.push({ role: "user", content: m.content });
		} else if (m.role === "assistant" && m.content) {
			input.push({ type: "message", role: "assistant", content: m.content });
		}
	}
	return { instructions: instructions || "", input, thinking: !!thinking };
}
