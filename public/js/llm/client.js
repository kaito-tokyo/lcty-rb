// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Interface shared by backends (LCTYSP-002).
// stream({ backend, instructions, input, signal }) → AsyncIterator<Event>

import { streamResponses } from "./responses.js";

export function stream(opts) {
	const api = opts.backend.api || "responses";
	if (api === "responses") return streamResponses(opts);
	throw new Error(`unsupported api: ${api}`);
}
