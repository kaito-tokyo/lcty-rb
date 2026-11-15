// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Types and documentation for lcty.v1.t.worker.cjs (LCTYSP-0009, LCTYSP-0014). The worker keeps only short comments;
 * its documentation lives here.
 *
 * - Every asynchronous operation on the browser's copies of the tags runs in this worker (IndexedDB "lcty_t"). It is a
 *   classic worker script with no imports, started by js/api/lcty-t.js as
 *   new Worker(siteUrl("lcty.v1/lcty.v1.t.worker.cjs")), and by lcty.v1.cjs for the names of the sidebar's tags; no
 *   module imports it. It sends no request: the page reads the lists over its /v1/rpc connection and posts what it got.
 * - It is the only code that opens "lcty_t": it alone defines the schema, and every connection is closed when the
 *   operation ends, so an upgrade is never blocked.
 * - It is an RPC server, like lcty.v1.c.worker.cjs, that runs as a Worker or as a SharedWorker alike: a {@link Request} is
 *   answered on the port it came from by a {@link Response}.
 * - The database "lcty_t" (at DB_VERSION) holds two copies that follow the server under the version rule of
 *   lcty.v1.c.worker.cjs (LCTYSP-0014), each with its row in the store "sync" (key path "store"), the version it was
 *   last brought to:
 *   - the copy "t_full", the tag definitions: the store "t_full" (key path "file"), one {@link Tag} per row, in key
 *     order, which is file-name order and so the order of the tags; and the store "t_set" (out-of-line keys), one
 *     {@link TagSet} under the key "set". Both are written in one transaction, so the rows and the ETag are always one
 *     set. Filled by replace from t.list, changed by apply from the t_full and t_set records of t.batch.updated.
 *   - the copy "t_has_many_c": the store "t_has_many_c" (key path ["tag", "cid"]), one {@link TagHasC} per tag and
 *     conversation, filled by replace from t.c.list and changed by apply from its records.
 * - A copy is derived: an upgrade drops every store and recreates them empty, and a copy without its row in "sync" has
 *   never been filled (stale), whatever its stores hold.
 * - A file system may list the names decomposed (HFS+); the server compares the files themselves. So the file name of
 *   every tag the worker writes, and the name of an invalid tag (which comes from its file name), are NFC-normalized.
 */

/** A row of "t_has_many_c": that the tag (a reference, the file-name part of a tag file) has the conversation cid. */
export interface TagHasC {
	tag: string;
	cid: string;
}

/** A row of "sync": the global version "<boot>.<seq>" a copy was last brought to. */
export interface SyncRow {
	store: "t_full" | "t_has_many_c";
	boot: string;
	seq: number;
}

/** A tag as t.list gives it, with the file name (and the name of an invalid tag) NFC-normalized. */
export interface Tag {
	file: string;
	name: string;
	ops: { type: string; content: string }[];
	prompt: string;
	memory: { id: string; text: string; at: string; source?: unknown }[];
	/** A tag file without <lcty-t>, listed with empty ops, prompt and memory. */
	invalid?: true;
}

/** The record "set" of "t_set": the ETag of the set the rows are. */
export interface TagSet {
	etag: string | null;
}

/** A record of t.batch.updated that the worker writes. */
export type TagRecord =
	| { store: "t_has_many_c"; op: "put" | "delete"; row: TagHasC }
	| { store: "t_full"; op: "put"; row: Tag }
	| { store: "t_full"; op: "delete"; row: { file: string } }
	| { store: "t_set"; op: "put"; row: TagSet };

/** The operations, with their payload and what they answer as result. */
export interface Operations {
	/** t_full and t_set: the tags in file-name order and the ETag; stale true when the copy has never been filled. */
	get: {
		payload: undefined;
		result: { tags: Tag[]; etag: string | null; stale: boolean };
	};
	/**
	 * Replace a copy with what t.list (store "t_full", with its etag) or t.c.list (store "t_has_many_c") answered, unless
	 * it holds a newer version of the same boot.
	 */
	replace: {
		payload:
			| { store: "t_full"; version: string; rows: Tag[]; etag: string | null }
			| { store: "t_has_many_c"; version: string; rows: TagHasC[] };
		result: { applied: boolean };
	};
	/**
	 * Apply the records of one t.batch.updated: each copy takes its own records (t_set's belong to t_full), only when it
	 * holds an older version of the same boot. A record of another store is ignored. The result names the copies that
	 * applied them.
	 */
	apply: {
		payload: { version: string; records: TagRecord[] };
		result: { applied: ("t_full" | "t_has_many_c")[] };
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
	payload: Operations[Op]["payload"];
}

/** The answer to the Request with the same id; the errors are those of lcty.v1.c.worker.d.cts, without a status. */
export type Response<Op extends keyof Operations = keyof Operations> =
	| { id: number; result: Operations[Op]["result"] }
	| { id: number; errorType: "unknownOperation" }
	| { id: number; errorType: "error"; error: Error }
	| { id: number; errorType: "errorMessage"; errorMessage: string };

// Internals:
// withStores(mode, names, fn): fn(...stores) in one transaction over names, resolved when it completes. COPIES lists the
// stores of each copy, its rows first. write(os, record): one record into the stores of its copy. tagRow(t): a tag
// with its file name (and an invalid tag's name) NFC-normalized.
