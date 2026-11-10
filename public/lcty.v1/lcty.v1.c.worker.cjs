// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty.v1.c.worker.cjs: the browser's copies of c/ (IndexedDB "lcty_c", LCTYSP-0014), an RPC server that runs as a
// Worker or as a SharedWorker. The messages, the database and why it works this way are in lcty.v1.c.worker.d.cts.

"use strict";

const DB_NAME = "lcty_c";
const DB_VERSION = 2; // raised when what is stored changes
const META = "c_meta";
const COUNTS = "c_recordcount";
const SYNC = "sync";
const COPIES = [META, COUNTS]; // the stores that follow the server, each keyed by cid

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

/** A global version "<boot>.<seq>" as {boot, seq}, or an error. */
/*export*/ function parseVersion(version) {
	const m = /^([0-9a-f]+)\.([0-9]+)$/.exec(String(version));
	if (!m) throw new Error(`not a version: ${version}`);
	return { boot: m[1], seq: Number(m[2]) };
}

/** Open the database at DB_VERSION, creating or upgrading it (only a write does). Upgrading drops every store. */
/*export*/ function openForWrite() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
			for (const name of COPIES) db.createObjectStore(name, { keyPath: "cid" });
			db.createObjectStore(SYNC, { keyPath: "store" });
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

/** Run fn(tx) in one transaction over stores; resolves to what fn returned when the transaction completes. */
function inTransaction(db, stores, mode, fn) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(stores, mode);
		const out = fn(tx);
		tx.oncomplete = () => resolve(out);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () =>
			reject(tx.error || new Error("the transaction was aborted"));
	});
}

/**
 * Replace a copy as a whole with what a full read answered: payload {store, version, rows}. Done when the store holds
 * no version, one of another boot, or one not newer; answers {applied}.
 */
/*export*/ async function replace(_v1, { store, version, rows }) {
	if (!COPIES.includes(store)) throw new Error(`no such store: ${store}`);
	const v = parseVersion(version);
	if (!Array.isArray(rows)) throw new Error("rows must be an array");
	const db = await openForWrite();
	try {
		return await inTransaction(db, [store, SYNC], "readwrite", (tx) => {
			const out = { applied: false };
			const sync = tx.objectStore(SYNC);
			sync.get(store).onsuccess = ({ target: { result: held } }) => {
				if (held && held.boot === v.boot && held.seq > v.seq) return; // a newer one is stored already
				const os = tx.objectStore(store);
				os.clear();
				for (const row of rows) os.put(row);
				sync.put({ store, ...v });
				out.applied = true;
			};
			return out;
		});
	} finally {
		db.close();
	}
}

/**
 * Apply the records of one change, as c.batch.updated sends it: payload {version, records}. Each store applies its
 * records only when it holds a version of the same boot that is older; records of other stores (c_html) are left.
 * Answers {applied}, the stores that applied them.
 */
/*export*/ async function apply(_v1, { version, records }) {
	const v = parseVersion(version);
	if (!Array.isArray(records)) throw new Error("records must be an array");
	const stores = COPIES.filter((s) => records.some((r) => r?.store === s));
	if (stores.length === 0) return { applied: [] };
	const db = await openForWrite();
	try {
		return await inTransaction(db, [...stores, SYNC], "readwrite", (tx) => {
			const out = { applied: [] };
			const sync = tx.objectStore(SYNC);
			for (const store of stores) {
				sync.get(store).onsuccess = ({ target: { result: held } }) => {
					// No full read of this boot yet: what came before is missing, so wait for one
					if (!held || held.boot !== v.boot || held.seq >= v.seq) return;
					const os = tx.objectStore(store);
					for (const r of records) {
						if (r.store !== store) continue;
						if (r.op === "put") os.put(r.row);
						else if (r.op === "delete") os.delete(r.row.cid);
					}
					sync.put({ store, ...v });
					out.applied.push(store);
				};
			}
			return out;
		});
	} finally {
		db.close();
	}
}

// Newest first by updatedAt, then by cid (it starts with the creation time): the order of c.list and the sidebar
function newestFirst(a, b) {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
	return a.cid < b.cid ? 1 : a.cid > b.cid ? -1 : 0;
}

/*export*/ async function get() {
	const none = { items: [], counts: {}, stale: true };
	const db = await openForRead();
	if (!db) return none;
	try {
		const all = [...COPIES, SYNC];
		if (!all.every((s) => db.objectStoreNames.contains(s))) return none; // a database of an older version
		const r = await inTransaction(db, all, "readonly", (tx) => {
			const out = {};
			tx.objectStore(META).getAll().onsuccess = (e) => {
				out.items = e.target.result;
			};
			tx.objectStore(COUNTS).getAll().onsuccess = (e) => {
				out.counts = e.target.result;
			};
			tx.objectStore(SYNC).get(META).onsuccess = (e) => {
				out.synced = Boolean(e.target.result);
			};
			return out;
		});
		return {
			items: r.items.sort(newestFirst),
			counts: Object.fromEntries(r.counts.map((c) => [c.cid, c.count])),
			stale: !r.synced,
		};
	} finally {
		db.close();
	}
}

/*non-worker-ignore-begin*/
const OPS = { replace, apply, get };

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
