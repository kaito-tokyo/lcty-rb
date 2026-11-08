// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty.v1.c.worker.cjs: the browser's copy of every conversation's meta (IndexedDB "lcty_c", LCTYSP-0010), an RPC
// server that runs as a Worker or as a SharedWorker. The messages, the database and why it works this way are in
// lcty.v1.c.worker.d.cts.

"use strict";

const DB_NAME = "lcty_c";
const DB_VERSION = 1; // raised when what is stored changes
const STORE = "c_meta";
const OLD_DB_NAME = "lcty";

/** The URL of the API (v1/) that a message names as its endpoint, checked (lcty.v1.c.worker.d.cts). */
/*export*/ function endpointOf(endpoint) {
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
/*export*/ function httpError(status, message) {
	const e = new Error(message);
	e.status = status;
	return e;
}

/** Open the database at DB_VERSION, creating or upgrading it (only a sync does). Upgrading drops every other store. */
/*export*/ function openForWrite() {
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
/*export*/ function openForRead() {
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

/*export*/ async function syncMeta(v1) {
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

/*export*/ async function get() {
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

/*non-worker-ignore-begin*/
const OPS = { sync_meta: syncMeta, get };

var onmessage = async ({
	data: { id, op, endpoint, payload },
	target: port,
}) => {
	try {
		const v1 = endpointOf(endpoint);
		if (!Object.hasOwn(OPS, op)) {
			port.postMessage({ id, errorType: "unknownOperation" });
			return;
		}
		port.postMessage({ id, result: await OPS[op](v1, payload) });
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
/*non-worker-ignore-end*/
