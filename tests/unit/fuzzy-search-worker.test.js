// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1013: the scenarios of docs/specs/LCTYSP-1013_fuzzy-search-worker.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by
// side.
//
// The worker runs as a Web Worker of Node.js 26 (node-preload.cjs), started from public/ as siteUrl() would. Its
// requests are answered by routeFetch (node-unit.js), as routes do in the browser. The test plays the server's vector
// pair (LCTYSP-0019): its JSON, and .dat and .idx by Range and If-Match, record 0 a header and the rows after it in the
// layout of LCTYSP-0008 (256 Float32 LE and 32 zero bytes per row, 16 bytes of id per row). /bdot264.wasm is the real
// kernel of public/ unless the test makes it fail, so that the worker scores in JavaScript.

import { readFile } from "node:fs/promises";
import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const JSON_PATH = "/v1/vectors.eg2_264.json";
const DAT = "/v1/vectors.eg2_264.dat";
const IDX = "/v1/vectors.eg2_264.idx";
const DIM = 256;
const REC = 1056;
const ID = 16;

/** The UUIDv7 of a short name ("a" → 019a0000-0000-7000-8000-000000000061). */
function uuid(name) {
	const hex = Buffer.from(name).toString("hex").padStart(12, "0");
	return `019a0000-0000-7000-8000-${hex}`;
}

/** The .dat of rows [name, vector]: the header (256 quiet NaNs, 32 zero bytes), then each vector padded with zeros. */
function datFile(rows) {
	const u = new Uint32Array(((rows.length + 1) * REC) / 4);
	u.fill(0x7fc00000, 0, DIM);
	const f = new Float32Array(u.buffer);
	rows.forEach(([, v], i) => {
		f.set(v, ((i + 1) * REC) / 4);
	});
	return Buffer.from(u.buffer);
}

/** The .idx of rows [name, vector]: a 16-byte header, then the id of each row. */
function idxFile(rows) {
	return Buffer.concat([
		Buffer.alloc(ID),
		...rows.map(([n]) => Buffer.from(uuid(n).replace(/-/g, ""), "hex")),
	]);
}

/** Rows [name, score]: the first value of the row is its score against the query. */
const scored = (rows) => rows.map(([name, score]) => [name, [score]]);

/** The query of the Scenarios: 1 in its first dimension, 0 in the others. */
const QUERY = Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0));

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
const ROWS_ABC = [...ROWS_AB, ["c", 0.75]];

const named = (results) => results.map(([id, score]) => [nameOf(id), score]);
const nameOf = (id) =>
	Buffer.from(id.slice(24).replace(/^(00)+/, ""), "hex").toString();

// Answers of a route: a response, or a failure without one (route.abort() in the browser)
const answer = (status, body) => () => new Response(body, { status });
const abort = () => {
	throw new TypeError("failed");
};

// ---- Background ----

/**
 * The pair answered by the test and the worker started (server.workers.w). server.rev, server.rows ([name, vector])
 * and server.invalid are the pair; server.json replaces its JSON; server.onJson(n) runs after the n-th request of the
 * JSON; server.fail is an answer per file (json, dat, idx) that replaces the pair's; server.cut drops bytes from the
 * end of a file's answer; server.wasm is the answer of /bdot264.wasm (undefined: the real file). server.requests counts
 * the requests and server.asked keeps the Range and If-Match of each request of .dat and .idx.
 */
async function background(step, t) {
	const server = {
		rev: 1,
		rows: [],
		invalid: [],
		json: null,
		onJson: () => {},
		fail: {},
		cut: {},
		wasm: () => undefined,
		requests: { json: 0, dat: 0, idx: 0, wasm: 0 },
		asked: { dat: [], idx: [] },
		workers: {},
	};
	await step(
		"Given the vector pair of /v1/vectors.eg2_264.json, .dat and .idx is answered by the test",
		() => {
			routeFetch(t, (request) => {
				const path = new URL(request.url).pathname;
				if (path === JSON_PATH) {
					const n = ++server.requests.json;
					if (server.fail.json) return server.fail.json(request);
					const body = server.json ?? {
						rev: server.rev,
						count: server.rows.length + 1,
						invalid: server.invalid,
					};
					server.onJson(n);
					return Response.json(body);
				}
				const key = { [DAT]: "dat", [IDX]: "idx" }[path];
				if (key) return pairFile(server, key, request);
				if (path === "/bdot264.wasm") {
					server.requests.wasm++;
					return server.wasm(request);
				}
			});
		},
	);
	await step("And the worker is started", () => {
		startWorker(server, "w");
	});
	return server;
}

/** .dat or .idx (key) of the pair as the server answers it: 412 for another generation, else the range, 206 */
function pairFile(server, key, request) {
	server.requests[key]++;
	const range = request.headers.get("Range");
	const ifMatch = request.headers.get("If-Match");
	server.asked[key].push([range, ifMatch]);
	if (server.fail[key]) return server.fail[key](request);
	if (ifMatch !== `"${server.rev}"`) return new Response("{}", { status: 412 });
	const file = key === "dat" ? datFile(server.rows) : idxFile(server.rows);
	const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range);
	const last = Math.min(Number(b), file.length - 1);
	const body = file.subarray(Number(a), last + 1 - (server.cut[key] ?? 0));
	return new Response(body, {
		status: 206,
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Range": `bytes ${a}-${last}/${file.length}`,
		},
	});
}

// ---- The worker ----

function startWorker(server, name) {
	const worker = new Worker(publicUrl("fuzzy_search.worker.js"));
	const pending = new Map();
	worker.onmessage = ({ data }) => {
		pending.get(data.id)?.(data);
		pending.delete(data.id);
	};
	server.workers[name] = { worker, pending, seq: 100 };
}

/** Send msg (a query as an array is sent as a Float32Array) with a new id; returns {sent: id, reply}. */
function send(server, msg, name = "w") {
	const h = server.workers[name];
	const id = ++h.seq;
	const data = { id, ...msg };
	if (Array.isArray(data.query)) data.query = Float32Array.from(data.query);
	return new Promise((resolve) => {
		h.pending.set(id, (reply) => resolve({ sent: id, reply }));
		h.worker.postMessage(data);
	});
}

const load = (server, name, extra = {}) =>
	send(
		server,
		{ op: "load", json: JSON_PATH, dat: DAT, idx: IDX, ...extra },
		name,
	);
const search = (server, k, extra = {}, name) =>
	send(server, { op: "search", query: QUERY, k, ...extra }, name);

// ---- Steps shared by the scenarios ----

async function givenThePairHolds(step, server, rows, text) {
	await step(`Given the pair holds ${text}`, () => {
		server.rows = scored(rows);
		server.rev = 1;
	});
}

const givenAB = (step, server) =>
	givenThePairHolds(
		step,
		server,
		ROWS_AB,
		'the rows of "a" and "b" in the generation 1',
	);
const givenABC = (step, server) =>
	givenThePairHolds(
		step,
		server,
		ROWS_ABC,
		'the rows of "a", "b" and "c" in the generation 1',
	);

async function givenLoaded(step, server) {
	await step("And the worker has loaded it", async () => {
		const { reply } = await load(server);
		expect(reply.error).toBeUndefined();
	});
}

async function whenLoad(step, server) {
	let result;
	await step("When the worker is sent a load of the pair", async () => {
		result = await load(server);
	});
	return result;
}

async function thenRows(step, { sent, reply }, rows) {
	await step(`Then it answers with the message's id and ${rows} rows`, () => {
		expect(reply).toEqual({ id: sent, rows });
	});
}

async function thenError(step, { sent, reply }, error) {
	await step(
		`Then it answers with the message's id and the error "${error}"`,
		() => {
			expect(reply).toEqual({ id: sent, error });
		},
	);
}

function idsText(names) {
	if (!names.length) return "none";
	const quoted = names.map((n) => `"${n}"`);
	return quoted.length === 1
		? quoted[0]
		: `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

async function thenIds(step, result, names) {
	await step(`Then it answers the ids ${idsText(names)}`, () => {
		expect(result.reply.id).toBe(result.sent);
		expect(named(result.reply.results).map(([n]) => n)).toEqual(names);
	});
}

async function thenSearchAnswers(step, server, names) {
	await step(
		`And a search with k 3 answers the ids ${idsText(names)}`,
		async () => {
			const { reply } = await search(server, 3);
			expect(named(reply.results).map(([n]) => n)).toEqual(names);
		},
	);
}

async function whenSearch(step, server, k) {
	let result;
	await step(`When the worker is sent a search with k ${k}`, async () => {
		result = await search(server, k);
	});
	return result;
}

// ---- Scenarios ----

scenario(
	"Loading fetches the JSON and the rows from record 1, and answers the row count",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenABC(step, server);
		const result = await whenLoad(step, server);
		await thenRows(step, result, 3);
		await step("And the JSON was requested once", () => {
			expect(server.requests.json).toBe(1);
		});
		await step(
			'And .dat was requested once, with bytes=1056-4223 and If-Match "1"',
			() => {
				expect(server.asked.dat).toEqual([["bytes=1056-4223", '"1"']]);
			},
		);
		await step(
			'And .idx was requested once, with bytes=16-63 and If-Match "1"',
			() => {
				expect(server.asked.idx).toEqual([["bytes=16-63", '"1"']]);
			},
		);
		await step("And /bdot264.wasm was requested once", () => {
			expect(server.requests.wasm).toBe(1);
		});
	},
);

scenario(
	"A search answers the k best ids by their best row, descending",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
		await givenLoaded(step, server);
		const result = await whenSearch(step, server, 3);
		await step(
			'Then it answers with the message\'s id and the results "a" 0.875, "c" 0.75 and "b" 0.5',
			() => {
				expect(result.reply).toEqual({
					id: result.sent,
					results: [
						[uuid("a"), 0.875],
						[uuid("c"), 0.75],
						[uuid("b"), 0.5],
					],
				});
			},
		);
	},
);

for (const [k, names] of [
	[1, ["a"]],
	[4, ["a", "c", "b", "d"]],
	[10, ["a", "c", "b", "d"]],
	[0, []],
	[-1, []],
]) {
	scenario(`k limits the number of ids (${k})`, async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
		await givenLoaded(step, server);
		const result = await whenSearch(step, server, k);
		await thenIds(step, result, names);
	});
}

scenario("A search without k answers at most 50 ids", async ({ step, t }) => {
	const server = await background(step, t);
	// n00 scores 0, n01 1/64, …, n59 59/64, shuffled
	const rows = Array.from({ length: 60 }, (_, i) => [
		`n${String((i * 7) % 60).padStart(2, "0")}`,
		((i * 7) % 60) / 64,
	]);
	await givenThePairHolds(
		step,
		server,
		rows,
		"one row for each of 60 ids, every one scoring differently",
	);
	await givenLoaded(step, server);
	let result;
	await step("When the worker is sent a search without k", async () => {
		result = await send(server, { op: "search", query: QUERY });
	});
	await step("Then it answers the 50 best ids, descending", () => {
		expect(named(result.reply.results)).toEqual(
			Array.from({ length: 50 }, (_, i) => [
				`n${String(59 - i).padStart(2, "0")}`,
				(59 - i) / 64,
			]),
		);
	});
});

scenario("allow selects the ids that may appear", async ({ step, t }) => {
	const server = await background(step, t);
	await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenLoaded(step, server);
	let result;
	await step(
		'When the worker is sent a search with k 3 and allow "b", "d" and "z"',
		async () => {
			result = await search(server, 3, {
				allow: [uuid("b"), uuid("d"), uuid("z")],
			});
		},
	);
	await step('Then it answers the results "b" 0.5 and "d" 0.125', () => {
		expect(result.reply.results).toEqual([
			[uuid("b"), 0.5],
			[uuid("d"), 0.125],
		]);
	});
});

scenario("An empty allow answers no ids", async ({ step, t }) => {
	const server = await background(step, t);
	await givenABC(step, server);
	await givenLoaded(step, server);
	let result;
	await step(
		"When the worker is sent a search with k 3 and an empty allow",
		async () => {
			result = await search(server, 3, { allow: [] });
		},
	);
	await thenIds(step, result, []);
});

scenario("A search before any load answers no ids", async ({ step, t }) => {
	const server = await background(step, t);
	const result = await whenSearch(step, server, 3);
	await thenIds(step, result, []);
});

scenario("A pair with no rows loads as 0 rows", async ({ step, t }) => {
	const server = await background(step, t);
	await givenThePairHolds(step, server, [], "no rows in the generation 1");
	const result = await whenLoad(step, server);
	await thenRows(step, result, 0);
	await step("And neither .dat nor .idx was requested", () => {
		expect([server.requests.dat, server.requests.idx]).toEqual([0, 0]);
	});
	await thenSearchAnswers(step, server, []);
});

scenario(
	"A load in the same generation fetches only the new records",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenAB(step, server);
		await givenLoaded(step, server);
		await step('And the row of "c" has been appended to the pair', () => {
			server.rows = scored(ROWS_ABC);
		});
		const result = await whenLoad(step, server);
		await thenRows(step, result, 3);
		await step(
			"And .dat was requested again, with bytes=3168-4223 only",
			() => {
				expect(server.asked.dat.map(([r]) => r)).toEqual([
					"bytes=1056-3167",
					"bytes=3168-4223",
				]);
			},
		);
		await step("And .idx was requested again, with bytes=48-63 only", () => {
			expect(server.asked.idx.map(([r]) => r)).toEqual([
				"bytes=16-47",
				"bytes=48-63",
			]);
		});
		await thenSearchAnswers(step, server, ["c", "b", "a"]);
	},
);

scenario("A load with nothing new fetches no rows", async ({ step, t }) => {
	const server = await background(step, t);
	await givenAB(step, server);
	await givenLoaded(step, server);
	const result = await whenLoad(step, server);
	await thenRows(step, result, 2);
	await step(
		"And the JSON was requested twice, and .dat and .idx once each",
		() => {
			expect(server.requests).toMatchObject({ json: 2, dat: 1, idx: 1 });
		},
	);
});

scenario("A new generation replaces the copy", async ({ step, t }) => {
	const server = await background(step, t);
	await givenAB(step, server);
	await givenLoaded(step, server);
	await step(
		'And the pair now holds the row of "c" in the generation 2',
		() => {
			server.rows = scored([["c", 0.75]]);
			server.rev = 2;
		},
	);
	const result = await whenLoad(step, server);
	await thenRows(step, result, 1);
	await step(
		'And .dat was requested again, with bytes=1056-2111 and If-Match "2"',
		() => {
			expect(server.asked.dat).toEqual([
				["bytes=1056-3167", '"1"'],
				["bytes=1056-2111", '"2"'],
			]);
		},
	);
	await thenSearchAnswers(step, server, ["c"]);
});

scenario(
	"Rows in the invalid ranges are never answered",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(
			step,
			server,
			ROWS_ABC,
			'the rows of "a", "b" and "c" in the generation 1, its JSON listing record 2 as invalid',
		);
		server.invalid = [[2, 2]]; // the row itself is left as it was: the worker fills it with NaN
		const result = await whenLoad(step, server);
		await thenRows(step, result, 3);
		await thenSearchAnswers(step, server, ["c", "a"]);
	},
);

scenario(
	"Rows invalidated after they were loaded are never answered",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenABC(step, server);
		await givenLoaded(step, server);
		await step("And the JSON now lists records 2 to 3 as invalid", () => {
			server.invalid = [[2, 3]];
		});
		const result = await whenLoad(step, server);
		await thenRows(step, result, 3);
		await step("And neither .dat nor .idx was requested again", () => {
			expect([server.requests.dat, server.requests.idx]).toEqual([1, 1]);
		});
		await thenSearchAnswers(step, server, ["a"]);
	},
);

scenario("A 412 starts again from the JSON", async ({ step, t }) => {
	const server = await background(step, t);
	await givenAB(step, server);
	await step(
		'And the pair moves to the generation 2, the row of "c" appended, right after its JSON is first requested',
		() => {
			server.onJson = (n) => {
				if (n !== 1) return;
				server.rows = scored(ROWS_ABC);
				server.rev = 2;
			};
		},
	);
	const result = await whenLoad(step, server);
	await thenRows(step, result, 3);
	await step("And the JSON was requested twice", () => {
		expect(server.requests.json).toBe(2);
	});
	await thenSearchAnswers(step, server, ["c", "b", "a"]);
});

scenario(
	"A generation that keeps changing fails after three tries",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenAB(step, server);
		await step(
			"And the pair moves to a new generation right after every request of its JSON",
			() => {
				server.onJson = () => {
					server.rev++;
				};
			},
		);
		const result = await whenLoad(step, server);
		await thenError(
			step,
			result,
			"the vectors changed while they were fetched",
		);
		await step("And the JSON was requested 3 times", () => {
			expect(server.requests.json).toBe(3);
		});
	},
);

scenario(
	"A summary given with the load is used without fetching the JSON",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenAB(step, server);
		let result;
		await step(
			"When the worker is sent a load of the pair with the summary of the generation 1, 3 records and no invalid range",
			async () => {
				result = await load(server, "w", {
					summary: { rev: 1, count: 3, invalid: [] },
				});
			},
		);
		await thenRows(step, result, 2);
		await step("And the JSON was not requested", () => {
			expect(server.requests.json).toBe(0);
		});
		await thenSearchAnswers(step, server, ["b", "a"]);
	},
);

for (const { change, error, apply } of [
	{
		change: "the JSON answers with the status 500",
		error: "failed to fetch the vectors (HTTP 500)",
		apply: (s) => {
			s.fail.json = answer(500, "boom");
		},
	},
	{
		change: "the JSON is not that of a pair",
		error: "broken vectors (not the JSON of a pair)",
		apply: (s) => {
			s.json = { rev: "2", count: 2, invalid: [] };
		},
	},
	{
		change: ".dat answers with the status 500",
		error: "failed to fetch the vectors (HTTP 500)",
		apply: (s) => {
			s.fail.dat = answer(500, "boom");
		},
	},
	{
		change: ".idx answers with the status 404",
		error: "failed to fetch the vectors (HTTP 404)",
		apply: (s) => {
			s.fail.idx = answer(404, "no");
		},
	},
	{
		change: ".dat answers with one byte less",
		error: "broken vectors (1055 bytes for 1056)",
		apply: (s) => {
			s.cut.dat = 1;
		},
	},
]) {
	scenario(
		`A failed load answers an error and keeps the copy (${change})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenAB(step, server);
			await givenLoaded(step, server);
			await step(
				`And the pair now holds the row of "c" in the generation 2, and ${change}`,
				() => {
					server.rows = scored([["c", 0.75]]);
					server.rev = 2;
					apply(server);
				},
			);
			const result = await whenLoad(step, server);
			await thenError(step, result, error);
			await thenSearchAnswers(step, server, ["b", "a"]);
		},
	);
}

scenario(
	"A file that fails without a response answers an error and keeps the copy",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenAB(step, server);
		await givenLoaded(step, server);
		await step(
			'And the pair now holds the row of "c" in the generation 2, and .idx fails without a response',
			() => {
				server.rows = scored([["c", 0.75]]);
				server.rev = 2;
				server.fail.idx = abort;
			},
		);
		const result = await whenLoad(step, server);
		await step("Then it answers with the message's id and an error", () => {
			expect(result.reply.id).toBe(result.sent);
			expect(typeof result.reply.error).toBe("string");
			expect(result.reply.rows).toBeUndefined();
		});
		await thenSearchAnswers(step, server, ["b", "a"]);
	},
);

scenario(
	"A query that does not have 256 dimensions answers an error",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenAB(step, server);
		await givenLoaded(step, server);
		let result;
		await step(
			"When the worker is sent a search with a query of 255 dimensions",
			async () => {
				result = await send(server, {
					op: "search",
					query: QUERY.slice(1),
					k: 3,
				});
			},
		);
		await thenError(step, result, "wrong query dimensions (255 ≠ 256)");
		await thenSearchAnswers(step, server, ["b", "a"]);
	},
);

scenario("An unknown op answers an error", async ({ step, t }) => {
	const server = await background(step, t);
	let result;
	await step('When the worker is sent the op "drop"', async () => {
		result = await send(server, { op: "drop" });
	});
	await thenError(step, result, "unknown op: drop");
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

for (const { wasm, fail } of [
	{ wasm: "answers with the status 404", fail: answer(404, "no") },
	{ wasm: "fails without a response", fail: abort },
	{
		wasm: "answers with bytes that are not WebAssembly",
		fail: () =>
			new Response("not wasm", {
				headers: { "Content-Type": "application/wasm" },
			}),
	},
]) {
	scenario(
		`Scoring in JavaScript gives the results of bdot264.wasm (${wasm})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			const next = random(1013);
			const vectors = Array.from({ length: 300 }, () => unitVector(next));
			const query = unitVector(next);
			const searchMsg = { op: "search", query, k: 20 };
			let first;
			let second;
			await step(
				"Given /bdot264.wasm can be instantiated with its memory of 256 MiB",
				async () => {
					// what the worker does, so that the first worker scores with the kernel (it falls back without a word)
					const bytes = await readFile(publicUrl("bdot264.wasm"));
					expect(WebAssembly.validate(bytes)).toBe(true);
					const memory = new WebAssembly.Memory({
						initial: 4096,
						maximum: 4096,
					});
					const { instance } = await WebAssembly.instantiate(bytes, {
						env: { memory },
					});
					expect(Object.keys(instance.exports)).toContain("bdot264");
				},
			);
			await step(
				"And the pair holds 300 rows of 100 ids, the rows and the query being random unit vectors",
				() => {
					server.rows = vectors.map((v, i) => [
						`r${String(i % 100).padStart(3, "0")}`,
						v,
					]);
				},
			);
			await step(
				"When one worker loads it and searches with k 20",
				async () => {
					expect((await load(server)).reply.rows).toBe(300);
					first = (await send(server, searchMsg)).reply.results;
					expect(server.requests.wasm).toBe(1);
				},
			);
			await step(
				`And a second worker, for which /bdot264.wasm ${wasm}, loads it and searches with k 20`,
				async () => {
					server.wasm = fail;
					startWorker(server, "js");
					expect((await load(server, "js")).reply.rows).toBe(300);
					second = (await send(server, searchMsg, "js")).reply.results;
					expect(server.requests.wasm).toBe(2);
				},
			);
			await step(
				"Then both answer the same 20 ids in the same order, with scores within 0.00001",
				() => {
					expect(first).toHaveLength(20);
					expect(second.map(([id]) => id)).toEqual(first.map(([id]) => id));
					second.forEach(([, score], i) => {
						expect(Math.abs(score - first[i][1])).toBeLessThan(0.00001);
					});
				},
			);
		},
	);
}
