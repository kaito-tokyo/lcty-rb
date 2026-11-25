// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty.v1.t.worker.cjs: the tags in the browser (IndexedDB "lcty_t", LCTYSP-0009), an RPC server that runs as a Worker
// or as a SharedWorker. The messages, the database and why it works this way are in lcty.v1.t.worker.d.cts.

"use strict";

const DB_NAME = "lcty_t";
const DB_VERSION = 3; // raised when what is stored changes
const TAGS = "t_full";
const SET = "t_set";
const SET_KEY = "set";
const HAS_MANY = "t_has_many_c"; // which conversations each tag has
const SYNC = "sync";

function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
			db.createObjectStore(TAGS, { keyPath: "file" });
			db.createObjectStore(SET);
			db.createObjectStore(HAS_MANY, { keyPath: ["tag", "cid"] });
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

/** Run fn(...stores) in one transaction over names; resolves to what fn returned when the transaction completes. */
/*export*/ async function withStores(mode, names, fn) {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(names, mode);
			const out = fn(...names.map((n) => tx.objectStore(n)));
			tx.oncomplete = () => resolve(out);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error || new Error("the transaction was aborted"));
		});
	} finally {
		db.close();
	}
}

/** A global version "<boot>.<seq>" as {boot, seq}, or an error. */
/*export*/ function parseVersion(version) {
	const m = /^([0-9a-f]+)\.([0-9]+)$/.exec(String(version));
	if (!m) throw new Error(`not a version: ${version}`);
	return { boot: m[1], seq: Number(m[2]) };
}

/** A tag as the server lists it, its file name (and an invalid tag's name, from its file name) NFC-normalized. */
/*export*/ function tagRow(t) {
	return {
		...t,
		file: t.file.normalize("NFC"),
		...(t.invalid ? { name: t.name.normalize("NFC") } : {}),
	};
}

// The stores of each copy, the first holding its rows; t_set belongs to the copy t_full
const COPIES = { [TAGS]: [TAGS, SET], [HAS_MANY]: [HAS_MANY] };

/** Replace the copy store with what t.list or t.c.list answered, unless it holds a newer version of the same boot. */
/*export*/ function replace({ store, version, rows, etag }) {
	if (!Object.hasOwn(COPIES, store)) throw new Error(`no such store: ${store}`);
	const v = parseVersion(version);
	if (!Array.isArray(rows)) throw new Error("rows must be an array");
	return withStores("readwrite", [...COPIES[store], SYNC], (...os) => {
		const sync = os.at(-1);
		const out = { applied: false };
		sync.get(store).onsuccess = ({ target: { result: held } }) => {
			if (held && held.boot === v.boot && held.seq > v.seq) return;
			os[0].clear();
			if (store === TAGS) {
				for (const t of rows) os[0].put(tagRow(t));
				os[1].put({ etag: etag ?? null }, SET_KEY);
			} else for (const { tag, cid } of rows) os[0].put({ tag, cid });
			sync.put({ store, ...v });
			out.applied = true;
		};
		return out;
	});
}

// Write one record of t.batch.updated into the stores of its copy
function write(os, { store, op, row }) {
	if (store === HAS_MANY) {
		if (op === "put") os[0].put({ tag: row.tag, cid: row.cid });
		else if (op === "delete") os[0].delete([row.tag, row.cid]);
	} else if (store === SET) {
		if (op === "put") os[1].put({ etag: row.etag ?? null }, SET_KEY);
	} else if (op === "put") os[0].put(tagRow(row));
	else if (op === "delete") os[0].delete(row.file.normalize("NFC"));
}

/**
 * Apply the records of one t.batch.updated, each copy only when it holds an older version of the same boot. Answers
 * {applied}, the copies that applied them.
 */
/*export*/ async function apply({ version, records }) {
	const v = parseVersion(version);
	if (!Array.isArray(records)) throw new Error("records must be an array");
	const copyOf = (s) => (s === SET ? TAGS : s);
	const applied = [];
	for (const store of Object.keys(COPIES)) {
		const mine = records.filter((r) => r && copyOf(r.store) === store);
		if (mine.length === 0) continue;
		const done = await withStores(
			"readwrite",
			[...COPIES[store], SYNC],
			(...os) => {
				const out = { done: false };
				const sync = os.at(-1);
				sync.get(store).onsuccess = ({ target: { result: held } }) => {
					if (!held || held.boot !== v.boot || held.seq >= v.seq) return;
					for (const r of mine) write(os, r);
					sync.put({ store, ...v });
					out.done = true;
				};
				return out;
			},
		);
		if (done.done) applied.push(store);
	}
	return { applied };
}

/** The order of the tags: by order, those without one last, ties by file name (the rows come in that order). */
function byOrder(a, b) {
	const x = a.order ?? Number.POSITIVE_INFINITY;
	const y = b.order ?? Number.POSITIVE_INFINITY;
	return x === y ? 0 : x < y ? -1 : 1;
}

/** t_full and t_set: the tags in their order and the ETag; stale true when the copy has never been filled. */
/*export*/ function get() {
	return withStores("readonly", [TAGS, SET, SYNC], (tags, set, sync) => {
		const out = { tags: [], etag: null, stale: true };
		tags.getAll().onsuccess = (e) => {
			out.tags = e.target.result.sort(byOrder); // stable: ties stay in file-name order
		};
		set.get(SET_KEY).onsuccess = (e) => {
			out.etag = e.target.result?.etag ?? null;
		};
		sync.get(TAGS).onsuccess = (e) => {
			out.stale = !e.target.result;
		};
		return out;
	});
}

/** Every row of t_has_many_c, ordered by tag then cid; stale true when it has never been filled. */
/*export*/ function getHasMany() {
	return withStores("readonly", [HAS_MANY, SYNC], (os, sync) => {
		const out = { rows: [], stale: true };
		os.getAll().onsuccess = (e) => {
			out.rows = e.target.result;
		};
		sync.get(HAS_MANY).onsuccess = (e) => {
			out.stale = !e.target.result;
		};
		return out;
	});
}

/*non-worker-ignore-begin*/
const OPS = { get, replace, apply, get_has_many: getHasMany };

var onmessage = async ({ data: { id, op, payload }, target: port }) => {
	try {
		if (!Object.hasOwn(OPS, op)) {
			port.postMessage({ id, errorType: "unknownOperation" });
			return;
		}
		port.postMessage({ id, result: await OPS[op](payload) });
	} catch (error) {
		try {
			port.postMessage({ id, errorType: "error", error });
		} catch {
			port.postMessage({
				id,
				errorType: "errorMessage",
				errorMessage: error?.errorMessage ?? String(error),
			});
		}
	}
};

// biome-ignore lint/correctness/noUnusedVariables: the global handler of a SharedWorker, set by a top-level var
var onconnect = ({ ports: [port] }) => {
	port.onmessage = onmessage;
};
/*non-worker-ignore-end*/
