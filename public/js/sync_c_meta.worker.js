// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// sync_c_meta.worker.js: replaces the browser's copy of every conversation's meta (LCTYSP-0010). A module worker with no
// imports, started by js/api/meta-db.js as new Worker("/js/sync_c_meta.worker.js", { type: "module" }); no module
// imports it, so the bundler never sees it. Each worker does one sync and ends:
//
//   GET /v1/meta-all.json → the store "c_meta" of the database "lcty" is cleared and filled in one transaction (so
//   conversations deleted on the server disappear from it too) → postMessage(undefined). On failure the error is
//   thrown at the top level and reaches the page as the Worker's error event; the copy is then left as it was.
//
//   database "lcty" (version DB_VERSION)
//     store "c_meta" (key: id): {id, title, created_at, updated_at_hint, setup_tags, tags_hint, messages_hint}, as
//       GET /v1/meta-all.json gives it (built by the server from each conversation file's "<!" meta lines, LCTYSP-0003)
//
// This worker is the only code that changes the schema. The pages only read the store, and close their connections
// right away, so an upgrade is not blocked by them. Upgrading drops every other store (those of the old meta_db worker).

const DB_NAME = "lcty";
const DB_VERSION = 5; // raised when what is stored changes
const STORE = "c_meta";

const response = await fetch("/v1/meta-all.json");
if (!response.ok)
	throw new Error(`Failed to fetch /v1/meta-all.json: ${response.status}`);
const metaAllJson = await response.json();
if (!Array.isArray(metaAllJson)) throw new Error("meta-all.json is invalid");

const db = await new Promise((resolve, reject) => {
	const req = indexedDB.open(DB_NAME, DB_VERSION);

	req.onupgradeneeded = () => {
		const db = req.result;
		for (const name of [...db.objectStoreNames]) {
			if (name !== STORE) {
				db.deleteObjectStore(name);
			}
		}
		if (!db.objectStoreNames.contains(STORE)) {
			db.createObjectStore(STORE, { keyPath: "id" });
		}
	};

	req.onsuccess = () => resolve(req.result);
	req.onerror = () => reject(req.error);
});

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

	self.postMessage(undefined);
} finally {
	db.close();
}
