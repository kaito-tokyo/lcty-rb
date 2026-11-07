// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty_c.worker.js: every asynchronous operation on the browser's copy of every conversation's meta (IndexedDB
// "lcty_c", store "c_meta", LCTYSP-0010, LCTYSP-0009). A module worker with no imports, started by js/api/meta-db.js
// and by /c/lcty.v1.js as new Worker(…/js/lcty_c.worker.js, { type: "module" }); no module imports it, so the bundler
// never sees it. This worker is the only code that opens "lcty_c": it alone defines the schema, and every connection is
// closed when the operation ends, so an upgrade is never blocked.
//
// One worker, one operation, as js/lcty_t.worker.js: the page posts one message {op} and gets one message back,
// {result} or {error, status} (status: the HTTP status, or null when there is none); then the page ends the worker.
// An error is posted, not thrown, because a rejection inside an async handler does not reliably reach the page as the
// Worker's error event; that event is left for a worker that could not be loaded.
//
//   {op: "force_sync"}  GET v1/meta-all.json → c_meta cleared and filled in one transaction (so conversations
//                       deleted on the server disappear from it too) → the old database "lcty" deleted → result
//                       undefined. On failure the copy is left as it was. Every page runs it whenever it is shown
//                       (js/ui/sidebar.js), and after a change of conversations (js/api/meta-db.js).
//   {op: "get"}         c_meta → result {items, stale}: items newest first by updated_at_hint, then by id (the order
//                       of the server and the sidebar); stale true, with no items, when there is no copy yet (the
//                       first force_sync has not finished). It never creates the database: only force_sync does.
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
// The site's v1/ is found from this file's URL: it is js/ under the root (LCTYSP-0005).

const DB_NAME = "lcty_c";
const DB_VERSION = 1; // raised when what is stored changes
const STORE = "c_meta";
const OLD_DB_NAME = "lcty";
const META_ALL = new URL("../v1/meta-all.json", import.meta.url);

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

async function forceSync() {
	const response = await fetch(META_ALL);
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

const OPS = { force_sync: forceSync, get };

self.onmessage = async ({ data }) => {
	self.onmessage = null; // one operation per worker
	try {
		const run = OPS[data?.op];
		if (!run) throw new Error(`unknown operation: ${data?.op}`);
		self.postMessage({ result: await run(data) });
	} catch (e) {
		self.postMessage({
			error: String(e?.message || e),
			status: e?.status ?? null,
		});
	}
};
