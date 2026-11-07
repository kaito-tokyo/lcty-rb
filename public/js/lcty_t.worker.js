// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// lcty_t.worker.js: every asynchronous operation on the tags in the browser (LCTYSP-0009): the browser's copy of
// GET /v1/tags (IndexedDB "lcty_t", store "t_full") and the requests that change the tags. A module worker with no
// imports, started by js/api/lcty-t.js as new Worker(siteUrl("js/lcty_t.worker.js"), { type: "module" }); no module
// imports it, so the bundler never sees it. This worker is the only code that opens "lcty_t": it alone defines the
// schema, and every connection is closed when the operation ends, so an upgrade is never blocked.
//
// One worker, one operation: the page posts one message {op, ...} and gets one message back, {result} or
// {error, status} (status: the HTTP status, or null when there is none); then the page ends the worker. An error is
// posted, not thrown, because a rejection inside an async handler does not reliably reach the page as the Worker's
// error event; that event is left for a worker that could not be loaded.
//
//   {op: "sync"}                 GET v1/tags → t_full replaced in one transaction → result undefined
//   {op: "get"}                  t_full → result {tags, etag}; when there is no copy yet, a sync first
//   {op: "put", tags, etag}      PUT v1/tags with If-Match etag (the one the caller read the tags with, never the
//                                copy's: the copy may be newer than what the caller edited) → result the new ETag
//   {op: "addMemory", file, body} POST v1/tags/:file/memory → result the server's JSON
//
// put and addMemory sync afterwards, also when they failed (the server's set may have changed: a 412 or 404 means
// it did), so the caller reads the new set with get. A failure of that sync is not reported: the change itself is
// what the caller asked about, and the next sync fixes the copy.
//
//   database "lcty_t" (version DB_VERSION)
//     store "t_full" (out-of-line keys), one record under the key "set": {tags, etag}, as GET /v1/tags gives them
//       (tags: [{file, name, ops, prompt, memory}], file names NFC-normalized; etag: the ETag of the set)
//
// The site's v1/ is found from this file's URL: it is js/ under the root (LCTYSP-0005).

const DB_NAME = "lcty_t";
const DB_VERSION = 1; // raised when what is stored changes
const STORE = "t_full";
const KEY = "set";
const V1 = new URL("../v1/", import.meta.url);

/** The error of a failed request: the message is "<status> <body>", and status is the HTTP status (as api/storage.js). */
function httpError(status, body) {
	const e = new Error(`${status} ${body.slice(0, 200)}`);
	e.status = status;
	return e;
}

async function send(method, path, body, headers = {}) {
	const init = { method, headers: { ...headers } };
	if (body !== undefined) {
		init.headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const r = await fetch(new URL(path, V1), init);
	if (!r.ok) throw httpError(r.status, await r.text());
	return r;
}

function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [...db.objectStoreNames]) {
				if (name !== STORE) db.deleteObjectStore(name);
			}
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	});
}

/** Run fn(store) in one transaction of mode; resolves to what fn returned (a request's result) when it completes. */
async function withStore(mode, fn) {
	const db = await openDb();
	try {
		const tx = db.transaction(STORE, mode);
		const req = fn(tx.objectStore(STORE));
		await new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error || new Error("the transaction was aborted"));
		});
		return req?.result;
	} finally {
		db.close();
	}
}

async function sync() {
	const r = await send("GET", "tags");
	const json = await r.json();
	if (!Array.isArray(json?.tags)) throw new Error("GET /v1/tags is invalid");
	// A file system may list the names decomposed (HFS+); the server compares the files themselves
	const tags = json.tags.map((t) => ({ ...t, file: t.file.normalize("NFC") }));
	const etag = r.headers.get("ETag");
	await withStore("readwrite", (store) => store.put({ tags, etag }, KEY));
}

async function get() {
	let set = await withStore("readonly", (store) => store.get(KEY));
	if (!set) {
		await sync();
		set = await withStore("readonly", (store) => store.get(KEY));
	}
	return { tags: set.tags, etag: set.etag };
}

/** fn(), then a sync whatever happened; fn's result or error is what counts. */
async function thenSync(fn) {
	try {
		return await fn();
	} finally {
		await sync().catch(() => {});
	}
}

const OPS = {
	sync,
	get,
	put: ({ tags, etag }) =>
		thenSync(async () => {
			const r = await send("PUT", "tags", { tags }, { "If-Match": etag ?? "" });
			return r.headers.get("ETag");
		}),
	addMemory: ({ file, body }) =>
		thenSync(async () => {
			const r = await send(
				"POST",
				`tags/${encodeURIComponent(file)}/memory`,
				body,
			);
			return r.json();
		}),
};

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
