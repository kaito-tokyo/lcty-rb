// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// sync_meta.worker.js: replaces the browser's copy of every conversation's meta (LCTYSP-010). A classic worker with no
// imports, started by js/api/meta-db.js as new Worker("/js/sync_meta.worker.js"); it is not a module, so the bundler
// never sees it. Each worker does one sync and ends:
//
//   GET /v1/meta-all.json → the store "c_meta" of the database "lcty" is cleared and filled in one transaction (so
//   conversations deleted on the server disappear from it too) → postMessage(undefined), or postMessage(Error) when
//   any step failed (the copy is then left as it was)
//
//   database "lcty" (version DB_VERSION)
//     store "c_meta" (key: id): {id, title, created_at, updated_at_hint, setup_tags, tags_hint, messages_hint}, as
//       GET /v1/meta-all.json gives it (built by the server from each conversation file's "<!" meta lines, LCTYSP-003)
//
// This worker is the only code that changes the schema. The pages only read the store, and close their connections
// right away, so an upgrade is not blocked by them. Upgrading drops every other store (those of the old meta_db worker).

const DB_NAME = "lcty";
const DB_VERSION = 5; // raised when what is stored changes
const STORE = "c_meta";

function request(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function open() {
	const req = indexedDB.open(DB_NAME, DB_VERSION);
	req.onupgradeneeded = () => {
		const db = req.result;
		for (const name of [...db.objectStoreNames])
			if (name !== STORE) db.deleteObjectStore(name);
		if (!db.objectStoreNames.contains(STORE))
			db.createObjectStore(STORE, { keyPath: "id" });
	};
	return request(req);
}

// The database is only a copy: when it cannot be opened (a newer version left by other code, a broken database), it is
// deleted and created again
async function openDb() {
	try {
		return await open();
	} catch (e) {
		console.warn("the meta database could not be opened; recreating it", e);
		await request(indexedDB.deleteDatabase(DB_NAME));
		return open();
	}
}

async function sync() {
	const r = await fetch("/v1/meta-all.json", { cache: "no-store" });
	if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
	const all = await r.json();
	if (!Array.isArray(all)) throw new Error("meta-all.json is not a list");
	const db = await openDb();
	try {
		const tx = db.transaction(STORE, "readwrite");
		const store = tx.objectStore(STORE);
		store.clear();
		for (const m of all) store.put(m);
		await new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error || new Error("the transaction was aborted"));
		});
	} finally {
		db.close();
	}
}

// A plain Error, so the message can be cloned whatever failed (a DOMException from IndexedDB, a TypeError from fetch)
sync().then(
	() => self.postMessage(undefined),
	(e) => self.postMessage(new Error(String(e?.message || e))),
);
