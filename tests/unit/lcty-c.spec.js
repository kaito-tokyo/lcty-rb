// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1001: the scenarios of docs/specs/LCTYSP-1001_lcty-c.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// The worker runs in a real browser on the test server's origin: the page is an empty document served by a route, so
// no page module runs a sync of its own, and every test gets a new browser context, so IndexedDB starts empty.
// GET /v1/meta-all.json is answered by a route too (routes also catch a worker's requests), so the server's data does
// not matter.

import { expect, test } from "@playwright/test";

const PAGE = "/__lcty_unit.html";
const WORKER_URL = "/js/lcty_c.worker.js";

/** A conversation's meta as GET /v1/meta-all.json returns it (LCTYSP-0006). */
function conv(id, title = `Conversation ${id}`) {
	return {
		id,
		title,
		created_at: "2026-11-01T00:00:00.000Z",
		updated_at_hint: "2026-11-02T00:00:00.000Z",
		setup_tags: [],
		tags_hint: ["tag"],
		messages_hint: 2,
	};
}

const byId = (items) => [...items].sort((a, b) => (a.id < b.id ? -1 : 1));

// ---- Background ----

/** A page on the server's origin, and GET /v1/meta-all.json answered by answer(route), which the test sets. */
async function background(page, context) {
	const server = { answer: (route) => route.fulfill({ json: [] }) };
	await test.step("Given a page on the server's origin", async () => {
		await context.route(`**${PAGE}`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>unit</title>",
			}),
		);
		await page.goto(PAGE);
	});
	await test.step("And GET /v1/meta-all.json is answered by the test", async () => {
		await context.route("**/v1/meta-all.json", (route) => server.answer(route));
	});
	return server;
}

// ---- The database, from the page ----

/** The database name ("lcty_c" by default) as it is: {exists, version, stores, items (of c_meta)}. Never creates it. */
function readDb(page, name = "lcty_c") {
	return page.evaluate(
		(name) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open(name);
				req.onupgradeneeded = () => req.transaction.abort(); // no database: do not create one
				req.onerror = () =>
					req.error?.name === "AbortError"
						? resolve({ exists: false })
						: reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					const result = {
						exists: true,
						version: db.version,
						stores: [...db.objectStoreNames].sort(),
					};
					if (!db.objectStoreNames.contains("c_meta")) {
						db.close();
						resolve({ ...result, items: null });
						return;
					}
					const get = db.transaction("c_meta").objectStore("c_meta").getAll();
					get.onsuccess = () => {
						db.close();
						resolve({ ...result, items: get.result });
					};
					get.onerror = () => {
						db.close();
						reject(get.error);
					};
				};
			}),
		name,
	);
}

/**
 * Create the database name ("lcty_c" by default) at version with stores ({store: {keyPath?, records: [[key?, value]]}}).
 */
function seedDb(page, version, stores, name = "lcty_c") {
	return page.evaluate(
		({ version, stores, name }) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open(name, version);
				req.onupgradeneeded = () => {
					const db = req.result;
					for (const [store, { keyPath, records }] of Object.entries(stores)) {
						const os = db.createObjectStore(
							store,
							keyPath ? { keyPath } : undefined,
						);
						for (const [key, value] of records)
							key === null ? os.put(value) : os.put(value, key);
					}
				};
				req.onsuccess = () => {
					req.result.close();
					resolve();
				};
				req.onerror = () => reject(req.error);
			}),
		{ version, stores, name },
	);
}

/** c_meta at version 1, as the worker leaves it, holding items. */
function seedCMeta(page, items) {
	return seedDb(page, 1, {
		c_meta: { keyPath: "id", records: items.map((m) => [null, m]) },
	});
}

// ---- The worker ----

/**
 * Start the worker, post it message and collect what it sends until it has answered or failed, and for a little while
 * after (so a second message would be seen). The worker stays alive (window.lctyWorker) until stopWorker().
 */
function runWorker(page, message) {
	return page.evaluate(
		({ url, message }) =>
			new Promise((resolve) => {
				const seen = { messages: [], errors: [] };
				const worker = new Worker(url, { type: "module" });
				window.lctyWorker = worker;
				let timer = null;
				const settle = () => {
					clearTimeout(timer);
					timer = setTimeout(() => resolve(seen), 300);
				};
				worker.onmessage = (e) => {
					seen.messages.push(e.data);
					settle();
				};
				worker.onerror = (e) => {
					e.preventDefault();
					seen.errors.push(e.message || "(no message)");
					settle();
				};
				worker.postMessage(message);
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

// ---- Steps shared by the scenarios ----

async function givenNoDatabase(page) {
	await test.step('Given there is no database "lcty_c"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
}

async function givenCMetaHolds(page, items, text) {
	await test.step(`Given "c_meta" holds ${text}`, async () => {
		await seedCMeta(page, items);
	});
}

async function whenPosted(page, op) {
	let seen;
	await test.step(`When the worker is posted {"op": "${op}"}`, async () => {
		seen = await runWorker(page, { op });
	});
	return seen;
}

/** The one answer the worker posted, and no error event. */
function answerOf(seen) {
	expect(seen.errors).toEqual([]);
	expect(seen.messages).toHaveLength(1);
	return seen.messages[0];
}

async function thenAnswersNoResult(seen) {
	await test.step("Then it answers with no result", () => {
		const answer = answerOf(seen);
		expect("result" in answer).toBe(true);
		expect(answer.result).toBeUndefined();
	});
}

async function thenAnswersError(seen, message, status) {
	await test.step(`Then it answers the error "${message}" with the status ${status}`, () => {
		expect(answerOf(seen)).toEqual({ error: message, status });
	});
}

async function thenAnswersAnError(seen) {
	await test.step("Then it answers an error with the status null", () => {
		const answer = answerOf(seen);
		expect(typeof answer.error).toBe("string");
		expect(answer.status).toBeNull();
	});
}

async function thenOnlyCMetaAtVersion1(page) {
	await test.step('And the database "lcty_c" is at version 1 with only the store "c_meta"', async () => {
		const db = await readDb(page);
		expect(db.version).toBe(1);
		expect(db.stores).toEqual(["c_meta"]);
	});
}

async function thenCMetaHoldsExactly(page, items, text) {
	await test.step(`And "c_meta" holds exactly ${text}`, async () => {
		expect(byId((await readDb(page)).items)).toEqual(byId(items));
	});
}

// ---- Scenarios ----

test("A sync stores every conversation of the list", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const list = [conv("a"), conv("b")];
	await givenNoDatabase(page);
	await test.step('And GET /v1/meta-all.json returns the conversations "a" and "b"', () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersNoResult(seen);
	await thenOnlyCMetaAtVersion1(page);
	await thenCMetaHoldsExactly(
		page,
		list,
		'the conversations "a" and "b", as returned',
	);
});

test("A sync replaces the copy as a whole", async ({ page, context }) => {
	const server = await background(page, context);
	const list = [conv("b", "A new title"), conv("c")];
	await givenCMetaHolds(
		page,
		[conv("a"), conv("b")],
		'the conversations "a" and "b"',
	);
	await test.step('And GET /v1/meta-all.json returns the conversation "b" with a new title and the conversation "c"', () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersNoResult(seen);
	await thenCMetaHoldsExactly(
		page,
		list,
		'the conversations "b" and "c", as returned',
	);
});

test("An empty list empties the copy", async ({ page, context }) => {
	const server = await background(page, context);
	await givenCMetaHolds(
		page,
		[conv("a"), conv("b")],
		'the conversations "a" and "b"',
	);
	await test.step("And GET /v1/meta-all.json returns no conversations", () => {
		server.answer = (route) => route.fulfill({ json: [] });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersNoResult(seen);
	await test.step('And "c_meta" is empty', async () => {
		expect((await readDb(page)).items).toEqual([]);
	});
});

test("A sync deletes the old database lcty", async ({ page, context }) => {
	const server = await background(page, context);
	const list = [conv("b")];
	await test.step('Given the database "lcty" is at version 5 with the store "c_meta" holding the conversation "a"', async () => {
		await seedDb(
			page,
			5,
			{ c_meta: { keyPath: "id", records: [[null, conv("a")]] } },
			"lcty",
		);
		expect((await readDb(page, "lcty")).version).toBe(5);
	});
	await test.step('And GET /v1/meta-all.json returns the conversation "b"', () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersNoResult(seen);
	await test.step('And there is no database "lcty"', async () => {
		expect((await readDb(page, "lcty")).exists).toBe(false);
	});
	await thenCMetaHoldsExactly(page, list, 'the conversation "b", as returned');
});

test("A connection to the old database does not hold up the sync", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const list = [conv("b")];
	await test.step('Given the page holds a connection to the database "lcty" that it never closes', async () => {
		await seedDb(
			page,
			5,
			{ c_meta: { keyPath: "id", records: [[null, conv("a")]] } },
			"lcty",
		);
		await page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					const req = indexedDB.open("lcty");
					req.onsuccess = () => {
						window.oldDb = req.result; // no onversionchange: it stays open
						resolve();
					};
					req.onerror = () => reject(req.error);
				}),
		);
	});
	await test.step('And GET /v1/meta-all.json returns the conversation "b"', () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersNoResult(seen);
	await thenCMetaHoldsExactly(page, list, 'the conversation "b", as returned');
	await page.evaluate(() => window.oldDb.close());
});

test("The worker closes its connection after the sync", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenNoDatabase(page);
	await test.step('And GET /v1/meta-all.json returns the conversation "a"', () => {
		server.answer = (route) => route.fulfill({ json: [conv("a")] });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersNoResult(seen);
	await test.step('And the database "lcty_c" can be opened at version 2 without being blocked, while the worker is still alive', async () => {
		const result = await page.evaluate(
			() =>
				new Promise((resolve) => {
					let blocked = false;
					const req = indexedDB.open("lcty_c", 2);
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

for (const { answer, message, status, fulfill } of [
	{
		answer: "answers with the status 500",
		message: "Failed to fetch /v1/meta-all.json: 500",
		status: 500,
		fulfill: (route) => route.fulfill({ status: 500, body: "boom" }),
	},
	{
		answer: "returns an object, not a list",
		message: "meta-all.json is invalid",
		status: null,
		fulfill: (route) => route.fulfill({ json: { a: conv("a") } }),
	},
]) {
	test(`A failed sync leaves the copy as it was (${answer})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		const kept = [conv("a"), conv("b")];
		await givenCMetaHolds(page, kept, 'the conversations "a" and "b"');
		await test.step(`And GET /v1/meta-all.json ${answer}`, () => {
			server.answer = fulfill;
		});
		const seen = await whenPosted(page, "sync");
		await thenAnswersError(seen, message, status);
		await thenCMetaHoldsExactly(page, kept, 'the conversations "a" and "b"');
	});
}

test("A response that is not JSON leaves the copy as it was", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const kept = [conv("a"), conv("b")];
	await givenCMetaHolds(page, kept, 'the conversations "a" and "b"');
	await test.step("And GET /v1/meta-all.json returns a body that is not JSON", () => {
		server.answer = (route) =>
			route.fulfill({ contentType: "application/json", body: "not json" });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersAnError(seen);
	await thenCMetaHoldsExactly(page, kept, 'the conversations "a" and "b"');
});

test("A failed request leaves the copy as it was", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const kept = [conv("a"), conv("b")];
	await givenCMetaHolds(page, kept, 'the conversations "a" and "b"');
	await test.step("And GET /v1/meta-all.json fails without a response", () => {
		server.answer = (route) => route.abort("failed");
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersAnError(seen);
	await thenCMetaHoldsExactly(page, kept, 'the conversations "a" and "b"');
});

test("A newer database is left alone", async ({ page, context }) => {
	const server = await background(page, context);
	const kept = [conv("a")];
	await test.step('Given the database "lcty_c" is at version 2 with the store "c_meta" holding the conversation "a"', async () => {
		await seedDb(page, 2, {
			c_meta: { keyPath: "id", records: kept.map((m) => [null, m]) },
		});
	});
	await test.step('And GET /v1/meta-all.json returns the conversation "b"', () => {
		server.answer = (route) => route.fulfill({ json: [conv("b")] });
	});
	const seen = await whenPosted(page, "sync");
	await thenAnswersAnError(seen);
	await test.step('And the database "lcty_c" is still at version 2', async () => {
		expect((await readDb(page)).version).toBe(2);
	});
	await thenCMetaHoldsExactly(page, kept, 'the conversation "a"');
});

// ---- Scenarios: reading ----

test("Getting before any sync finds no copy", async ({ page, context }) => {
	await background(page, context);
	await givenNoDatabase(page);
	const seen = await whenPosted(page, "get");
	await test.step("Then it answers no items and stale true", () => {
		expect(answerOf(seen)).toEqual({ result: { items: [], stale: true } });
	});
	await test.step('And there is still no database "lcty_c"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
});

test("Getting returns the copy newest first", async ({ page, context }) => {
	await background(page, context);
	const at = (id, time) => ({
		...conv(id),
		updated_at_hint: `2026-11-02T${time}:00.000Z`,
	});
	const stored = {
		a: at("a", "10:00"),
		b: at("b", "12:00"),
		c: at("c", "11:00"),
		d: at("d", "12:00"),
	};
	await givenCMetaHolds(
		page,
		Object.values(stored),
		'the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00',
	);
	const seen = await whenPosted(page, "get");
	await test.step('Then it answers "d", "b", "c" and "a" in that order, as stored, and stale false', () => {
		expect(answerOf(seen)).toEqual({
			result: {
				items: [stored.d, stored.b, stored.c, stored.a],
				stale: false,
			},
		});
	});
});

test("An unknown operation is an error", async ({ page, context }) => {
	const server = await background(page, context);
	let requested = false;
	server.answer = (route) => {
		requested = true;
		return route.fulfill({ json: [] });
	};
	const seen = await whenPosted(page, "nope");
	await thenAnswersError(seen, "unknown operation: nope", null);
	await test.step("And GET /v1/meta-all.json is not fetched", () => {
		expect(requested).toBe(false);
	});
});
