// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Saved data → Responses API input, laid out unchanged to keep the cache effective (LCTYSP-0002).

export function buildRequest({ instructions, messages }) {
	const input = [];
	for (const m of messages) {
		if (m.role === "user") {
			input.push({ role: "user", content: m.content });
		} else if (m.role === "assistant" && m.content) {
			input.push({ type: "message", role: "assistant", content: m.content });
		}
	}
	return { instructions: instructions || "", input };
}
