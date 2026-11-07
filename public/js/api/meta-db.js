// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copy of every conversation's meta (IndexedDB "lcty_c", store "c_meta", LCTYSP-0010). Every operation on
// it starts one worker, js/lcty_c.worker.js of the site, posts it one message ({op: "sync"} or {op: "get"}) and gets
// its answer, {result} or {error, status}; the worker is the only code that opens the database (LCTYSP-0009). A sync
// (force_sync) fetches GET v1/meta-all.json and replaces the whole store; a read returns the copy without ever
// creating it.
//
// Every page syncs whenever it is shown (forceSyncMetaDb(), called by js/ui/sidebar.js, at once). Pages also request a
// sync when they load the list and after sending a change of conversations to the server (requestMetaDbSync(), called
// by api/storage.js), when the browser is idle (requestIdleCallback is not available in
// workers). In a tab at most one worker runs: a sync requested while one runs is run once after it, so an older
// response never overwrites a newer one in this tab and a change made meanwhile is still fetched. Changes not made
// through this browser (a file edited by hand, another browser) are seen at the next sync.
//
// A snapshot for the first paint (the newest SNAPSHOT_SIZE conversations by updated_at_hint, only what the sidebar
// shows before a module has loaded: id, title, updated_at_hint, tags_hint, messages_hint) is also kept in localStorage
// (lcty.meta.v1), which can be read synchronously: lcty.v1.js fills the sidebar from it before the first paint. It is
// written from the main thread (workers have no localStorage) after each sync. When it does not fit, it is removed and
// the sidebar reads the database instead.

import { siteUrl } from "../site.js";

const WORKER_PATH = "js/lcty_c.worker.js"; // relative to the root of the site (LCTYSP-0005)
const IDLE_TIMEOUT_MS = 10000; // run by then even if the browser never becomes idle
const FALLBACK_DELAY_MS = 1000; // where requestIdleCallback is missing
const SNAPSHOT_KEY = "lcty.meta.v1"; // localStorage, read by lcty.v1.js
const SNAPSHOT_SIZE = 20; // the newest conversations only: it is the first view, not the list

// running: the sync in progress; queued: the one that runs after it; scheduled: a requested sync waits for idle time;
// listeners: called when a new list was stored
const state = {
	running: null,
	queued: null,
	scheduled: false,
	listeners: null,
};

// One worker, one operation: resolves to its result, rejects with its error (with the HTTP status as status)
function runWorker(message) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(siteUrl(WORKER_PATH), { type: "module" });
		worker.onmessage = ({ data }) => {
			worker.terminate();
			if (data && "error" in data) {
				const e = new Error(data.error);
				e.status = data.status;
				reject(e);
			} else resolve(data?.result);
		};
		// A worker that could not be loaded (or threw outside an operation). Chromium prefixes "Uncaught "
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
			const text = (e.message || "").replace(/^Uncaught /, "");
			reject(new Error(text || "the meta sync worker failed"));
		};
		worker.postMessage(message);
	});
}

// Keep only what the sidebar shows before a module has loaded: the newest SNAPSHOT_SIZE, and only their id, title,
// updated_at_hint, tags_hint and messages_hint
function saveSnapshot(items) {
	const newest = items
		.slice(0, SNAPSHOT_SIZE)
		.map(({ id, title, updated_at_hint, tags_hint, messages_hint }) => ({
			id,
			title,
			updated_at_hint,
			tags_hint,
			messages_hint,
		}));
	try {
		localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(newest));
	} catch {
		try {
			localStorage.removeItem(SNAPSHOT_KEY); // too large (or no storage): the sidebar reads the database
		} catch {}
	}
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
		state.running = runWorker({ op: "force_sync" })
			.then(readMetaDb)
			.then(({ items }) => {
				saveSnapshot(items);
				notify();
			})
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
 * Call fn whenever a new list has been stored: by a sync in this tab, or in another tab (seen through the snapshot's
 * storage event). fn reads the copy again with readMetaDb().
 */
export function onMetaDbChange(fn) {
	if (!state.listeners) {
		state.listeners = [];
		addEventListener("storage", (e) => {
			if (e.key === SNAPSHOT_KEY) notify();
		});
	}
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
 * Sync now, not when idle (force_sync): every page whenever it is shown. Resolves when the new list has been stored
 * (listeners are notified), rejects with the worker's error.
 */
export function forceSyncMetaDb() {
	return sync();
}

/**
 * Sync now, not when idle: the sidebar's refresh button. The snapshot is thrown away first; the store is replaced by the
 * sync. Resolves when the new list has been stored (listeners are notified), rejects with the worker's error.
 */
export function resetMetaDb() {
	try {
		localStorage.removeItem(SNAPSHOT_KEY);
	} catch {}
	return sync();
}

/**
 * The stored copy: {items, stale}. items are newest first by updated_at_hint (only a hint); stale is true when there is
 * no copy yet (the first sync has not finished), and items is then [].
 */
export function readMetaDb() {
	return runWorker({ op: "get" });
}
