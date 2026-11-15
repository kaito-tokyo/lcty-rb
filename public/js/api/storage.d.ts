// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Client for the lcty.rb HTTP API (LCTYSP-0006), which serves reads only: the pages write through /v1/rpc
// (LCTYSP-0012). The paths are relative to the root of the site (v1/…), which siteUrl() turns into URLs (LCTYSP-0005).
//
// Every function rejects, when the response is not ok, with an Error whose message is "<status> <body>" (the body cut
// to 200 characters) and whose status is the HTTP status.

/** The Error of a failed request: the message is "<status> <body>", and status is the HTTP status. */
export interface HttpError extends Error {
	status: number;
}

/** GET v1/conversations: the server's JSON. */
export function listConversations(): Promise<unknown>;

/** { meta, title, tags, messages } (for reading a conversation outside its page, e.g. forking). */
export function getConversation(
	id: string,
): Promise<{ meta: object; title: string; tags: string[]; messages: object[] }>;

/** Defaults of the browser settings (LCTYSP-0010). Changes are kept in localStorage, not on the server. */
export function getDefaults(): Promise<unknown>;

// ---- Search index (LCTYSP-0006, LCTYSP-0007) ----

/** Keyword search: {q, tags, limit} → {results: [{id, conv_id, snippet}]} (in rank order). */
export function searchConversations(body: {
	q: string;
	tags?: string[];
	limit?: number;
}): Promise<{ results: { id: string; conv_id: string; snippet: string }[] }>;

/** Snippets of rounds: {ids, q} → { id: {conv_id, snippet} }. */
export function fetchSnippets(
	ids: string[],
	q: string,
): Promise<Record<string, { conv_id: string; snippet: string }>>;

// Internals:
//
// httpError(status, body): the HttpError above. request: one fetch of siteUrl(path), with a JSON body when one is
// given, resolving to the JSON of the answer. conv(id): the path v1/conversations/<id>.
