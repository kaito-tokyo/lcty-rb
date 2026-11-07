// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1013: the scenarios of docs/specs/LCTYSP-1013_fuzzy-search-worker.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by
// side.
//
// The worker runs as a Web Worker of Node.js 26 (node-preload.cjs), started from public/ as siteUrl() would. Its
// requests are answered by routeFetch (node-unit.js), as routes do in the browser: the distribution files are built by
// the test in the layout of LCTYSP-0008 (256 Float32 LE and 32 zero bytes per row, 16 bytes of id per row), and
// /bdot264.wasm is the real kernel of public/ unless the test makes it fail, so that the worker scores in JavaScript.

import { readFile } from "node:fs/promises";
import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

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
const ROWS_ABCDA_TEXT =
	'the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875';
const ROWS_AB = [
	["a", 0.25],
	["b", 0.5],
];

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
 * The files answered by the test and the worker started (server.workers.w). server.files is the pair, server.etag the
 * ETag of each file by its request number (or null), server.fail an answer per file that replaces the files,
 * server.wasm the answer of /bdot264.wasm (undefined: the real file); server.requests counts the requests.
 */
async function background(step, t) {
	const server = {
		files: { dat: Buffer.alloc(0), idx: Buffer.alloc(0) },
		etag: { dat: () => null, idx: () => null },
		fail: {},
		wasm: () => undefined,
		requests: { dat: 0, idx: 0, wasm: 0 },
		workers: {},
	};
	await step(
		"Given /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx are answered by the test",
		() => {
			routeFetch(t, (request) => {
				const path = new URL(request.url).pathname;
				const key = { [DAT]: "dat", [IDX]: "idx" }[path];
				if (key) {
					const n = ++server.requests[key];
					if (server.fail[key]) return server.fail[key](request);
					const etag = server.etag[key](n);
					return new Response(server.files[key], {
						headers: {
							"Content-Type": "application/octet-stream",
							...(etag ? { ETag: etag } : {}),
						},
					});
				}
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

const load = (server, name) =>
	send(server, { op: "load", dat: DAT, idx: IDX }, name);
const search = (server, k, extra = {}, name) =>
	send(server, { op: "search", query: QUERY, k, ...extra }, name);

// ---- Steps shared by the scenarios ----

async function givenTheFilesHold(step, server, rows, text, etag = null) {
	await step(`Given the files hold ${text}`, () => {
		server.files = files(rows);
		server.etag = { dat: () => etag, idx: () => etag };
	});
}

async function givenLoaded(step, server) {
	await step("And the worker has loaded them", async () => {
		const { reply } = await load(server);
		expect(reply.error).toBeUndefined();
	});
}

async function whenLoad(step, server) {
	let result;
	await step("When the worker is sent a load of the two files", async () => {
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
	"Loading fetches both files and answers the row count",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
			step,
			server,
			[
				["a", 0.25],
				["b", 0.5],
				["c", 0.75],
			],
			'the rows of "a", "b" and "c"',
		);
		const result = await whenLoad(step, server);
		await thenRows(step, result, 3);
		await step("And each file was requested once", () => {
			expect(server.requests.dat).toBe(1);
			expect(server.requests.idx).toBe(1);
		});
		await step("And /bdot264.wasm was requested once", () => {
			expect(server.requests.wasm).toBe(1);
		});
	},
);

scenario(
	"A search answers the k best ids by their best row, descending",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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
		await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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
	await givenTheFilesHold(
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
	await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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
	await givenTheFilesHold(
		step,
		server,
		[
			["a", 0.25],
			["b", 0.5],
			["c", 0.75],
		],
		'the rows of "a", "b" and "c"',
	);
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

scenario("Empty files load as no rows", async ({ step, t }) => {
	const server = await background(step, t);
	await step("Given the files are empty", () => {
		server.files = { dat: Buffer.alloc(0), idx: Buffer.alloc(0) };
	});
	const result = await whenLoad(step, server);
	await thenRows(step, result, 0);
	await thenSearchAnswers(step, server, []);
});

scenario(
	"A pair with the ETag already loaded is not read again",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
			step,
			server,
			ROWS_AB,
			'the rows of "a" and "b", with the ETag "v1"',
			'"v1"',
		);
		await givenLoaded(step, server);
		await step(
			'And the files now hold the row of "c", still with the ETag "v1"',
			() => {
				server.files = files([["c", 0.75]]);
			},
		);
		const result = await whenLoad(step, server);
		await thenRows(step, result, 2);
		await thenSearchAnswers(step, server, ["b", "a"]);
	},
);

scenario(
	"A pair with a new ETag replaces what was loaded",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
			step,
			server,
			ROWS_AB,
			'the rows of "a" and "b", with the ETag "v1"',
			'"v1"',
		);
		await givenLoaded(step, server);
		await step(
			'And the files now hold the row of "c", with the ETag "v2"',
			() => {
				server.files = files([["c", 0.75]]);
				server.etag = { dat: () => '"v2"', idx: () => '"v2"' };
			},
		);
		const result = await whenLoad(step, server);
		await thenRows(step, result, 1);
		await thenSearchAnswers(step, server, ["c"]);
	},
);

scenario(
	"Files without an ETag are read at every load",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
			step,
			server,
			ROWS_AB,
			'the rows of "a" and "b", without an ETag',
		);
		await givenLoaded(step, server);
		await step('And the files now hold the row of "c", without an ETag', () => {
			server.files = files([["c", 0.75]]);
		});
		const result = await whenLoad(step, server);
		await thenRows(step, result, 1);
		await thenSearchAnswers(step, server, ["c"]);
	},
);

scenario("A pair whose ETags differ is fetched again", async ({ step, t }) => {
	const server = await background(step, t);
	await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
	await step(
		'And /v1/vectors.eg2_264.idx has the ETag "v0" at its first request and "v1" later, /v1/vectors.eg2_264.dat "v1"',
		() => {
			server.etag = {
				dat: () => '"v1"',
				idx: (n) => (n === 1 ? '"v0"' : '"v1"'),
			};
		},
	);
	const result = await whenLoad(step, server);
	await thenRows(step, result, 2);
	await step("And each file was requested twice", () => {
		expect(server.requests.dat).toBe(2);
		expect(server.requests.idx).toBe(2);
	});
});

scenario(
	"A pair whose ETags never agree is used after three tries",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await step(
			'And /v1/vectors.eg2_264.dat always has the ETag "v1" and /v1/vectors.eg2_264.idx "v2"',
			() => {
				server.etag = { dat: () => '"v1"', idx: () => '"v2"' };
			},
		);
		const result = await whenLoad(step, server);
		await thenRows(step, result, 2);
		await step("And each file was requested 3 times", () => {
			expect(server.requests.dat).toBe(3);
			expect(server.requests.idx).toBe(3);
		});
	},
);

for (const { change, error, apply } of [
	{
		change: "/v1/vectors.eg2_264.dat answers with the status 500",
		error: "failed to fetch the vectors (HTTP 500)",
		apply: (server) => {
			server.fail.dat = answer(500, "boom");
		},
	},
	{
		change: "/v1/vectors.eg2_264.idx answers with the status 404",
		error: "failed to fetch the vectors (HTTP 404)",
		apply: (server) => {
			server.fail.idx = answer(404, "no");
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
	scenario(
		`A failed load answers an error and keeps what was loaded (${change})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenTheFilesHold(
				step,
				server,
				ROWS_AB,
				'the rows of "a" and "b", with the ETag "v1"',
				'"v1"',
			);
			await givenLoaded(step, server);
			await step(`And with the ETag "v2", ${change}`, () => {
				server.etag = { dat: () => '"v2"', idx: () => '"v2"' };
				apply(server);
			});
			const result = await whenLoad(step, server);
			await thenError(step, result, error);
			await thenSearchAnswers(step, server, ["b", "a"]);
		},
	);
}

scenario(
	"A file that fails without a response answers an error",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
			step,
			server,
			ROWS_AB,
			'the rows of "a" and "b", with the ETag "v1"',
			'"v1"',
		);
		await givenLoaded(step, server);
		await step(
			"And /v1/vectors.eg2_264.idx now fails without a response",
			() => {
				server.fail.idx = abort;
			},
		);
		const result = await whenLoad(step, server);
		await step("Then it answers with the message's id and an error", () => {
			expect(result.reply.id).toBe(result.sent);
			expect(typeof result.reply.error).toBe("string");
			expect(result.reply.error).not.toBe("");
			expect(result.reply.rows).toBeUndefined();
		});
		await thenSearchAnswers(step, server, ["b", "a"]);
	},
);

scenario(
	"A query that does not have 256 dimensions answers an error",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenLoaded(step, server);
		let result;
		await step(
			"When the worker is sent a search with a query of 255 dimensions",
			async () => {
				result = await send(server, {
					op: "search",
					query: QUERY.slice(0, 255),
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
			const names = vectors.map(
				(_, i) => `r${String(i % 100).padStart(3, "0")}`,
			);
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
				"And the files hold 300 rows of 100 ids, the rows and the query being random unit vectors",
				() => {
					server.files = { dat: rowsFile(vectors), idx: idsFile(names) };
				},
			);
			await step(
				"When one worker loads them and searches with k 20",
				async () => {
					expect((await load(server)).reply.rows).toBe(300);
					first = (await send(server, searchMsg)).reply.results;
					expect(server.requests.wasm).toBe(1);
				},
			);
			await step(
				`And a second worker, for which /bdot264.wasm ${wasm}, loads them and searches with k 20`,
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
