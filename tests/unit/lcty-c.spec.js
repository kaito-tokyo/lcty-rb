// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1001: the scenarios of docs/specs/LCTYSP-1001_lcty-c.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// The worker runs in a real browser on the test server's origin: the page is an empty document served by a route, so
// no page module runs, and every test gets a new browser context, so IndexedDB starts empty. The worker sends no
// request, so the server's data does not matter.

import { expect, test } from "@playwright/test";

const PAGE = "/__lcty_unit.html";
const WORKER_URL = "/lcty.v1/lcty.v1.c.worker.cjs";

/** A conversation's meta as c.list answers it (LCTYSP-0012). */
function conv(cid, title = `Conversation ${cid}`) {
	return {
		cid,
		lang: "en",
		title,
		titleTypeId: "__64",
		updatedAt: "2026-11-02T00:00:00.000Z",
		createdAt: "2026-11-01T00:00:00.000Z",
	};
}

const count = (cid, n) => ({ cid, count: n });
const byCid = (items) => [...items].sort((a, b) => (a.cid < b.cid ? -1 : 1));

/** "b1.5" as the row of sync for store */
function syncRow(store, version) {
	const [boot, seq] = version.split(".");
	return { store, boot, seq: Number(seq) };
}

// ---- Background ----

async function background(page, context) {
	await test.step("Given a page on the server's origin", async () => {
		await context.route(`**${PAGE}`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>unit</title>",
			}),
		);
		await page.goto(PAGE);
	});
	await test.step('And every message to the worker has the endpoint "/v1/" on the page\'s origin, unless the scenario says otherwise', () => {});
}

// ---- The database, from the page ----

/** The database "lcty_c" as it is: {exists, version, stores, c_meta, c_recordcount, sync}. Never creates it. */
function readDb(page) {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_c");
				req.onupgradeneeded = () => req.transaction.abort(); // no database: do not create one
				req.onerror = () =>
					req.error?.name === "AbortError"
						? resolve({ exists: false })
						: reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					const stores = [...db.objectStoreNames].sort();
					const result = { exists: true, version: db.version, stores };
					if (stores.length === 0) {
						db.close();
						resolve(result);
						return;
					}
					const tx = db.transaction(stores);
					for (const s of stores)
						tx.objectStore(s).getAll().onsuccess = (e) => {
							result[s] = e.target.result;
						};
					tx.oncomplete = () => {
						db.close();
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

/** Create "lcty_c" at version with stores ({store: {keyPath, records: [value]}}). */
function seedDb(page, version, stores) {
	return page.evaluate(
		({ version, stores }) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_c", version);
				req.onupgradeneeded = () => {
					const db = req.result;
					for (const [store, { keyPath, records }] of Object.entries(stores)) {
						const os = db.createObjectStore(store, { keyPath });
						for (const value of records) os.put(value);
					}
				};
				req.onsuccess = () => {
					req.result.close();
					resolve();
				};
				req.onerror = () => reject(req.error);
			}),
		{ version, stores },
	);
}

/** The database as the worker leaves it: c_meta, c_recordcount and their versions in sync (undefined: no row). */
function seed(page, { meta = [], counts = [], metaAt, countsAt }) {
	const sync = [];
	if (metaAt) sync.push(syncRow("c_meta", metaAt));
	if (countsAt) sync.push(syncRow("c_recordcount", countsAt));
	return seedDb(page, 2, {
		c_meta: { keyPath: "cid", records: meta },
		c_recordcount: { keyPath: "cid", records: counts },
		sync: { keyPath: "store", records: sync },
	});
}

// ---- The worker ----

/**
 * Start the worker, post it message (with the endpoint "/v1/" on the page's origin unless message has one; an endpoint
 * null is left out) and collect what it sends until it has answered or failed, and for a little while after (so a
 * second message would be seen). The worker stays alive (window.lctyWorker) until stopWorker().
 */
function runWorker(page, message) {
	return page.evaluate(
		({ url, message }) =>
			new Promise((resolve) => {
				const { endpoint = "/v1/", ...rest } = message;
				if (endpoint !== null)
					rest.endpoint = new URL(endpoint, location.href).href;
				const seen = { messages: [], errors: [] };
				const worker = new Worker(url);
				window.lctyWorker = worker;
				let timer = null;
				const settle = () => {
					clearTimeout(timer);
					timer = setTimeout(() => resolve(seen), 300);
				};
				// A posted Error is kept as its message, so the answer can be compared as JSON
				worker.onmessage = ({ data }) => {
					seen.messages.push(
						data?.error instanceof Error
							? { ...data, error: data.error.message }
							: data,
					);
					settle();
				};
				worker.onerror = (e) => {
					e.preventDefault();
					seen.errors.push(e.message || "(no message)");
					settle();
				};
				worker.postMessage(rest);
			}),
		{ url: WORKER_URL, message },
	);
}

function stopWorker(page) {
	return page.evaluate(() => window.lctyWorker?.terminate());
}

test.afterEach(async ({ page }) => {
	await stopWorker(page).catch(() => {});
});

const replace = (store, rows, version) => ({
	id: 1,
	op: "replace",
	payload: { store, version, rows },
});
const apply = (version, records) => ({
	id: 1,
	op: "apply",
	payload: { version, records },
});
const put = (store, row) => ({ store, op: "put", row });
const del = (store, cid) => ({ store, op: "delete", row: { cid } });
const HTML = {
	store: "c_html",
	op: "append",
	row: { cid: "a", after: null, tag: "lcty-msg", attrs: {}, innerHTML: "" },
};

// ---- Steps shared by the scenarios ----

async function givenNoDatabase(page) {
	await test.step('Given there is no database "lcty_c"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
}

async function whenPosted(page, text, message) {
	let seen;
	await test.step(`When the worker is posted ${text}`, async () => {
		seen = await runWorker(page, message);
	});
	return seen;
}

/** The one answer the worker posted, with the id 1 (left out), and no error event. */
function answerOf(seen) {
	expect(seen.errors).toEqual([]);
	expect(seen.messages).toHaveLength(1);
	const { id, ...answer } = seen.messages[0];
	expect(id).toBe(1);
	return answer;
}

async function thenApplied(
	seen,
	applied,
	text = applied ? "applied" : "not applied",
) {
	await test.step(`Then it answers that it was ${text}`, () => {
		expect(answerOf(seen)).toEqual({ result: { applied } });
	});
}

async function thenStoresApplied(seen, stores, text) {
	await test.step(`Then it answers that ${text}`, () => {
		expect(answerOf(seen)).toEqual({ result: { applied: stores } });
	});
}

async function thenAnswersError(seen, message) {
	await test.step(`Then it answers the error "${message}" with the status null`, () => {
		expect(answerOf(seen)).toEqual({
			errorType: "error",
			error: message,
			status: null,
		});
	});
}

async function thenHolds(page, store, rows, text) {
	await test.step(`And "${store}" holds exactly ${text}`, async () => {
		expect(byCid((await readDb(page))[store])).toEqual(byCid(rows));
	});
}

// ---- Scenarios: full reads ----

test("A full read creates the copies", async ({ page, context }) => {
	await background(page, context);
	const list = [conv("a"), conv("b")];
	await givenNoDatabase(page);
	const seen = await whenPosted(
		page,
		'a replace of "c_meta" with the conversations "a" and "b" at "b1.5"',
		replace("c_meta", list, "b1.5"),
	);
	await thenApplied(seen, true);
	await test.step('And the database "lcty_c" is at version 2 with the stores "c_meta", "c_recordcount" and "sync"', async () => {
		const db = await readDb(page);
		expect(db.version).toBe(2);
		expect(db.stores).toEqual(["c_meta", "c_recordcount", "sync"]);
	});
	await thenHolds(
		page,
		"c_meta",
		list,
		'the conversations "a" and "b", as posted',
	);
	await test.step('And "sync" holds "c_meta" at boot "b1" and seq 5, and nothing for "c_recordcount"', async () => {
		expect((await readDb(page)).sync).toEqual([syncRow("c_meta", "b1.5")]);
	});
});

test("A full read replaces the copy as a whole", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given "c_meta" holds the conversations "a" and "b" at "b1.5"', async () => {
		await seed(page, { meta: [conv("a"), conv("b")], metaAt: "b1.5" });
	});
	const list = [conv("b", "New title"), conv("c")];
	const seen = await whenPosted(
		page,
		'a replace of "c_meta" with the conversation "b" with a new title and the conversation "c" at "b1.7"',
		replace("c_meta", list, "b1.7"),
	);
	await thenApplied(seen, true);
	await thenHolds(
		page,
		"c_meta",
		list,
		'the conversations "b" and "c", as posted',
	);
	await test.step('And "sync" holds "c_meta" at boot "b1" and seq 7', async () => {
		expect((await readDb(page)).sync).toEqual([syncRow("c_meta", "b1.7")]);
	});
});

for (const { held, read, applied, kept } of [
	{ held: "b1.5", read: "b1.5", applied: "applied", kept: "b" },
	{ held: "b1.7", read: "b1.5", applied: "not applied", kept: "a" },
	{ held: "b1.9", read: "b2.1", applied: "applied", kept: "b" },
]) {
	test(`A full read is written unless the copy is newer in the same boot (${held})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await test.step(`Given "c_meta" holds the conversation "a" at "${held}"`, async () => {
			await seed(page, { meta: [conv("a")], metaAt: held });
		});
		const seen = await whenPosted(
			page,
			`a replace of "c_meta" with the conversation "b" at "${read}"`,
			replace("c_meta", [conv("b")], read),
		);
		await thenApplied(seen, applied === "applied", applied);
		await thenHolds(page, "c_meta", [conv(kept)], `the conversation "${kept}"`);
	});
}

test("The counts are a copy of their own", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given "c_meta" holds the conversation "a" at "b1.9"', async () => {
		await seed(page, { meta: [conv("a")], metaAt: "b1.9" });
	});
	const counts = [count("a", 2), count("b", 5)];
	const seen = await whenPosted(
		page,
		'a replace of "c_recordcount" with the counts 2 of "a" and 5 of "b" at "b1.5"',
		replace("c_recordcount", counts, "b1.5"),
	);
	await thenApplied(seen, true);
	await thenHolds(page, "c_recordcount", counts, '2 of "a" and 5 of "b"');
	await test.step('And "sync" holds "c_meta" at seq 9 and "c_recordcount" at seq 5', async () => {
		expect((await readDb(page)).sync).toEqual([
			syncRow("c_meta", "b1.9"),
			syncRow("c_recordcount", "b1.5"),
		]);
	});
});

// ---- Scenarios: changes ----

test("A change is written onto an older copy of the same boot", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given "c_meta" holds the conversations "a" and "b" and "c_recordcount" 2 of "a", both at "b1.5"', async () => {
		await seed(page, {
			meta: [conv("a"), conv("b")],
			counts: [count("a", 2)],
			metaAt: "b1.5",
			countsAt: "b1.5",
		});
	});
	const renamed = conv("a", "New title");
	const seen = await whenPosted(
		page,
		'an apply at "b1.6" of a c_meta put of "a" with a new title, a c_recordcount put of 3 of "a" and a c_html append',
		apply("b1.6", [
			put("c_meta", renamed),
			put("c_recordcount", count("a", 3)),
			HTML,
		]),
	);
	await thenStoresApplied(
		seen,
		["c_meta", "c_recordcount"],
		'"c_meta" and "c_recordcount" applied it',
	);
	await thenHolds(
		page,
		"c_meta",
		[renamed, conv("b")],
		'the conversation "a" with the new title and "b"',
	);
	await thenHolds(page, "c_recordcount", [count("a", 3)], '3 of "a"');
	await test.step('And "sync" holds "c_meta" and "c_recordcount" at seq 6', async () => {
		expect((await readDb(page)).sync).toEqual([
			syncRow("c_meta", "b1.6"),
			syncRow("c_recordcount", "b1.6"),
		]);
	});
});

test("A deleted conversation leaves both copies", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given "c_meta" holds the conversations "a" and "b" and "c_recordcount" 2 of "a" and 4 of "b", both at "b1.5"', async () => {
		await seed(page, {
			meta: [conv("a"), conv("b")],
			counts: [count("a", 2), count("b", 4)],
			metaAt: "b1.5",
			countsAt: "b1.5",
		});
	});
	const seen = await whenPosted(
		page,
		'an apply at "b1.6" of a c_meta delete and a c_recordcount delete of "b"',
		apply("b1.6", [del("c_meta", "b"), del("c_recordcount", "b")]),
	);
	await thenStoresApplied(
		seen,
		["c_meta", "c_recordcount"],
		'"c_meta" and "c_recordcount" applied it',
	);
	await thenHolds(page, "c_meta", [conv("a")], 'the conversation "a"');
	await thenHolds(page, "c_recordcount", [count("a", 2)], '2 of "a"');
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
		await test.step(`Given "c_meta" holds the conversation "a" at "${held}"`, async () => {
			await seed(page, { meta: [conv("a")], metaAt: held });
		});
		const seen = await whenPosted(
			page,
			`an apply at "${change}" of a c_meta put of "b"`,
			apply(change, [put("c_meta", conv("b"))]),
		);
		await thenStoresApplied(seen, [], "no store applied it");
		await thenHolds(page, "c_meta", [conv("a")], 'the conversation "a"');
	});
}

test("A change onto a copy that was never read is left", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given "c_meta" holds the conversation "a" at "b1.5" and "c_recordcount" was never read', async () => {
		await seed(page, { meta: [conv("a")], metaAt: "b1.5" });
	});
	const seen = await whenPosted(
		page,
		'an apply at "b1.6" of a c_recordcount put of 3 of "a"',
		apply("b1.6", [put("c_recordcount", count("a", 3))]),
	);
	await thenStoresApplied(seen, [], "no store applied it");
	await test.step('And "c_recordcount" is empty', async () => {
		expect((await readDb(page)).c_recordcount).toEqual([]);
	});
});

test("A change of other stores only does not open the database", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const seen = await whenPosted(
		page,
		'an apply at "b1.6" of a c_html append only',
		apply("b1.6", [HTML]),
	);
	await thenStoresApplied(seen, [], "no store applied it");
	await test.step('And there is still no database "lcty_c"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
});

for (const { payload, message, posted } of [
	{
		payload: 'a replace of "c_html" at "b1.5"',
		message: "no such store: c_html",
		posted: replace("c_html", [], "b1.5"),
	},
	{
		payload: 'a replace of "c_meta" at "5"',
		message: "not a version: 5",
		posted: replace("c_meta", [], "5"),
	},
	{
		payload: 'an apply at "b1" of a c_meta put of "a"',
		message: "not a version: b1",
		posted: apply("b1", [put("c_meta", conv("a"))]),
	},
]) {
	test(`A bad payload is an error (${payload})`, async ({ page, context }) => {
		await background(page, context);
		const seen = await whenPosted(page, payload, posted);
		await thenAnswersError(seen, message);
	});
}

test("A newer database is left alone", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given the database "lcty_c" is at version 3 with the store "c_meta" holding the conversation "a"', async () => {
		await seedDb(page, 3, { c_meta: { keyPath: "cid", records: [conv("a")] } });
	});
	const seen = await whenPosted(
		page,
		'a replace of "c_meta" with the conversation "b" at "b1.5"',
		replace("c_meta", [conv("b")], "b1.5"),
	);
	await test.step("Then it answers an error with the status null", () => {
		const answer = answerOf(seen);
		expect(answer.errorType).toBe("error");
		expect(typeof answer.error).toBe("string");
		expect(answer.status).toBeNull();
	});
	await test.step('And the database "lcty_c" is still at version 3', async () => {
		expect((await readDb(page)).version).toBe(3);
	});
});

test("The worker closes its connection after a write", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenNoDatabase(page);
	const seen = await whenPosted(
		page,
		'a replace of "c_meta" with the conversation "a" at "b1.5"',
		replace("c_meta", [conv("a")], "b1.5"),
	);
	await thenApplied(seen, true);
	await test.step('And the database "lcty_c" can be opened at version 3 without being blocked, while the worker is still alive', async () => {
		const outcome = await page.evaluate(
			() =>
				new Promise((resolve) => {
					const req = indexedDB.open("lcty_c", 3);
					req.onblocked = () => resolve("blocked");
					req.onsuccess = () => {
						req.result.close();
						resolve("opened");
					};
					req.onerror = () => resolve(`error: ${req.error}`);
				}),
		);
		expect(outcome).toBe("opened");
	});
});

// ---- Scenarios: reading ----

test("Getting before any read finds no copy", async ({ page, context }) => {
	await background(page, context);
	await givenNoDatabase(page);
	const seen = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await test.step("Then it answers no items, no counts and stale true", () => {
		expect(answerOf(seen)).toEqual({
			result: { items: [], counts: {}, stale: true },
		});
	});
	await test.step('And there is still no database "lcty_c"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
});

test("Getting a database of version 1 finds no copy", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the database "lcty_c" is at version 1 with the store "c_meta" holding the conversation "a"', async () => {
		await seedDb(page, 1, {
			c_meta: { keyPath: "id", records: [{ id: "a", title: "a" }] },
		});
	});
	const seen = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await test.step("Then it answers no items, no counts and stale true", () => {
		expect(answerOf(seen)).toEqual({
			result: { items: [], counts: {}, stale: true },
		});
	});
	await test.step('And the database "lcty_c" is still at version 1', async () => {
		expect((await readDb(page)).version).toBe(1);
	});
});

test("Getting returns the copy newest first with the counts", async ({
	page,
	context,
}) => {
	await background(page, context);
	const at = (cid, time) => ({
		...conv(cid),
		updatedAt: `2026-11-02T${time}:00.000Z`,
	});
	const stored = {
		a: at("a", "10:00"),
		b: at("b", "12:00"),
		c: at("c", "11:00"),
		d: at("d", "12:00"),
	};
	await test.step('Given "c_meta" holds the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00', async () => {
		await seed(page, {
			meta: Object.values(stored),
			counts: [count("a", 2), count("d", 5)],
			metaAt: "b1.5",
			countsAt: "b1.5",
		});
	});
	await test.step('And "c_recordcount" holds 2 of "a" and 5 of "d"', () => {});
	const seen = await whenPosted(page, '{"id": 1, "op": "get"}', {
		id: 1,
		op: "get",
	});
	await test.step('Then it answers "d", "b", "c" and "a" in that order, as stored, the counts 2 of "a" and 5 of "d", and stale false', () => {
		expect(answerOf(seen)).toEqual({
			result: {
				items: [stored.d, stored.b, stored.c, stored.a],
				counts: { a: 2, d: 5 },
				stale: false,
			},
		});
	});
});

// ---- Scenarios: messages ----

test("An unknown operation is an error", async ({ page, context }) => {
	await background(page, context);
	const seen = await whenPosted(page, '{"id": 1, "op": "nope"}', {
		id: 1,
		op: "nope",
	});
	await test.step('Then it answers the error type "unknownOperation"', () => {
		expect(answerOf(seen)).toEqual({ errorType: "unknownOperation" });
	});
});

test("A SharedWorker answers on the port the message came from", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given "c_meta" holds the conversation "a" at "b1.5"', async () => {
		await seed(page, { meta: [conv("a")], metaAt: "b1.5" });
	});
	let answers;
	await test.step('When two ports of new SharedWorker("/lcty.v1/lcty.v1.c.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other', async () => {
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
	await test.step('Then the first port is answered with the id 1 and the conversation "a"', () => {
		expect(answers.first).toEqual({
			id: 1,
			result: { items: [conv("a")], counts: {}, stale: false },
		});
	});
	await test.step('And the second port is answered with the id 2 and the error type "unknownOperation"', () => {
		expect(answers.second).toEqual({ id: 2, errorType: "unknownOperation" });
	});
});

test("A message without an endpoint is an error", async ({ page, context }) => {
	await background(page, context);
	const seen = await whenPosted(
		page,
		'{"id": 1, "op": "get"} without an endpoint',
		{ id: 1, op: "get", endpoint: null },
	);
	await thenAnswersError(seen, "the message has no endpoint");
});

test("An endpoint on another origin is an error", async ({ page, context }) => {
	await background(page, context);
	const seen = await whenPosted(
		page,
		'{"id": 1, "op": "get", "endpoint": "http://example.com/v1/"}',
		{ id: 1, op: "get", endpoint: "http://example.com/v1/" },
	);
	await thenAnswersError(
		seen,
		"the endpoint is not on this origin: http://example.com/v1/",
	);
});
