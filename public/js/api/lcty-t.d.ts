// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser (LCTYSP-0009): every call posts one operation to the tab's worker,
// lcty.v1/lcty.v1.t.worker.cjs of the site (started by the first call; the path is relative to the root of the site,
// LCTYSP-0005), and resolves to its answer. The worker keeps the browser's copy of GET /v1/tags (IndexedDB "lcty_t",
// store "t_full") and sends the requests that change the tags, syncing the copy after them; this module never opens
// the database itself.
//
// In a tab the operations run one at a time, in the order they were called, so an older GET never overwrites a newer
// copy in this tab and a read after a change sees it. Changes not made through this browser (a file edited by hand,
// another browser) are seen at the next sync: every page runs forceSyncTags() whenever it is shown (js/ui/sidebar.js),
// and a save made on an older set fails with 412.
//
// The tags of conversations (store "t_has_many_c", which conversations each tag has) follow the server over the tab's
// /v1/rpc connection instead, as the copies of api/meta-db.js do (LCTYSP-0014): readTagsOfConversationsFrom(rpc)
// replaces them with t.c.list, applyTagBatch(params) writes a t.batch.updated, and readTagsOfConversations() reads
// them.

import type { Tag } from "../../lcty.v1/lcty.v1.t.worker.cjs";
import type { RpcClient } from "./rpc.js";

/** The Error a failed operation rejects with: status is the HTTP status of the failed request, or null. */
export interface TagsError extends Error {
	status: number | null;
}

/**
 * The tags from the browser's copy: {tags: [{file, name, ops, prompt, memory, invalid?}], etag}, file names
 * NFC-normalized, etag the ETag of the set they are. The first call in a browser fetches GET /v1/tags.
 */
export function getTags(): Promise<{ tags: Tag[]; etag: string | null }>;

/**
 * Replace all tag files with tags. etag is the one getTags returned with the tags that were edited (sent as If-Match):
 * a change made elsewhere in between fails with an Error whose status is 412. Resolves to the new ETag. The copy is
 * synced afterwards, also on failure, so getTags then returns the server's set.
 */
export function putTags(
	tags: Tag[],
	etag: string | null,
): Promise<string | null>;

/**
 * Add a memory item ({text, source}) to the tag in file (e.g. 00010-ruby.html); fails with status 404 when the file is
 * gone. Then syncs the copy. Resolves to the server's JSON.
 */
export function addMemory(
	file: string,
	body: { text: string; source?: unknown },
): Promise<unknown>;

/** Replace the copy with GET /v1/tags now (sync_full): resolves when it has been stored, rejects with the error. */
export function forceSyncTags(): Promise<void>;

/** Call fn whenever this tab has stored a change of the tags of conversations (t_has_many_c). */
export function onTagsOfConversationsChange(fn: () => void): void;

/** Read t.c.list over rpc and replace the copy; resolves when it is stored, rejects with the error. */
export function readTagsOfConversationsFrom(
	rpc: Pick<RpcClient, "call">,
): Promise<void>;

/** Write the records of one t.batch.updated (after a list being read, if any); a failure is only logged. */
export function applyTagBatch(params: {
	version: string;
	records: unknown[];
}): void;

/**
 * The tags of every conversation from the copy: {byCid: Map(cid => [tag, …]), stale}, each conversation's tags
 * ordered by reference (the sidebar orders them by the tags' files). stale is true when the copy has never been filled.
 */
export function readTagsOfConversations(): Promise<{
	byCid: Map<string, string[]>;
	stale: boolean;
}>;

// Internals:
//
// state: tail is the last operation called in this tab; lastId the id of the last message posted to the worker;
// worker the tab's worker; pending the operations posted to it and not answered yet, by id.
//
// workerOf(): the tab's one worker, started by the first operation and kept for the life of the page: a worker started
// late, while the page is being left, fails to load (WebKit reports it as an error of the page). One that fails is
// dropped with the operations it had, and the next operation starts another. Its onerror handles a worker that could
// not be loaded (or threw outside an operation); Chromium prefixes the message with "Uncaught ", which is stripped.
//
// runWorker(op, payload): posts {id, op, endpoint (the site's v1/), payload} to the worker and resolves to the result
// of the answer with that id, or rejects with its error (with the HTTP status as status).
//
// errorOf(data, op): the Error of an answer {errorType, error?, errorMessage?, status}, with the HTTP status (or null)
// as status.
//
// run(op, payload): runs the operation after the ones called before it, whether they succeeded or not.
//
// listeners / hasMany: the callbacks of onTagsOfConversationsChange, and the followCopies (api/tab-rpc.js) of
// [["t.c.list", "t_has_many_c"]] that calls them (a listener that throws is logged, the others still run).
