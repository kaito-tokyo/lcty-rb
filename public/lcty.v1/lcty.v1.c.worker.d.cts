// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Types and documentation for lcty.v1.c.worker.cjs (LCTYSP-0010, LCTYSP-0009). The worker keeps only short comments; its
 * documentation lives here.
 *
 * - Every asynchronous operation on the browser's copy of every conversation's meta (IndexedDB "lcty_v1_c", store
 *   "c_meta") runs in this worker. It is a classic worker script with no imports, started by js/api/meta-db.js and by
 *   lcty.v1.cjs as new Worker(…/lcty.v1/lcty.v1.c.worker.cjs); no module imports it.
 * - It is the only code that opens "lcty_v1_c": it alone defines the schema, and every connection is closed when the
 *   operation ends, so an upgrade is never blocked.
 * - It is an RPC server, like lcty.v1.t.worker.cjs, that runs as a Worker or as a SharedWorker alike: a top-level var sets
 *   the global onmessage (a Worker's) and onconnect (a SharedWorker's, which gives each port the same handler). A
 *   {@link Request} is answered on the port it came from (the event's target) by a {@link Response}. A message without
 *   an id cannot be answered. An error is posted, not thrown, because a rejection inside an async handler does not
 *   reliably reach the page as the Worker's error event; that event is left for a worker that could not be loaded.
 * - endpoint is the URL of the site's v1/, which the page knows (siteUrl("v1/")): every message carries it, so the
 *   worker does not depend on where it is served. It must be an absolute URL on the worker's origin ending with "/",
 *   since the copy is the origin's; otherwise the message is answered with an error, before any operation.
 * - The database's name carries the version of the files (lcty_v1_c for lcty.v1, LCTYSP-0009): the files of another
 *   version open a database of their own and never read, convert or delete this one.
 */

/**
 * A row of the store "c_meta" of the database "lcty_v1_c" (key path "id"): a conversation's meta as GET /v1/meta-all.json
 * gives it, built by the server from each conversation file's "<!" meta lines (LCTYSP-0003). The database is at
 * DB_VERSION and has no other store: an upgrade drops every other store.
 */
export interface CMeta {
	id: string;
	title: string;
	created_at: string;
	/** Only a hint, as the server's index recorded it. */
	updated_at_hint: string;
	/** The tags at creation. */
	setup_tags: string[];
	/** Only a hint: the current tags. */
	tags_hint: string[];
	/** Only a hint: the number of messages. */
	messages_hint: number;
}

/** The operations, with what they answer as result. */
export interface Operations {
	/**
	 * GET v1/meta-all.json, then c_meta cleared and filled in one transaction (so conversations deleted on the server
	 * disappear from it too); no result. On failure the copy is left as it was.
	 * Every page runs it whenever it is shown (js/ui/sidebar.js), and after a change of conversations
	 * (js/api/meta-db.js).
	 */
	sync_meta: undefined;
	/**
	 * c_meta: items newest first by updated_at_hint, then by id (the order of the server and the sidebar); stale true,
	 * with no items, when there is no copy yet (the first sync_meta has not finished). It never creates the database:
	 * only sync_meta does.
	 */
	get: { items: CMeta[]; stale: boolean };
}

/** A message to the worker. Neither operation takes a payload. */
export interface Request<Op extends keyof Operations = keyof Operations> {
	id: number;
	op: Op;
	/** The absolute URL of the site's v1/, ending with "/". */
	endpoint: string;
	payload?: undefined;
}

/** The answer to the Request with the same id. */
export type Response<Op extends keyof Operations = keyof Operations> =
	| { id: number; result: Operations[Op] }
	/** An op the worker does not have. */
	| { id: number; errorType: "unknownOperation" }
	/** error as the structured clone keeps it; status the HTTP status (the clone drops it), or null. */
	| { id: number; errorType: "error"; error: Error; status: number | null }
	/** When the error cannot be posted as it is: its text. */
	| {
			id: number;
			errorType: "errorMessage";
			errorMessage: string;
			status: number | null;
	  };
