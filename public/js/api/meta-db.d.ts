// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copies of the list of conversations (IndexedDB "lcty_c", stores "c_meta" and "c_recordcount",
// LCTYSP-0014). Every operation on them posts one message ({id, op, endpoint, payload}, with the site's v1/ as the
// endpoint) to the tab's worker, lcty.v1/lcty.v1.c.worker.cjs of the site (started by the first operation; the path is
// relative to the root of the site, LCTYSP-0005), and gets its answer, {id, result} or {id, errorType, ...}; the worker
// is the only code that opens the database (LCTYSP-0009).
//
// The copies follow the server over the tab's /v1/rpc connection (api/tab-rpc.js): readMetaDbFrom(rpc) reads c.list and
// c.recordcount.list and replaces them (whenever the connection opens, and the sidebar's refresh button), and
// applyMetaBatch(params) writes the records of a c.batch.updated. The worker keeps a copy from going back, whichever
// tab writes last (the version rule of LCTYSP-0014). In a tab the operations run one at a time, in the order they were
// called, and the notifications that arrive while the lists are read are written after them.

import type { CMeta, CRecord } from "../../lcty.v1/lcty.v1.c.worker.cjs";
import type { RpcClient } from "./rpc.js";

/** Call fn whenever this tab has stored a change of the copies. fn reads them again with readMetaDb(). */
export function onMetaDbChange(fn: () => void): void;

/**
 * Read c.list and c.recordcount.list over rpc and replace the copies with them. Resolves when they are stored
 * (listeners are notified when something was), rejects with the error of the request or of the worker.
 */
export function readMetaDbFrom(rpc: Pick<RpcClient, "call">): Promise<void>;

/** Write the records of one c.batch.updated (after the lists being read, if any); a failure is only logged. */
export function applyMetaBatch(params: {
	version: string;
	records: CRecord[];
}): void;

/**
 * The stored copies: {items, counts, stale}. items are the meta newest first by updatedAt; counts the number of
 * elements by cid (unknown when absent); stale is true when the list has never been read, and items is then [].
 */
export function readMetaDb(): Promise<{
	items: CMeta[];
	counts: Record<string, number>;
	stale: boolean;
}>;

// Internals:
//
// state: tail is the last operation posted in this tab; lastId the id of the last message posted to the worker; worker
// the tab's worker; pending the operations posted to it and not answered yet, by id; listeners the callbacks of
// onMetaDbChange, called by notify() when the copies have changed (one that throws is logged, the others still run).
//
// workerOf(): the tab's one worker, started by the first operation and kept for the life of the page, as in
// api/lcty-t.js: a worker started while the page is being left fails to load. One that fails is dropped with the
// operations it had. Its onerror handles a worker that could not be loaded (or threw outside an operation); Chromium
// prefixes the message with "Uncaught ", which is stripped.
//
// runWorker(op, payload): posts {id, op, endpoint (the site's v1/), payload} to the worker and resolves to the result
// of the answer with that id, or rejects with its error.
//
// errorOf(data, op): the Error of an answer {errorType, error?, errorMessage?}.
//
// run(op, payload): runs the operation after the ones posted before it in this tab, whether they succeeded or not.
//
// copies: the followCopies (api/tab-rpc.js) of c.list => c_meta and c.recordcount.list => c_recordcount.
