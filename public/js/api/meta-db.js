// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copy of every conversation's meta (IndexedDB "lcty_c", store "c_meta", LCTYSP-0010). Every operation on
// it starts one worker, lcty.v1/lcty.v1.c.worker.cjs of the site, posts it one message ({id, op: "sync_meta"} or {id,
// op: "get"}, with the site's v1/ as the endpoint) and gets its answer, {id, result} or {id, errorType, ...}; the
// worker is the only code that opens the database (LCTYSP-0009). A sync (sync_meta) fetches GET v1/meta-all.json and
// replaces the whole store; a read returns the copy without ever creating it.
//
// Every page syncs whenever it is shown (forceSyncMetaDb(), called by js/ui/sidebar.js, at once). Pages also request a
// sync when they load the list and after sending a change of conversations to the server (requestMetaDbSync(), called
// by api/storage.js), when the browser is idle (requestIdleCallback is not available in
// workers). In a tab at most one worker runs: a sync requested while one runs is run once after it, so an older
// response never overwrites a newer one in this tab and a change made meanwhile is still fetched. Changes not made
// through this browser (a file edited by hand, another browser, another tab) are seen at the next sync.

import { siteUrl } from "../site.js";

const WORKER_PATH = "lcty.v1/lcty.v1.c.worker.cjs"; // relative to the root of the site (LCTYSP-0005)
const IDLE_TIMEOUT_MS = 10000; // run by then even if the browser never becomes idle
const FALLBACK_DELAY_MS = 1000; // where requestIdleCallback is missing

// lastId: the id of the last message posted to a worker; running: the sync in progress; queued: the one that runs
// after it; scheduled: a requested sync waits for idle time; listeners: called when a new list was stored
const state = {
	lastId: 0,
	running: null,
	queued: null,
	scheduled: false,
	listeners: null,
};

// One worker, one operation: posts {id, op, endpoint (the site's v1/), payload} and resolves to the result of the
// answer with that id, or rejects with its error (with the HTTP status as status)
function runWorker(op, payload) {
	return new Promise((resolve, reject) => {
		state.lastId += 1;
		const id = state.lastId;
		const worker = new Worker(siteUrl(WORKER_PATH));
		worker.onmessage = ({ data }) => {
			if (data?.id !== id) return;
			worker.terminate();
			if (data.errorType) reject(errorOf(data, op));
			else resolve(data.result);
		};
		// A worker that could not be loaded (or threw outside an operation). Chromium prefixes "Uncaught "
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
			const text = (e.message || "").replace(/^Uncaught /, "");
			reject(new Error(text || "the meta sync worker failed"));
		};
		worker.postMessage({ id, op, endpoint: siteUrl("v1/").href, payload });
	});
}

// The Error of an answer {errorType, error?, errorMessage?, status}, with the HTTP status (or null) as status
function errorOf(data, op) {
	const e =
		data.errorType === "error" && data.error instanceof Error
			? data.error
			: new Error(
					data.errorType === "unknownOperation"
						? `unknown operation: ${op}`
						: String(data.errorMessage ?? data.error),
				);
	e.status = data.status ?? null;
	return e;
}

function notify() {
	for (const fn of state.listeners || []) {
		try {
			fn();
		} catch (e) {
			console.warn(e);
		}
	}
}

// A sync now; while one runs, one more after it (requests made meanwhile share it)
function sync() {
	if (!state.running) {
		state.running = runWorker("sync_meta")
			.then(notify)
			.finally(() => {
				state.running = null;
			});
		return state.running;
	}
	state.queued ??= state.running
		.catch(() => {})
		.then(() => {
			state.queued = null;
			return sync();
		});
	return state.queued;
}

/**
 * Call fn whenever a sync in this tab has stored a new list. fn reads the copy again with readMetaDb().
 */
export function onMetaDbChange(fn) {
	state.listeners ??= [];
	state.listeners.push(fn);
}

/** Sync the copy when the browser is idle: on loading the list, and after a change of conversations was sent. */
export function requestMetaDbSync() {
	if (state.scheduled) return; // one is already waiting for the browser to be idle: that one is enough
	state.scheduled = true;
	const run = () => {
		state.scheduled = false;
		sync().catch((e) =>
			console.warn("the meta of the conversations could not be synced", e),
		);
	};
	if (typeof requestIdleCallback === "function")
		requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
	else setTimeout(run, FALLBACK_DELAY_MS);
}

/**
 * Sync now, not when idle (sync_meta): every page whenever it is shown, and the sidebar's refresh button. Resolves
 * when the new list has been stored (listeners are notified), rejects with the worker's error.
 */
export function forceSyncMetaDb() {
	return sync();
}

/**
 * The stored copy: {items, stale}. items are newest first by updated_at_hint (only a hint); stale is true when there is
 * no copy yet (the first sync has not finished), and items is then [].
 */
export function readMetaDb() {
	return runWorker("get");
}
