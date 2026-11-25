// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser (LCTYSP-0009, LCTYSP-0014). The tab's worker, lcty.v1/lcty.v1.t.worker.cjs of the site
// (started by the first call; the path is relative to the root of the site, LCTYSP-0005), keeps the browser's copies in
// the IndexedDB database "lcty_t"; this module never opens the database itself. Both copies follow the server over the
// tab's /v1/rpc connection (api/tab-rpc.js), as the copies of api/meta-db.js do:
//
// - the tag definitions (stores "t_full" and "t_set"): every tag file of t/ and the ETag of the set, read whole with
//   t.list;
// - the tags of conversations (store "t_has_many_c", which conversations each tag has), read whole with t.c.list.
//
// readTagsFrom(rpc) reads both lists and replaces the copies, and applyTagBatch(params) writes the records of a
// t.batch.updated into them (the sidebar does both: every (re)connection reads the lists, every notification is
// applied). A change of a tag file made outside the server (a file edited by hand) is not announced: it is seen at the
// next read of the lists, which every page makes when its connection opens and again when it is shown from the
// back/forward cache, and a save made on an older set is refused (TAGS_CHANGED).
//
// The tag definitions are changed over the tab's connection too: putTags is t.replace and addMemory t.memory.add. The
// server announces the change with t.batch.updated before it answers, so the copy is written before a getTags called
// after the change. When a change fails, the lists are read again (the server's set may have changed), and then the
// error is passed on.
//
// In a tab the operations of the worker run one at a time, in the order they were called, so an older read never
// overwrites a newer copy in this tab and a read after a change sees it.

import type { Tag } from "../../lcty.v1/lcty.v1.t.worker.cjs";
import type { RpcClient } from "./rpc.js";

/**
 * The code of the RpcError of a save made on a set of tags that has changed since it was read (the etag is not the
 * set's any more). The caller reads the tags again with getTags, which then has the server's set.
 */
export const TAGS_CHANGED: 8;

/**
 * The tags from the browser's copy: {tags: [{file, name, ops, prompt, memory, invalid?}], etag}, file names
 * NFC-normalized, etag the ETag of the set they are. When the copy has never been filled, the lists are read over the
 * tab's connection first (forceSyncTags).
 */
export function getTags(): Promise<{ tags: Tag[]; etag: string | null }>;

/**
 * The copy of the tag definitions as it is: {tags, etag, stale}, stale true (and tags empty) when it has never been
 * filled. Never reads over the connection, so it never waits for it: a reader that only shows the tags (the search
 * panel's order of a conversation's tags) uses it and takes the copy again on onTagsChange.
 */
export function readTagDefs(): Promise<{
	tags: Tag[];
	etag: string | null;
	stale: boolean;
}>;

/**
 * Replace all tag files with tags (t.replace). etag is the one getTags returned with the tags that were edited: a change
 * made elsewhere in between rejects with an RpcError whose code is TAGS_CHANGED. Resolves to the new ETag.
 */
export function putTags(tags: Tag[], etag: string | null): Promise<string>;

/**
 * Add a memory item ({text, source}) to the tag in file, e.g. ruby.html (t.memory.add); rejects with an RpcError
 * when the file is gone (code 9) or the text is blank (code 3). Resolves to the item as written, {id, text, at,
 * source?}.
 */
export function addMemory(
	file: string,
	body: { text: string; source?: unknown },
): Promise<{ id: string; text: string; at: string; source?: unknown }>;

/** Read t.list and t.c.list over the tab's connection now and replace the copies; rejects with the error. */
export function forceSyncTags(): Promise<void>;

/** Call fn whenever this tab has stored a change of the tags: of their definitions or of the tags of conversations. */
export function onTagsChange(fn: () => void): void;

/** Read t.list and t.c.list over rpc and replace the copies; resolves when they are stored, rejects with the error. */
export function readTagsFrom(rpc: Pick<RpcClient, "call">): Promise<void>;

/** Write the records of one t.batch.updated (after the lists being read, if any); a failure is only logged. */
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
// runWorker(op, payload): posts {id, op, payload} to the worker and resolves to the result of the answer with that id,
// or rejects with its error.
//
// run(op, payload): runs the operation after the ones called before it, whether they succeeded or not.
//
// listeners / copies: the callbacks of onTagsChange, and the followCopies (api/tab-rpc.js) of
// [["t.list", "t_full"], ["t.c.list", "t_has_many_c"]] that calls them (a listener that throws is logged, the others
// still run). t.list answers the ETag beside the rows, which followCopies passes on to the worker's replace.
//
// getTags(): forceSyncTags() opens the tab's connection when it is not open yet; that happens after a round trip to the
// worker, so every part of the page has registered its notifications by then (api/tab-rpc.js refuses them later).
//
// change(method, params): one change over the tab's connection; when it fails, the lists are read again (a failure of
// that read is ignored) before the error is passed on.
