// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1001: the scenarios of LCTYSP-1001_sync-c-meta.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// The worker runs in a real browser on the test server's origin: the page is an empty document served by a route, so
// no page module runs a sync of its own, and every test gets a new browser context, so IndexedDB starts empty.
// GET /v1/meta-all.json is answered by a route too (routes also catch a worker's requests), so the server's data does
// not matter.

import { expect, test } from "@playwright/test";

const PAGE = "/__lcty_unit.html";
const WORKER_URL = "/js/sync_c_meta.worker.js";

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

/** The database "lcty" as it is: {exists, version, stores, items (of c_meta)}. Never creates it. */
function readDb(page) {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty");
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
	);
}

/** Create the database "lcty" at version with stores ({name: {keyPath?, records: [[key?, value]]}}). */
function seedDb(page, version, stores) {
	return page.evaluate(
		({ version, stores }) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty", version);
				req.onupgradeneeded = () => {
					const db = req.result;
					for (const [name, { keyPath, records }] of Object.entries(stores)) {
						const store = db.createObjectStore(
							name,
							keyPath ? { keyPath } : undefined,
						);
						for (const [key, value] of records)
							key === null ? store.put(value) : store.put(value, key);
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

/** c_meta at version 5, as the worker leaves it, holding items. */
function seedCMeta(page, items) {
	return seedDb(page, 5, {
		c_meta: { keyPath: "id", records: items.map((m) => [null, m]) },
	});
}

// ---- The worker ----

/**
 * Start the worker and collect what it sends until it has posted or failed, and for a little while after (so a
 * message after an error would be seen). The worker stays alive (window.lctyWorker) until stopWorker().
 */
function runWorker(page) {
	return page.evaluate(
		(url) =>
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
					seen.messages.push(
						e.data === undefined ? "undefined" : JSON.stringify(e.data),
					);
					settle();
				};
				worker.onerror = (e) => {
					e.preventDefault();
					seen.errors.push(e.message || "(no message)");
					settle();
				};
			}),
		WORKER_URL,
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
	await test.step('Given there is no database "lcty"', async () => {
		expect((await readDb(page)).exists).toBe(false);
	});
}

async function givenCMetaHolds(page, items, text) {
	await test.step(`Given "c_meta" holds ${text}`, async () => {
		await seedCMeta(page, items);
	});
}

async function whenTheWorkerRuns(page) {
	let seen;
	await test.step("When the worker runs", async () => {
		seen = await runWorker(page);
	});
	return seen;
}

async function thenItPostsUndefined(seen) {
	await test.step("Then it posts undefined", async () => {
		expect(seen.errors).toEqual([]);
		expect(seen.messages).toEqual(["undefined"]);
	});
}

async function thenTheErrorEventFires(seen, message) {
	const line = message
		? `Then the Worker's error event says "${message}"`
		: "Then the Worker's error event fires";
	await test.step(line, async () => {
		expect(seen.errors).toHaveLength(1);
		// Chromium prefixes the message with "Uncaught Error: ", WebKit with "Error: "
		if (message) expect(seen.errors[0]).toContain(message);
	});
	await test.step("And it posts nothing", async () => {
		expect(seen.messages).toEqual([]);
	});
}

async function thenOnlyCMetaAtVersion5(page) {
	await test.step('And the database "lcty" is at version 5 with only the store "c_meta"', async () => {
		const db = await readDb(page);
		expect(db.version).toBe(5);
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
	const seen = await whenTheWorkerRuns(page);
	await thenItPostsUndefined(seen);
	await thenOnlyCMetaAtVersion5(page);
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
	const seen = await whenTheWorkerRuns(page);
	await thenItPostsUndefined(seen);
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
	const seen = await whenTheWorkerRuns(page);
	await thenItPostsUndefined(seen);
	await test.step('And "c_meta" is empty', async () => {
		expect((await readDb(page)).items).toEqual([]);
	});
});

test("Upgrading a version 4 database drops the stores of the old worker", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const list = [conv("a")];
	await test.step('Given the database "lcty" is at version 4 with the stores "meta" and "sync", each holding a record', async () => {
		await seedDb(page, 4, {
			meta: { keyPath: "id", records: [[null, conv("old")]] },
			sync: { records: [["stale", "token"]] },
		});
		const db = await readDb(page);
		expect(db.version).toBe(4);
		expect(db.stores).toEqual(["meta", "sync"]);
	});
	await test.step('And GET /v1/meta-all.json returns the conversation "a"', () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	const seen = await whenTheWorkerRuns(page);
	await thenItPostsUndefined(seen);
	await thenOnlyCMetaAtVersion5(page);
	await thenCMetaHoldsExactly(page, list, 'the conversation "a", as returned');
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
	const seen = await whenTheWorkerRuns(page);
	await thenItPostsUndefined(seen);
	await test.step('And the database "lcty" can be opened at version 6 without being blocked, while the worker is still alive', async () => {
		const result = await page.evaluate(
			() =>
				new Promise((resolve) => {
					let blocked = false;
					const req = indexedDB.open("lcty", 6);
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

for (const { answer, message, fulfill } of [
	{
		answer: "answers with the status 500",
		message: "Failed to fetch /v1/meta-all.json: 500",
		fulfill: (route) => route.fulfill({ status: 500, body: "boom" }),
	},
	{
		answer: "returns an object, not a list",
		message: "meta-all.json is invalid",
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
		const seen = await whenTheWorkerRuns(page);
		await thenTheErrorEventFires(seen, message);
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
	const seen = await whenTheWorkerRuns(page);
	await thenTheErrorEventFires(seen);
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
	const seen = await whenTheWorkerRuns(page);
	await thenTheErrorEventFires(seen);
	await thenCMetaHoldsExactly(page, kept, 'the conversations "a" and "b"');
});

test("A newer database is left alone", async ({ page, context }) => {
	const server = await background(page, context);
	const kept = [conv("a")];
	await test.step('Given the database "lcty" is at version 6 with the store "c_meta" holding the conversation "a"', async () => {
		await seedDb(page, 6, {
			c_meta: { keyPath: "id", records: kept.map((m) => [null, m]) },
		});
	});
	await test.step('And GET /v1/meta-all.json returns the conversation "b"', () => {
		server.answer = (route) => route.fulfill({ json: [conv("b")] });
	});
	const seen = await whenTheWorkerRuns(page);
	await thenTheErrorEventFires(seen);
	await test.step('And the database "lcty" is still at version 6', async () => {
		expect((await readDb(page)).version).toBe(6);
	});
	await thenCMetaHoldsExactly(page, kept, 'the conversation "a"');
});
