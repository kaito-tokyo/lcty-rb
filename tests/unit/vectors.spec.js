// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1011: the scenarios of docs/specs/LCTYSP-1011_vector-store.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by
// side.
//
// js/search/vectors.js runs in a real browser on the test server's origin, on the empty page of unit-page.js, with the
// real worker /fuzzy_search.worker.js (LCTYSP-1013). The distribution files are answered by routes (they also catch the
// worker's requests), built by the test in the layout of LCTYSP-0008; a route also counts the requests of the worker's
// script. Typed arrays cross from the page as hex or plain arrays.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const DAT = "/v1/vectors.eg2_264.dat";
const IDX = "/v1/vectors.eg2_264.idx";
const REC = 1056; // a row of the distribution files
// the control block of registration: "lctyvLE0", 3072 as uint32 LE, a reserved 0 (LCTYSP-3006)
const CONTROL = "6c637479764c4530" + "000c0000" + "00000000";
const ID = "0190f3a1-7c2e-7abc-8def-0123456789ab";

/** The UUIDv7 of a short name ("a" → 019a0000-0000-7000-8000-000000000061). */
function uuid(name) {
	const hex = Buffer.from(name).toString("hex").padStart(12, "0");
	return `019a0000-0000-7000-8000-${hex}`;
}

const nameOf = (id) =>
	Buffer.from(id.slice(24).replace(/^(00)+/, ""), "hex").toString();
const named = (results) => results.map(([id, score]) => [nameOf(id), score]);

/** The pair of distribution files of rows [name, first values]. */
function files(rows) {
	const f = new Float32Array((rows.length * REC) / 4);
	rows.forEach(([, values], i) => {
		f.set([values].flat(), (i * REC) / 4);
	});
	return {
		dat: Buffer.from(f.buffer),
		idx: Buffer.concat(
			rows.map(([n]) => Buffer.from(uuid(n).replace(/-/g, ""), "hex")),
		),
	};
}

const ROWS_ABCDA = [
	["a", 0.25],
	["b", 0.5],
	["c", 0.75],
	["d", 0.125],
	["a", 0.875],
];
const ROWS_ABCDA_TEXT =
	'the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875';
const ROWS_AB = [
	["a", 0.25],
	["b", 0.5],
];

/** A 768-dimension query: 1 in its first dimension, or the values given at their indices. */
function query(values = { 0: 1 }, length = 768) {
	return Array.from({ length }, (_, i) => values[i] ?? 0);
}

/** A vector of n Float32 values that are all different and exact. */
const vector = (n, seed = 0) =>
	Array.from({ length: n }, (_, i) => (i - 300) / 8 + seed);

/** Bytes of Float32 LE as hex. */
const f32hex = (values) =>
	Buffer.from(Float32Array.from(values).buffer).toString("hex");

// ---- Background ----

/**
 * The page with the module loaded (window.lctyVectors) and the files answered by the test. server.files is the pair,
 * server.etag the ETag of both (or null), server.fail a route answer per file that replaces it, server.worker the
 * answer of /fuzzy_search.worker.js (by default the real file); server.requests counts the requests.
 */
async function background(page, context) {
	const server = {
		files: { dat: Buffer.alloc(0), idx: Buffer.alloc(0) },
		etag: null,
		fail: {},
		worker: (route) => route.continue(),
		requests: { dat: 0, idx: 0, worker: 0 },
	};
	await givenAPage(page, context);
	await page.evaluate(async () => {
		window.lctyVectors = await import("/js/search/vectors.js");
	});
	await test.step("And /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx are answered by the test", async () => {
		for (const [key, path] of [
			["dat", DAT],
			["idx", IDX],
		]) {
			await context.route(`**${path}`, (route) => {
				server.requests[key]++;
				if (server.fail[key]) return server.fail[key](route);
				return route.fulfill({
					status: 200,
					contentType: "application/octet-stream",
					headers: server.etag ? { ETag: server.etag } : {},
					body: server.files[key],
				});
			});
		}
		await context.route("**/fuzzy_search.worker.js", (route) => {
			server.requests.worker++;
			return server.worker(route);
		});
	});
	return server;
}

// ---- encodeRecords, from the page ----

/** encodeRecords of items [{id, vec: values, view?}], as {hex, size, count} or {error}. */
function encode(page, items) {
	return page.evaluate((items) => {
		try {
			const { body, size, count } = window.lctyVectors.encodeRecords(
				items.map(({ id, vec, view }) => ({
					id,
					vec: view
						? Float32Array.from({ length: view.length }, (_, i) => i).subarray(
								view.from,
								view.from + 768,
							)
						: Float32Array.from(vec),
				})),
			);
			const hex = [...body]
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
			return { isUint8Array: body instanceof Uint8Array, hex, size, count };
		} catch (e) {
			return { error: e.message };
		}
	}, items);
}

// ---- The store, from the page ----

function makeStore(page) {
	return page.evaluate(() => {
		window.lctyStore = window.lctyVectors.createVectorStore();
	});
}

function refresh(page) {
	return page.evaluate(() =>
		window.lctyStore.refresh().then(
			() => ({ resolved: true, size: window.lctyStore.size }),
			(e) => ({ rejected: e.message, size: window.lctyStore.size }),
		),
	);
}

function size(page) {
	return page.evaluate(() => window.lctyStore.size);
}

/** store.search(q, k, {allow, accept}); accept is {only} or {reject} (a name), and the ids it is asked are kept. */
function search(page, q, k, { allow, accept } = {}) {
	return page.evaluate(
		({ q, k, allow, accept }) => {
			window.lctyAsked = [];
			const options = {};
			if (allow) options.allow = allow;
			if (accept)
				options.accept = (id) => {
					window.lctyAsked.push(id);
					return accept.only ? id === accept.only : id !== accept.reject;
				};
			return window.lctyStore.search(Float32Array.from(q), k, options).then(
				(results) => ({ results }),
				(e) => ({ rejected: e.message }),
			);
		},
		{ q, k, allow, accept },
	);
}

test.afterEach(async ({ page }) => {
	// the store has no way to end its worker: closing the page ends it
	await page.close().catch(() => {});
});

// ---- Steps shared by the scenarios ----

async function givenTheFilesHold(server, rows, text, etag = null) {
	await test.step(`Given the files hold ${text}`, () => {
		server.files = files(rows);
		server.etag = etag;
	});
}

async function givenAStore(page) {
	await test.step("And a store made by createVectorStore()", () =>
		makeStore(page));
}

async function givenRefreshed(page) {
	await test.step("And a store that has been refreshed", async () => {
		await makeStore(page);
		expect((await refresh(page)).resolved).toBe(true);
	});
}

async function whenRefresh(page) {
	let result;
	await test.step("When refresh() is called", async () => {
		result = await refresh(page);
	});
	return result;
}

async function thenResolvesWithSize(result, n) {
	await test.step(`Then it resolves and the size is ${n}`, () => {
		expect(result).toEqual({ resolved: true, size: n });
	});
}

async function thenSearchAnswers(page, names, text) {
	await test.step(`And a search with k 3 answers ${text}`, async () => {
		const { results } = await search(page, query(), 3);
		expect(named(results).map(([n]) => n)).toEqual(names);
	});
}

async function whenSearch(page, k, text = `with k ${k}`, q = query(), opts) {
	let result;
	await test.step(`When it searches ${text}`, async () => {
		result = await search(page, q, k, opts);
	});
	return result;
}

async function thenAnswers(result, expected, text) {
	await test.step(`Then it answers ${text}`, () => {
		expect(named(result.results)).toEqual(expected);
	});
}

// ---- Scenarios: encodeRecords ----

test("A record is the control block, the id and the vector", async ({
	page,
	context,
}) => {
	await background(page, context);
	const vec = vector(768);
	await test.step("Given a UUIDv7 id and a vector of 768 Float32 values", () => {
		expect(ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
	});
	let result;
	await test.step("When encodeRecords encodes them", async () => {
		result = await encode(page, [{ id: ID, vec }]);
	});
	await test.step("Then it returns a body of 3,104 bytes, the size 3072 and the count 1", () => {
		expect(result.isUint8Array).toBe(true);
		expect(result.hex.length / 2).toBe(3104);
		expect(result.size).toBe(3072);
		expect(result.count).toBe(1);
	});
	await test.step("And the bytes 0 to 15 are 6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00", () => {
		expect(result.hex.slice(0, 32)).toBe("6c637479764c4530000c000000000000");
	});
	await test.step("And the bytes 16 to 31 are the 16 bytes of the id", () => {
		expect(result.hex.slice(32, 64)).toBe(ID.replace(/-/g, ""));
	});
	await test.step("And the rest is the vector as Float32 LE", () => {
		expect(result.hex.slice(64)).toBe(f32hex(vec));
	});
});

test("Records follow each other in the order given", async ({
	page,
	context,
}) => {
	await background(page, context);
	const other = "0190f3a1-7c2e-7abc-8def-ba9876543210";
	const items = [
		{ id: ID, vec: vector(768, 1) },
		{ id: other, vec: vector(768, 2) },
		{ id: ID, vec: vector(768, 3) },
	];
	await test.step("Given three items, the first and the third with the same id", () => {
		expect(items[0].id).toBe(items[2].id);
	});
	let result;
	await test.step("When encodeRecords encodes them", async () => {
		result = await encode(page, items);
	});
	await test.step("Then it returns a body of 9,312 bytes, the size 3072 and the count 3", () => {
		expect(result.hex.length / 2).toBe(9312);
		expect(result.size).toBe(3072);
		expect(result.count).toBe(3);
	});
	await test.step("And each record of 3,104 bytes is the control block, the id and the vector of its item, in order", () => {
		items.forEach(({ id, vec }, i) => {
			expect(result.hex.slice(i * 6208, (i + 1) * 6208)).toBe(
				CONTROL + id.replace(/-/g, "") + f32hex(vec),
			);
		});
	});
});

test("No items encode to an empty body", async ({ page, context }) => {
	await background(page, context);
	let result;
	await test.step("When encodeRecords encodes no items", async () => {
		result = await encode(page, []);
	});
	await test.step("Then it returns a body of 0 bytes, the size 3072 and the count 0", () => {
		expect(result).toEqual({
			isUint8Array: true,
			hex: "",
			size: 3072,
			count: 0,
		});
	});
});

test("A vector that is a view of a larger array is encoded from its own values", async ({
	page,
	context,
}) => {
	await background(page, context);
	let item;
	await test.step("Given an item whose vector is the 768 values from the 11th of a Float32Array of 1,000", () => {
		// the array holds 0, 1, …, 999; the view starts at the value 10
		item = { id: ID, view: { length: 1000, from: 10 } };
	});
	let result;
	await test.step("When encodeRecords encodes it", async () => {
		result = await encode(page, [item]);
	});
	await test.step("Then the bytes from 32 are those 768 values as Float32 LE", () => {
		expect(result.hex.length / 2).toBe(3104);
		expect(result.hex.slice(64)).toBe(
			f32hex(Array.from({ length: 768 }, (_, i) => i + 10)),
		);
	});
});

for (const dims of [256, 767, 769]) {
	test(`A vector that does not have 768 dimensions is rejected (${dims})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		let item;
		await test.step(`Given an item whose vector has ${dims} values`, () => {
			item = { id: ID, vec: vector(dims) };
		});
		let result;
		await test.step("When encodeRecords encodes it", async () => {
			result = await encode(page, [item]);
		});
		await test.step(`Then it throws "wrong dimensions (${dims} ≠ 768)"`, () => {
			expect(result).toEqual({ error: `wrong dimensions (${dims} ≠ 768)` });
		});
	});
}

test("FULL_DIM is the dimension of registration", async ({ page, context }) => {
	await background(page, context);
	await test.step("Then FULL_DIM is 768", async () => {
		expect(await page.evaluate(() => window.lctyVectors.FULL_DIM)).toBe(768);
	});
});

// ---- Scenarios: the store ----

test("A new store is empty and starts no worker", async ({ page, context }) => {
	const server = await background(page, context);
	await test.step("When createVectorStore() makes a store", () =>
		makeStore(page));
	let result;
	await test.step("And it searches with k 3", async () => {
		result = await search(page, query(), 3);
	});
	await test.step("Then its size is 0", async () => {
		expect(await size(page)).toBe(0);
	});
	await test.step("And the search answers no ids", () => {
		expect(result).toEqual({ results: [] });
	});
	await test.step("And /fuzzy_search.worker.js was not requested", async () => {
		await page.waitForTimeout(200);
		expect(server.requests.worker).toBe(0);
	});
});

test("A refresh loads the distribution files in the worker", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(
		server,
		[
			["a", 0.25],
			["b", 0.5],
			["c", 0.75],
		],
		'the rows of "a", "b" and "c"',
	);
	await givenAStore(page);
	const result = await whenRefresh(page);
	await thenResolvesWithSize(result, 3);
	await test.step("And /fuzzy_search.worker.js was requested once", () => {
		expect(server.requests.worker).toBe(1);
	});
	await test.step("And each file was requested once", () => {
		expect(server.requests.dat).toBe(1);
		expect(server.requests.idx).toBe(1);
	});
});

test("Concurrent refreshes share one load", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await givenAStore(page);
	let result;
	await test.step("When refresh() is called twice at once", async () => {
		result = await page.evaluate(async () => {
			const store = window.lctyStore;
			const [p, q] = [store.refresh(), store.refresh()];
			await Promise.all([p, q]);
			return { size: store.size };
		});
	});
	await test.step("Then both resolve and the size is 2", () => {
		expect(result).toEqual({ size: 2 });
	});
	await test.step("And each file was requested once", () => {
		expect(server.requests.dat).toBe(1);
		expect(server.requests.idx).toBe(1);
	});
});

test("A refresh after the files changed loads the new rows in the same worker", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(
		server,
		ROWS_AB,
		'the rows of "a" and "b", with the ETag "v1"',
		'"v1"',
	);
	await givenRefreshed(page);
	await test.step('And the files now hold the row of "c", with the ETag "v2"', () => {
		server.files = files([["c", 0.75]]);
		server.etag = '"v2"';
	});
	const result = await whenRefresh(page);
	await thenResolvesWithSize(result, 1);
	await thenSearchAnswers(page, ["c"], '"c"');
	await test.step("And /fuzzy_search.worker.js was requested once", () => {
		expect(server.requests.worker).toBe(1);
	});
});

test("Refreshing empty files leaves the store empty", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step("Given the files are empty", () => {
		server.files = { dat: Buffer.alloc(0), idx: Buffer.alloc(0) };
	});
	await givenAStore(page);
	const result = await whenRefresh(page);
	await thenResolvesWithSize(result, 0);
	await thenSearchAnswers(page, [], "no ids");
});

test("A search answers the k best ids by their best row, with their scores", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenRefreshed(page);
	const result = await whenSearch(page, 3);
	await thenAnswers(
		result,
		[
			["a", 0.875],
			["c", 0.75],
			["b", 0.5],
		],
		'"a" 0.875, "c" 0.75 and "b" 0.5',
	);
});

test("The query is cut to its first 256 dimensions and renormalized", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(
		server,
		[
			["x", [1, 0, 0]],
			["y", [0, 1, 0]],
			["z", [0, 0, 1]],
		],
		'the rows of "x", "y" and "z", 1 in their first, second and third dimension',
	);
	await givenRefreshed(page);
	const result = await whenSearch(
		page,
		3,
		"with k 3 for a query of 3 and 4 in its first two dimensions, 100 in the 257th and -50 in the 768th",
		query({ 0: 3, 1: 4, 256: 100, 767: -50 }),
	);
	await test.step('Then it answers "y" 0.8, "x" 0.6 and "z" 0', () => {
		const answered = named(result.results);
		expect(answered.map(([n]) => n)).toEqual(["y", "x", "z"]);
		expect(answered[0][1]).toBeCloseTo(0.8, 6);
		expect(answered[1][1]).toBeCloseTo(0.6, 6);
		expect(answered[2][1]).toBe(0);
	});
});

test("A query of zeros scores every row 0", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await givenRefreshed(page);
	const result = await whenSearch(
		page,
		3,
		"with k 3 for a query of 768 zeros",
		query({}),
	);
	await test.step('Then it answers "a" and "b", both with the score 0', () => {
		expect(named(result.results).sort()).toEqual([
			["a", 0],
			["b", 0],
		]);
	});
});

test("A store searched without k answers at most 50 ids", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	// n00 scores 0, n01 1/64, …, n59 59/64, shuffled
	const rows = Array.from({ length: 60 }, (_, i) => [
		`n${String((i * 7) % 60).padStart(2, "0")}`,
		((i * 7) % 60) / 64,
	]);
	await givenTheFilesHold(
		server,
		rows,
		"one row for each of 60 ids, every one scoring differently",
	);
	await givenRefreshed(page);
	const result = await whenSearch(page, undefined, "without k");
	await test.step("Then it answers the 50 best ids, descending", () => {
		expect(named(result.results)).toEqual(
			Array.from({ length: 50 }, (_, i) => [
				`n${String(59 - i).padStart(2, "0")}`,
				(59 - i) / 64,
			]),
		);
	});
});

test("allow is the only ids the worker may answer", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenRefreshed(page);
	const result = await whenSearch(
		page,
		3,
		'with k 3 and allow "b" and "d"',
		query(),
		{ allow: [uuid("b"), uuid("d")] },
	);
	await thenAnswers(
		result,
		[
			["b", 0.5],
			["d", 0.125],
		],
		'"b" 0.5 and "d" 0.125',
	);
});

test("accept drops ids on the main thread before k are taken", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenRefreshed(page);
	const result = await whenSearch(
		page,
		2,
		'with k 2 and an accept that rejects "a"',
		query(),
		{ accept: { reject: uuid("a") } },
	);
	await thenAnswers(
		result,
		[
			["c", 0.75],
			["b", 0.5],
		],
		'"c" 0.75 and "b" 0.5',
	);
});

test("accept is given only the 2k best ids", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenRefreshed(page);
	const result = await whenSearch(
		page,
		1,
		'with k 1 and an accept that takes only "d"',
		query(),
		{ accept: { only: uuid("d") } },
	);
	await thenAnswers(result, [], "no ids");
	await test.step('And accept was asked about "a" and "c" only', async () => {
		const asked = await page.evaluate(() => window.lctyAsked);
		expect(asked.map(nameOf)).toEqual(["a", "c"]);
	});
});

test("A query shorter than 256 dimensions is rejected by the worker", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await givenRefreshed(page);
	const result = await whenSearch(
		page,
		3,
		"with k 3 for a query of 100 dimensions",
		query({ 0: 1 }, 100),
	);
	await test.step('Then the search rejects with "wrong query dimensions (100 ≠ 256)"', () => {
		expect(result).toEqual({
			rejected: "wrong query dimensions (100 ≠ 256)",
		});
	});
});

for (const { change, error, apply } of [
	{
		change: "/v1/vectors.eg2_264.dat answers with the status 500",
		error: "failed to fetch the vectors (HTTP 500)",
		apply: (server) => {
			server.fail.dat = (route) => route.fulfill({ status: 500, body: "boom" });
		},
	},
	{
		change: "the rows are one byte short",
		error: "broken vectors (2111 bytes of rows for 2 ids)",
		apply: (server) => {
			server.files.dat = server.files.dat.subarray(0, 2 * REC - 1);
		},
	},
]) {
	test(`A failed refresh rejects and keeps what was loaded (${change})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheFilesHold(
			server,
			ROWS_AB,
			'the rows of "a" and "b", with the ETag "v1"',
			'"v1"',
		);
		await givenRefreshed(page);
		await test.step(`And with the ETag "v2", ${change}`, () => {
			server.etag = '"v2"';
			apply(server);
		});
		const result = await whenRefresh(page);
		await test.step(`Then it rejects with "${error}"`, () => {
			expect(result.rejected).toBe(error);
		});
		await test.step("And the size is still 2", async () => {
			expect(await size(page)).toBe(2);
		});
		await thenSearchAnswers(page, ["b", "a"], '"b" and "a"');
	});
}

test("A worker that cannot be loaded rejects the refresh", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await test.step("And /fuzzy_search.worker.js answers with the status 404", () => {
		server.worker = (route) => route.fulfill({ status: 404, body: "no" });
	});
	await givenAStore(page);
	const result = await whenRefresh(page);
	await test.step("Then it rejects with an error", () => {
		expect(typeof result.rejected).toBe("string");
		expect(result.rejected).not.toBe("");
	});
	await test.step("And the size is still 0", () => {
		expect(result.size).toBe(0);
	});
});

test("A store whose worker failed starts a new worker at the next call", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await test.step("And /fuzzy_search.worker.js answers with the status 404 once, then is served", () => {
		server.worker = (route) => {
			server.worker = (r) => r.continue();
			return route.fulfill({ status: 404, body: "no" });
		};
	});
	await givenAStore(page);
	const first = await whenRefresh(page);
	await test.step('Then it rejects with "the vector search worker failed"', () => {
		expect(first.rejected).toBe("the vector search worker failed");
	});
	let second;
	await test.step("When refresh() is called again", async () => {
		// a call that never settles (a dead worker kept) is told apart from a failure within 5 s
		second = await page.evaluate(() =>
			Promise.race([
				window.lctyStore.refresh().then(
					() => ({ resolved: true, size: window.lctyStore.size }),
					(e) => ({ rejected: e.message, size: window.lctyStore.size }),
				),
				new Promise((resolve) =>
					setTimeout(() => resolve({ pending: true }), 5000),
				),
			]),
		);
	});
	await thenResolvesWithSize(second, 2);
	await thenSearchAnswers(page, ["b", "a"], '"b" and "a"');
	await test.step("And /fuzzy_search.worker.js was requested twice", () => {
		expect(server.requests.worker).toBe(2);
	});
});
