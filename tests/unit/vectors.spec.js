// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1011: the scenarios of docs/specs/LCTYSP-1011_vector-store.feature that need the browser (the store and its
// worker), written by hand. Each test has the title of its Scenario (an Examples row is added in parentheses) and one
// test.step per line of it, so the two read side by side. The Scenarios of encodeRecords and FULL_DIM run in Node.js,
// in tests/unit/vectors.test.js.
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
