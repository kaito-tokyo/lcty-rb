// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// meta_db.worker.js: the browser's copy of every conversation's meta, off the main thread (LCTYSP-010). A classic
// worker with no imports, started by js/api/meta-db.js as new Worker("/meta_db.worker.js"). It is the only code that
// opens the database, so the schema is defined here alone. It is not a /c/ file: a conversation file opened on its own
// does not need it (LCTYSP-005).
//
//   database "lcty"
//     store "meta" (key: id): {id, title, created_at, updated_at_hint, setup_tags, tags_hint, messages_hint},
//       from
//       GET /v1/meta-all.json
//       (built by the server from each conversation file's "<!" meta lines, LCTYSP-003)
//     store "sync": "stale" → a token, present while the copy is out of date
//
// The copy is never refetched while it is up to date. "invalidate" (a change of conversations was sent to the server)
// writes a new token. "sync" fetches /v1/meta-all.json, replaces the whole "meta" store in one transaction (so
// conversations deleted on the server disappear from it too) and removes the token only if it is still the one read
// before fetching: an invalidation made meanwhile, in this tab or another, is not lost. A new database starts out stale.
//
// Every message is answered at once with { id, accepted }; an accepted one is answered again when it has finished:
//
//   { id, op: "invalidate" }   → { id, accepted: true }, then { id, result: undefined }
//   { id, op: "sync" }         → { id, accepted }, then { id, result: [meta, …] } (the list now stored)
//   { id, op: "syncIfStale" }  → { id, accepted }, then { id, result: [meta, …], or null when the copy was up to date
//                                (not invalidated and not empty) }
//   { id, op: "read" }         → { id, accepted: true }, then { id, result: { items: [meta, …], stale } } (items newest
//                                first by updated_at_hint, which is only a hint; stale: the copy is out of date)
//   on failure                 → { id, error: message } (an unknown op: { id, accepted: false, error })
//
// There is no queue. A sync is a job, and while one runs another is refused (accepted: false): two syncs running
// together could let an older response overwrite a newer one. "invalidate" and "read" are short and always accepted;
// an invalidation must never be lost, and one made while a sync runs is handled by the token.

const DB_NAME = "lcty";
const DB_VERSION = 4; // raised when what is stored changes: an upgrade marks the copy stale, so it is refetched
const META = "meta";
const SYNC = "sync";
const STALE = "stale";

let dbPromise = null;

function open() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(META))
				db.createObjectStore(META, { keyPath: "id" });
			if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC);
			req.transaction.objectStore(SYNC).put(newToken(), STALE); // a new or upgraded database starts out stale
		};
		req.onsuccess = () => {
			const db = req.result;
			// another connection wants to upgrade or delete the database: let it, and open it again next time
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	});
}

function deleteDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.deleteDatabase(DB_NAME);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

// The database is only a copy: when it cannot be opened (a newer version left by other code, a broken store), it is
// deleted and created again, and the new one starts out stale
function openDb() {
	dbPromise ??= open()
		.catch((e) => {
			console.warn("the meta database could not be opened; recreating it", e);
			return deleteDb().then(open);
		})
		.catch((e) => {
			dbPromise = null; // try again next time
			throw e;
		});
	return dbPromise;
}

function newToken() {
	return `${Date.now()}-${Math.random()}`;
}

function done(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function committed(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

async function staleToken() {
	const db = await openDb();
	return done(db.transaction(SYNC).objectStore(SYNC).get(STALE));
}

async function invalidate() {
	const db = await openDb();
	const tx = db.transaction(SYNC, "readwrite");
	tx.objectStore(SYNC).put(newToken(), STALE);
	await committed(tx);
}

async function sync() {
	const token = await staleToken();
	const r = await fetch("/v1/meta-all.json");
	if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
	const all = await r.json();
	const db = await openDb();
	const tx = db.transaction([META, SYNC], "readwrite");
	const meta = tx.objectStore(META);
	meta.clear();
	for (const m of all) meta.put(m);
	const s = tx.objectStore(SYNC);
	s.get(STALE).onsuccess = (e) => {
		if (e.target.result === token) s.delete(STALE); // up to date, unless invalidated meanwhile
	};
	await committed(tx);
	return all;
}

// Stale also when the store is empty: a copy that lost its records (cleared by hand, a broken store) without being
// invalidated would otherwise stay empty until the next change. A server with no conversations is refetched each time,
// which is cheap.
async function syncIfStale() {
	const db = await openDb();
	const tx = db.transaction([META, SYNC]);
	const [token, count] = await Promise.all([
		done(tx.objectStore(SYNC).get(STALE)),
		done(tx.objectStore(META).count()),
	]);
	return token === undefined && count > 0 ? null : sync();
}

// Newest first by updated_at_hint, then by id (it starts with the creation time), so the order is the same wherever
// the list is sorted: the server, this worker, the snapshot and the sidebar (LCTYSP-010)
function newestFirst(a, b) {
	if (a.updated_at_hint !== b.updated_at_hint)
		return a.updated_at_hint < b.updated_at_hint ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

async function read() {
	const db = await openDb();
	const tx = db.transaction([META, SYNC]);
	const [all, token] = await Promise.all([
		done(tx.objectStore(META).getAll()),
		done(tx.objectStore(SYNC).get(STALE)),
	]);
	const items = all.sort(newestFirst);
	return { items, stale: token !== undefined };
}

const JOBS = { sync, syncIfStale }; // at most one runs at a time; others are refused
const ALWAYS = { invalidate, read }; // always accepted

let running = false;

self.onmessage = ({ data }) => {
	const { id, op } = data;
	const job = Object.hasOwn(JOBS, op);
	const fn = job ? JOBS[op] : Object.hasOwn(ALWAYS, op) ? ALWAYS[op] : null;
	if (!fn) {
		self.postMessage({ id, accepted: false, error: `unknown op: ${op}` });
		return;
	}
	if (job && running) {
		self.postMessage({ id, accepted: false });
		return;
	}
	self.postMessage({ id, accepted: true });
	if (job) running = true;
	fn()
		.then(
			(result) => self.postMessage({ id, result }),
			(e) => self.postMessage({ id, error: String(e?.message || e) }),
		)
		.finally(() => {
			if (job) running = false;
		});
};
