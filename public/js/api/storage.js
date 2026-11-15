// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Client for the reads of the lcty.rb HTTP API (LCTYSP-0006, LCTYSP-0003, LCTYSP-0005).

import { siteUrl } from "../site.js";

/** The error of a failed request, with the HTTP status as status. */
function httpError(status, body) {
	const e = new Error(`${status} ${body.slice(0, 200)}`);
	e.status = status;
	return e;
}

async function request(method, path, body) {
	const init = { method, headers: {} };
	if (body !== undefined) {
		init.headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const r = await fetch(siteUrl(path), init);
	if (!r.ok) throw httpError(r.status, await r.text());
	return r.json();
}

function conv(id) {
	return `v1/conversations/${encodeURIComponent(id)}`;
}

export function listConversations() {
	return request("GET", "v1/conversations");
}
/** { meta, title, tags, messages } (for reading a conversation outside its page, e.g. forking) */
export function getConversation(id) {
	return request("GET", conv(id));
}
/** Defaults of the browser settings (LCTYSP-0010). */
export function getDefaults() {
	return request("GET", "v1/defaults.json");
}

// ---- Search index (LCTYSP-0006, LCTYSP-0007) ----
/** Keyword search: {q, tags, limit} → {results: [{id, conv_id, snippet}]} (in rank order) */
export function searchConversations(body) {
	return request("POST", "v1/search", body);
}
/** Snippets of rounds: {ids, q} → { id: {conv_id, snippet} } */
export function fetchSnippets(ids, q) {
	return request("POST", "v1/snippets", { ids, q });
}
