// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copies of the list of conversations, kept by the tab's worker (LCTYSP-0014, LCTYSP-0009, LCTYSP-0005).

import { siteUrl } from "../site.js";
import { followCopies } from "./tab-rpc.js";

const WORKER_PATH = "lcty.v1/lcty.v1.c.worker.cjs"; // relative to the root of the site (LCTYSP-0005)

// The tab's last operation, last message id, worker, unanswered operations, and change listeners
const state = {
	tail: null,
	lastId: 0,
	worker: null,
	pending: new Map(),
	listeners: [],
};

// The tab's one worker, started by the first operation and kept for the life of the page, as in api/lcty-t.js
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
	// A worker that could not be loaded (or threw outside an operation)
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

// Post one message to the worker and resolve to the answer with its id, or reject with its error
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

/** Call fn whenever this tab has stored a change of the copies. */
export function onMetaDbChange(fn) {
	state.listeners.push(fn);
}

/** Read c.list and c.recordcount.list over rpc and replace the copies with them. */
export function readMetaDbFrom(rpc) {
	return copies.readAll(rpc);
}

/** Write the records of one c.batch.updated (after the lists being read, if any); a failure is only logged. */
export function applyMetaBatch(params) {
	copies.onBatch(params);
}

/** The stored copies: {items, counts, stale}. */
export function readMetaDb() {
	return run("get");
}
