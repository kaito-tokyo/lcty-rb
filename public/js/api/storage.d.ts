// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Client for the lcty.rb storage API (LCTYSP-0006). Conversations are only created, appended to and popped (Ruby
// decides the format, LCTYSP-0003). The paths are relative to the root of the site (v1/…), which siteUrl() turns into
// URLs (LCTYSP-0005).
//
// Every function rejects, when the response is not ok, with an Error whose message is "<status> <body>" (the body cut
// to 200 characters) and whose status is the HTTP status. The requests that change conversations (createConversation,
// appendLines, popMessages, deleteConversation) do not touch the browser's copies of the list: those hear of the change
// from the server, over /v1/rpc (LCTYSP-0014).

/** The Error of a failed request: the message is "<status> <body>", and status is the HTTP status. */
export interface HttpError extends Error {
	status: number;
}

/** A message as the page keeps it. */
export interface Message {
	role: string;
	content?: string;
	[key: string]: unknown;
}

/**
 * Message → line to append ({type: "message", ...m}). Replies (role "assistant") also carry presentation HTML in
 * content_html (dual recording, LCTYSP-0003). It is rendered with the same converter as the screen (convert/reply.js),
 * so what is saved matches what is shown.
 */
export function toLine<M extends Message>(
	m: M,
): M & { type: "message"; content_html?: string };

/** GET v1/conversations: the server's JSON. */
export function listConversations(): Promise<unknown>;

/** { meta, title, tags, messages } (for reading a conversation outside its page, e.g. forking). */
export function getConversation(
	id: string,
): Promise<{ meta: object; title: string; tags: string[]; messages: object[] }>;

/** Create a conversation from meta and initial lines (e.g. lines copied from the fork source). */
export function createConversation(
	meta: object,
	lines: object[],
): Promise<unknown>;

/** Append lines to the conversation id. */
export function appendLines(id: string, lines: object[]): Promise<unknown>;

/** Delete messages from index from. One call may go back at most the last turn (LCTYSP-0004). */
export function popMessages(id: string, from: number): Promise<unknown>;

/** Delete the conversation id. */
export function deleteConversation(id: string): Promise<unknown>;

/** Defaults of the browser settings (LCTYSP-0010). Changes are kept in localStorage, not on the server. */
export function getDefaults(): Promise<unknown>;

// ---- Search index (LCTYSP-0006, LCTYSP-0007) ----

/** Rounds waiting for embeddings of model (at most limit, 16 by default): [{id, rev, parts: [text, …]}]. */
export function vectorsPending(
	model: string,
	limit?: number,
): Promise<{ id: string; rev: number | string; parts: string[] }[]>;

/**
 * Register vectors of model. revs: [[id, rev], …]; records: { body: registration vector binary, size: bytes per
 * vector, count: number of records }. The vectors of the ids sent are replaced by those in the body (LCTYSP-0008). The
 * server checks magic (lctyvLE0), size and entry_count in the query against the body.
 */
export function putVectors(
	model: string,
	revs: [id: string, rev: number | string][],
	records: { body: BodyInit; size: number; count: number },
): Promise<unknown>;

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
// httpError(status, body): the HttpError above. send / request: one fetch of siteUrl(path), with a JSON body when one
// is given; request resolves to the JSON (or the text with raw). write(method, url, body): a request that changes
// conversations; the browser's copies of the list hear of it from the server, over /v1/rpc (LCTYSP-0014), not from
// here. conv(id): the path v1/conversations/<id>.
