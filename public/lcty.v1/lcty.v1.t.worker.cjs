// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty.v1.t.worker.cjs: the tags in the browser (IndexedDB "lcty_v1_t", LCTYSP-0009), an RPC server that runs as a Worker
// or as a SharedWorker. The messages, the database and why it works this way are in lcty.v1.t.worker.d.cts.

"use strict";

const DB_NAME = "lcty_v1_t";
const DB_VERSION = 2; // raised when what is stored changes
const TAGS = "t_full";
const SET = "t_set";
const SET_KEY = "set";

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

/*non-worker-ignore-begin*/
const OPS = { sync_full: syncFull, get, put, addMemory };

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
