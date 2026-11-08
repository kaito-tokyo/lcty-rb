// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty_c.worker.js: every asynchronous operation on the browser's copy of every conversation's meta (IndexedDB
// "lcty_c", store "c_meta", LCTYSP-0010, LCTYSP-0009). A classic worker script with no imports, started by
// js/api/meta-db.js and by /c/lcty.v1.js as new Worker(…/lcty_c.worker.js); no module imports it, so the bundler never
// sees it. This worker is the only code that opens "lcty_c": it alone defines the schema, and every connection is
// closed when the operation ends, so an upgrade is never blocked.
//
// An RPC server, as lcty_t.worker.js, that runs as a Worker or as a SharedWorker alike: a message {id, op, endpoint,
// payload} is answered on the port it came from (the worker itself, or the SharedWorker's port) by {id, result}, or by
// {id, errorType} on a failure: "unknownOperation" for an op it does not have, "error" with error (the Error itself)
// and status (the HTTP status, or null when there is none), or "errorMessage" with errorMessage (its text) when the
// error cannot be posted as it is. A message without an id cannot be answered. An error is posted, not thrown, because
// a rejection inside an async handler does not reliably reach the page as the Worker's error event; that event is left
// for a worker that could not be loaded.
//
//   {op: "sync_meta"}  GET v1/meta-all.json → c_meta cleared and filled in one transaction (so conversations deleted
//                      on the server disappear from it too) → the old database "lcty" deleted → result undefined. On
//                      failure the copy is left as it was. Every page runs it whenever it is shown (js/ui/sidebar.js),
//                      and after a change of conversations (js/api/meta-db.js).
//   {op: "get"}        c_meta → result {items, stale}: items newest first by updated_at_hint, then by id (the order of
//                      the server and the sidebar); stale true, with no items, when there is no copy yet (the first
//                      sync_meta has not finished). It never creates the database: only sync_meta does.
//
//   database "lcty_c" (version DB_VERSION)
//     store "c_meta" (key: id): {id, title, created_at, updated_at_hint, setup_tags, tags_hint, messages_hint}, as
//       GET /v1/meta-all.json gives it (built by the server from each conversation file's "<!" meta lines, LCTYSP-0003)
//
// "lcty" is the database of the copy before IndexedDB was split by resource ("lcty_c" for c/, "lcty_t" for t/,
// LCTYSP-0009). It is derived, so it is deleted, not converted: a sync deletes it after the copy is in place (a
// database that does not exist is deleted at once). A deletion blocked by a connection of a page still running older
// code is not waited for; the next sync tries again.
//
// endpoint is the URL of the site's v1/, which the page knows (siteUrl("v1/")): every message carries it, so the worker
// does not depend on where it is served. It must be on the worker's origin and end with "/"; otherwise the message is
// answered with an error, before any operation.

const DB_NAME = "lcty_c";
const DB_VERSION = 1; // raised when what is stored changes
const STORE = "c_meta";
const OLD_DB_NAME = "lcty";

/**
 * The URL of the API (v1/) that a message names as its endpoint: an absolute URL on this worker's origin, ending in "/"
 * (the copy in IndexedDB is the origin's, so it must not be filled from another server).
 */
function endpointOf(endpoint) {
	if (typeof endpoint !== "string")
		throw new Error("the message has no endpoint");
	const url = new URL(endpoint);
	if (url.origin !== location.origin)
		throw new Error(`the endpoint is not on this origin: ${endpoint}`);
	if (!url.pathname.endsWith("/"))
		throw new Error(`the endpoint does not end with /: ${endpoint}`);
	return url;
}

/** The error of a failed request, with the HTTP status as status. */
function httpError(status, message) {
	const e = new Error(message);
	e.status = status;
	return e;
}

/** Open the database at DB_VERSION, creating or upgrading it (only a sync does). Upgrading drops every other store. */
function openForWrite() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [...db.objectStoreNames]) {
				if (name !== STORE) db.deleteObjectStore(name);
			}
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: "id" });
			}
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	});
}

/** Open the database as it is, or resolve to null when there is none (it is not created). */
function openForRead() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME);
		req.onupgradeneeded = () => req.transaction.abort(); // no database yet: do not create one
		req.onerror = () => {
			if (req.error?.name === "AbortError") resolve(null);
			else reject(req.error);
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
	});
}

function deleteOldDb() {
	return new Promise((resolve) => {
		const req = indexedDB.deleteDatabase(OLD_DB_NAME);
		req.onsuccess = () => resolve();
		req.onerror = () => resolve(); // the copy is in place: an old database left behind is only space
		req.onblocked = () => resolve();
	});
}

async function syncMeta(v1) {
	const response = await fetch(new URL("meta-all.json", v1));
	if (!response.ok)
		throw httpError(
			response.status,
			`Failed to fetch /v1/meta-all.json: ${response.status}`,
		);
	const metaAllJson = await response.json();
	if (!Array.isArray(metaAllJson)) throw new Error("meta-all.json is invalid");

	const db = await openForWrite();
	try {
		const tx = db.transaction(STORE, "readwrite");
		const store = tx.objectStore(STORE);
		store.clear();
		for (const m of metaAllJson) {
			store.put(m);
		}
		await new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error || new Error("the transaction was aborted"));
		});
	} finally {
		db.close();
	}
	await deleteOldDb();
}

// Newest first by updated_at_hint, then by id (it starts with the creation time): the same order as the server and
// the sidebar (LCTYSP-0010)
function newestFirst(a, b) {
	if (a.updated_at_hint !== b.updated_at_hint)
		return a.updated_at_hint < b.updated_at_hint ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

async function get() {
	const db = await openForRead();
	if (!db) return { items: [], stale: true };
	try {
		if (!db.objectStoreNames.contains(STORE)) return { items: [], stale: true };
		const items = await new Promise((resolve, reject) => {
			const req = db.transaction(STORE).objectStore(STORE).getAll();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		return { items: items.sort(newestFirst), stale: false };
	} finally {
		db.close();
	}
}

var onmessage = async ({
	data: { id, op, endpoint, payload },
	target: port,
}) => {
	try {
		const v1 = endpointOf(endpoint);
		switch (op) {
			case "sync_meta": {
				const result = await syncMeta(v1, payload);
				port.postMessage({ id, result });
				break;
			}
			case "get": {
				const result = await get(v1, payload);
				port.postMessage({ id, result });
				break;
			}
			default:
				port.postMessage({ id, errorType: "unknownOperation" });
		}
	} catch (error) {
		const status = error?.status ?? null;
		try {
			port.postMessage({ id, errorType: "error", error, status });
		} catch {
			port.postMessage({
				id,
				errorType: "errorMessage",
				errorMessage: error?.errorMessage ?? String(error),
				status,
			});
		}
	}
};

// biome-ignore lint/correctness/noUnusedVariables: the global handler of a SharedWorker, set by a top-level var
var onconnect = ({ ports: [port] }) => {
	port.onmessage = onmessage;
};
