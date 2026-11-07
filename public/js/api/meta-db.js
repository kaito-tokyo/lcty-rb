// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The browser's copy of every conversation's meta (IndexedDB, LCTYSP-010), kept by a worker
// (/meta_db.worker.js, which owns the database and fetches GET /v1/meta-all.json). This module only sends it
// messages; the worker starts on first use.
//
// The copy is never refetched while it is up to date. Sending a change of conversations to the server invalidates it
// (invalidateMetaDb(), called by api/storage.js) and requests a sync. Pages call syncMetaDbIfStale() when they load the
// list. Sync requests are sent when the browser is idle (requestIdleCallback is not available in workers). The worker
// answers every message at once with whether it accepted it; it refuses a sync while one runs, and a refused sync is
// requested again a little later, so the copy still catches up with an invalidation made while a sync was running.
// Changes not made through this browser (a file edited by hand, another browser) are not seen until the next
// invalidation.
//
// A snapshot for the first paint (the newest SNAPSHOT_SIZE conversations by updated_at_hint, only what the sidebar
// shows before a module has loaded: id, title, updated_at_hint, tags_hint, messages_hint) is also kept in localStorage
// (lcty.meta.v1), which can be read synchronously: lcty.v1.js fills the sidebar from it before the first paint. It is
// written from the main thread (workers have no localStorage) whenever a sync has stored a new list, and from the
// database when it is missing. When it does not fit, it is removed and the sidebar reads the database instead.

const WORKER_URL = "/meta_db.worker.js";
const IDLE_TIMEOUT_MS = 10000; // run by then even if the browser never becomes idle
const FALLBACK_DELAY_MS = 1000; // where requestIdleCallback is missing
const RETRY_DELAY_MS = 500; // before requesting a refused sync again
const SNAPSHOT_KEY = "lcty.meta.v1"; // localStorage, read by lcty.v1.js
const SNAPSHOT_SIZE = 20; // the newest conversations only: it is the first view, not the list

// worker: started on first use; pending: id → {resolve, reject, op}; listeners: called when a new list was stored
const state = { worker: null, seq: 0, pending: null, listeners: null };

// op's result; a refused op rejects with an error whose refused is true
function call(op) {
	if (!state.worker) {
		state.pending = new Map();
		state.worker = new Worker(WORKER_URL);
		state.worker.onmessage = ({ data }) => {
			const p = state.pending.get(data.id);
			if (!p) return;
			if ("accepted" in data) {
				if (data.accepted) return; // the result follows
				state.pending.delete(data.id);
				p.reject(
					Object.assign(new Error(data.error || `${p.op} was refused`), {
						refused: !data.error,
					}),
				);
				return;
			}
			state.pending.delete(data.id);
			if (data.error) p.reject(new Error(data.error));
			else p.resolve(data.result);
		};
		state.worker.onerror = (e) => {
			for (const p of state.pending.values())
				p.reject(new Error(e.message || "the meta worker failed"));
			state.pending.clear();
			// a worker that failed (to load, or with an uncaught error) is not reused: the next call starts a new one
			state.worker.terminate();
			state.worker = null;
		};
	}
	const id = ++state.seq;
	return new Promise((resolve, reject) => {
		state.pending.set(id, { resolve, reject, op });
		state.worker.postMessage({ id, op });
	});
}

function warn(e) {
	console.warn("the meta of the conversations could not be synced", e);
}

// Newest first by updated_at_hint, then by id (it starts with the creation time): the same order as the server, the
// worker and the sidebar (LCTYSP-010)
function newestFirst(a, b) {
	if (a.updated_at_hint !== b.updated_at_hint)
		return a.updated_at_hint < b.updated_at_hint ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Keep only what the sidebar shows before a module has loaded: the newest SNAPSHOT_SIZE, and only their id, title,
// updated_at_hint, tags_hint and messages_hint
function saveSnapshot(all) {
	const items = [...all]
		.sort(newestFirst)
		.slice(0, SNAPSHOT_SIZE)
		.map(({ id, title, updated_at_hint, tags_hint, messages_hint }) => ({
			id,
			title,
			updated_at_hint,
			tags_hint,
			messages_hint,
		}));
	try {
		localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(items));
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

// A snapshot that is not a list (broken, or written by other code) counts as missing, so it is written again
function hasSnapshot() {
	let v;
	try {
		v = localStorage.getItem(SNAPSHOT_KEY);
	} catch {
		return true; // no storage: nothing to write
	}
	try {
		return v !== null && Array.isArray(JSON.parse(v));
	} catch {
		return false;
	}
}

// Send op ("sync" or "syncIfStale") to the worker when the browser is idle; when it is refused (a sync was running),
// request it again a little later
function requestSync(op) {
	const run = () =>
		call(op)
			.then((all) => {
				if (all) {
					saveSnapshot(all); // a new list was stored
					notify();
				} else if (!hasSnapshot()) {
					return call("read").then(({ items }) => saveSnapshot(items));
				}
			})
			.catch((e) => {
				if (e.refused) setTimeout(() => requestSync(op), RETRY_DELAY_MS);
				else warn(e);
			});
	if (typeof requestIdleCallback === "function")
		requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
	else setTimeout(run, FALLBACK_DELAY_MS);
}

/** Refetch the copy when idle, unless it is up to date. */
export function syncMetaDbIfStale() {
	requestSync("syncIfStale");
}

/** A change of conversations was sent to the server: the copy is out of date until the next sync, which is requested. */
export function invalidateMetaDb() {
	call("invalidate").catch(warn);
	requestSync("sync");
}

/**
 * The stored copy: {items, stale}. items are newest first by updated_at_hint (only a hint), [] before the first sync;
 * stale is true while the copy is out of date (a sync is pending or has not happened yet).
 */
export function readMetaDb() {
	return call("read");
}
