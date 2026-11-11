// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Adapter for the Responses API (POST /v1/responses, stream: true).
// Converts llama-server events into common events { type: 'text' | 'thinking' | 'done' | 'error' } (LCTYSP-0002).

/** A backend as the settings describe it. */
export interface Backend {
	/** The URL the path /v1/responses is appended to (trailing slashes removed). */
	base_url: string;
	/** Sent as model; "default" when absent. */
	model?: string;
	/** Sent as Authorization: Bearer <api_key> when present. */
	api_key?: string;
	/** Parameters merged into every request body. */
	extra?: Record<string, unknown>;
	/** The API of the backend; "responses" when absent (llm/client.js). */
	api?: string;
}

/** The common events of a stream (LCTYSP-0002). */
export type LlmEvent =
	| { type: "text"; delta: string }
	| { type: "thinking"; delta: string }
	/** The response ended (incomplete when it was cut off, e.g. by the token limit). */
	| { type: "done"; incomplete?: true; usage?: unknown; timings?: unknown }
	| { type: "error"; message: string };

/** The options of a stream. */
export interface StreamOptions {
	backend: Backend;
	instructions?: string;
	input: unknown[];
	/** Parameters added for this one request only (e.g. response_format for memory proposals). */
	extraBody?: Record<string, unknown>;
	signal?: AbortSignal;
}

/**
 * POST <base_url>/v1/responses with stream: true and yield the common events: response.output_text.delta as text,
 * response.reasoning_text.delta as thinking, response.completed and response.incomplete (incomplete: true) as done,
 * and response.failed and error as error; the stream ends after done, error or data [DONE]. Data that is not JSON is
 * skipped. A response that is not ok throws "HTTP <status>: <message>", the message being the body's error.message or
 * the status text.
 *
 * The body is backend.extra, then extraBody, then model, stream: true and input (and instructions when given). Whether
 * the model thinks is left to llama-server (its defaults / chat template): no enable_thinking is sent (LCTYSP-0002).
 */
export function streamResponses(
	opts: StreamOptions,
): AsyncGenerator<LlmEvent, void, undefined>;

// Internals:
//
// buildBody(opts): the request body described above; extraBody holds parameters added for this one request only.
