// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Adapter for the Responses API (POST /v1/responses, stream: true).
// Converts llama-server events into common events { type: 'text' | 'thinking' | 'done' | 'error' } (LCTYSP-002).

import { parseSSE } from "./sse.js";

function buildBody({ backend, instructions, input, thinking, extraBody }) {
	const extra = backend.extra || {};
	// extraBody: parameters added for this one request only (e.g. response_format for memory proposals)
	const body = {
		...extra,
		...(extraBody || {}),
		model: backend.model || "default",
		stream: true,
		input,
	};
	if (instructions) body.instructions = instructions;
	if (backend.thinking_kwarg !== false) {
		// Thinking is fixed per conversation (LCTYSP-002). Always send it explicitly so the prefix stays identical.
		body.chat_template_kwargs = {
			...(extra.chat_template_kwargs || {}),
			enable_thinking: !!thinking,
		};
	}
	return body;
}

export async function* streamResponses(opts) {
	const { backend, signal } = opts;
	const url = `${backend.base_url.replace(/\/+$/, "")}/v1/responses`;
	const headers = { "Content-Type": "application/json" };
	if (backend.api_key) headers.Authorization = `Bearer ${backend.api_key}`;

	const res = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(buildBody(opts)),
		signal,
	});
	if (!res.ok) {
		let msg = res.statusText;
		try {
			const j = await res.json();
			msg = j.error?.message || msg;
		} catch {}
		throw new Error(`HTTP ${res.status}: ${msg}`);
	}

	for await (const ev of parseSSE(res.body)) {
		if (ev.data === "[DONE]") return;
		let j;
		try {
			j = JSON.parse(ev.data);
		} catch {
			continue;
		}
		switch (j.type) {
			case "response.output_text.delta":
				yield { type: "text", delta: j.delta };
				break;
			case "response.reasoning_text.delta":
				yield { type: "thinking", delta: j.delta };
				break;
			case "response.completed":
				yield { type: "done", usage: j.response?.usage, timings: j.timings };
				return;
			case "response.incomplete":
				yield {
					type: "done",
					incomplete: true,
					usage: j.response?.usage,
					timings: j.timings,
				};
				return;
			case "response.failed":
			case "error":
				yield {
					type: "error",
					message:
						j.error?.message || j.response?.error?.message || "unknown error",
				};
				return;
		}
	}
}
