// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Types and documentation for lcty.v1.t.worker.cjs (LCTYSP-0009). The worker keeps only short comments; its documentation
 * lives here.
 *
 * - Every asynchronous operation on the tags in the browser runs in this worker: the browser's copy of GET /v1/tags
 *   (IndexedDB "lcty_t", stores "t_full" and "t_set") and the requests that change the tags. It is a classic worker
 *   script with no imports, started by js/api/lcty-t.js as new Worker(siteUrl("lcty.v1/lcty.v1.t.worker.cjs")); no
 *   module imports it.
 * - It is the only code that opens "lcty_t": it alone defines the schema, and every connection is closed when the
 *   operation ends, so an upgrade is never blocked.
 * - It is an RPC server, like lcty.v1.c.worker.cjs, that runs as a Worker or as a SharedWorker alike: a {@link Request} is
 *   answered on the port it came from by a {@link Response}, and its endpoint is checked first (lcty.v1.c.worker.d.cts).
 * - put and addMemory sync afterwards, also when they failed (the server's set may have changed: a 412 or 404 means it
 *   did), so the caller reads the new set with get. A failure of that sync is not reported: the change itself is what
 *   the caller asked about, and the next sync fixes the copy.
 * - The database "lcty_t" (at DB_VERSION) has two stores, both written and read in one transaction, so the rows and the
 *   ETag are always one set: "t_full" (key path "file"), one {@link Tag} per row, in key order, which is file-name
 *   order and so the order of the tags; and "t_set" (out-of-line keys), one {@link TagSet} under the key "set". The
 *   copy is derived: an upgrade drops every store and recreates them empty, and the next get syncs.
 * - Two more stores follow the server over the page's /v1/rpc connection (LCTYSP-0014), as the copies of
 *   lcty.v1.c.worker.cjs do and under the same version rule: "t_has_many_c" (key path ["tag", "cid"]), one
 *   {@link TagHasC} per tag and conversation, filled by replace from t.c.list and changed by apply from t.batch.updated;
 *   and "sync" (key path "store"), the version it was last brought to. The worker never reads them from the server
 *   itself: the page posts what it got.
 */

/** A row of "t_has_many_c": that the tag (a reference, the file-name part of a tag file) has the conversation cid. */
export interface TagHasC {
	tag: string;
	cid: string;
}

/** A row of "sync": the global version "<boot>.<seq>" t_has_many_c was last brought to. */
export interface SyncRow {
	store: "t_has_many_c";
	boot: string;
	seq: number;
}

/**
 * A tag as GET /v1/tags gives it, with the file name (and the name of an invalid tag, which comes from its file name)
 * NFC-normalized: a file system may list the names decomposed (HFS+).
 */
export interface Tag {
	file: string;
	name: string;
	ops: { type: string; content: string }[];
	prompt: string;
	memory: { id: string; text: string; at: string; source?: unknown }[];
	/** A tag file without <lcty-t>, listed with empty ops, prompt and memory. */
	invalid?: true;
}

/** The record "set" of "t_set": the ETag of the set the rows are. Its presence marks a copy (an empty set too). */
export interface TagSet {
	etag: string | null;
}

/** The operations, with their payload and what they answer as result. */
export interface Operations {
	/**
	 * GET v1/tags, then the rows of t_full and the ETag in t_set replaced in one transaction; no result. On failure the
	 * copy is left as it was. Every page runs it whenever it is shown (js/ui/sidebar.js).
	 */
	sync_full: { payload: undefined; result: undefined };
	/** t_full and t_set: the tags in file-name order and the ETag; when there is no copy yet, a sync first. */
	get: { payload: undefined; result: { tags: Tag[]; etag: string | null } };
	/**
	 * PUT v1/tags with {tags} and If-Match etag: the one the caller read the tags with, never the copy's (the copy may be
	 * newer than what the caller edited). The result is the new ETag.
	 */
	put: { payload: { tags: Tag[]; etag: string | null }; result: string | null };
	/** POST v1/tags/:file/memory with body. The result is the server's JSON. */
	addMemory: { payload: { file: string; body: unknown }; result: unknown };
	/** Replace t_has_many_c with what t.c.list answered, unless it holds a newer version of the same boot. */
	replace: {
		payload: { store: "t_has_many_c"; version: string; rows: TagHasC[] };
		result: { applied: boolean };
	};
	/** Apply the records of one t.batch.updated, only onto a copy of the same boot holding an older version. */
	apply: {
		payload: {
			version: string;
			records: { store: "t_has_many_c"; op: "put" | "delete"; row: TagHasC }[];
		};
		result: { applied: "t_has_many_c"[] };
	};
	/** Every row of t_has_many_c, by tag then cid; stale true when it has never been filled. */
	get_has_many: {
		payload: undefined;
		result: { rows: TagHasC[]; stale: boolean };
	};
}

/** A message to the worker. */
export interface Request<Op extends keyof Operations = keyof Operations> {
	id: number;
	op: Op;
	/** The absolute URL of the site's v1/, ending with "/". */
	endpoint: string;
	payload: Operations[Op]["payload"];
}

/** The answer to the Request with the same id; the errors are those of lcty.v1.c.worker.d.cts. */
export type Response<Op extends keyof Operations = keyof Operations> =
	| { id: number; result: Operations[Op]["result"] }
	| { id: number; errorType: "unknownOperation" }
	| { id: number; errorType: "error"; error: Error; status: number | null }
	| {
			id: number;
			errorType: "errorMessage";
			errorMessage: string;
			status: number | null;
	  };
