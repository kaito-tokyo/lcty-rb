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
 *   module imports it, so the bundler never sees it.
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
 */

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
