// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Interface shared by backends (LCTYSP-0002).
// stream({ backend, instructions, input, signal }) → AsyncIterator<Event>

import type { LlmEvent, StreamOptions } from "./responses.js";

/**
 * Stream a response from opts.backend as the common events. backend.api picks the adapter ("responses", the default,
 * is llm/responses.js); any other api throws "unsupported api: <api>".
 */
export function stream(
	opts: StreamOptions,
): AsyncGenerator<LlmEvent, void, undefined>;
