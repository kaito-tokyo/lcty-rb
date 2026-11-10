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
const HAS_MANY = "t_has_many_c"; // which conversations each tag has, followed over /v1/rpc (LCTYSP-0014)
const SYNC = "sync";

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

/** The error of a failed request: the message is "<status> <body>", and status is the HTTP status (as api/storage.js). */
/*export*/ function httpError(status, body) {
	const e = new Error(`${status} ${body.slice(0, 200)}`);
	e.status = status;
	return e;
}

/*export*/ async function send(v1, method, path, body, headers = {}) {
	const init = { method, headers: { ...headers } };
	if (body !== undefined) {
		init.headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const r = await fetch(new URL(path, v1), init);
	if (!r.ok) throw httpError(r.status, await r.text());
	return r;
}

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

/** Run fn(tags, set) in one transaction over both stores; resolves to what fn returned, with every request in it
 * replaced by its result, when the transaction completes. */
/*export*/ async function withStores(mode, fn) {
	const db = await openDb();
	try {
		const tx = db.transaction([TAGS, SET], mode);
		const reqs = fn(tx.objectStore(TAGS), tx.objectStore(SET));
		await new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error || new Error("the transaction was aborted"));
		});
		return (
			reqs &&
			Object.fromEntries(Object.entries(reqs).map(([k, r]) => [k, r.result]))
		);
	} finally {
		db.close();
	}
}

async function syncFull(v1) {
	const r = await send(v1, "GET", "tags");
	const json = await r.json();
	if (!Array.isArray(json?.tags)) throw new Error("GET /v1/tags is invalid");
	// A file system may list the names decomposed (HFS+); the server compares the files themselves. The name of an
	// invalid tag (a file without <lcty-t>) comes from its file name, so it is normalized too
	const tags = json.tags.map((t) => ({
		...t,
		file: t.file.normalize("NFC"),
		...(t.invalid ? { name: t.name.normalize("NFC") } : {}),
	}));
	const etag = r.headers.get("ETag");
	await withStores("readwrite", (rows, set) => {
		rows.clear();
		for (const t of tags) rows.put(t);
		set.put({ etag }, SET_KEY);
	});
}

const readCopy = () =>
	withStores("readonly", (rows, set) => ({
		tags: rows.getAll(),
		set: set.get(SET_KEY),
	}));

/*export*/ async function get(v1) {
	let copy = await readCopy();
	if (!copy.set) {
		await syncFull(v1);
		copy = await readCopy();
	}
	return { tags: copy.tags, etag: copy.set.etag };
}

/** fn(), then a sync whatever happened; fn's result or error is what counts. */
/*export*/ async function thenSync(v1, fn) {
	try {
		return await fn();
	} finally {
		await syncFull(v1).catch(() => {});
	}
}

/*export*/ const put = (v1, { tags, etag }) =>
	thenSync(v1, async () => {
		const r = await send(
			v1,
			"PUT",
			"tags",
			{ tags },
			{ "If-Match": etag ?? "" },
		);
		return r.headers.get("ETag");
	});

/*export*/ const addMemory = (v1, { file, body }) =>
	thenSync(v1, async () => {
		const r = await send(
			v1,
			"POST",
			`tags/${encodeURIComponent(file)}/memory`,
			body,
		);
		return r.json();
	});

// ---- t_has_many_c: a copy that follows the server under the version rule (LCTYSP-0014) ----

/** A global version "<boot>.<seq>" as {boot, seq}, or an error. */
/*export*/ function parseVersion(version) {
	const m = /^([0-9a-f]+)\.([0-9]+)$/.exec(String(version));
	if (!m) throw new Error(`not a version: ${version}`);
	return { boot: m[1], seq: Number(m[2]) };
}

/** Run fn(tx) in one transaction over t_has_many_c and sync; resolves to what fn returned when it completes. */
async function withHasMany(mode, fn) {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([HAS_MANY, SYNC], mode);
			const out = fn(tx.objectStore(HAS_MANY), tx.objectStore(SYNC));
			tx.oncomplete = () => resolve(out);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error || new Error("the transaction was aborted"));
		});
	} finally {
		db.close();
	}
}

/**
 * Replace t_has_many_c with what t.c.list answered: payload {store, version, rows}. Done unless the copy holds a newer
 * version of the same boot; answers {applied}.
 */
/*export*/ function replace(_v1, { store, version, rows }) {
	if (store !== HAS_MANY) throw new Error(`no such store: ${store}`);
	const v = parseVersion(version);
	if (!Array.isArray(rows)) throw new Error("rows must be an array");
	return withHasMany("readwrite", (os, sync) => {
		const out = { applied: false };
		sync.get(HAS_MANY).onsuccess = ({ target: { result: held } }) => {
			if (held && held.boot === v.boot && held.seq > v.seq) return;
			os.clear();
			for (const { tag, cid } of rows) os.put({ tag, cid });
			sync.put({ store: HAS_MANY, ...v });
			out.applied = true;
		};
		return out;
	});
}

/**
 * Apply the records of one t.batch.updated: payload {version, records}, only onto a copy of the same boot holding an
 * older version. Answers {applied}, the stores that applied them.
 */
/*export*/ function apply(_v1, { version, records }) {
	const v = parseVersion(version);
	if (!Array.isArray(records)) throw new Error("records must be an array");
	const mine = records.filter((r) => r?.store === HAS_MANY);
	if (mine.length === 0) return { applied: [] };
	return withHasMany("readwrite", (os, sync) => {
		const out = { applied: [] };
		sync.get(HAS_MANY).onsuccess = ({ target: { result: held } }) => {
			if (!held || held.boot !== v.boot || held.seq >= v.seq) return;
			for (const { op, row } of mine) {
				if (op === "put") os.put({ tag: row.tag, cid: row.cid });
				else if (op === "delete") os.delete([row.tag, row.cid]);
			}
			sync.put({ store: HAS_MANY, ...v });
			out.applied.push(HAS_MANY);
		};
		return out;
	});
}

/** Every row of t_has_many_c, ordered by tag then cid; stale true when it has never been filled. */
/*export*/ function getHasMany() {
	return withHasMany("readonly", (os, sync) => {
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
const OPS = {
	sync_full: syncFull,
	get,
	put,
	addMemory,
	replace,
	apply,
	get_has_many: getHasMany,
};

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
