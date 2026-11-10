// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1010: the scenarios of docs/specs/LCTYSP-1010_meta-db.feature, written by hand. Each test has the title of its
// Scenario and one test.step per line of it, so the two read side by side.
//
// js/api/meta-db.js runs in a real browser on the test server's origin, on the empty page of unit-page.js, with the
// real worker (LCTYSP-1001). The connection to /v1/rpc is a fake in the page (window.fakeRpc), whose answers the test
// sets in window.rpcAnswers: a result, {error} for a rejection, or "hold" to keep it until the test settles it through
// window.rpcHeld. Every test gets a new browser context: IndexedDB starts empty, and the module's state is new.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** A conversation's meta as c.list answers it (LCTYSP-0012), updated at the time given. */
function conv(cid, updated = "12:00") {
	return {
		cid,
		lang: "en",
		title: `Conversation ${cid}`,
		titleTypeId: "__64",
		updatedAt: `2026-11-02T${updated}:00.000Z`,
		createdAt: "2026-11-01T00:00:00.000Z",
	};
}

const list = (version, items) => ({ version, items });

// ---- Background ----

async function background(page, context) {
	await givenAPage(page, context);
	await page.evaluate(async () => {
		window.metaDb = await import("/js/api/meta-db.js");
		window.lctyCalls = [];
	});
	await test.step("And a connection whose answers to c.list and c.recordcount.list the test gives", async () => {
		await page.evaluate(() => {
			window.rpcCalls = [];
			window.rpcHeld = {};
			window.rpcAnswers = {};
			window.fakeRpc = {
				call: (method) =>
					new Promise((resolve, reject) => {
						window.rpcCalls.push(method);
						const a = window.rpcAnswers[method];
						if (a === "hold") window.rpcHeld[method] = { resolve, reject };
						else if (a?.error) reject(new Error(a.error));
						else resolve(a);
					}),
			};
		});
	});
}

function answer(page, answers) {
	return page.evaluate((answers) => {
		Object.assign(window.rpcAnswers, answers);
	}, answers);
}

/** Start readMetaDbFrom(fakeRpc); window.lctyRead says how it ended once it has. */
function startRead(page) {
	return page.evaluate(() => {
		window.lctyRead = null;
		window.metaDb.readMetaDbFrom(window.fakeRpc).then(
			() => {
				window.lctyRead = { resolved: true };
			},
			(e) => {
				window.lctyRead = { rejected: e.message };
			},
		);
	});
}

function readOutcome(page) {
	return expect.poll(() => page.evaluate(() => window.lctyRead));
}

function readMetaDb(page) {
	return page.evaluate(() => window.metaDb.readMetaDb());
}

const cids = (r) => r.items.map((m) => m.cid);

function calls(page) {
	return page.evaluate(() => window.lctyCalls);
}

function addListener(page) {
	return page.evaluate(() =>
		window.metaDb.onMetaDbChange(() => window.lctyCalls.push("change")),
	);
}

function applyBatch(page, params) {
	return page.evaluate((p) => window.metaDb.applyMetaBatch(p), params);
}

/** The database "lcty_c" as it is: {exists, version}. Never creates it. */
function dbInfo(page) {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_c");
				req.onupgradeneeded = () => req.transaction.abort();
				req.onerror = () =>
					req.error?.name === "AbortError"
						? resolve({ exists: false })
						: reject(req.error);
				req.onsuccess = () => {
					const info = { exists: true, version: req.result.version };
					req.result.close();
					resolve(info);
				};
			}),
	);
}

/** Read the lists once, with only items as the meta at version, and no counts. */
async function givenRead(page, items, version) {
	const text = `"${items.map((m) => m.cid).join('", "')}"`;
	await test.step(`Given the lists have been read with ${text} at "${version}"`, async () => {
		await answer(page, {
			"c.list": list(version, items),
			"c.recordcount.list": list(version, []),
		});
		await page.evaluate(() => window.metaDb.readMetaDbFrom(window.fakeRpc));
	});
}

async function andListener(page) {
	await test.step("And a listener is registered with onMetaDbChange", () =>
		addListener(page));
}

// ---- Scenarios ----

test("Reading before any list finds no copy", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given there is no database "lcty_c"', async () => {
		expect((await dbInfo(page)).exists).toBe(false);
	});
	let r;
	await test.step("When readMetaDb() reads the copies", async () => {
		r = await readMetaDb(page);
	});
	await test.step("Then it returns no items, no counts and stale true", () => {
		expect(r).toEqual({ items: [], counts: {}, stale: true });
	});
	await test.step('And there is still no database "lcty_c"', async () => {
		expect((await dbInfo(page)).exists).toBe(false);
	});
});

test("Reading the lists stores the meta and the counts", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given c.list answers "a" updated at 10:00 and "b" at 12:00, and c.recordcount.list 2 of "a", both at "b1.5"', () =>
		answer(page, {
			"c.list": list("b1.5", [conv("a", "10:00"), conv("b", "12:00")]),
			"c.recordcount.list": list("b1.5", [{ cid: "a", count: 2 }]),
		}));
	await andListener(page);
	await test.step("When readMetaDbFrom(the connection) is called", () =>
		startRead(page));
	await test.step("Then it resolves after c.list and then c.recordcount.list were called once each", async () => {
		await readOutcome(page).toEqual({ resolved: true });
		expect(await page.evaluate(() => window.rpcCalls)).toEqual([
			"c.list",
			"c.recordcount.list",
		]);
	});
	await test.step('And readMetaDb() returns "b" and "a" in that order, the counts 2 of "a", and stale false', async () => {
		const r = await readMetaDb(page);
		expect(cids(r)).toEqual(["b", "a"]);
		expect(r.counts).toEqual({ a: 2 });
		expect(r.stale).toBe(false);
	});
	await test.step("And the listener was called once", async () => {
		expect(await calls(page)).toEqual(["change"]);
	});
});

test("A notification that arrives while the lists are read is written after them", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given c.list is held until the test answers it", () =>
		answer(page, { "c.list": "hold" }));
	await test.step("When readMetaDbFrom(the connection) is called", async () => {
		await startRead(page);
		await expect
			.poll(() => page.evaluate(() => Boolean(window.rpcHeld["c.list"])))
			.toBe(true);
	});
	await test.step('And applyMetaBatch() is given a c_meta put of "c" at "b1.6"', () =>
		applyBatch(page, {
			version: "b1.6",
			actorId: null,
			records: [{ store: "c_meta", op: "put", row: conv("c", "13:00") }],
		}));
	await test.step('And c.list answers "a" at "b1.5" and c.recordcount.list nothing at "b1.5"', async () => {
		await answer(page, { "c.recordcount.list": list("b1.5", []) });
		await page.evaluate(() =>
			window.rpcHeld["c.list"].resolve({
				version: "b1.5",
				items: [
					{
						cid: "a",
						lang: "en",
						title: "Conversation a",
						titleTypeId: "__64",
						updatedAt: "2026-11-02T12:00:00.000Z",
						createdAt: "2026-11-01T00:00:00.000Z",
					},
				],
			}),
		);
	});
	await test.step("Then readMetaDbFrom resolves", async () => {
		await readOutcome(page).toEqual({ resolved: true });
	});
	await test.step('And readMetaDb() returns "c" and "a"', async () => {
		await expect
			.poll(async () => cids(await readMetaDb(page)))
			.toEqual(["c", "a"]);
	});
});

test("A notification after the lists is written and calls the listeners", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenRead(page, [conv("a", "10:00")], "b1.5");
	await andListener(page);
	await test.step('When applyMetaBatch() is given a c_meta put of "b" at "b1.6" and a c_recordcount put of 3 of "b"', () =>
		applyBatch(page, {
			version: "b1.6",
			actorId: null,
			records: [
				{ store: "c_meta", op: "put", row: conv("b", "12:00") },
				{ store: "c_recordcount", op: "put", row: { cid: "b", count: 3 } },
			],
		}));
	await test.step('Then readMetaDb() returns "b" and "a" and the counts 3 of "b"', async () => {
		await expect
			.poll(async () => {
				const r = await readMetaDb(page);
				return { cids: cids(r), counts: r.counts };
			})
			.toEqual({ cids: ["b", "a"], counts: { b: 3 } });
	});
	await test.step("And the listener was called once", async () => {
		await expect.poll(() => calls(page)).toEqual(["change"]);
	});
});

test("A notification older than the copy is left and calls no listener", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenRead(page, [conv("a")], "b1.6");
	await andListener(page);
	await test.step('When applyMetaBatch() is given a c_meta put of "b" at "b1.5"', () =>
		applyBatch(page, {
			version: "b1.5",
			actorId: null,
			records: [{ store: "c_meta", op: "put", row: conv("b") }],
		}));
	let r;
	await test.step("And readMetaDb() has been called after it", async () => {
		r = await readMetaDb(page); // the operations of a tab run in order: the apply has ended
	});
	await test.step('Then readMetaDb() returns only "a"', () => {
		expect(cids(r)).toEqual(["a"]);
	});
	await test.step("And the listener was not called", async () => {
		expect(await calls(page)).toEqual([]);
	});
});

test("A failed read rejects and keeps the copies", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenRead(page, [conv("a")], "b1.5");
	await andListener(page);
	await test.step('And c.list fails with "the connection was lost"', () =>
		answer(page, { "c.list": { error: "the connection was lost" } }));
	await test.step("When readMetaDbFrom(the connection) is called", () =>
		startRead(page));
	await test.step('Then it rejects with "the connection was lost"', async () => {
		await readOutcome(page).toEqual({ rejected: "the connection was lost" });
	});
	await test.step('And readMetaDb() returns only "a"', async () => {
		expect(cids(await readMetaDb(page))).toEqual(["a"]);
	});
	await test.step("And the listener was not called", async () => {
		expect(await calls(page)).toEqual([]);
	});
});

test("A notification held during a failed read is still written", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenRead(page, [conv("a", "10:00")], "b1.5");
	await test.step("And c.list is held until the test answers it", () =>
		answer(page, { "c.list": "hold" }));
	await test.step("When readMetaDbFrom(the connection) is called", async () => {
		await page.evaluate(() => {
			window.rpcHeld = {};
		});
		await startRead(page);
		await expect
			.poll(() => page.evaluate(() => Boolean(window.rpcHeld["c.list"])))
			.toBe(true);
	});
	await test.step('And applyMetaBatch() is given a c_meta put of "b" at "b1.6"', () =>
		applyBatch(page, {
			version: "b1.6",
			actorId: null,
			records: [{ store: "c_meta", op: "put", row: conv("b", "12:00") }],
		}));
	await test.step('And c.list fails with "the connection was lost"', () =>
		page.evaluate(() =>
			window.rpcHeld["c.list"].reject(new Error("the connection was lost")),
		));
	await test.step("Then readMetaDbFrom rejects", async () => {
		await readOutcome(page).toEqual({ rejected: "the connection was lost" });
	});
	await test.step('And readMetaDb() returns "b" and "a"', async () => {
		await expect
			.poll(async () => cids(await readMetaDb(page)))
			.toEqual(["b", "a"]);
	});
});

test("A listener that throws does not stop the others", async ({
	page,
	context,
}) => {
	const warnings = [];
	page.on("console", (msg) => {
		if (msg.type() === "warning") warnings.push(msg.text());
	});
	await background(page, context);
	await test.step("Given a listener that throws is registered with onMetaDbChange", () =>
		page.evaluate(() =>
			window.metaDb.onMetaDbChange(() => {
				throw new Error("listener broke");
			}),
		));
	await test.step("And a second listener is registered with onMetaDbChange", () =>
		addListener(page));
	await test.step('And c.list answers "a" and c.recordcount.list nothing, both at "b1.5"', () =>
		answer(page, {
			"c.list": list("b1.5", [conv("a")]),
			"c.recordcount.list": list("b1.5", []),
		}));
	await test.step("When readMetaDbFrom(the connection) is called", () =>
		startRead(page));
	await test.step("Then it resolves", async () => {
		await readOutcome(page).toEqual({ resolved: true });
	});
	await test.step("And the second listener was called once", async () => {
		expect(await calls(page)).toEqual(["change"]);
	});
	await test.step("And the error of the first listener is logged as a warning", async () => {
		await expect
			.poll(() => warnings.some((w) => w.includes("listener broke")))
			.toBe(true);
	});
});

test("Reading leaves no connection open", async ({ page, context }) => {
	await background(page, context);
	await givenRead(page, [conv("a")], "b1.5");
	await test.step("When readMetaDb() reads the copies", () => readMetaDb(page));
	await test.step('Then the database "lcty_c" can be opened at version 3 without being blocked', async () => {
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
