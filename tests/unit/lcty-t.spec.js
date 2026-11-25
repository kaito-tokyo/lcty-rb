// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1021: the scenarios of docs/specs/LCTYSP-1021_lcty-t.feature, written by hand. Each test has the title of its
// Scenario and one test.step per line of it, so the two read side by side.
//
// The worker and js/api/lcty-t.js run in a real browser on the test server's origin, on the empty unit page; every test
// gets a new browser context, so IndexedDB starts empty. The worker sends no request. Where a scenario uses /v1/rpc,
// the page's WebSocket is answered by context.routeWebSocket (never connected to the server), which answers
// "initialize" and the methods the scenario names and records every call, so the server's data does not matter.

import { expect, test } from "@playwright/test";
import { openUnitPage } from "./unit-page.js";

const WORKER_URL = "/lcty.v1/lcty.v1.t.worker.cjs";

/** A tag file as t.list lists it (LCTYSP-0009). */
const tag = (file) => ({ file, name: file, ops: [], prompt: "", memory: [] });

const nfd = (s) => s.normalize("NFD");

// ---- Background ----

async function background(page, context) {
	await test.step("Given a page on the server's origin", () =>
		openUnitPage(page, context, { lctyT: false }));
}

// ---- The database, from the page ----

/** The database "lcty_t" as it is: {exists, version, stores, and of the stores it has: keyPath (of t_full), tags (the
 * rows of t_full in key order), etag (of the record "set" of t_set), hasMany (the rows of t_has_many_c in key order),
 * sync ({t_full, t_has_many_c}: the rows of sync, or null)}. Never creates it. */
function readDb(page) {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_t");
				req.onupgradeneeded = () => req.transaction.abort();
				req.onerror = () =>
					req.error?.name === "AbortError"
						? resolve({ exists: false })
						: reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					const stores = [...db.objectStoreNames].sort();
					const result = { exists: true, version: db.version, stores };
					const known = ["t_full", "t_set", "t_has_many_c", "sync"].filter(
						(s) => stores.includes(s),
					);
					if (known.length === 0) {
						db.close();
						resolve(result);
						return;
					}
					const tx = db.transaction(known);
					const reqs = {};
					if (known.includes("t_full")) {
						result.keyPath = tx.objectStore("t_full").keyPath;
						reqs.tags = tx.objectStore("t_full").getAll();
					}
					if (known.includes("t_set"))
						reqs.set = tx.objectStore("t_set").get("set");
					if (known.includes("t_has_many_c"))
						reqs.hasMany = tx.objectStore("t_has_many_c").getAll();
					if (known.includes("sync")) {
						reqs.syncFull = tx.objectStore("sync").get("t_full");
						reqs.syncHasMany = tx.objectStore("sync").get("t_has_many_c");
					}
					tx.oncomplete = () => {
						db.close();
						if (reqs.tags) result.tags = reqs.tags.result;
						if (reqs.set) result.etag = reqs.set.result?.etag ?? null;
						if (reqs.hasMany) result.hasMany = reqs.hasMany.result;
						if (reqs.syncFull)
							result.sync = {
								t_full: reqs.syncFull.result ?? null,
								t_has_many_c: reqs.syncHasMany.result ?? null,
							};
						resolve(result);
					};
					tx.onerror = () => {
						db.close();
						reject(tx.error);
					};
				};
			}),
	);
}

/**
 * "lcty_t" at version 3, as the worker leaves it, with its four stores (created when it does not exist), into which
 * are written the copy of the tags {tags, etag, version} when set is given and the tags of conversations {rows,
 * version} when hasMany is, each with its row of "sync"; the rows are put in the given order.
 */
function seed(page, { set = null, hasMany = null }) {
	return page.evaluate(
		({ set, hasMany }) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_t", 3);
				req.onupgradeneeded = () => {
					const db = req.result;
					db.createObjectStore("t_full", { keyPath: "file" });
					db.createObjectStore("t_set");
					db.createObjectStore("t_has_many_c", { keyPath: ["tag", "cid"] });
					db.createObjectStore("sync", { keyPath: "store" });
				};
				req.onsuccess = () => {
					const db = req.result;
					const tx = db.transaction(
						["t_full", "t_set", "t_has_many_c", "sync"],
						"readwrite",
					);
					const syncOf = (store, version) => {
						const [boot, seq] = version.split(".");
						tx.objectStore("sync").put({ store, boot, seq: Number(seq) });
					};
					if (set) {
						for (const t of set.tags) tx.objectStore("t_full").put(t);
						tx.objectStore("t_set").put({ etag: set.etag }, "set");
						syncOf("t_full", set.version);
					}
					if (hasMany) {
						for (const r of hasMany.rows) tx.objectStore("t_has_many_c").put(r);
						syncOf("t_has_many_c", hasMany.version);
					}
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => {
						db.close();
						reject(tx.error);
					};
				};
				req.onerror = () => reject(req.error);
			}),
		{ set, hasMany },
	);
}

/** The rows {tag, cid} of ["tag", "cid"] pairs. */
const rowsOf = (pairs) => pairs.map(([tag, cid]) => ({ tag, cid }));

/** The row of "sync" that a version "<boot>.<seq>" of store is. */
function syncRow(store, version) {
	const [boot, seq] = version.split(".");
	return { store, boot, seq: Number(seq) };
}

/** "lcty_t" at version 1 as the worker before rows left it: t_full with out-of-line keys and one record "set". */
function seedVersion1(page, set) {
	return page.evaluate(
		(set) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_t", 1);
				req.onupgradeneeded = () =>
					req.result.createObjectStore("t_full").put(set, "set");
				req.onsuccess = () => {
					req.result.close();
					resolve();
				};
				req.onerror = () => reject(req.error);
			}),
		set,
	);
}

// ---- /v1/rpc, answered by the test ----

/**
 * Answer the page's WebSocket to /v1/rpc: "initialize" with an actorId, a method of answers with answers[method](params)
 * ({result} or {error}), any other method with the error -32601. Resolves to {calls: [{method, params}], connections}.
 */
async function fakeRpc(context, answers) {
	const rpc = { calls: [], connections: 0 };
	await context.routeWebSocket("**/v1/rpc", (ws) => {
		rpc.connections += 1;
		ws.onMessage((text) => {
			const m = JSON.parse(text);
			if (typeof m.method !== "string" || !("id" in m)) return;
			rpc.calls.push({ method: m.method, params: m.params });
			const answer =
				m.method === "initialize"
					? { result: { actorId: "a1" } }
					: Object.hasOwn(answers, m.method)
						? answers[m.method](m.params)
						: { error: { code: -32601, message: "method not found" } };
			ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...answer }));
		});
	});
	return rpc;
}

/** The answer of t.list: the tags of files at version with etag. */
const tList = (files, version, etag) => () => ({
	result: { version, etag, items: files.map(tag) },
});

/** The answer of t.c.list: the rows of pairs at version. */
const tcList = (pairs, version) => () => ({
	result: { version, items: rowsOf(pairs) },
});

// ---- The worker ----

/**
 * Start the worker, post it message and resolve to the first message it answers, as {id, message (the rest, a posted
 * Error kept as its message), hasResult}, or to its error event.
 */
function post(page, message) {
	return page.evaluate(
		({ url, message }) =>
			new Promise((resolve) => {
				const worker = new Worker(url);
				window.lctyWorker = worker;
				worker.onmessage = ({ data: { id, ...message } }) =>
					resolve({
						id,
						message:
							message.error instanceof Error
								? { ...message, error: message.error.message }
								: message,
						hasResult: "result" in message,
					});
				worker.onerror = (e) => {
					e.preventDefault();
					resolve({ errorEvent: e.message || "(no message)" });
				};
				worker.postMessage(message);
			}),
		{ url: WORKER_URL, message },
	);
}

test.afterEach(async ({ page }) => {
	await page.evaluate(() => window.lctyWorker?.terminate()).catch(() => {});
});

// ---- Steps shared by the scenarios ----

const list = (files) => JSON.stringify(files).replaceAll(",", ", ");

async function givenNoDatabase(page) {
	await test.step('Given there is no database "lcty_t"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
}

async function givenTFullHolds(page, files, etag, version) {
	await test.step(`Given "t_full" holds the tags ${list(files)} and the ETag "${etag}" at "${version}"`, () =>
		seed(page, { set: { tags: files.map(tag), etag, version } }));
}

async function givenHasManyHolds(page, pairs, version, word = "Given") {
	await test.step(`${word} "t_has_many_c" holds ${list(pairs)} at "${version}"`, () =>
		seed(page, { hasMany: { rows: rowsOf(pairs), version } }));
}

async function thenHasManyHolds(page, pairs, word = "And") {
	await test.step(`${word} "t_has_many_c" holds exactly ${list(pairs)}`, async () => {
		expect((await readDb(page)).hasMany).toEqual(rowsOf(pairs));
	});
}

async function thenSyncAt(page, store, version) {
	await test.step(`And "sync" holds "${store}" at "${version}"`, async () => {
		expect((await readDb(page)).sync[store]).toEqual(syncRow(store, version));
	});
}

async function thenAnswersApplied(answer, applied) {
	await test.step(`Then it answers {"applied": ${list(applied)}}`, () => {
		expect(answer.message).toEqual({ result: { applied } });
	});
}

/** The message of a replace of store with the rows of pairs (or rows as they are, when not an array) at version. */
const replaceOf = (store, version, pairs) => ({
	id: 1,
	op: "replace",
	payload: {
		store,
		version,
		rows: Array.isArray(pairs) ? rowsOf(pairs) : pairs,
	},
});

/** The message of a replace of t_full with rows (tags) at version with etag. */
const replaceTagsOf = (version, rows, etag) => ({
	id: 1,
	op: "replace",
	payload: { store: "t_full", version, rows, etag },
});

/** A record of t_has_many_c: op of ["tag", "cid"]. */
const hasC = (op, [tag, cid]) => ({
	store: "t_has_many_c",
	op,
	row: { tag, cid },
});

/** The records of t_full and t_set: a put of the tag of file, a delete of file, a put of the ETag. */
const tagPut = (file) => ({ store: "t_full", op: "put", row: tag(file) });
const tagDelete = (file) => ({ store: "t_full", op: "delete", row: { file } });
const setPut = (etag) => ({ store: "t_set", op: "put", row: { etag } });

/** The params of a t.batch.updated at version with records. */
const batchOf = (version, records) => ({ version, records });

/** The message of an apply at version of records. */
const applyOf = (version, records) => ({
	id: 1,
	op: "apply",
	payload: batchOf(version, records),
});

async function whenPosted(page, json, message) {
	let answer;
	await test.step(`When the worker is posted ${json}`, async () => {
		answer = await post(page, message);
	});
	expect(answer.id).toBe(message.id);
	return answer;
}

async function thenAnswersTags(answer, files, etag, stale) {
	const e = etag === null ? "null" : `"${etag}"`;
	await test.step(`Then it answers the tags ${list(files)}, the ETag ${e} and stale ${stale}`, () => {
		expect(answer.message).toEqual({
			result: { tags: files.map(tag), etag, stale },
		});
	});
}

async function thenAnswersError(answer, error) {
	await test.step(`Then it answers the error "${error}"`, () => {
		expect(answer.message).toEqual({ errorType: "error", error });
	});
}

async function thenTFullHolds(page, files, etag, composed = "") {
	const e = etag === null ? "null" : `"${etag}"`;
	await test.step(`And "t_full" holds the tags ${list(files)}${composed} and the ETag ${e}`, async () => {
		const db = await readDb(page);
		expect(db.tags.map((t) => t.file)).toEqual(files);
		expect(db.etag).toBe(etag);
	});
}

async function thenVersion3(page) {
	await test.step('And the database "lcty_t" is at version 3 with only the stores "sync", "t_full", "t_has_many_c" and "t_set"', async () => {
		const db = await readDb(page);
		expect(db.version).toBe(3);
		expect(db.stores).toEqual(["sync", "t_full", "t_has_many_c", "t_set"]);
	});
}

// ---- Scenarios: the worker, t_full ----

test("A replace stores the tags with NFC file names and the ETag", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const answer = await whenPosted(
		page,
		'a replace of "t_full" with the tag "café.html", its name decomposed, at "b1.5" with the ETag "e1"',
		replaceTagsOf("b1.5", [tag(nfd("café.html"))], "e1"),
	);
	await thenAnswersApplied(answer, true);
	await thenVersion3(page);
	await test.step('And "t_full" has one row per tag, keyed by its file name', async () => {
		const db = await readDb(page);
		expect(db.keyPath).toBe("file");
		// the row is the tag as t.list gave it, with only the file name composed
		expect(db.tags).toEqual([{ ...tag(nfd("café.html")), file: "café.html" }]);
	});
	await thenTFullHolds(page, ["café.html"], "e1", " composed");
	await thenSyncAt(page, "t_full", "b1.5");
});

test("A replace composes the name of an invalid tag, which comes from its file name", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const invalid = {
		...tag(nfd("café.html")),
		name: nfd("café"),
		invalid: true,
	};
	const other = { ...tag(nfd("cafés.html")), name: nfd("Cafés") };
	await whenPosted(
		page,
		'a replace of "t_full" with the invalid tag "café.html" named "café", both decomposed, and the tag "cafe" U+0301 "s.html" with the name decomposed',
		replaceTagsOf("b1.5", [invalid, other], "e1"),
	);
	let db;
	await test.step('Then "t_full" holds the invalid tag "café.html" named "café", both composed, with invalid true', async () => {
		db = await readDb(page);
		expect(db.tags[0]).toEqual({
			...invalid,
			file: "café.html",
			name: "café",
		});
	});
	await test.step("And the other tag keeps its decomposed name", () => {
		expect(db.tags[1]).toEqual({ ...other, file: "cafés.html" });
	});
});

test("A database at version 1 is dropped, and the copy is stale", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the database "lcty_t" is at version 1 with the record "set" of the tags ["a.html"] in "t_full"', () =>
		seedVersion1(page, { tags: [tag("a.html")], etag: "e1" }));
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, [], null, true);
	await thenVersion3(page);
});

test("Getting answers the tags in their order, those without one last", async ({
	page,
	context,
}) => {
	await background(page, context);
	const ordered = (file, order) => ({ ...tag(file), order });
	await test.step('Given "t_full" holds the tags ["a.html", "b.html", "c.html", "d.html"] with the orders [20, null, 10, 20] and the ETag "e1" at "b1.5"', () =>
		seed(page, {
			set: {
				tags: [
					ordered("a.html", 20),
					ordered("b.html", null),
					ordered("c.html", 10),
					ordered("d.html", 20),
				],
				etag: "e1",
				version: "b1.5",
			},
		}));
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await test.step('Then it answers the tags ["c.html", "a.html", "d.html", "b.html"], the ETag "e1" and stale false', () => {
		expect(answer.message).toEqual({
			result: {
				tags: [
					ordered("c.html", 10),
					ordered("a.html", 20),
					ordered("d.html", 20),
					ordered("b.html", null),
				],
				etag: "e1",
				stale: false,
			},
		});
	});
});

test("Getting the tags of a copy never filled is stale", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, [], null, true);
});

test("An empty set is a copy too", async ({ page, context }) => {
	await background(page, context);
	await givenNoDatabase(page);
	await whenPosted(
		page,
		'a replace of "t_full" with the tags [] at "b1.5" with the ETag "e1"',
		replaceTagsOf("b1.5", [], "e1"),
	);
	let answer;
	await test.step('And then a new worker is posted {"id": 2, "op": "get"}', async () => {
		await page.evaluate(() => window.lctyWorker?.terminate());
		answer = await post(page, { id: 2, op: "get" });
	});
	await thenAnswersTags(answer, [], "e1", false);
});

test("A replace replaces the set as a whole", async ({ page, context }) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html", "b.html"], "e1", "b1.5");
	const answer = await whenPosted(
		page,
		'a replace of "t_full" with the tags ["c.html"] at "b1.6" with the ETag "e2"',
		replaceTagsOf("b1.6", [tag("c.html")], "e2"),
	);
	await thenAnswersApplied(answer, true);
	await thenTFullHolds(page, ["c.html"], "e2");
	await thenSyncAt(page, "t_full", "b1.6");
});

for (const { held, read, applied, kept, etag, version } of [
	{
		held: "b1.5",
		read: "b1.5",
		applied: true,
		kept: ["b.html"],
		etag: "e2",
		version: "b1.5",
	},
	{
		held: "b1.7",
		read: "b1.5",
		applied: false,
		kept: ["a.html"],
		etag: "e1",
		version: "b1.7",
	},
	{
		held: "b1.9",
		read: "b2.1",
		applied: true,
		kept: ["b.html"],
		etag: "e2",
		version: "b2.1",
	},
]) {
	test(`A replace of the tags is written unless the copy is newer in the same boot (${held})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenTFullHolds(page, ["a.html"], "e1", held);
		const answer = await whenPosted(
			page,
			`a replace of "t_full" with the tags ["b.html"] at "${read}" with the ETag "e2"`,
			replaceTagsOf(read, [tag("b.html")], "e2"),
		);
		await thenAnswersApplied(answer, applied);
		await thenTFullHolds(page, kept, etag);
		await thenSyncAt(page, "t_full", version);
	});
}

test("A replace of the tags leaves the tags of conversations as they were", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	const answer = await whenPosted(
		page,
		'a replace of "t_full" with the tags ["a.html"] at "b1.6" with the ETag "e1"',
		replaceTagsOf("b1.6", [tag("a.html")], "e1"),
	);
	await thenAnswersApplied(answer, true);
	await thenHasManyHolds(page, [["go", "c1"]]);
	await thenSyncAt(page, "t_has_many_c", "b1.5");
});

test("An unknown operation is an error", async ({ page, context }) => {
	await background(page, context);
	const answer = await whenPosted(page, '{"id": 1, "op": "nope"}', {
		id: 1,
		op: "nope",
	});
	await test.step('Then it answers the error type "unknownOperation"', () => {
		expect(answer.message).toEqual({ errorType: "unknownOperation" });
	});
});

test("The worker closes its connection after the operation", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, ["a.html"], "e1", false);
	await test.step('And the database "lcty_t" can be opened at version 3 without being blocked, while the worker is still alive', async () => {
		const result = await page.evaluate(
			() =>
				new Promise((resolve) => {
					let blocked = false;
					const req = indexedDB.open("lcty_t", 3);
					req.onblocked = () => {
						blocked = true;
					};
					req.onsuccess = () => {
						req.result.close();
						resolve({ opened: true, blocked });
					};
					req.onerror = () => resolve({ opened: false, blocked });
					setTimeout(() => resolve({ opened: false, blocked }), 2000);
				}),
		);
		expect(result).toEqual({ opened: true, blocked: false });
	});
});

test("A SharedWorker answers on the port the message came from", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	let answers;
	await test.step('When two ports of new SharedWorker("/lcty.v1/lcty.v1.t.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other', async () => {
		answers = await page.evaluate(async (url) => {
			const ask = (message) =>
				new Promise((resolve) => {
					const { port } = new SharedWorker(url);
					port.onmessage = ({ data }) => resolve(data);
					port.postMessage(message);
				});
			const first = await ask({ id: 1, op: "get" });
			const second = await ask({ id: 2, op: "nope" });
			return { first, second };
		}, WORKER_URL);
	});
	await test.step('Then the first port is answered with the id 1, the tags ["a.html"], the ETag "e1" and stale false', () => {
		expect(answers.first).toEqual({
			id: 1,
			result: { tags: [tag("a.html")], etag: "e1", stale: false },
		});
	});
	await test.step('And the second port is answered with the id 2 and the error type "unknownOperation"', () => {
		expect(answers.second).toEqual({ id: 2, errorType: "unknownOperation" });
	});
});

// ---- Scenarios: the worker, t_has_many_c ----

test('A replace fills "t_has_many_c" and stores the version', async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const answer = await whenPosted(
		page,
		'a replace of "t_has_many_c" with the rows [["ruby", "c2"], ["go", "c1"]] at "b1.5"',
		replaceOf("t_has_many_c", "b1.5", [
			["ruby", "c2"],
			["go", "c1"],
		]),
	);
	await thenAnswersApplied(answer, true);
	await thenHasManyHolds(page, [
		["go", "c1"],
		["ruby", "c2"],
	]);
	await thenSyncAt(page, "t_has_many_c", "b1.5");
});

for (const { held, read, applied, kept, version } of [
	{
		held: "b1.5",
		read: "b1.5",
		applied: true,
		kept: [["ruby", "c2"]],
		version: "b1.5",
	},
	{
		held: "b1.7",
		read: "b1.5",
		applied: false,
		kept: [["go", "c1"]],
		version: "b1.7",
	},
	{
		held: "b1.9",
		read: "b2.1",
		applied: true,
		kept: [["ruby", "c2"]],
		version: "b2.1",
	},
]) {
	test(`A replace is written unless the copy is newer in the same boot (${held})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenHasManyHolds(page, [["go", "c1"]], held);
		const answer = await whenPosted(
			page,
			`a replace of "t_has_many_c" with the rows [["ruby", "c2"]] at "${read}"`,
			replaceOf("t_has_many_c", read, [["ruby", "c2"]]),
		);
		await thenAnswersApplied(answer, applied);
		await thenHasManyHolds(page, kept);
		await thenSyncAt(page, "t_has_many_c", version);
	});
}

test("A replace leaves the tags as they were", async ({ page, context }) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	const answer = await whenPosted(
		page,
		'a replace of "t_has_many_c" with the rows [["go", "c1"]] at "b1.5"',
		replaceOf("t_has_many_c", "b1.5", [["go", "c1"]]),
	);
	await thenAnswersApplied(answer, true);
	await thenTFullHolds(page, ["a.html"], "e1");
});

test("A change is written onto an older copy of the same boot", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(
		page,
		[
			["go", "c1"],
			["go", "c2"],
		],
		"b1.5",
	);
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a put of ["ruby", "c1"] and a delete of ["go", "c2"]',
		applyOf("b1.6", [
			hasC("put", ["ruby", "c1"]),
			hasC("delete", ["go", "c2"]),
		]),
	);
	await thenAnswersApplied(answer, ["t_has_many_c"]);
	await thenHasManyHolds(page, [
		["go", "c1"],
		["ruby", "c1"],
	]);
	await thenSyncAt(page, "t_has_many_c", "b1.6");
});

for (const { held, change } of [
	{ held: "b1.6", change: "b1.6" },
	{ held: "b1.6", change: "b1.5" },
	{ held: "b1.6", change: "b2.7" },
]) {
	test(`A change is left when the copy is not older in the same boot (${change})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenHasManyHolds(page, [["go", "c1"]], held);
		const answer = await whenPosted(
			page,
			`an apply at "${change}" of a put of ["ruby", "c1"]`,
			applyOf(change, [hasC("put", ["ruby", "c1"])]),
		);
		await thenAnswersApplied(answer, []);
		await thenHasManyHolds(page, [["go", "c1"]]);
		await thenSyncAt(page, "t_has_many_c", held);
	});
}

test("A change onto a copy that was never filled is left", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a put of ["ruby", "c1"]',
		applyOf("b1.6", [hasC("put", ["ruby", "c1"])]),
	);
	await thenAnswersApplied(answer, []);
	await thenHasManyHolds(page, []);
});

// ---- Scenarios: the worker, changes of t_full ----

test("A change of the tags is written onto an older copy of the same boot", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html", "b.html"], "e1", "b1.5");
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a put of the tag "c.html", a delete of "a.html" and the ETag "e2"',
		applyOf("b1.6", [tagPut("c.html"), tagDelete("a.html"), setPut("e2")]),
	);
	await thenAnswersApplied(answer, ["t_full"]);
	await thenTFullHolds(page, ["b.html", "c.html"], "e2");
	await thenSyncAt(page, "t_full", "b1.6");
});

test("A change of the tags composes the file names", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["café.html"], "e1", "b1.5");
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a delete of "café.html" and a put of the tag "cafés.html", both decomposed',
		applyOf("b1.6", [tagDelete(nfd("café.html")), tagPut(nfd("cafés.html"))]),
	);
	await thenAnswersApplied(answer, ["t_full"]);
	await thenTFullHolds(page, ["cafés.html"], "e1", " composed");
});

for (const { held, change } of [
	{ held: "b1.6", change: "b1.6" },
	{ held: "b1.6", change: "b1.5" },
	{ held: "b1.6", change: "b2.7" },
]) {
	test(`A change of the tags is left when the copy is not older in the same boot (${change})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenTFullHolds(page, ["a.html"], "e1", held);
		const answer = await whenPosted(
			page,
			`an apply at "${change}" of a put of the tag "b.html" and the ETag "e2"`,
			applyOf(change, [tagPut("b.html"), setPut("e2")]),
		);
		await thenAnswersApplied(answer, []);
		await thenTFullHolds(page, ["a.html"], "e1");
		await thenSyncAt(page, "t_full", held);
	});
}

test("A change of the tags onto a copy that was never filled is left", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a put of the tag "a.html" and the ETag "e2"',
		applyOf("b1.6", [tagPut("a.html"), setPut("e2")]),
	);
	await thenAnswersApplied(answer, []);
	await thenTFullHolds(page, [], null);
});

for (const { held, applied, kept, etag, version } of [
	{
		held: "b1.5",
		applied: ["t_full", "t_has_many_c"],
		kept: ["a.html", "b.html"],
		etag: "e2",
		version: "b1.6",
	},
	{
		held: "b1.7",
		applied: ["t_has_many_c"],
		kept: ["a.html"],
		etag: "e1",
		version: "b1.7",
	},
]) {
	test(`A batch of both copies is applied to each under its own version (${held})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenTFullHolds(page, ["a.html"], "e1", held);
		await givenHasManyHolds(page, [["go", "c1"]], "b1.5", "And");
		const answer = await whenPosted(
			page,
			'an apply at "b1.6" of a put of the tag "b.html", the ETag "e2" and a put of ["ruby", "c1"]',
			applyOf("b1.6", [
				tagPut("b.html"),
				setPut("e2"),
				hasC("put", ["ruby", "c1"]),
			]),
		);
		await thenAnswersApplied(answer, applied);
		await thenTFullHolds(page, kept, etag);
		await thenSyncAt(page, "t_full", version);
		await thenHasManyHolds(page, [
			["go", "c1"],
			["ruby", "c1"],
		]);
		await thenSyncAt(page, "t_has_many_c", "b1.6");
	});
}

test("A change of other stores only does not open the database", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a c_meta put only',
		applyOf("b1.6", [{ store: "c_meta", op: "put", row: { cid: "c1" } }]),
	);
	await thenAnswersApplied(answer, []);
	await test.step('And there is still no database "lcty_t"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
});

for (const { payload, message, sent } of [
	{
		payload: 'a replace of "c_meta" at "b1.5"',
		message: "no such store: c_meta",
		sent: replaceOf("c_meta", "b1.5", []),
	},
	{
		payload: 'a replace of "t_has_many_c" at "5"',
		message: "not a version: 5",
		sent: replaceOf("t_has_many_c", "5", []),
	},
	{
		payload: 'a replace of "t_has_many_c" at "b1.5" with the rows null',
		message: "rows must be an array",
		sent: replaceOf("t_has_many_c", "b1.5", null),
	},
	{
		payload: 'an apply at "b1" of a put of ["ruby", "c1"]',
		message: "not a version: b1",
		sent: applyOf("b1", [hasC("put", ["ruby", "c1"])]),
	},
	{
		payload: 'an apply at "b1.6" with the records null',
		message: "records must be an array",
		sent: applyOf("b1.6", null),
	},
]) {
	test(`A bad payload is an error (${payload})`, async ({ page, context }) => {
		await background(page, context);
		const answer = await whenPosted(page, payload, sent);
		await thenAnswersError(answer, message);
	});
}

async function thenAnswersRows(answer, pairs, stale) {
	await test.step(`Then it answers the rows ${list(pairs)} and stale ${stale}`, () => {
		expect(answer.message).toEqual({
			result: { rows: rowsOf(pairs), stale },
		});
	});
}

test("Getting the tags of conversations answers the rows by tag, then conversation", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(
		page,
		[
			["ruby", "c1"],
			["go", "c2"],
			["go", "c1"],
		],
		"b1.5",
	);
	const answer = await whenPosted(page, '{"id": 1, "op": "get_has_many"}', {
		id: 1,
		op: "get_has_many",
	});
	await thenAnswersRows(
		answer,
		[
			["go", "c1"],
			["go", "c2"],
			["ruby", "c1"],
		],
		false,
	);
});

test("Getting the tags of conversations before any replace is stale", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const answer = await whenPosted(page, '{"id": 1, "op": "get_has_many"}', {
		id: 1,
		op: "get_has_many",
	});
	await thenAnswersRows(answer, [], true);
});

// ---- Scenarios: js/api/lcty-t.js ----

test("The calls of a tab run one at a time, in order", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	let result;
	await test.step('When applyTagBatch is called with a put of the tag "b.html" at "b1.6" and then getTags() without waiting', async () => {
		result = await page.evaluate(
			async (batch) => {
				const t = await import("/js/api/lcty-t.js");
				t.applyTagBatch(batch);
				return t.getTags();
			},
			batchOf("b1.6", [tagPut("b.html")]),
		);
	});
	await test.step('Then getTags resolves to the tags ["a.html", "b.html"] and the ETag "e1"', () => {
		expect(result).toEqual({
			tags: [tag("a.html"), tag("b.html")],
			etag: "e1",
		});
	});
});

test("A call whose worker answers an error rejects with the error", async ({
	page,
	context,
}) => {
	await background(page, context);
	let error;
	await test.step('When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags [] at "5" with the ETag "e1"', async () => {
		error = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			try {
				await t.readTagsFrom({
					call: async () => ({ version: "5", etag: "e1", items: [] }),
				});
				return null;
			} catch (e) {
				return { isError: e instanceof Error, message: e.message };
			}
		});
	});
	await test.step('Then it rejects with the Error "not a version: 5"', () => {
		expect(error).toEqual({ isError: true, message: "not a version: 5" });
	});
});

async function thenMethodsCalled(rpc, line, methods) {
	await test.step(line, () => {
		expect(rpc.calls.map((c) => c.method)).toEqual(methods);
	});
}

async function thenCalledWith(rpc, method, json, params) {
	await test.step(`And "${method}" was called with ${json}`, () => {
		expect(rpc.calls.find((c) => c.method === method)?.params).toEqual(params);
	});
}

/** Call getTags() in the page and resolve to what it resolved to. */
async function whenGetTags(page) {
	let result;
	await test.step("When getTags() is called", async () => {
		result = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			return t.getTags();
		});
	});
	return result;
}

test("Getting the tags of a copy never filled reads the lists over the tab's connection", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	let rpc;
	await test.step('And /v1/rpc answers "t.list" with the tags ["a.html"] at "b1.5" with the ETag "e1", and "t.c.list" with the rows [["go", "c1"]] at "b1.5"', async () => {
		rpc = await fakeRpc(context, {
			"t.list": tList(["a.html"], "b1.5", "e1"),
			"t.c.list": tcList([["go", "c1"]], "b1.5"),
		});
	});
	const result = await whenGetTags(page);
	await test.step('Then it resolves to the tags ["a.html"] and the ETag "e1"', () => {
		expect(result).toEqual({ tags: [tag("a.html")], etag: "e1" });
	});
	await thenMethodsCalled(
		rpc,
		'And the methods called over /v1/rpc are "initialize", "t.list" and "t.c.list"',
		["initialize", "t.list", "t.c.list"],
	);
	await thenHasManyHolds(page, [["go", "c1"]]);
});

test("Getting the tags of a filled copy opens no connection", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	let rpc;
	await test.step('And /v1/rpc answers "t.list" with the tags ["b.html"] at "b1.6" with the ETag "e2", and "t.c.list" with the rows [] at "b1.6"', async () => {
		rpc = await fakeRpc(context, {
			"t.list": tList(["b.html"], "b1.6", "e2"),
			"t.c.list": tcList([], "b1.6"),
		});
	});
	const result = await whenGetTags(page);
	await test.step('Then it resolves to the tags ["a.html"] and the ETag "e1"', () => {
		expect(result).toEqual({ tags: [tag("a.html")], etag: "e1" });
	});
	await test.step("And no connection to /v1/rpc is opened", () => {
		expect(rpc.connections).toBe(0);
	});
});

test("putTags sends t.replace with the ETag and resolves to the new one", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	let rpc;
	await test.step('And /v1/rpc answers "t.replace" with the ETag "e2" at "b1.6"', async () => {
		rpc = await fakeRpc(context, {
			"t.replace": () => ({ result: { version: "b1.6", etag: "e2" } }),
		});
	});
	let result;
	await test.step('When putTags([{"file": "b.html"}], "e1") is called', async () => {
		result = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			return t.putTags([{ file: "b.html" }], "e1");
		});
	});
	await test.step('Then it resolves to "e2"', () => {
		expect(result).toBe("e2");
	});
	await thenMethodsCalled(
		rpc,
		'And the methods called over /v1/rpc are "initialize" and "t.replace"',
		["initialize", "t.replace"],
	);
	await thenCalledWith(
		rpc,
		"t.replace",
		'{"tags": [{"file": "b.html"}], "etag": "e1"}',
		{ tags: [{ file: "b.html" }], etag: "e1" },
	);
});

test("A putTags that fails reads the lists again and rejects with the error", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	let rpc;
	await test.step('And /v1/rpc answers "t.replace" with the error 8 "the tags have changed", "t.list" with the tags ["b.html"] at "b1.6" with the ETag "e2", and "t.c.list" with the rows [] at "b1.6"', async () => {
		rpc = await fakeRpc(context, {
			"t.replace": () => ({
				error: { code: 8, message: "the tags have changed" },
			}),
			"t.list": tList(["b.html"], "b1.6", "e2"),
			"t.c.list": tcList([], "b1.6"),
		});
	});
	let error;
	await test.step('When putTags([], "e1") is called', async () => {
		error = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			try {
				await t.putTags([], "e1");
				return null;
			} catch (e) {
				return {
					name: e.name,
					message: e.message,
					code: e.code,
					tagsChanged: t.TAGS_CHANGED,
				};
			}
		});
	});
	await test.step('Then it rejects with an RpcError "the tags have changed" whose code is TAGS_CHANGED, 8', () => {
		expect(error).toEqual({
			name: "RpcError",
			message: "the tags have changed",
			code: 8,
			tagsChanged: 8,
		});
	});
	await thenMethodsCalled(
		rpc,
		'And the methods called over /v1/rpc are "initialize", "t.replace", "t.list" and "t.c.list"',
		["initialize", "t.replace", "t.list", "t.c.list"],
	);
	await thenTFullHolds(page, ["b.html"], "e2");
});

test("addMemory sends t.memory.add and resolves to the item", async ({
	page,
	context,
}) => {
	await background(page, context);
	const item = { id: "m1", text: "t", at: "2026-11-15T00:00:00Z" };
	let rpc;
	await test.step('Given /v1/rpc answers "t.memory.add" with the item {"id": "m1", "text": "t", "at": "2026-11-15T00:00:00Z"} at "b1.6"', async () => {
		rpc = await fakeRpc(context, {
			"t.memory.add": () => ({ result: { version: "b1.6", item } }),
		});
	});
	let result;
	await test.step('When addMemory("a.html", {"text": "t", "source": {"cid": "c1"}}) is called', async () => {
		result = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			return t.addMemory("a.html", { text: "t", source: { cid: "c1" } });
		});
	});
	await test.step('Then it resolves to the item {"id": "m1", "text": "t", "at": "2026-11-15T00:00:00Z"}', () => {
		expect(result).toEqual(item);
	});
	await thenMethodsCalled(
		rpc,
		'And the methods called over /v1/rpc are "initialize" and "t.memory.add"',
		["initialize", "t.memory.add"],
	);
	await thenCalledWith(
		rpc,
		"t.memory.add",
		'{"file": "a.html", "text": "t", "source": {"cid": "c1"}}',
		{ file: "a.html", text: "t", source: { cid: "c1" } },
	);
});

async function whenReadTagsOfConversations(page) {
	let result;
	await test.step("When readTagsOfConversations() is called", async () => {
		result = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			const { byCid, stale } = await t.readTagsOfConversations();
			return {
				isMap: byCid instanceof Map,
				byCid: Object.fromEntries(byCid),
				stale,
			};
		});
	});
	return result;
}

/** Register a listener with onTagsChange that counts its calls in window.lctyChanges. */
async function givenListener(page) {
	await test.step("And a listener is registered with onTagsChange", () =>
		page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			window.lctyChanges = 0;
			t.onTagsChange(() => {
				window.lctyChanges += 1;
			});
		}));
}

const changes = (page) => page.evaluate(() => window.lctyChanges);

/**
 * Call readTagsFrom(rpc) with an rpc whose call(method) records the method and answers lists[method], after calling
 * applyTagBatch(batch) during the first call when batch is given; resolves to the methods called.
 */
function readFrom(page, lists, batch = null) {
	return page.evaluate(
		async ({ lists, batch }) => {
			const t = await import("/js/api/lcty-t.js");
			const calls = [];
			await t.readTagsFrom({
				call: async (method) => {
					calls.push(method);
					if (batch && calls.length === 1) t.applyTagBatch(batch);
					return lists[method];
				},
			});
			return calls;
		},
		{ lists, batch },
	);
}

/** The answers of t.list (the tags of files at version with etag) and t.c.list (the rows of pairs at version). */
const listsOf = (files, version, etag, pairs) => ({
	"t.list": { version, etag, items: files.map(tag) },
	"t.c.list": { version, items: rowsOf(pairs) },
});

test("The tags of conversations are read by conversation", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(
		page,
		[
			["go", "c1"],
			["go", "c2"],
			["ruby", "c1"],
		],
		"b1.5",
	);
	const result = await whenReadTagsOfConversations(page);
	await test.step('Then it resolves to byCid {"c1": ["go", "ruby"], "c2": ["go"]} and stale false', () => {
		expect(result).toEqual({
			isMap: true,
			byCid: { c1: ["go", "ruby"], c2: ["go"] },
			stale: false,
		});
	});
});

test("The tags of conversations of a copy never filled are stale", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const result = await whenReadTagsOfConversations(page);
	await test.step("Then it resolves to byCid {} and stale true", () => {
		expect(result).toEqual({ isMap: true, byCid: {}, stale: true });
	});
});

test("A read over rpc replaces the copies and calls the listeners", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5", "And");
	await givenListener(page);
	let calls;
	await test.step('When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags ["b.html"] at "b1.6" with the ETag "e2" and whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"', async () => {
		calls = await readFrom(
			page,
			listsOf(["b.html"], "b1.6", "e2", [["ruby", "c2"]]),
		);
	});
	await test.step('Then the rpc was called with "t.list" and then "t.c.list"', () => {
		expect(calls).toEqual(["t.list", "t.c.list"]);
	});
	await test.step("And the listener was called once", async () => {
		expect(await changes(page)).toBe(1);
	});
	await thenTFullHolds(page, ["b.html"], "e2");
	await thenSyncAt(page, "t_full", "b1.6");
	await thenHasManyHolds(page, [["ruby", "c2"]]);
	await thenSyncAt(page, "t_has_many_c", "b1.6");
});

test("A read over rpc of an older version calls no listener", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.7");
	await givenHasManyHolds(page, [["go", "c1"]], "b1.7", "And");
	await givenListener(page);
	await test.step('When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags ["b.html"] at "b1.6" with the ETag "e2" and whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"', () =>
		readFrom(page, listsOf(["b.html"], "b1.6", "e2", [["ruby", "c2"]])));
	await test.step("Then the listener was not called", async () => {
		expect(await changes(page)).toBe(0);
	});
	await thenTFullHolds(page, ["a.html"], "e1");
	await thenHasManyHolds(page, [["go", "c1"]]);
});

/** Call applyTagBatch(batch) in the page. */
function applyBatch(page, batch) {
	return page.evaluate(async (batch) => {
		const t = await import("/js/api/lcty-t.js");
		t.applyTagBatch(batch);
	}, batch);
}

test("A batch is written onto the copy and calls the listeners", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	await givenListener(page);
	await test.step('When applyTagBatch is called with a put of ["ruby", "c1"] at "b1.6"', () =>
		applyBatch(page, batchOf("b1.6", [hasC("put", ["ruby", "c1"])])));
	await test.step("Then the listener is called once", async () => {
		await expect.poll(() => changes(page)).toBe(1);
	});
	await thenHasManyHolds(page, [
		["go", "c1"],
		["ruby", "c1"],
	]);
	await thenSyncAt(page, "t_has_many_c", "b1.6");
});

test("A batch of the tags calls the listeners too", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	await givenListener(page);
	await test.step('When applyTagBatch is called with a delete of "a.html" and the ETag "e2" at "b1.6"', () =>
		applyBatch(page, batchOf("b1.6", [tagDelete("a.html"), setPut("e2")])));
	await test.step("Then the listener is called once", async () => {
		await expect.poll(() => changes(page)).toBe(1);
	});
	await thenTFullHolds(page, [], "e2");
	await thenSyncAt(page, "t_full", "b1.6");
});

test("A batch that arrives during a read is written after it", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["a.html"], "e1", "b1.5");
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5", "And");
	await givenListener(page);
	await test.step('When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags ["a.html"] at "b1.6" with the ETag "e1" and whose "t.c.list" answers the rows [["go", "c2"]] at "b1.6", after applyTagBatch was called with a put of ["ruby", "c2"] at "b1.7"', () =>
		readFrom(
			page,
			listsOf(["a.html"], "b1.6", "e1", [["go", "c2"]]),
			batchOf("b1.7", [hasC("put", ["ruby", "c2"])]),
		));
	await thenHasManyHolds(
		page,
		[
			["go", "c2"],
			["ruby", "c2"],
		],
		"Then",
	);
	await thenSyncAt(page, "t_has_many_c", "b1.7");
	await thenSyncAt(page, "t_full", "b1.6");
	await test.step("And the listener was called twice", async () => {
		expect(await changes(page)).toBe(2);
	});
});
