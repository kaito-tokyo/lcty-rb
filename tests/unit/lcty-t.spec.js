// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1021: the scenarios of docs/specs/LCTYSP-1021_lcty-t.feature, written by hand. Each test has the title of its
// Scenario and one test.step per line of it, so the two read side by side.
//
// The worker and js/api/lcty-t.js run in a real browser on the test server's origin, on the empty unit page; every test
// gets a new browser context, so IndexedDB starts empty. /v1/tags and /v1/tags/:file/memory are answered by routes
// (routes also catch a worker's requests), which record every request, so the server's data does not matter.

import { expect, test } from "@playwright/test";
import { openUnitPage } from "./unit-page.js";

const WORKER_URL = "/lcty.v1/lcty.v1.t.worker.cjs";

/** A tag file as GET /v1/tags returns it (LCTYSP-0006). */
const tag = (file) => ({ file, name: file, ops: [], prompt: "", memory: [] });

// ---- Background ----

async function background(page, context) {
	const server = {
		requests: [],
		get: (route) =>
			route.fulfill({ json: { tags: [] }, headers: { ETag: "e0" } }),
		put: (route) =>
			route.fulfill({ json: { ok: true }, headers: { ETag: "e9" } }),
		memory: (route) => route.fulfill({ status: 201, json: {} }),
	};
	await test.step("Given a page on the server's origin", () =>
		openUnitPage(page, context, { lctyT: false }));
	await test.step("And /v1/tags and /v1/tags/:file/memory are answered by the test, which records the requests", async () => {
		await context.route("**/v1/tags", async (route) => {
			const req = route.request();
			server.requests.push({
				method: req.method(),
				path: new URL(req.url()).pathname,
				body: req.postData(),
				ifMatch: (await req.headerValue("if-match")) ?? null,
			});
			return req.method() === "PUT" ? server.put(route) : server.get(route);
		});
		await context.route("**/v1/tags/*/memory", (route) => {
			const req = route.request();
			server.requests.push({
				method: req.method(),
				path: new URL(req.url()).pathname,
				body: req.postData(),
				ifMatch: null,
			});
			return server.memory(route);
		});
	});
	await test.step('And every message to the worker has the endpoint "/v1/" on the page\'s origin, unless the scenario says otherwise', () => {});
	return server;
}

// ---- The database, from the page ----

/** The database "lcty_t" as it is: {exists, version, stores, and of the stores it has: keyPath (of t_full), tags (the
 * rows of t_full in key order), etag (of the record "set" of t_set), hasMany (the rows of t_has_many_c in key order),
 * sync (the row "t_has_many_c" of sync, or null)}. Never creates it. */
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
					if (known.includes("sync"))
						reqs.sync = tx.objectStore("sync").get("t_has_many_c");
					tx.oncomplete = () => {
						db.close();
						if (reqs.tags) result.tags = reqs.tags.result;
						if (reqs.set) result.etag = reqs.set.result?.etag ?? null;
						if (reqs.hasMany) result.hasMany = reqs.hasMany.result;
						if (reqs.sync) result.sync = reqs.sync.result ?? null;
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
 * "lcty_t" at version 3, as the worker leaves it, with its four stores, holding the set {tags, etag} when set is given
 * and the tags of conversations {rows, version} when hasMany is: the rows are put in the given order.
 */
function seed(page, { set = null, hasMany = null }) {
	return page.evaluate(
		({ set, hasMany }) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_t", 3);
				req.onupgradeneeded = () => {
					const db = req.result;
					const tags = db.createObjectStore("t_full", { keyPath: "file" });
					const sets = db.createObjectStore("t_set");
					const rows = db.createObjectStore("t_has_many_c", {
						keyPath: ["tag", "cid"],
					});
					const sync = db.createObjectStore("sync", { keyPath: "store" });
					if (set) {
						for (const t of set.tags) tags.put(t);
						sets.put({ etag: set.etag }, "set");
					}
					if (hasMany) {
						for (const r of hasMany.rows) rows.put(r);
						const [boot, seq] = hasMany.version.split(".");
						sync.put({ store: "t_has_many_c", boot, seq: Number(seq) });
					}
				};
				req.onsuccess = () => {
					req.result.close();
					resolve();
				};
				req.onerror = () => reject(req.error);
			}),
		{ set, hasMany },
	);
}

/** The rows {tag, cid} of ["tag", "cid"] pairs. */
const rowsOf = (pairs) => pairs.map(([tag, cid]) => ({ tag, cid }));

/** The row of "sync" that a version "<boot>.<seq>" of t_has_many_c is. */
function syncRow(version) {
	const [boot, seq] = version.split(".");
	return { store: "t_has_many_c", boot, seq: Number(seq) };
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

// ---- The worker ----

/**
 * Start the worker, post it message (with the endpoint "/v1/" on the page's origin unless message has one; an endpoint
 * null is left out) and resolve to the first message it answers, as {id, message (the rest, a posted
 * Error kept as its message), hasResult}, or to its error event.
 */
function post(page, message) {
	return page.evaluate(
		({ url, message }) =>
			new Promise((resolve) => {
				const { endpoint = "/v1/", ...sent } = message;
				if (endpoint !== null)
					sent.endpoint = new URL(endpoint, location.href).href;
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
				worker.postMessage(sent);
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

async function givenTFullHolds(page, files, etag) {
	await test.step(`Given "t_full" holds the tags ${list(files)} and the ETag "${etag}"`, () =>
		seed(page, { set: { tags: files.map(tag), etag } }));
}

async function givenHasManyHolds(page, pairs, version) {
	await test.step(`Given "t_has_many_c" holds ${list(pairs)} at "${version}"`, () =>
		seed(page, { hasMany: { rows: rowsOf(pairs), version } }));
}

async function thenHasManyHolds(page, pairs, word = "And") {
	await test.step(`${word} "t_has_many_c" holds exactly ${list(pairs)}`, async () => {
		expect((await readDb(page)).hasMany).toEqual(rowsOf(pairs));
	});
}

async function thenSyncAt(page, version) {
	await test.step(`And "sync" holds "t_has_many_c" at "${version}"`, async () => {
		expect((await readDb(page)).sync).toEqual(syncRow(version));
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

/** The message of an apply at version of records [op, ["tag", "cid"]] of t_has_many_c. */
const applyOf = (version, records) => ({
	id: 1,
	op: "apply",
	payload: {
		version,
		records: records.map(([op, [tag, cid]]) => ({
			store: "t_has_many_c",
			op,
			row: { tag, cid },
		})),
	},
});

async function givenGetReturns(server, files, etag) {
	await test.step(`And GET /v1/tags returns the tags ${list(files)} with the ETag "${etag}"`, () => {
		server.get = (route) =>
			route.fulfill({
				json: { tags: files.map(tag) },
				headers: { ETag: etag },
			});
	});
}

async function whenPosted(page, json, message) {
	let answer;
	await test.step(`When the worker is posted ${json}`, async () => {
		answer = await post(page, message);
	});
	expect(answer.id).toBe(message.id);
	return answer;
}

async function thenAnswersTags(answer, files, etag) {
	await test.step(`Then it answers the tags ${list(files)} and the ETag "${etag}"`, () => {
		expect(answer.message).toEqual({ result: { tags: files.map(tag), etag } });
	});
}

async function thenAnswersError(answer, error, status) {
	await test.step(`Then it answers the error "${error}" with the status ${status}`, () => {
		expect(answer.message).toEqual({ errorType: "error", error, status });
	});
}

async function thenRequests(server, line, expected) {
	await test.step(line, () => {
		expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(
			expected,
		);
	});
}

async function thenNoRequest(server) {
	await test.step("And no request is sent", () => {
		expect(server.requests).toEqual([]);
	});
}

async function thenTFullHolds(page, files, etag, composed = "") {
	await test.step(`And "t_full" holds the tags ${list(files)}${composed} and the ETag "${etag}"`, async () => {
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

// ---- Scenarios: the worker ----

test("A sync stores the set with NFC file names and the ETag", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	await test.step('And GET /v1/tags returns the tag "00010-café.html" with the name decomposed and the ETag "e1"', () => {
		server.get = (route) =>
			route.fulfill({
				json: { tags: [tag("00010-café.html".normalize("NFD"))] },
				headers: { ETag: "e1" },
			});
	});
	const answer = await whenPosted(page, '{"id": 1, "op": "sync_full"}', {
		id: 1,
		op: "sync_full",
	});
	await test.step("Then it answers with no result", () => {
		expect(answer.hasResult).toBe(true);
		expect(answer.message).toEqual({ result: undefined });
	});
	await thenVersion3(page);
	await test.step('And "t_full" has one row per tag, keyed by its file name', async () => {
		const db = await readDb(page);
		expect(db.keyPath).toBe("file");
		// the row is the tag as GET /v1/tags gave it, with only the file name composed
		expect(db.tags).toEqual([
			{ ...tag("00010-café.html".normalize("NFD")), file: "00010-café.html" },
		]);
	});
	await thenTFullHolds(page, ["00010-café.html"], "e1", " composed");
});

test("A sync composes the name of an invalid tag, which comes from its file name", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	const nfd = (s) => s.normalize("NFD");
	const invalid = {
		...tag(nfd("00010-café.html")),
		name: nfd("café"),
		invalid: true,
	};
	const other = { ...tag(nfd("00020-café.html")), name: nfd("Café") };
	await test.step('And GET /v1/tags returns the invalid tag "00010-café.html" named "café", both decomposed, and the tag "00020-cafe" U+0301 ".html" with the name decomposed', () => {
		server.get = (route) =>
			route.fulfill({
				json: { tags: [invalid, other] },
				headers: { ETag: "e1" },
			});
	});
	await whenPosted(page, '{"id": 1, "op": "sync_full"}', {
		id: 1,
		op: "sync_full",
	});
	let db;
	await test.step('Then "t_full" holds the invalid tag "00010-café.html" named "café", both composed, with invalid true', async () => {
		db = await readDb(page);
		expect(db.tags[0]).toEqual({
			...invalid,
			file: "00010-café.html",
			name: "café",
		});
	});
	await test.step("And the other tag keeps its decomposed name", () => {
		expect(db.tags[1]).toEqual({ ...other, file: "00020-café.html" });
	});
});

test("A database at version 1 is dropped and synced again", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step('Given the database "lcty_t" is at version 1 with the record "set" of the tags ["00010-a.html"] in "t_full"', () =>
		seedVersion1(page, { tags: [tag("00010-a.html")], etag: "e1" }));
	await givenGetReturns(server, ["00010-b.html"], "e2");
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, ["00010-b.html"], "e2");
	await thenRequests(server, "And the requests sent are GET /v1/tags", [
		"GET /v1/tags",
	]);
	await thenVersion3(page);
});

test("Getting answers the tags in the order of their file names", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(
		page,
		["00020-b.html", "00010-c.html", "00030-a.html"],
		"e1",
	);
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(
		answer,
		["00010-c.html", "00020-b.html", "00030-a.html"],
		"e1",
	);
});

test("An empty set is a copy too", async ({ page, context }) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	await givenGetReturns(server, [], "e1");
	await whenPosted(page, '{"id": 1, "op": "sync_full"}', {
		id: 1,
		op: "sync_full",
	});
	let answer;
	await test.step('And then a new worker is posted {"id": 2, "op": "get"}', async () => {
		await page.evaluate(() => window.lctyWorker?.terminate());
		answer = await post(page, { id: 2, op: "get" });
	});
	await thenAnswersTags(answer, [], "e1");
	await thenRequests(server, "And the requests sent are GET /v1/tags", [
		"GET /v1/tags",
	]);
});

test("A sync replaces the set as a whole", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html", "00020-b.html"], "e1");
	await givenGetReturns(server, ["00010-c.html"], "e2");
	const answer = await whenPosted(page, '{"id": 1, "op": "sync_full"}', {
		id: 1,
		op: "sync_full",
	});
	await test.step("Then it answers with no result", () => {
		expect(answer.message).toEqual({ result: undefined });
	});
	await thenTFullHolds(page, ["00010-c.html"], "e2");
});

test("Getting without a copy syncs first", async ({ page, context }) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	await givenGetReturns(server, ["00010-a.html"], "e1");
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, ["00010-a.html"], "e1");
	await thenRequests(server, "And the requests sent are GET /v1/tags", [
		"GET /v1/tags",
	]);
});

test("Getting with a copy sends no request", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await givenGetReturns(server, ["00010-b.html"], "e2");
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, ["00010-a.html"], "e1");
	await thenNoRequest(server);
});

test("A put sends the If-Match it is given and syncs afterwards", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await test.step('And PUT /v1/tags answers with the ETag "e3"', () => {
		server.put = (route) =>
			route.fulfill({ json: { ok: true }, headers: { ETag: "e3" } });
	});
	await givenGetReturns(server, ["00010-b.html"], "e3");
	const answer = await whenPosted(
		page,
		'{"id": 1, "op": "put", "payload": {"tags": [{"file": "00010-b.html"}], "etag": "e0"}}',
		{
			id: 1,
			op: "put",
			payload: { tags: [{ file: "00010-b.html" }], etag: "e0" },
		},
	);
	await test.step('Then it answers "e3"', () => {
		expect(answer.message).toEqual({ result: "e3" });
	});
	await thenRequests(
		server,
		"And the requests sent are PUT /v1/tags and then GET /v1/tags",
		["PUT /v1/tags", "GET /v1/tags"],
	);
	await test.step('And the PUT has the body {"tags":[{"file":"00010-b.html"}]} and the If-Match "e0"', () => {
		expect(server.requests[0].body).toBe('{"tags":[{"file":"00010-b.html"}]}');
		expect(server.requests[0].ifMatch).toBe("e0");
	});
	await thenTFullHolds(page, ["00010-b.html"], "e3");
});

test("A put that fails answers the error with the status and still syncs", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await test.step('And PUT /v1/tags answers with the status 412 and "the tags have changed"', () => {
		server.put = (route) =>
			route.fulfill({ status: 412, body: "the tags have changed" });
	});
	await givenGetReturns(server, ["00010-b.html"], "e2");
	const answer = await whenPosted(
		page,
		'{"id": 1, "op": "put", "payload": {"tags": [], "etag": "e1"}}',
		{ id: 1, op: "put", payload: { tags: [], etag: "e1" } },
	);
	await thenAnswersError(answer, "412 the tags have changed", 412);
	await thenRequests(
		server,
		"And the requests sent are PUT /v1/tags and then GET /v1/tags",
		["PUT /v1/tags", "GET /v1/tags"],
	);
	await thenTFullHolds(page, ["00010-b.html"], "e2");
});

test("Adding memory posts to the tag's file and syncs afterwards", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await test.step('And POST /v1/tags/:file/memory answers {"id": "m1"}', () => {
		server.memory = (route) =>
			route.fulfill({ status: 201, json: { id: "m1" } });
	});
	await givenGetReturns(server, ["00010-a.html"], "e2");
	const answer = await whenPosted(
		page,
		'{"id": 1, "op": "addMemory", "payload": {"file": "00010-a/b.html", "body": {"text": "t"}}}',
		{
			id: 1,
			op: "addMemory",
			payload: { file: "00010-a/b.html", body: { text: "t" } },
		},
	);
	await test.step('Then it answers {"id": "m1"}', () => {
		expect(answer.message).toEqual({ result: { id: "m1" } });
	});
	await thenRequests(
		server,
		"And the requests sent are POST /v1/tags/00010-a%2Fb.html/memory and then GET /v1/tags",
		["POST /v1/tags/00010-a%2Fb.html/memory", "GET /v1/tags"],
	);
	await test.step('And the POST has the body {"text":"t"}', () => {
		expect(server.requests[0].body).toBe('{"text":"t"}');
	});
	await thenTFullHolds(page, ["00010-a.html"], "e2");
});

test("A failed sync leaves the copy as it was", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await test.step('And GET /v1/tags answers with the status 500 and "boom"', () => {
		server.get = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	const answer = await whenPosted(page, '{"id": 1, "op": "sync_full"}', {
		id: 1,
		op: "sync_full",
	});
	await thenAnswersError(answer, "500 boom", 500);
	await thenTFullHolds(page, ["00010-a.html"], "e1");
});

test("A request that fails without an answer has no status", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	await test.step("And GET /v1/tags fails without an answer", () => {
		server.get = (route) => route.abort("failed");
	});
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await test.step("Then it answers an error with the status null", () => {
		expect(answer.message.errorType).toBe("error");
		expect(typeof answer.message.error).toBe("string");
		expect(answer.message.status).toBeNull();
	});
});

test("An unknown operation is an error", async ({ page, context }) => {
	const server = await background(page, context);
	const answer = await whenPosted(page, '{"id": 1, "op": "nope"}', {
		id: 1,
		op: "nope",
	});
	await test.step('Then it answers the error type "unknownOperation"', () => {
		expect(answer.message).toEqual({ errorType: "unknownOperation" });
	});
	await thenNoRequest(server);
});

test("The worker closes its connection after the operation", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	await givenGetReturns(server, ["00010-a.html"], "e1");
	const answer = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await thenAnswersTags(answer, ["00010-a.html"], "e1");
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

// Playwright's routes do not catch the requests of a SharedWorker, so this scenario uses no request
test("A SharedWorker answers on the port the message came from", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	let answers;
	await test.step('When two ports of new SharedWorker("/lcty.v1/lcty.v1.t.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other', async () => {
		answers = await page.evaluate(async (url) => {
			const ask = (message) =>
				new Promise((resolve) => {
					const { port } = new SharedWorker(url);
					port.onmessage = ({ data }) => resolve(data);
					port.postMessage({
						...message,
						endpoint: new URL("/v1/", location.href).href,
					});
				});
			const first = await ask({ id: 1, op: "get" });
			const second = await ask({ id: 2, op: "nope" });
			return { first, second };
		}, WORKER_URL);
	});
	await test.step('Then the first port is answered with the id 1, the tags ["00010-a.html"] and the ETag "e1"', () => {
		expect(answers.first).toEqual({
			id: 1,
			result: { tags: [tag("00010-a.html")], etag: "e1" },
		});
	});
	await test.step('And the second port is answered with the id 2 and the error type "unknownOperation"', () => {
		expect(answers.second).toEqual({ id: 2, errorType: "unknownOperation" });
	});
});

test("A message without an endpoint is an error", async ({ page, context }) => {
	const server = await background(page, context);
	const answer = await whenPosted(
		page,
		'{"id": 1, "op": "sync_full"} without an endpoint',
		{ id: 1, op: "sync_full", endpoint: null },
	);
	await thenAnswersError(answer, "the message has no endpoint", null);
	await thenNoRequest(server);
});

test("An endpoint on another origin is an error", async ({ page, context }) => {
	const server = await background(page, context);
	const answer = await whenPosted(
		page,
		'{"id": 1, "op": "sync_full", "endpoint": "http://example.com/v1/"}',
		{ id: 1, op: "sync_full", endpoint: "http://example.com/v1/" },
	);
	await thenAnswersError(
		answer,
		"the endpoint is not on this origin: http://example.com/v1/",
		null,
	);
	await thenNoRequest(server);
});

// ---- Scenarios: the worker, t_has_many_c ----

test('A replace fills "t_has_many_c" and stores the version', async ({
	page,
	context,
}) => {
	const server = await background(page, context);
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
	await thenSyncAt(page, "b1.5");
	await thenNoRequest(server);
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
		await thenSyncAt(page, version);
	});
}

test("A replace leaves the tags as they were", async ({ page, context }) => {
	await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	const answer = await whenPosted(
		page,
		'a replace of "t_has_many_c" with the rows [["go", "c1"]] at "b1.5"',
		replaceOf("t_has_many_c", "b1.5", [["go", "c1"]]),
	);
	await thenAnswersApplied(answer, true);
	await thenTFullHolds(page, ["00010-a.html"], "e1");
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
			["put", ["ruby", "c1"]],
			["delete", ["go", "c2"]],
		]),
	);
	await thenAnswersApplied(answer, ["t_has_many_c"]);
	await thenHasManyHolds(page, [
		["go", "c1"],
		["ruby", "c1"],
	]);
	await thenSyncAt(page, "b1.6");
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
			applyOf(change, [["put", ["ruby", "c1"]]]),
		);
		await thenAnswersApplied(answer, []);
		await thenHasManyHolds(page, [["go", "c1"]]);
		await thenSyncAt(page, held);
	});
}

test("A change onto a copy that was never filled is left", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a put of ["ruby", "c1"]',
		applyOf("b1.6", [["put", ["ruby", "c1"]]]),
	);
	await thenAnswersApplied(answer, []);
	await thenHasManyHolds(page, []);
});

test("A change of other stores only does not open the database", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const answer = await whenPosted(
		page,
		'an apply at "b1.6" of a c_meta put only',
		{
			id: 1,
			op: "apply",
			payload: {
				version: "b1.6",
				records: [{ store: "c_meta", op: "put", row: { cid: "c1" } }],
			},
		},
	);
	await thenAnswersApplied(answer, []);
	await test.step('And there is still no database "lcty_t"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
});

for (const { payload, message, sent } of [
	{
		payload: 'a replace of "t_full" at "b1.5"',
		message: "no such store: t_full",
		sent: replaceOf("t_full", "b1.5", []),
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
		sent: applyOf("b1", [["put", ["ruby", "c1"]]]),
	},
]) {
	test(`A bad payload is an error (${payload})`, async ({ page, context }) => {
		await background(page, context);
		const answer = await whenPosted(page, payload, sent);
		await thenAnswersError(answer, message, null);
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
	const server = await background(page, context);
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
	await thenNoRequest(server);
});

test("Getting the tags of conversations before any replace is stale", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	const answer = await whenPosted(page, '{"id": 1, "op": "get_has_many"}', {
		id: 1,
		op: "get_has_many",
	});
	await thenAnswersRows(answer, [], true);
	await thenNoRequest(server);
});

// ---- Scenarios: js/api/lcty-t.js ----
test("The calls of a tab run one at a time, in order", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await test.step('And PUT /v1/tags answers with the ETag "e2" after 300 milliseconds', () => {
		server.put = async (route) => {
			await new Promise((r) => setTimeout(r, 300));
			await route.fulfill({ json: { ok: true }, headers: { ETag: "e2" } });
		};
	});
	await givenGetReturns(server, ["00010-b.html"], "e2");
	let results;
	await test.step('When putTags([{"file": "00010-b.html"}], "e1") and then getTags() are called without waiting', async () => {
		results = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			const put = t.putTags([{ file: "00010-b.html" }], "e1");
			const get = t.getTags();
			return { put: await put, get: await get };
		});
	});
	await test.step('Then putTags resolves to "e2"', () => {
		expect(results.put).toBe("e2");
	});
	await test.step('And getTags resolves to the tags ["00010-b.html"] and the ETag "e2"', () => {
		expect(results.get).toEqual({ tags: [tag("00010-b.html")], etag: "e2" });
	});
	await thenRequests(
		server,
		"And the requests sent are PUT /v1/tags and then GET /v1/tags",
		["PUT /v1/tags", "GET /v1/tags"],
	);
});

test("A call whose worker answers an error rejects with its status", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTFullHolds(page, ["00010-a.html"], "e1");
	await test.step('And PUT /v1/tags answers with the status 412 and "the tags have changed"', () => {
		server.put = (route) =>
			route.fulfill({ status: 412, body: "the tags have changed" });
	});
	let error;
	await test.step('When putTags([], "e0") is called', async () => {
		error = await page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			try {
				await t.putTags([], "e0");
				return null;
			} catch (e) {
				return {
					isError: e instanceof Error,
					message: e.message,
					status: e.status,
				};
			}
		});
	});
	await test.step('Then it rejects with the Error "412 the tags have changed" whose status is 412', () => {
		expect(error).toEqual({
			isError: true,
			message: "412 the tags have changed",
			status: 412,
		});
	});
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

/** Register a listener with onTagsOfConversationsChange that counts its calls in window.lctyChanges. */
async function givenListener(page) {
	await test.step("And a listener is registered with onTagsOfConversationsChange", () =>
		page.evaluate(async () => {
			const t = await import("/js/api/lcty-t.js");
			window.lctyChanges = 0;
			t.onTagsOfConversationsChange(() => {
				window.lctyChanges += 1;
			});
		}));
}

const changes = (page) => page.evaluate(() => window.lctyChanges);

/**
 * Call readTagsOfConversationsFrom(rpc) with an rpc whose call(method) records the method and answers {version, items:
 * the rows of pairs}, after calling applyTagBatch(batch) when batch is given; resolves to the methods called.
 */
function readFrom(page, version, pairs, batch = null) {
	return page.evaluate(
		async ({ version, items, batch }) => {
			const t = await import("/js/api/lcty-t.js");
			const calls = [];
			await t.readTagsOfConversationsFrom({
				call: async (method) => {
					calls.push(method);
					if (batch) t.applyTagBatch(batch);
					return { version, items };
				},
			});
			return calls;
		},
		{ version, items: rowsOf(pairs), batch },
	);
}

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

test("A read over rpc replaces the copy and calls the listeners", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	await givenListener(page);
	let calls;
	await test.step('When readTagsOfConversationsFrom(rpc) is called with an rpc whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"', async () => {
		calls = await readFrom(page, "b1.6", [["ruby", "c2"]]);
	});
	await test.step('Then the rpc was called with "t.c.list" only', () => {
		expect(calls).toEqual(["t.c.list"]);
	});
	await test.step("And the listener was called once", async () => {
		expect(await changes(page)).toBe(1);
	});
	await thenHasManyHolds(page, [["ruby", "c2"]]);
	await thenSyncAt(page, "b1.6");
});

test("A read over rpc of an older version calls no listener", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.7");
	await givenListener(page);
	await test.step('When readTagsOfConversationsFrom(rpc) is called with an rpc whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"', () =>
		readFrom(page, "b1.6", [["ruby", "c2"]]));
	await test.step("Then the listener was not called", async () => {
		expect(await changes(page)).toBe(0);
	});
	await thenHasManyHolds(page, [["go", "c1"]]);
});

test("A batch is written onto the copy and calls the listeners", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	await givenListener(page);
	await test.step('When applyTagBatch is called with a put of ["ruby", "c1"] at "b1.6"', () =>
		page.evaluate(
			async (batch) => {
				const t = await import("/js/api/lcty-t.js");
				t.applyTagBatch(batch);
			},
			applyOf("b1.6", [["put", ["ruby", "c1"]]]).payload,
		));
	await test.step("Then the listener is called once", async () => {
		await expect.poll(() => changes(page)).toBe(1);
	});
	await thenHasManyHolds(page, [
		["go", "c1"],
		["ruby", "c1"],
	]);
	await thenSyncAt(page, "b1.6");
});

test("A batch that arrives during a read is written after it", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenHasManyHolds(page, [["go", "c1"]], "b1.5");
	await givenListener(page);
	await test.step('When readTagsOfConversationsFrom(rpc) is called with an rpc whose "t.c.list" answers the rows [["go", "c2"]] at "b1.6", after applyTagBatch was called with a put of ["ruby", "c2"] at "b1.7"', () =>
		readFrom(
			page,
			"b1.6",
			[["go", "c2"]],
			applyOf("b1.7", [["put", ["ruby", "c2"]]]).payload,
		));
	await thenHasManyHolds(
		page,
		[
			["go", "c2"],
			["ruby", "c2"],
		],
		"Then",
	);
	await thenSyncAt(page, "b1.7");
	await test.step("And the listener was called twice", async () => {
		expect(await changes(page)).toBe(2);
	});
});
