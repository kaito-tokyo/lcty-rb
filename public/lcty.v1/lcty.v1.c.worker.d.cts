// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Types and documentation for lcty.v1.c.worker.cjs (LCTYSP-0014, LCTYSP-0010). The worker keeps only short comments;
 * its documentation lives here.
 *
 * - Every operation on the browser's copies of c/ (IndexedDB "lcty_c", stores "c_meta", "c_recordcount" and "sync")
 *   runs in this worker. It is a classic worker script with no imports, started by js/api/meta-db.js and by
 *   lcty.v1.cjs as new Worker(…/lcty.v1/lcty.v1.c.worker.cjs); no module imports it.
 * - It is the only code that opens "lcty_c": it alone defines the schema, and every connection is closed when the
 *   operation ends, so an upgrade is never blocked.
 * - It never talks to the server: the page reads over its /v1/rpc connection (c.list, c.recordcount.list and the
 *   notifications c.batch.updated, LCTYSP-0012) and posts what it got here, which writes it under the version rule.
 * - The version rule (LCTYSP-0014): "sync" holds, for each copy, the global version it was last brought to. A full
 *   read (replace) is written unless the copy holds a newer version of the same boot; a change (apply) is written only
 *   onto a copy of the same boot holding an older version. The check and the write are one read-write transaction, so
 *   whichever tab or worker writes last, a copy never goes back.
 * - It is an RPC server, like lcty.v1.t.worker.cjs, that runs as a Worker or as a SharedWorker alike: a top-level var sets
 *   the global onmessage (a Worker's) and onconnect (a SharedWorker's, which gives each port the same handler). A
 *   {@link Request} is answered on the port it came from (the event's target) by a {@link Response}. A message without
 *   an id cannot be answered. An error is posted, not thrown, because a rejection inside an async handler does not
 *   reliably reach the page as the Worker's error event; that event is left for a worker that could not be loaded.
 * - endpoint is the URL of the site's v1/, which the page knows (siteUrl("v1/")): every message carries it, so the
 *   worker does not depend on where it is served. It must be an absolute URL on the worker's origin ending with "/",
 *   since the copy is the origin's; otherwise the message is answered with an error, before any operation.
 * - The database's name is its resource's (lcty_c, as the server's lcty_c.sqlite, LCTYSP-0009 and LCTYSP-0015); what it
 *   stores is versioned by DB_VERSION, and an upgrade drops the stores and recreates them empty.
 */

/** A row of "c_meta" (key path "cid"): a conversation's meta as c.list and the c_meta records give it. */
export interface CMeta {
	cid: string;
	lang: string;
	title: string;
	/** The id of the <title> of line 3 ("__" and the size of the slot, LCTYSP-0013). */
	titleTypeId: string;
	/** When the file was last changed: it orders the list. */
	updatedAt: string;
	createdAt: string;
}

/** A row of "c_recordcount" (key path "cid"): the number of elements of a conversation but lcty-c. */
export interface CRecordCount {
	cid: string;
	count: number;
}

/** A row of "sync" (key path "store"): the global version "<boot>.<seq>" a copy was last brought to. */
export interface SyncRow {
	store: "c_meta" | "c_recordcount";
	boot: string;
	seq: number;
}

/** One change of a copy, as c.batch.updated sends it. Records of other stores (c_html) are ignored here. */
export type CRecord =
	| { store: "c_meta"; op: "put"; row: CMeta }
	| { store: "c_recordcount"; op: "put"; row: CRecordCount }
	| { store: "c_meta" | "c_recordcount"; op: "delete"; row: { cid: string } }
	| { store: string; op: string; row: unknown };

/** The operations: what each takes as payload and answers as result. */
export interface Operations {
	/** Replace one copy with a full read (c.list or c.recordcount.list), under the version rule. */
	replace: {
		payload: {
			store: "c_meta" | "c_recordcount";
			version: string;
			rows: CMeta[] | CRecordCount[];
		};
		result: { applied: boolean };
	};
	/** Apply the records of one c.batch.updated, store by store under the version rule. */
	apply: {
		payload: { version: string; records: CRecord[] };
		/** The stores that applied their records. */
		result: { applied: ("c_meta" | "c_recordcount")[] };
	};
	/**
	 * The copies: items newest first by updatedAt, then by cid; counts by cid (a conversation without one has an
	 * unknown count); stale true, with no items, when c_meta has never been filled. It never creates the database.
	 */
	get: {
		payload: undefined;
		result: { items: CMeta[]; counts: Record<string, number>; stale: boolean };
	};
}

/** A message to the worker. */
export interface Request<Op extends keyof Operations = keyof Operations> {
	id: number;
	op: Op;
	/** The absolute URL of the site's v1/, ending with "/". */
	endpoint: string;
	payload?: Operations[Op]["payload"];
}

/** The answer to the Request with the same id. */
export type Response<Op extends keyof Operations = keyof Operations> =
	| { id: number; result: Operations[Op]["result"] }
	/** An op the worker does not have. */
	| { id: number; errorType: "unknownOperation" }
	/** error as the structured clone keeps it; status null (the worker sends no HTTP request). */
	| { id: number; errorType: "error"; error: Error; status: number | null }
	/** When the error cannot be posted as it is: its text. */
	| {
			id: number;
			errorType: "errorMessage";
			errorMessage: string;
			status: number | null;
	  };
