// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copy of every conversation's meta (IndexedDB "lcty", store "c_meta", LCTYSP-010). A sync starts a
// worker, /js/sync_c_meta.worker.js, which fetches GET /v1/meta-all.json, replaces the whole store, posts undefined and
// ends; a failure is thrown in the worker and arrives here as its error event. This module reads the store itself (the worker owns the schema: the database is never created here)
// and closes each connection right away, so the worker's upgrade is never blocked.
//
// Pages request a sync when they load the list and after sending a change of conversations to the server
// (requestMetaDbSync(), called by api/storage.js), when the browser is idle (requestIdleCallback is not available in
// workers). In a tab at most one worker runs: a sync requested while one runs is run once after it, so an older
// response never overwrites a newer one in this tab and a change made meanwhile is still fetched. Changes not made
// through this browser (a file edited by hand, another browser) are seen at the next sync.
//
// A snapshot for the first paint (the newest SNAPSHOT_SIZE conversations by updated_at_hint, only what the sidebar
// shows before a module has loaded: id, title, updated_at_hint, tags_hint, messages_hint) is also kept in localStorage
// (lcty.meta.v1), which can be read synchronously: lcty.v1.js fills the sidebar from it before the first paint. It is
// written from the main thread (workers have no localStorage) after each sync. When it does not fit, it is removed and
// the sidebar reads the database instead.

const WORKER_URL = "/js/sync_c_meta.worker.js";
const DB_NAME = "lcty";
const STORE = "c_meta"; // the schema is the worker's
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

// One worker, one sync: resolves when the store has been replaced
function runWorker() {
	return new Promise((resolve, reject) => {
		const worker = new Worker(WORKER_URL, { type: "module" });
		// The worker posts only on success
		worker.onmessage = () => {
			worker.terminate();
			resolve();
		};
		// What the worker threw (or a failure to load it). Chromium prefixes the message with "Uncaught "
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
			const message = (e.message || "").replace(/^Uncaught /, "");
			reject(new Error(message || "the meta sync worker failed"));
		};
	});
}

// Newest first by updated_at_hint, then by id (it starts with the creation time): the same order as the server and
// the sidebar (LCTYSP-010)
function newestFirst(a, b) {
	if (a.updated_at_hint !== b.updated_at_hint)
		return a.updated_at_hint < b.updated_at_hint ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
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
		state.running = runWorker()
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
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME);
		req.onupgradeneeded = () => req.transaction.abort(); // no database yet: do not create one
		req.onerror = () => {
			if (req.error?.name === "AbortError") resolve({ items: [], stale: true });
			else reject(req.error);
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => db.close();
			if (!db.objectStoreNames.contains(STORE)) {
				db.close();
				resolve({ items: [], stale: true }); // an old database the worker has not upgraded yet
				return;
			}
			const get = db.transaction(STORE).objectStore(STORE).getAll();
			get.onsuccess = () => {
				db.close();
				resolve({ items: get.result.sort(newestFirst), stale: false });
			};
			get.onerror = () => {
				db.close();
				reject(get.error);
			};
		};
	});
}
