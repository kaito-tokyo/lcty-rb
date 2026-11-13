// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Client for the lcty.rb storage API (LCTYSP-0006, LCTYSP-0003, LCTYSP-0005).

import { replyHtml } from "../convert/reply.js";
import { siteUrl } from "../site.js";

/** The error of a failed request, with the HTTP status as status. */
function httpError(status, body) {
	const e = new Error(`${status} ${body.slice(0, 200)}`);
	e.status = status;
	return e;
}

async function send(method, path, body, headers = {}) {
	const init = { method, headers: { ...headers } };
	if (body !== undefined) {
		init.headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const r = await fetch(siteUrl(path), init);
	if (!r.ok) throw httpError(r.status, await r.text());
	return r;
}

async function request(method, path, body, { raw = false } = {}) {
	const r = await send(method, path, body);
	return raw ? r.text() : r.json();
}

/** A request that changes conversations (the copies of the list hear of it over /v1/rpc, LCTYSP-0014). */
function write(method, url, body) {
	return request(method, url, body);
}

function conv(id) {
	return `v1/conversations/${encodeURIComponent(id)}`;
}

/** Message → line to append; replies also carry content_html (LCTYSP-0003). */
export function toLine(m) {
	const line = { type: "message", ...m };
	if (m.role === "assistant") line.content_html = replyHtml(m.content || "");
	return line;
}

export function listConversations() {
	return request("GET", "v1/conversations");
}
/** { meta, title, tags, messages } (for reading a conversation outside its page, e.g. forking) */
export function getConversation(id) {
	return request("GET", conv(id));
}
/** Create a conversation from meta and initial lines (e.g. lines copied from the fork source). */
export function createConversation(meta, lines) {
	return write("POST", "v1/conversations", { meta, lines });
}
export function appendLines(id, lines) {
	return write("POST", `${conv(id)}/lines`, lines);
}
/** Delete messages from index from, at most the last turn (LCTYSP-0004). */
export function popMessages(id, from) {
	return write("POST", `${conv(id)}/pop`, { from });
}
export function deleteConversation(id) {
	return write("DELETE", conv(id));
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
