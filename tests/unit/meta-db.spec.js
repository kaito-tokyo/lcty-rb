// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1010: the scenarios of docs/specs/LCTYSP-1010_meta-db.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/api/meta-db.js runs in a real browser on the test server's origin, on the empty page of unit-page.js, with the
// real sync worker (LCTYSP-1001). GET /v1/meta-all.json is answered by a route (it also catches the worker's request),
// so the server's data does not matter. Every test gets a new browser context: IndexedDB and localStorage start empty,
// and the module's state (the running sync, the listeners) is new.

import { expect, test } from "@playwright/test";
import { givenAPage, UNIT_PAGE } from "./unit-page.js";

const SNAPSHOT_KEY = "lcty.meta.v1";

/** A conversation's meta as GET /v1/meta-all.json returns it (LCTYSP-0006), updated at the time given. */
function conv(id, updated = "12:00", title = `Conversation ${id}`) {
	return {
		id,
		title,
		created_at: "2026-11-01T00:00:00.000Z",
		updated_at_hint: `2026-11-02T${updated}:00.000Z`,
		setup_tags: ["setup"],
		tags_hint: ["tag"],
		messages_hint: 2,
	};
}

const ids = (items) => items.map((m) => m.id);

// ---- Background ----

/**
 * The page with the module loaded (window.metaDb) and GET /v1/meta-all.json answered by the test: by the next of
 * server.queue, or else by server.answer. server.requests counts the requests.
 */
async function background(page, context) {
	const server = {
		requests: 0,
		queue: [],
		answer: (route) => route.fulfill({ json: [] }),
	};
	await givenAPage(page, context);
	await page.evaluate(async () => {
		window.metaDb = await import("/js/api/meta-db.js");
		window.lctyCalls = [];
	});
	await test.step("And GET /v1/meta-all.json is answered by the test", async () => {
		await context.route("**/v1/meta-all.json", (route) => {
			server.requests++;
			return (server.queue.shift() || server.answer)(route);
		});
	});
	return server;
}

/** The warnings the page logs. */
function collectWarnings(page) {
	const warnings = [];
	page.on("console", (msg) => {
		if (msg.type() === "warning") warnings.push(msg.text());
	});
	return warnings;
}

// ---- The database, from the page ----

/** The database name ("lcty_c" by default) as it is: {exists, version, stores}. Never creates it. */
function dbInfo(page, name = "lcty_c") {
	return page.evaluate(
		(name) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open(name);
				req.onupgradeneeded = () => req.transaction.abort();
				req.onerror = () =>
					req.error?.name === "AbortError"
						? resolve({ exists: false })
						: reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					const info = {
						exists: true,
						version: db.version,
						stores: [...db.objectStoreNames].sort(),
					};
					db.close();
					resolve(info);
				};
			}),
		name,
	);
}

/** Create the database name ("lcty_c" by default) at version with stores ({store: {keyPath?, records: [value]}}). */
function seedDb(page, version, stores, name = "lcty_c") {
	return page.evaluate(
		({ version, stores, name }) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open(name, version);
				req.onupgradeneeded = () => {
					for (const [store, { keyPath, records }] of Object.entries(stores)) {
						const os = req.result.createObjectStore(
							store,
							keyPath ? { keyPath } : { autoIncrement: true },
						);
						for (const value of records) os.put(value);
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
	return seedDb(page, 1, { c_meta: { keyPath: "id", records: items } });
}

function readMetaDb(page) {
	return page.evaluate(() => window.metaDb.readMetaDb());
}

function snapshot(page) {
	return page.evaluate((key) => localStorage.getItem(key), SNAPSHOT_KEY);
}

function calls(page) {
	return page.evaluate(() => window.lctyCalls);
}

/** Start resetMetaDb() n times; window.lctyResults[i] says how call i ended once it has. */
function startResets(page, n) {
	return page.evaluate((n) => {
		window.lctyResults = [];
		window.lctyPromises = Array.from({ length: n }, () =>
			window.metaDb.resetMetaDb(),
		);
		window.lctyPromises.forEach((p, i) => {
			p.then(
				() => {
					window.lctyResults[i] = { resolved: true };
				},
				(e) => {
					window.lctyResults[i] = { rejected: e.message };
				},
			);
		});
	}, n);
}

/** How the reset calls ended, once all n have. */
async function resetResults(page, n) {
	await page.waitForFunction(
		(n) => window.lctyResults.filter(Boolean).length === n,
		n,
	);
	return page.evaluate(() => window.lctyResults);
}

// ---- Steps shared by the scenarios ----

async function givenNoDatabase(page) {
	await test.step('Given there is no database "lcty_c"', async () => {
		expect((await dbInfo(page)).exists).toBe(false);
	});
}

async function givenCMetaHolds(page, items, text, keyword = "Given") {
	await test.step(`${keyword} "c_meta" holds ${text}`, async () => {
		await seedCMeta(page, items);
	});
}

async function givenAnOldSnapshot(page, keyword = "And") {
	await test.step(`${keyword} localStorage "lcty.meta.v1" holds an old snapshot`, async () => {
		await page.evaluate(
			(key) => localStorage.setItem(key, JSON.stringify([{ id: "old" }])),
			SNAPSHOT_KEY,
		);
	});
}

async function givenAListener(page, keyword = "And") {
	await test.step(`${keyword} a listener is registered with onMetaDbChange`, async () => {
		await page.evaluate(() =>
			window.metaDb.onMetaDbChange(() => window.lctyCalls.push("listener")),
		);
	});
}

async function givenMetaAllReturns(server, items, text) {
	await test.step(`And GET /v1/meta-all.json returns ${text}`, () => {
		server.answer = (route) => route.fulfill({ json: items });
	});
}

async function whenReadMetaDb(page) {
	let result;
	await test.step("When readMetaDb() reads the copy", async () => {
		result = await readMetaDb(page);
	});
	return result;
}

async function thenNoItemsAndStale(result) {
	await test.step("Then it returns no items and stale true", () => {
		expect(result).toEqual({ items: [], stale: true });
	});
}

async function whenResetResolves(page) {
	await test.step("When resetMetaDb() is called", async () => {
		await startResets(page, 1);
	});
	await test.step("Then it resolves", async () => {
		expect(await resetResults(page, 1)).toEqual([{ resolved: true }]);
	});
}

async function thenReadMetaDbReturns(page, expected, text) {
	await test.step(`And readMetaDb() returns ${text}`, async () => {
		const { items, stale } = await readMetaDb(page);
		expect(stale).toBe(false);
		expect(items).toEqual(expected);
	});
}

async function thenNoSnapshot(page) {
	await test.step('And localStorage has no "lcty.meta.v1"', async () => {
		expect(await snapshot(page)).toBeNull();
	});
}

async function thenListenerNotCalled(page, keyword = "And") {
	await test.step(`${keyword} the listener was not called`, async () => {
		await page.waitForTimeout(300);
		expect(await calls(page)).toEqual([]);
	});
}

/**
 * Another document of the same origin (a frame of the unit page, as another tab would be) writes localStorage key.
 * The storage event reaches every other document of the origin; a frame is used because WebKit does not deliver it
 * to a second page of the test's browser context.
 */
function writeInAnotherDocument(page, key) {
	return page.evaluate(
		({ url, key }) =>
			new Promise((resolve) => {
				const frame = document.createElement("iframe");
				frame.onload = () => {
					frame.contentWindow.localStorage.setItem(
						key,
						JSON.stringify([{ id: "x" }]),
					);
					resolve();
				};
				frame.src = url;
				document.body.append(frame);
			}),
		{ url: UNIT_PAGE, key },
	);
}

// ---- Scenarios ----

test("Reading before any sync finds no copy", async ({ page, context }) => {
	await background(page, context);
	await givenNoDatabase(page);
	const result = await whenReadMetaDb(page);
	await thenNoItemsAndStale(result);
	await test.step('And there is still no database "lcty_c"', async () => {
		expect((await dbInfo(page)).exists).toBe(false);
	});
});

test("Reading does not read the old database lcty", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the database "lcty" is at version 5 with the store "c_meta" holding the conversation "a"', async () => {
		await seedDb(
			page,
			5,
			{ c_meta: { keyPath: "id", records: [conv("a")] } },
			"lcty",
		);
	});
	await test.step('And there is no database "lcty_c"', async () => {
		expect((await dbInfo(page)).exists).toBe(false);
	});
	const result = await whenReadMetaDb(page);
	await thenNoItemsAndStale(result);
	await test.step('And there is still no database "lcty_c"', async () => {
		expect((await dbInfo(page)).exists).toBe(false);
	});
});

test("Reading returns the copy newest first", async ({ page, context }) => {
	await background(page, context);
	const stored = {
		a: conv("a", "10:00"),
		b: conv("b", "12:00"),
		c: conv("c", "11:00"),
		d: conv("d", "12:00"),
	};
	await givenCMetaHolds(
		page,
		Object.values(stored),
		'the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00',
	);
	const result = await whenReadMetaDb(page);
	await test.step('Then it returns "d", "b", "c" and "a" in that order, as stored, and stale false', () => {
		expect(result).toEqual({
			items: [stored.d, stored.b, stored.c, stored.a],
			stale: false,
		});
	});
});

test("Reading leaves no connection open", async ({ page, context }) => {
	await background(page, context);
	await givenCMetaHolds(page, [conv("a")], 'the conversation "a"');
	await whenReadMetaDb(page);
	await test.step('Then the database "lcty_c" can be opened at version 2 without being blocked', async () => {
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

test("A reset syncs at once", async ({ page, context }) => {
	const server = await background(page, context);
	const list = [conv("a", "10:00"), conv("b", "11:00")];
	await givenNoDatabase(page);
	await givenMetaAllReturns(server, list, 'the conversations "a" and "b"');
	await givenAListener(page);
	await test.step("When resetMetaDb() is called", async () => {
		await startResets(page, 1);
	});
	await test.step("Then it resolves after GET /v1/meta-all.json was requested once", async () => {
		expect(await resetResults(page, 1)).toEqual([{ resolved: true }]);
		expect(server.requests).toBe(1);
	});
	await test.step('And readMetaDb() returns the conversations "a" and "b" and stale false', async () => {
		expect(await readMetaDb(page)).toEqual({
			items: [list[1], list[0]],
			stale: false,
		});
	});
	await test.step("And the listener was called once", async () => {
		expect(await calls(page)).toEqual(["listener"]);
	});
});

test("A sync writes a snapshot of the newest 20 conversations", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	// updated at 00:00, 00:01, …, 00:24, in a shuffled order
	const list = Array.from({ length: 25 }, (_, i) =>
		conv(`c${String(i).padStart(2, "0")}`, `00:${String(i).padStart(2, "0")}`),
	).sort(
		(a, b) => ((a.id.charCodeAt(2) * 7) % 25) - ((b.id.charCodeAt(2) * 7) % 25),
	);
	await test.step("Given GET /v1/meta-all.json returns 25 conversations, each updated at a different time", () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	await test.step("When resetMetaDb() is called", async () => {
		await startResets(page, 1);
		expect(await resetResults(page, 1)).toEqual([{ resolved: true }]);
	});
	let entries;
	await test.step('Then localStorage "lcty.meta.v1" holds the newest 20 of them, newest first', async () => {
		entries = JSON.parse(await snapshot(page));
		expect(ids(entries)).toEqual(
			Array.from(
				{ length: 20 },
				(_, i) => `c${String(24 - i).padStart(2, "0")}`,
			),
		);
	});
	await test.step("And each entry has only id, title, updated_at_hint, tags_hint and messages_hint", () => {
		for (const entry of entries) {
			const { id, title, updated_at_hint, tags_hint, messages_hint } =
				list.find((m) => m.id === entry.id);
			expect(entry).toEqual({
				id,
				title,
				updated_at_hint,
				tags_hint,
				messages_hint,
			});
		}
	});
});

test("A snapshot that does not fit is removed", async ({ page, context }) => {
	const server = await background(page, context);
	// 20 titles of 500,000 characters: 10 million characters, more than localStorage takes in Chromium or WebKit
	const list = Array.from({ length: 20 }, (_, i) =>
		conv(
			`c${String(i).padStart(2, "0")}`,
			`00:${String(i).padStart(2, "0")}`,
			String(i % 10).repeat(500000),
		),
	);
	await givenAnOldSnapshot(page, "Given");
	await test.step("And GET /v1/meta-all.json returns 20 conversations whose titles together are too large for localStorage", () => {
		server.answer = (route) => route.fulfill({ json: list });
	});
	await whenResetResolves(page);
	await thenNoSnapshot(page);
	await test.step("And readMetaDb() returns the 20 conversations", async () => {
		const { items, stale } = await page.evaluate(async () => {
			const { items, stale } = await window.metaDb.readMetaDb();
			return {
				items: items.map((m) => ({ id: m.id, length: m.title.length })),
				stale,
			};
		});
		expect(stale).toBe(false);
		expect(items).toEqual(
			[...list].reverse().map((m) => ({ id: m.id, length: 500000 })),
		);
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
	test(`A failed reset rejects with the worker's error and keeps the copy (${answer})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		const kept = [conv("a", "10:00"), conv("b", "11:00")];
		await givenCMetaHolds(page, kept, 'the conversations "a" and "b"');
		await givenAnOldSnapshot(page);
		await givenAListener(page);
		await test.step(`And GET /v1/meta-all.json ${answer}`, () => {
			server.answer = fulfill;
		});
		await test.step("When resetMetaDb() is called", async () => {
			await startResets(page, 1);
		});
		await test.step(`Then it rejects with an error whose message has "${message}" and does not start with "Uncaught"`, async () => {
			const [result] = await resetResults(page, 1);
			expect(result.rejected).toContain(message);
			expect(result.rejected).not.toMatch(/^Uncaught/);
		});
		await thenNoSnapshot(page);
		await thenReadMetaDbReturns(
			page,
			[kept[1], kept[0]],
			'the conversations "a" and "b"',
		);
		await thenListenerNotCalled(page);
	});
}

test("Resets made during a sync share one sync after it", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const held = [];
	await test.step("Given GET /v1/meta-all.json is held until the test answers it", () => {
		server.answer = (route) => {
			held.push(route);
		};
	});
	await test.step("When resetMetaDb() is called three times", async () => {
		await startResets(page, 3);
	});
	await test.step("Then GET /v1/meta-all.json has been requested once", async () => {
		await expect.poll(() => server.requests).toBe(1);
		await page.waitForTimeout(300);
		expect(server.requests).toBe(1);
	});
	await test.step("And the second and the third call return the same promise", async () => {
		expect(
			await page.evaluate(
				() => window.lctyPromises[1] === window.lctyPromises[2],
			),
		).toBe(true);
	});
	await test.step('When the first request is answered with the conversation "a"', async () => {
		await held[0].fulfill({ json: [conv("a")] });
	});
	await test.step("Then GET /v1/meta-all.json is requested a second time", async () => {
		await expect.poll(() => held.length).toBe(2);
	});
	await test.step('When the second request is answered with the conversation "b"', async () => {
		await held[1].fulfill({ json: [conv("b")] });
	});
	await test.step("Then all three calls resolve", async () => {
		expect(await resetResults(page, 3)).toEqual([
			{ resolved: true },
			{ resolved: true },
			{ resolved: true },
		]);
		expect(server.requests).toBe(2);
	});
	await thenReadMetaDbReturns(page, [conv("b")], 'only the conversation "b"');
});

test("A sync queued after a failed one still runs", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step('Given GET /v1/meta-all.json answers with the status 500 first and returns the conversation "a" next', () => {
		server.queue.push((route) => route.fulfill({ status: 500, body: "boom" }));
		server.answer = (route) => route.fulfill({ json: [conv("a")] });
	});
	await test.step("When resetMetaDb() is called twice at once", async () => {
		await startResets(page, 2);
	});
	await test.step("Then the first call rejects and the second resolves", async () => {
		const [first, second] = await resetResults(page, 2);
		expect(first.rejected).toContain("Failed to fetch /v1/meta-all.json: 500");
		expect(second).toEqual({ resolved: true });
	});
	await thenReadMetaDbReturns(page, [conv("a")], 'only the conversation "a"');
});

test("Requests made before the browser is idle share one sync", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step('Given GET /v1/meta-all.json returns the conversation "a"', () => {
		server.answer = (route) => route.fulfill({ json: [conv("a")] });
	});
	await givenAListener(page);
	await test.step("When requestMetaDbSync() is called three times", async () => {
		await page.evaluate(() => {
			window.metaDb.requestMetaDbSync();
			window.metaDb.requestMetaDbSync();
			window.metaDb.requestMetaDbSync();
		});
	});
	await test.step("Then the listener is called once", async () => {
		await page.waitForFunction(() => window.lctyCalls.length > 0);
		await page.waitForTimeout(500);
		expect(await calls(page)).toEqual(["listener"]);
	});
	await test.step("And GET /v1/meta-all.json was requested once", () => {
		expect(server.requests).toBe(1);
	});
	await thenReadMetaDbReturns(page, [conv("a")], 'only the conversation "a"');
});

test("A request after a finished sync syncs again", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const both = [conv("a", "10:00"), conv("b", "11:00")];
	await test.step('Given GET /v1/meta-all.json returns the conversation "a" first and the conversations "a" and "b" next', () => {
		server.queue.push((route) => route.fulfill({ json: [conv("a", "10:00")] }));
		server.answer = (route) => route.fulfill({ json: both });
	});
	await givenAListener(page);
	await test.step("When requestMetaDbSync() is called and the listener has been called", async () => {
		await page.evaluate(() => window.metaDb.requestMetaDbSync());
		await page.waitForFunction(() => window.lctyCalls.length === 1);
	});
	await test.step("And requestMetaDbSync() is called again", async () => {
		await page.evaluate(() => window.metaDb.requestMetaDbSync());
	});
	await test.step("Then the listener is called a second time", async () => {
		await page.waitForFunction(() => window.lctyCalls.length === 2);
	});
	await test.step("And GET /v1/meta-all.json was requested twice", () => {
		expect(server.requests).toBe(2);
	});
	await test.step('And readMetaDb() returns the conversations "a" and "b" and stale false', async () => {
		expect(await readMetaDb(page)).toEqual({
			items: [both[1], both[0]],
			stale: false,
		});
	});
});

test("A failed requested sync is only logged", async ({ page, context }) => {
	const server = await background(page, context);
	const warnings = collectWarnings(page);
	await givenCMetaHolds(page, [conv("a")], 'the conversation "a"');
	await test.step("And GET /v1/meta-all.json answers with the status 500", () => {
		server.answer = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	await givenAListener(page);
	await test.step("When requestMetaDbSync() is called", async () => {
		await page.evaluate(() => window.metaDb.requestMetaDbSync());
	});
	await test.step('Then the warning "the meta of the conversations could not be synced" is logged', async () => {
		await expect
			.poll(() =>
				warnings.some((w) =>
					w.includes("the meta of the conversations could not be synced"),
				),
			)
			.toBe(true);
	});
	await thenListenerNotCalled(page);
	await thenReadMetaDbReturns(page, [conv("a")], 'only the conversation "a"');
});

test("A listener that throws does not stop the others", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const warnings = collectWarnings(page);
	await test.step("Given a listener that throws is registered with onMetaDbChange", async () => {
		await page.evaluate(() =>
			window.metaDb.onMetaDbChange(() => {
				throw new Error("the first listener failed");
			}),
		);
	});
	await test.step("And a second listener is registered with onMetaDbChange", async () => {
		await page.evaluate(() =>
			window.metaDb.onMetaDbChange(() => window.lctyCalls.push("second")),
		);
	});
	await test.step('And GET /v1/meta-all.json returns the conversation "a"', () => {
		server.answer = (route) => route.fulfill({ json: [conv("a")] });
	});
	await whenResetResolves(page);
	await test.step("And the second listener was called once", async () => {
		expect(await calls(page)).toEqual(["second"]);
	});
	await test.step("And the error of the first listener is logged as a warning", async () => {
		await expect
			.poll(() => warnings.some((w) => w.includes("the first listener failed")))
			.toBe(true);
	});
});

test("A snapshot written in another document notifies the listeners", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenAListener(page, "Given");
	await test.step('When another document of the same origin writes localStorage "lcty.meta.v1"', async () => {
		await writeInAnotherDocument(page, SNAPSHOT_KEY);
	});
	await test.step("Then the listener is called once", async () => {
		await page.waitForFunction(() => window.lctyCalls.length > 0);
		await page.waitForTimeout(300);
		expect(await calls(page)).toEqual(["listener"]);
	});
	await test.step("And GET /v1/meta-all.json was not requested", () => {
		expect(server.requests).toBe(0);
	});
});

test("Other keys written in another document do not notify the listeners", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAListener(page, "Given");
	await test.step('When another document of the same origin writes localStorage "lcty.other"', async () => {
		await writeInAnotherDocument(page, "lcty.other");
	});
	await thenListenerNotCalled(page, "Then");
});
