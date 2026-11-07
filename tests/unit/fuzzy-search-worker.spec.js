// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1013: the scenarios of docs/specs/LCTYSP-1013_fuzzy-search-worker.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read
// side by side.
//
// The worker runs in a real browser on the test server's origin, on the empty page of unit-page.js. The distribution
// files are answered by routes (they also catch the worker's requests), built by the test in the layout of LCTYSP-0008:
// 256 Float32 LE and 32 zero bytes per row, 16 bytes of id per row. /bdot264.wasm is the real kernel served from
// public/; a route counts its requests and can make it fail, so that the worker scores in JavaScript.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const DAT = "/v1/vectors.eg2_264.dat";
const IDX = "/v1/vectors.eg2_264.idx";
const DIM = 256;
const REC = 1056;

/** The UUIDv7 of a short name ("a" → 019a0000-0000-7000-8000-000000000061). */
function uuid(name) {
	const hex = Buffer.from(name).toString("hex").padStart(12, "0");
	return `019a0000-0000-7000-8000-${hex}`;
}

/** The rows file of vectors (arrays of up to 256 numbers; the rest and the padding are 0). */
function rowsFile(vectors) {
	const f = new Float32Array((vectors.length * REC) / 4);
	vectors.forEach((v, i) => {
		f.set(v, (i * REC) / 4);
	});
	return Buffer.from(f.buffer);
}

/** The ids file of names, one per row. */
function idsFile(names) {
	return Buffer.concat(
		names.map((n) => Buffer.from(uuid(n).replace(/-/g, ""), "hex")),
	);
}

/** The pair of files of rows [name, score]: the first value of the row is its score against the query. */
function files(rows) {
	return {
		dat: rowsFile(rows.map(([, score]) => [score])),
		idx: idsFile(rows.map(([name]) => name)),
	};
}

/** The query of the Scenarios: 1 in its first dimension, 0 in the others. */
const QUERY = Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0));

const ROWS_ABCDA = [
	["a", 0.25],
	["b", 0.5],
	["c", 0.75],
	["d", 0.125],
	["a", 0.875],
];
const ROWS_AB = [
	["a", 0.25],
	["b", 0.5],
];

const named = (results) => results.map(([id, score]) => [nameOf(id), score]);
const nameOf = (id) =>
	Buffer.from(id.slice(24).replace(/^(00)+/, ""), "hex").toString();

// ---- Background ----

/**
 * The page, the files answered by the test and the worker started (window.lctyWorkers.w). server.files is the pair,
 * server.etag the ETag of each file by its request number (or null), server.fail a route answer per file that replaces
 * the files, server.wasm the answer of /bdot264.wasm (by default the real file); server.requests counts the requests.
 */
async function background(page, context) {
	const server = {
		files: { dat: Buffer.alloc(0), idx: Buffer.alloc(0) },
		etag: { dat: () => null, idx: () => null },
		fail: {},
		wasm: (route) => route.continue(),
		requests: { dat: 0, idx: 0, wasm: 0 },
	};
	await givenAPage(page, context);
	await test.step("And /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx are answered by the test", async () => {
		for (const [key, path] of [
			["dat", DAT],
			["idx", IDX],
		]) {
			await context.route(`**${path}`, (route) => {
				const n = ++server.requests[key];
				if (server.fail[key]) return server.fail[key](route);
				const etag = server.etag[key](n);
				return route.fulfill({
					status: 200,
					contentType: "application/octet-stream",
					headers: etag ? { ETag: etag } : {},
					body: server.files[key],
				});
			});
		}
		await context.route("**/bdot264.wasm", (route) => {
			server.requests.wasm++;
			return server.wasm(route);
		});
	});
	await test.step("And the worker is started", async () => {
		await startWorker(page, "w");
	});
	return server;
}

// ---- The worker, from the page ----

function startWorker(page, name) {
	return page.evaluate((name) => {
		window.lctyWorkers ??= {};
		const worker = new Worker("/fuzzy_search.worker.js");
		const pending = new Map();
		worker.onmessage = ({ data }) => {
			pending.get(data.id)?.(data);
			pending.delete(data.id);
		};
		window.lctyWorkers[name] = { worker, pending, seq: 100 };
	}, name);
}

/** Send msg (a query as an array is sent as a Float32Array) with a new id; returns {sent: id, reply}. */
function send(page, msg, name = "w") {
	return page.evaluate(
		({ msg, name }) => {
			const h = window.lctyWorkers[name];
			const id = ++h.seq;
			const data = { id, ...msg };
			if (Array.isArray(data.query)) data.query = Float32Array.from(data.query);
			return new Promise((resolve) => {
				h.pending.set(id, (reply) => resolve({ sent: id, reply }));
				h.worker.postMessage(data);
			});
		},
		{ msg, name },
	);
}

const load = (page, name) =>
	send(page, { op: "load", dat: DAT, idx: IDX }, name);
const search = (page, k, extra = {}, name) =>
	send(page, { op: "search", query: QUERY, k, ...extra }, name);

test.afterEach(async ({ page }) => {
	await page
		.evaluate(() => {
			for (const h of Object.values(window.lctyWorkers || {}))
				h.worker.terminate();
		})
		.catch(() => {});
});

// ---- Steps shared by the scenarios ----

async function givenTheFilesHold(server, rows, text, etag = null) {
	await test.step(`Given the files hold ${text}`, () => {
		server.files = files(rows);
		server.etag = { dat: () => etag, idx: () => etag };
	});
}

async function givenLoaded(page) {
	await test.step("And the worker has loaded them", async () => {
		const { reply } = await load(page);
		expect(reply.error).toBeUndefined();
	});
}

async function whenLoad(page) {
	let result;
	await test.step("When the worker is sent a load of the two files", async () => {
		result = await load(page);
	});
	return result;
}

async function thenRows({ sent, reply }, rows) {
	await test.step(`Then it answers with the message's id and ${rows} rows`, () => {
		expect(reply).toEqual({ id: sent, rows });
	});
}

async function thenError({ sent, reply }, error) {
	await test.step(`Then it answers with the message's id and the error "${error}"`, () => {
		expect(reply).toEqual({ id: sent, error });
	});
}

function idsText(names) {
	if (!names.length) return "none";
	const quoted = names.map((n) => `"${n}"`);
	return quoted.length === 1
		? quoted[0]
		: `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

async function thenIds(result, names, keyword = "Then") {
	await test.step(`${keyword} it answers the ids ${idsText(names)}`, () => {
		expect(result.reply.id).toBe(result.sent);
		expect(named(result.reply.results).map(([n]) => n)).toEqual(names);
	});
}

async function thenSearchAnswers(page, names) {
	await test.step(`And a search with k 3 answers the ids ${idsText(names)}`, async () => {
		const { reply } = await search(page, 3);
		expect(named(reply.results).map(([n]) => n)).toEqual(names);
	});
}

async function whenSearch(page, k) {
	let result;
	await test.step(`When the worker is sent a search with k ${k}`, async () => {
		result = await search(page, k);
	});
	return result;
}

// ---- Scenarios ----

test("Loading fetches both files and answers the row count", async ({
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
	const result = await whenLoad(page);
	await thenRows(result, 3);
	await test.step("And each file was requested once", () => {
		expect(server.requests.dat).toBe(1);
		expect(server.requests.idx).toBe(1);
	});
	await test.step("And /bdot264.wasm was requested once", () => {
		expect(server.requests.wasm).toBe(1);
	});
});

test("A search answers the k best ids by their best row, descending", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(
		server,
		ROWS_ABCDA,
		'the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875',
	);
	await givenLoaded(page);
	const result = await whenSearch(page, 3);
	await test.step('Then it answers with the message\'s id and the results "a" 0.875, "c" 0.75 and "b" 0.5', () => {
		expect(result.reply).toEqual({
			id: result.sent,
			results: [
				[uuid("a"), 0.875],
				[uuid("c"), 0.75],
				[uuid("b"), 0.5],
			],
		});
	});
});

for (const [k, names] of [
	[1, ["a"]],
	[4, ["a", "c", "b", "d"]],
	[10, ["a", "c", "b", "d"]],
	[0, []],
	[-1, []],
]) {
	test(`k limits the number of ids (${k})`, async ({ page, context }) => {
		const server = await background(page, context);
		await givenTheFilesHold(
			server,
			ROWS_ABCDA,
			'the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875',
		);
		await givenLoaded(page);
		const result = await whenSearch(page, k);
		await thenIds(result, names);
	});
}

test("A search without k answers at most 50 ids", async ({ page, context }) => {
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
	await givenLoaded(page);
	let result;
	await test.step("When the worker is sent a search without k", async () => {
		result = await send(page, { op: "search", query: QUERY });
	});
	await test.step("Then it answers the 50 best ids, descending", () => {
		expect(named(result.reply.results)).toEqual(
			Array.from({ length: 50 }, (_, i) => [
				`n${String(59 - i).padStart(2, "0")}`,
				(59 - i) / 64,
			]),
		);
	});
});

test("allow selects the ids that may appear", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheFilesHold(
		server,
		ROWS_ABCDA,
		'the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875',
	);
	await givenLoaded(page);
	let result;
	await test.step('When the worker is sent a search with k 3 and allow "b", "d" and "z"', async () => {
		result = await search(page, 3, {
			allow: [uuid("b"), uuid("d"), uuid("z")],
		});
	});
	await test.step('Then it answers the results "b" 0.5 and "d" 0.125', () => {
		expect(result.reply.results).toEqual([
			[uuid("b"), 0.5],
			[uuid("d"), 0.125],
		]);
	});
});

test("An empty allow answers no ids", async ({ page, context }) => {
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
	await givenLoaded(page);
	let result;
	await test.step("When the worker is sent a search with k 3 and an empty allow", async () => {
		result = await search(page, 3, { allow: [] });
	});
	await thenIds(result, []);
});

test("A search before any load answers no ids", async ({ page, context }) => {
	await background(page, context);
	const result = await whenSearch(page, 3);
	await thenIds(result, []);
});

test("Empty files load as no rows", async ({ page, context }) => {
	const server = await background(page, context);
	await test.step("Given the files are empty", () => {
		server.files = { dat: Buffer.alloc(0), idx: Buffer.alloc(0) };
	});
	const result = await whenLoad(page);
	await thenRows(result, 0);
	await thenSearchAnswers(page, []);
});

test("A pair with the ETag already loaded is not read again", async ({
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
	await givenLoaded(page);
	await test.step('And the files now hold the row of "c", still with the ETag "v1"', () => {
		server.files = files([["c", 0.75]]);
	});
	const result = await whenLoad(page);
	await thenRows(result, 2);
	await thenSearchAnswers(page, ["b", "a"]);
});

test("A pair with a new ETag replaces what was loaded", async ({
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
	await givenLoaded(page);
	await test.step('And the files now hold the row of "c", with the ETag "v2"', () => {
		server.files = files([["c", 0.75]]);
		server.etag = { dat: () => '"v2"', idx: () => '"v2"' };
	});
	const result = await whenLoad(page);
	await thenRows(result, 1);
	await thenSearchAnswers(page, ["c"]);
});

test("Files without an ETag are read at every load", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(
		server,
		ROWS_AB,
		'the rows of "a" and "b", without an ETag',
	);
	await givenLoaded(page);
	await test.step('And the files now hold the row of "c", without an ETag', () => {
		server.files = files([["c", 0.75]]);
	});
	const result = await whenLoad(page);
	await thenRows(result, 1);
	await thenSearchAnswers(page, ["c"]);
});

test("A pair whose ETags differ is fetched again", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await test.step('And /v1/vectors.eg2_264.idx has the ETag "v0" at its first request and "v1" later, /v1/vectors.eg2_264.dat "v1"', () => {
		server.etag = {
			dat: () => '"v1"',
			idx: (n) => (n === 1 ? '"v0"' : '"v1"'),
		};
	});
	const result = await whenLoad(page);
	await thenRows(result, 2);
	await test.step("And each file was requested twice", () => {
		expect(server.requests.dat).toBe(2);
		expect(server.requests.idx).toBe(2);
	});
});

test("A pair whose ETags never agree is used after three tries", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await test.step('And /v1/vectors.eg2_264.dat always has the ETag "v1" and /v1/vectors.eg2_264.idx "v2"', () => {
		server.etag = { dat: () => '"v1"', idx: () => '"v2"' };
	});
	const result = await whenLoad(page);
	await thenRows(result, 2);
	await test.step("And each file was requested 3 times", () => {
		expect(server.requests.dat).toBe(3);
		expect(server.requests.idx).toBe(3);
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
		change: "/v1/vectors.eg2_264.idx answers with the status 404",
		error: "failed to fetch the vectors (HTTP 404)",
		apply: (server) => {
			server.fail.idx = (route) => route.fulfill({ status: 404, body: "no" });
		},
	},
	{
		change: "the rows are one byte short",
		error: "broken vectors (2111 bytes of rows for 2 ids)",
		apply: (server) => {
			server.files.dat = server.files.dat.subarray(0, 2 * REC - 1);
		},
	},
	{
		change: "the ids have a third id",
		error: "broken vectors (2112 bytes of rows for 3 ids)",
		apply: (server) => {
			server.files.idx = idsFile(["a", "b", "c"]);
		},
	},
	{
		change: "the ids are one byte short",
		error: "broken vectors (2112 bytes of rows for 1.9375 ids)",
		apply: (server) => {
			server.files.idx = server.files.idx.subarray(0, 31);
		},
	},
]) {
	test(`A failed load answers an error and keeps what was loaded (${change})`, async ({
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
		await givenLoaded(page);
		await test.step(`And with the ETag "v2", ${change}`, () => {
			server.etag = { dat: () => '"v2"', idx: () => '"v2"' };
			apply(server);
		});
		const result = await whenLoad(page);
		await thenError(result, error);
		await thenSearchAnswers(page, ["b", "a"]);
	});
}

test("A file that fails without a response answers an error", async ({
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
	await givenLoaded(page);
	await test.step("And /v1/vectors.eg2_264.idx now fails without a response", () => {
		server.fail.idx = (route) => route.abort("failed");
	});
	const result = await whenLoad(page);
	await test.step("Then it answers with the message's id and an error", () => {
		expect(result.reply.id).toBe(result.sent);
		expect(typeof result.reply.error).toBe("string");
		expect(result.reply.error).not.toBe("");
		expect(result.reply.rows).toBeUndefined();
	});
	await thenSearchAnswers(page, ["b", "a"]);
});

test("A query that does not have 256 dimensions answers an error", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheFilesHold(server, ROWS_AB, 'the rows of "a" and "b"');
	await givenLoaded(page);
	let result;
	await test.step("When the worker is sent a search with a query of 255 dimensions", async () => {
		result = await send(page, {
			op: "search",
			query: QUERY.slice(0, 255),
			k: 3,
		});
	});
	await thenError(result, "wrong query dimensions (255 ≠ 256)");
	await thenSearchAnswers(page, ["b", "a"]);
});

test("An unknown op answers an error", async ({ page, context }) => {
	await background(page, context);
	let result;
	await test.step('When the worker is sent the op "drop"', async () => {
		result = await send(page, { op: "drop" });
	});
	await thenError(result, "unknown op: drop");
});

// ---- Random unit vectors, the same at every run ----

function random(seed) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function unitVector(next) {
	const v = Array.from({ length: DIM }, () => next() * 2 - 1);
	const n = Math.hypot(...v);
	return v.map((x) => x / n);
}

for (const { wasm, answer } of [
	{
		wasm: "answers with the status 404",
		answer: (route) => route.fulfill({ status: 404, body: "no" }),
	},
	{
		wasm: "fails without a response",
		answer: (route) => route.abort("failed"),
	},
	{
		wasm: "answers with bytes that are not WebAssembly",
		answer: (route) =>
			route.fulfill({
				contentType: "application/wasm",
				body: Buffer.from("not wasm"),
			}),
	},
]) {
	test(`Scoring in JavaScript gives the results of bdot264.wasm (${wasm})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		const next = random(1013);
		const vectors = Array.from({ length: 300 }, () => unitVector(next));
		const query = unitVector(next);
		const names = vectors.map((_, i) => `r${String(i % 100).padStart(3, "0")}`);
		const searchMsg = { op: "search", query, k: 20 };
		let first;
		let second;
		await test.step("Given /bdot264.wasm can be instantiated in this browser with its memory of 256 MiB", async () => {
			// what the worker does, so that the first worker scores with the kernel (it falls back without a word)
			const exports = await page.evaluate(async () => {
				const bytes = await (await fetch("/bdot264.wasm")).arrayBuffer();
				if (!WebAssembly.validate(bytes)) return null;
				const memory = new WebAssembly.Memory({
					initial: 4096,
					maximum: 4096,
				});
				const { instance } = await WebAssembly.instantiate(bytes, {
					env: { memory },
				});
				return Object.keys(instance.exports);
			});
			expect(exports).toContain("bdot264");
			server.requests.wasm = 0;
		});
		await test.step("And the files hold 300 rows of 100 ids, the rows and the query being random unit vectors", () => {
			server.files = { dat: rowsFile(vectors), idx: idsFile(names) };
		});
		await test.step("When one worker loads them and searches with k 20", async () => {
			expect((await load(page)).reply.rows).toBe(300);
			first = (await send(page, searchMsg)).reply.results;
			expect(server.requests.wasm).toBe(1);
		});
		await test.step(`And a second worker, for which /bdot264.wasm ${wasm}, loads them and searches with k 20`, async () => {
			server.wasm = answer;
			await startWorker(page, "js");
			expect((await load(page, "js")).reply.rows).toBe(300);
			second = (await send(page, searchMsg, "js")).reply.results;
			expect(server.requests.wasm).toBe(2);
		});
		await test.step("Then both answer the same 20 ids in the same order, with scores within 0.00001", () => {
			expect(first).toHaveLength(20);
			expect(second.map(([id]) => id)).toEqual(first.map(([id]) => id));
			second.forEach(([, score], i) => {
				expect(Math.abs(score - first[i][1])).toBeLessThan(0.00001);
			});
		});
	});
}
