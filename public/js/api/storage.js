// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Client for the lcty.rb storage API (LCTYSP-0006). Conversations are only created, appended to and popped (Ruby decides the format. LCTYSP-0003).
// The paths are relative to the root of the site (v1/…), which siteUrl() turns into URLs (LCTYSP-0005).

import { siteUrl } from "../site.js";
import { renderMarkdown } from "../ui/markdown.js";
import { requestMetaDbSync } from "./meta-db.js";

/** The error of a failed request: the message is "<status> <body>", and status is the HTTP status. */
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

/**
 * A request that changes conversations. The browser's copy of their meta is synced afterwards (api/meta-db.js), also
 * when the request failed (the server may have written part of it).
 */
async function write(method, url, body) {
	try {
		return await request(method, url, body);
	} finally {
		requestMetaDbSync();
	}
}

function conv(id) {
	return `v1/conversations/${encodeURIComponent(id)}`;
}

/**
 * Message → line to append. Replies carry presentation HTML (content_html) (dual recording. LCTYSP-0003).
 * It is rendered with the same markdown.js as the screen, so what is saved matches what is shown.
 */
export function toLine(m) {
	const line = { type: "message", ...m };
	if (m.role === "assistant")
		line.content_html = renderMarkdown(m.content || "");
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
/** Delete messages from index from. One call may go back at most the last turn (LCTYSP-0004). */
export function popMessages(id, from) {
	return write("POST", `${conv(id)}/pop`, { from });
}
export function deleteConversation(id) {
	return write("DELETE", conv(id));
}
/** Defaults of the browser settings (LCTYSP-0010). Changes are kept in localStorage, not on the server. */
export function getDefaults() {
	return request("GET", "v1/defaults.json");
}

// ---- Search index (LCTYSP-0006, LCTYSP-0007) ----
/** Rounds waiting for embeddings: [{id, rev, parts: [text, …]}] */
export function vectorsPending(model, limit = 16) {
	return request(
		"GET",
		`v1/vectors/pending?model=${encodeURIComponent(model)}&limit=${limit}`,
	);
}
/**
 * revs: [[id, rev], …], records: { body: registration vector binary, size: bytes per vector, count: number of records }.
 * The vectors of the ids sent are replaced by those in the body (LCTYSP-0008). The server checks magic, size and entry_count in the query against the body
 */
export async function putVectors(model, revs, { body, size, count }) {
	const rev = revs.map(([id, r]) => `${id}:${r}`).join(",");
	const qs = `model=${encodeURIComponent(model)}&magic=lctyvLE0&size=${size}&entry_count=${count}&rev=${rev}`;
	const r = await fetch(siteUrl(`v1/vectors?${qs}`), {
		method: "PUT",
		headers: { "Content-Type": "application/octet-stream" },
		body,
	});
	if (!r.ok) throw httpError(r.status, await r.text());
	return r.json();
}
/** Keyword search: {q, tags, limit} → {results: [{id, conv_id, snippet}]} (in rank order) */
export function searchConversations(body) {
	return request("POST", "v1/search", body);
}
/** Snippets of rounds: {ids, q} → { id: {conv_id, snippet} } */
export function fetchSnippets(ids, q) {
	return request("POST", "v1/snippets", { ids, q });
}
