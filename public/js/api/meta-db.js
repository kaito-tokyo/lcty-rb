// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copies of the list of conversations (IndexedDB "lcty_c", stores "c_meta" and "c_recordcount",
// LCTYSP-0014). Every operation on them posts one message ({id, op, endpoint, payload}, with the site's v1/ as the
// endpoint) to the tab's worker, lcty.v1/lcty.v1.c.worker.cjs of the site (started by the first operation), and gets
// its answer, {id, result} or {id, errorType, ...}; the worker is the only code that opens the database (LCTYSP-0009).
//
// The copies follow the server over the tab's /v1/rpc connection (api/tab-rpc.js): readMetaDbFrom(rpc) reads c.list and
// c.recordcount.list and replaces them (whenever the connection opens, and the sidebar's refresh button), and
// applyMetaBatch(params) writes the records of a c.batch.updated. The worker keeps a copy from going back, whichever
// tab writes last (the version rule of LCTYSP-0014). In a tab the operations run one at a time, in the order they were
// called, and the notifications that arrive while the lists are read are written after them.

import { siteUrl } from "../site.js";
import { followCopies } from "./tab-rpc.js";

const WORKER_PATH = "lcty.v1/lcty.v1.c.worker.cjs"; // relative to the root of the site (LCTYSP-0005)

// tail: the last operation posted in this tab; lastId: the id of the last message posted to the worker; worker: the
// tab's worker; pending: the operations posted to it and not answered yet, by id; listeners: called when the copies
// have changed
const state = {
	tail: null,
	lastId: 0,
	worker: null,
	pending: new Map(),
	listeners: [],
};

// The tab's one worker, started by the first operation and kept for the life of the page, as in api/lcty-t.js: a
// worker started while the page is being left fails to load. One that fails is dropped with the operations it had.
function workerOf() {
	if (state.worker) return state.worker;
	const worker = new Worker(siteUrl(WORKER_PATH));
	worker.onmessage = ({ data }) => {
		if (typeof data?.id !== "number") return;
		const p = state.pending.get(data.id);
		if (!p) return;
		state.pending.delete(data.id);
		if (data.errorType) p.reject(errorOf(data, p.op));
		else p.resolve(data.result);
	};
	// A worker that could not be loaded (or threw outside an operation). Chromium prefixes "Uncaught "
	worker.onerror = (e) => {
		e.preventDefault();
		worker.terminate();
		if (state.worker === worker) state.worker = null;
		const text = (e.message || "").replace(/^Uncaught /, "");
		const error = new Error(text || "the worker of the conversations failed");
		for (const p of state.pending.values()) p.reject(error);
		state.pending.clear();
	};
	state.worker = worker;
	return worker;
}

// Post {id, op, endpoint (the site's v1/), payload} to the worker and resolve to the result of the answer with that id,
// or reject with its error
function runWorker(op, payload) {
	return new Promise((resolve, reject) => {
		state.lastId += 1;
		const id = state.lastId;
		state.pending.set(id, { op, resolve, reject });
		workerOf().postMessage({
			id,
			op,
			endpoint: siteUrl("v1/").href,
			payload,
		});
	});
}

// The Error of an answer {errorType, error?, errorMessage?}
function errorOf(data, op) {
	return data.errorType === "error" && data.error instanceof Error
		? data.error
		: new Error(
				data.errorType === "unknownOperation"
					? `unknown operation: ${op}`
					: String(data.errorMessage ?? data.error),
			);
}

// Run the operation after the ones posted before it in this tab, whether they succeeded or not
function run(op, payload) {
	const task = (state.tail ?? Promise.resolve())
		.catch(() => {})
		.then(() => runWorker(op, payload));
	state.tail = task;
	return task;
}

function notify() {
	for (const fn of state.listeners) {
		try {
			fn();
		} catch (e) {
			console.warn(e);
		}
	}
}

const copies = followCopies({
	lists: [
		["c.list", "c_meta"],
		["c.recordcount.list", "c_recordcount"],
	],
	run,
	onChange: notify,
});

/** Call fn whenever this tab has stored a change of the copies. fn reads them again with readMetaDb(). */
export function onMetaDbChange(fn) {
	state.listeners.push(fn);
}

/**
 * Read c.list and c.recordcount.list over rpc and replace the copies with them. Resolves when they are stored
 * (listeners are notified when something was), rejects with the error of the request or of the worker.
 */
export function readMetaDbFrom(rpc) {
	return copies.readAll(rpc);
}

/** Write the records of one c.batch.updated (after the lists being read, if any); a failure is only logged. */
export function applyMetaBatch(params) {
	copies.onBatch(params);
}

/**
 * The stored copies: {items, counts, stale}. items are the meta newest first by updatedAt; counts the number of
 * elements by cid (unknown when absent); stale is true when the list has never been read, and items is then [].
 */
export function readMetaDb() {
	return run("get");
}
