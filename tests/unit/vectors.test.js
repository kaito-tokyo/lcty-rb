// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1011: the scenarios of docs/specs/LCTYSP-1011_vector-store.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// embedQuery of js/search/vectors.js is given a fake connection ({ call }). The store (createVectorStore()) starts the
// real worker /fuzzy_search.worker.js (LCTYSP-1013) as a Web Worker of Node.js 26 (node-preload.cjs). Its requests, and
// the request of its script, are answered by routeFetch (node-unit.js), as routes do in the browser: the vector pair
// is built by the test in the layout of LCTYSP-0019 (record 0 the header, then rows of 256 Float32 LE and 32 zero
// bytes, and 16 bytes of id per record), served as the server serves it (the JSON, and the files by Range with
// If-Match of the generation), and the script and /bdot264.wasm are the files of public/ unless the test makes the
// script fail.

import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const { createVectorStore, embedQuery } = await import(
	publicUrl("js/search/vectors.js")
);

// ---- The query embedding ----

/** A fake connection whose call answers answer(method, params) and records its calls. */
function connection(answer) {
	const calls = [];
	return {
		calls,
		call: async (method, params) => {
			calls.push([method, params]);
			return answer(method, params);
		},
	};
}

/** The base64 of bytes. */
const base64 = (bytes) => Buffer.from(bytes).toString("base64");

function embed(rpc, text) {
	return embedQuery(rpc, text).then(
		(vector) => ({ vector }),
		(e) => ({ rejected: e.message }),
	);
}

scenario("A query is embedded by the server", async ({ step }) => {
	let rpc;
	await step(
		"Given a connection whose vectors.eg2_264.embed answers the base64 of 256 Float32 LE, 0.5 in the first and -0.25 in the last",
		() => {
			const v = new Float32Array(256);
			v[0] = 0.5;
			v[255] = -0.25;
			rpc = connection(() => ({
				vector: base64(new Uint8Array(v.buffer)),
			}));
		},
	);
	let result;
	await step('When embedQuery embeds "closures" over it', async () => {
		result = await embed(rpc, "closures");
	});
	await step(
		'Then vectors.eg2_264.embed was called once with { text: "closures" }',
		() => {
			expect(rpc.calls).toEqual([
				["vectors.eg2_264.embed", { text: "closures" }],
			]);
		},
	);
	await step(
		"And it resolves with a Float32Array of 256, 0.5 in the first, -0.25 in the last and 0 in the others",
		() => {
			const { vector } = result;
			expect(vector).toBeInstanceOf(Float32Array);
			expect(vector.length).toBe(256);
			expect(vector[0]).toBe(0.5);
			expect(vector[255]).toBe(-0.25);
			expect(vector.slice(1, 255).every((x) => x === 0)).toBe(true);
		},
	);
});

for (const [bytes, floats] of [
	[1020, 255],
	[3072, 768],
	[0, 0],
]) {
	scenario(
		`An answer that is not 256 floats rejects (${bytes})`,
		async ({ step }) => {
			let rpc;
			await step(
				`Given a connection whose vectors.eg2_264.embed answers the base64 of ${bytes} bytes`,
				() => {
					rpc = connection(() => ({ vector: base64(new Uint8Array(bytes)) }));
				},
			);
			let result;
			await step('When embedQuery embeds "closures" over it', async () => {
				result = await embed(rpc, "closures");
			});
			await step(
				`Then it rejects with "wrong query dimensions (${floats} ≠ 256)"`,
				() => {
					expect(result).toEqual({
						rejected: `wrong query dimensions (${floats} ≠ 256)`,
					});
				},
			);
		},
	);
}

scenario("A failed call of the connection passes through", async ({ step }) => {
	let rpc;
	await step(
		'Given a connection whose vectors.eg2_264.embed rejects with "semantic search is unavailable"',
		() => {
			rpc = connection(() => {
				throw new Error("semantic search is unavailable");
			});
		},
	);
	let result;
	await step('When embedQuery embeds "closures" over it', async () => {
		result = await embed(rpc, "closures");
	});
	await step('Then it rejects with "semantic search is unavailable"', () => {
		expect(result).toEqual({ rejected: "semantic search is unavailable" });
	});
});

// ---- The store ----

const JSON_PATH = "/v1/vectors.eg2_264.json";
const DAT = "/v1/vectors.eg2_264.dat";
const IDX = "/v1/vectors.eg2_264.idx";
const WORKER = "/fuzzy_search.worker.js";
const REC = 1056; // a row of .dat
const ID = 16; // an id of .idx

/** The UUIDv7 of a short name ("a" → 019a0000-0000-7000-8000-000000000061). */
function uuid(name) {
	const hex = Buffer.from(name).toString("hex").padStart(12, "0");
	return `019a0000-0000-7000-8000-${hex}`;
}

const nameOf = (id) =>
	Buffer.from(id.slice(24).replace(/^(00)+/, ""), "hex").toString();
const named = (results) => results.map(([id, score]) => [nameOf(id), score]);

/** The files of a pair of rows [name, first values]: record 0 the header (NaNs, an id of zeros), then the rows. */
function files(rows) {
	const f = new Float32Array(((rows.length + 1) * REC) / 4);
	f.fill(Number.NaN, 0, 256);
	rows.forEach(([, values], i) => {
		f.set([values].flat(), ((i + 1) * REC) / 4);
	});
	return {
		dat: Buffer.from(f.buffer),
		idx: Buffer.concat([
			Buffer.alloc(ID),
			...rows.map(([n]) => Buffer.from(uuid(n).replace(/-/g, ""), "hex")),
		]),
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

/** A 256-dimension query: 1 in its first dimension, or the values given at their indices. */
function query(values = { 0: 1 }, length = 256) {
	return Array.from({ length }, (_, i) => values[i] ?? 0);
}

/** An answer of a route: a response with the status. */
const answer = (status, body) => () => new Response(body, { status });

/**
 * The pair answered by the test. server.pair is {rev, rows}, server.fail an answer per file that replaces it,
 * server.short makes .dat answer one byte short, server.worker the answer of /fuzzy_search.worker.js (undefined: the
 * real file); server.requests counts the requests and server.ranges keeps the Range of each file request. server.store
 * is the store the Scenario makes.
 */
async function background(step, t) {
	const server = {
		pair: { rev: 1763000000000, rows: [] },
		fail: {},
		short: false,
		worker: () => undefined,
		requests: { json: 0, dat: 0, idx: 0, worker: 0 },
		ranges: { dat: [], idx: [] },
		store: null,
		asked: [],
	};
	await step("Given the vector pair is answered by the test", () => {
		routeFetch(t, (request) => {
			const path = new URL(request.url).pathname;
			if (path === JSON_PATH) {
				server.requests.json++;
				return Response.json(summary(server));
			}
			const key = { [DAT]: "dat", [IDX]: "idx" }[path];
			if (key) return serveRange(server, key, request);
			if (path === WORKER) {
				server.requests.worker++;
				return server.worker(request);
			}
		});
	});
	return server;
}

/** The pair's JSON */
function summary(server) {
	return {
		rev: server.pair.rev,
		count: server.pair.rows.length + 1,
		invalid: [],
	};
}

/** A file of the pair as the server serves it: 206 for bytes=first-last, 412 for another generation */
function serveRange(server, key, request) {
	server.requests[key]++;
	const range = request.headers.get("range");
	server.ranges[key].push(range);
	if (server.fail[key]) return server.fail[key](request);
	if (request.headers.get("if-match") !== `"${server.pair.rev}"`)
		return new Response("", { status: 412 });
	const body = files(server.pair.rows)[key];
	const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
	let bytes = body.subarray(first, last + 1);
	if (key === "dat" && server.short) bytes = bytes.subarray(0, -1);
	return new Response(bytes, {
		status: 206,
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Range": `bytes ${first}-${last}/${body.length}`,
		},
	});
}

function refresh(server) {
	const store = server.store;
	return store.refresh().then(
		() => ({ resolved: true, size: store.size }),
		(e) => ({ rejected: e.message, size: store.size }),
	);
}

/** store.search(q, k, {allow, accept}); accept is {only} or {reject} (a name), and the ids it is asked are kept. */
function search(server, q, k, { allow, accept } = {}) {
	server.asked = [];
	const options = {};
	if (allow) options.allow = allow;
	if (accept)
		options.accept = (id) => {
			server.asked.push(id);
			return accept.only ? id === accept.only : id !== accept.reject;
		};
	return server.store.search(Float32Array.from(q), k, options).then(
		(results) => ({ results }),
		(e) => ({ rejected: e.message }),
	);
}

async function givenThePairHolds(step, server, rows, text) {
	await step(`Given the pair holds ${text}`, () => {
		server.pair = { rev: server.pair.rev, rows };
	});
}

async function givenAStore(step, server) {
	await step("And a store made by createVectorStore()", () => {
		server.store = createVectorStore();
	});
}

async function givenRefreshed(step, server) {
	await step("And a store that has been refreshed", async () => {
		server.store = createVectorStore();
		expect((await refresh(server)).resolved).toBe(true);
	});
}

async function whenRefresh(step, server) {
	let result;
	await step("When refresh() is called", async () => {
		result = await refresh(server);
	});
	return result;
}

async function thenResolvesWithSize(step, result, n) {
	await step(`Then it resolves and the size is ${n}`, () => {
		expect(result).toEqual({ resolved: true, size: n });
	});
}

async function thenEachFileFromRecord1(step, server) {
	await step("And each file was requested once, from its record 1", () => {
		const n = server.pair.rows.length + 1;
		expect(server.ranges.dat).toEqual([`bytes=${REC}-${n * REC - 1}`]);
		expect(server.ranges.idx).toEqual([`bytes=${ID}-${n * ID - 1}`]);
	});
}

async function thenSearchAnswers(step, server, names, text) {
	await step(`And a search with k 3 answers ${text}`, async () => {
		const { results } = await search(server, query(), 3);
		expect(named(results).map(([n]) => n)).toEqual(names);
	});
}

async function whenSearch(
	step,
	server,
	k,
	text = `with k ${k}`,
	q = query(),
	opts,
) {
	let result;
	await step(`When it searches ${text}`, async () => {
		result = await search(server, q, k, opts);
	});
	return result;
}

async function thenAnswers(step, result, expected, text) {
	await step(`Then it answers ${text}`, () => {
		expect(named(result.results)).toEqual(expected);
	});
}

scenario("A new store is empty and starts no worker", async ({ step, t }) => {
	const server = await background(step, t);
	await step("When createVectorStore() makes a store", () => {
		server.store = createVectorStore();
	});
	let result;
	await step("And it searches with k 3", async () => {
		result = await search(server, query(), 3);
	});
	await step("Then its size is 0", () => {
		expect(server.store.size).toBe(0);
	});
	await step("And the search answers no ids", () => {
		expect(result).toEqual({ results: [] });
	});
	await step("And /fuzzy_search.worker.js was not requested", async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(server.requests.worker).toBe(0);
	});
});

scenario(
	"A refresh loads the vector pair in the worker",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(
			step,
			server,
			[
				["a", 0.25],
				["b", 0.5],
				["c", 0.75],
			],
			'the rows of "a", "b" and "c"',
		);
		await givenAStore(step, server);
		const result = await whenRefresh(step, server);
		await thenResolvesWithSize(step, result, 3);
		await step("And /fuzzy_search.worker.js was requested once", () => {
			expect(server.requests.worker).toBe(1);
		});
		await step("And the JSON was requested once", () => {
			expect(server.requests.json).toBe(1);
		});
		await thenEachFileFromRecord1(step, server);
	},
);

// ---- The notifications ----

async function givenCAppended(step, server) {
	await step('And the row of "c" is now appended to the pair', () => {
		server.pair = {
			rev: server.pair.rev,
			rows: [...server.pair.rows, ["c", 0.75]],
		};
	});
}

async function whenChanged(step, server, s = summary(server), text = "") {
	await step(`When changed() is given the summary of the pair${text}`, () =>
		server.store.changed(s),
	);
}

async function thenSizeIs(step, server, n) {
	await step(`Then the size is ${n}`, () => {
		expect(server.store.size).toBe(n);
	});
}

async function thenJsonRequested(step, server, n, text) {
	await step(`And the JSON was requested ${text}`, () => {
		expect(server.requests.json).toBe(n);
	});
}

/** A store whose actor() answers server.actor, refreshed */
async function givenFollowing(step, server) {
	await step(
		'And a store whose connection\'s actorId is "actor-1", refreshed',
		async () => {
			server.actor = "actor-1";
			server.store = createVectorStore({ actor: () => server.actor });
			expect((await refresh(server)).resolved).toBe(true);
		},
	);
}

const ABC = ["c", "b", "a"];

scenario(
	"A notification brings a loaded copy up to date without the JSON",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenRefreshed(step, server);
		await givenCAppended(step, server);
		await whenChanged(step, server);
		await thenSizeIs(step, server, 3);
		await thenJsonRequested(step, server, 1, "once");
		await step("And each file was requested again, from its record 3", () => {
			expect(server.ranges.dat.at(-1)).toBe(`bytes=${3 * REC}-${4 * REC - 1}`);
			expect(server.ranges.idx.at(-1)).toBe(`bytes=${3 * ID}-${4 * ID - 1}`);
			expect(server.ranges.dat.length).toBe(2);
		});
		await thenSearchAnswers(step, server, ABC, '"c", "b" and "a"');
	},
);

scenario(
	"A notification before the first load does nothing",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenAStore(step, server);
		await whenChanged(step, server);
		await thenSizeIs(step, server, 0);
		await step("And /fuzzy_search.worker.js was not requested", () => {
			expect(server.requests.worker).toBe(0);
		});
	},
);

scenario(
	"An older summary of the same generation changes nothing",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenRefreshed(step, server);
		const older = summary(server);
		await givenCAppended(step, server);
		await step("And the store has been refreshed again", async () => {
			expect(await refresh(server)).toEqual({ resolved: true, size: 3 });
		});
		await whenChanged(
			step,
			server,
			older,
			' as it was with the rows of "a" and "b"',
		);
		await thenSizeIs(step, server, 3);
		await step("And each file was requested twice", () => {
			expect(server.requests.dat).toBe(2);
			expect(server.requests.idx).toBe(2);
		});
		await thenSearchAnswers(step, server, ABC, '"c", "b" and "a"');
	},
);

scenario(
	"A refresh fetches nothing while the connection's notifications keep the copy",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenFollowing(step, server);
		const result = await whenRefresh(step, server);
		await thenResolvesWithSize(step, result, 2);
		await thenJsonRequested(step, server, 1, "once");
	},
);

for (const [text, actor] of [
	['"actor-2"', "actor-2"],
	["null", null],
]) {
	scenario(
		`A refresh fetches the JSON when the connection changed (${text})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
			await givenFollowing(step, server);
			await givenCAppended(step, server);
			await step(`And the connection's actorId is now ${text}`, () => {
				server.actor = actor;
			});
			const result = await whenRefresh(step, server);
			await step("Then it resolves and the size is 3", () => {
				expect(result).toEqual({ resolved: true, size: 3 });
			});
			await thenJsonRequested(step, server, 2, "twice");
		},
	);
}

scenario(
	"A failed notification makes the next refresh fetch the JSON",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenFollowing(step, server);
		await givenCAppended(step, server);
		await step(
			"And /v1/vectors.eg2_264.dat answers with the status 500",
			() => {
				server.fail.dat = answer(500, "");
			},
		);
		t.mock.method(console, "warn", () => {});
		await whenChanged(step, server);
		await thenSizeIs(step, server, 2);
		await step("When /v1/vectors.eg2_264.dat is served again", () => {
			delete server.fail.dat;
		});
		let result;
		await step("And refresh() is called", async () => {
			result = await refresh(server);
		});
		await step("Then it resolves and the size is 3", () => {
			expect(result).toEqual({ resolved: true, size: 3 });
		});
		await thenJsonRequested(step, server, 2, "twice");
	},
);

scenario("Concurrent refreshes share one load", async ({ step, t }) => {
	const server = await background(step, t);
	await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
	await givenAStore(step, server);
	let result;
	await step("When refresh() is called twice at once", async () => {
		const store = server.store;
		await Promise.all([store.refresh(), store.refresh()]);
		result = { size: store.size };
	});
	await step("Then both resolve and the size is 2", () => {
		expect(result).toEqual({ size: 2 });
	});
	await thenEachFileFromRecord1(step, server);
});

scenario(
	"A refresh after a new generation loads the new rows in the same worker",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenRefreshed(step, server);
		await step(
			'And the pair is now a new generation holding the row of "c"',
			() => {
				server.pair = { rev: server.pair.rev + 1, rows: [["c", 0.75]] };
			},
		);
		const result = await whenRefresh(step, server);
		await thenResolvesWithSize(step, result, 1);
		await thenSearchAnswers(step, server, ["c"], '"c"');
		await step("And /fuzzy_search.worker.js was requested once", () => {
			expect(server.requests.worker).toBe(1);
		});
	},
);

scenario(
	"Refreshing a pair with no rows leaves the store empty",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, [], "no rows");
		await givenAStore(step, server);
		const result = await whenRefresh(step, server);
		await thenResolvesWithSize(step, result, 0);
		await thenSearchAnswers(step, server, [], "no ids");
	},
);

scenario(
	"A search answers the k best ids by their best row, with their scores",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
		await givenRefreshed(step, server);
		const result = await whenSearch(step, server, 3);
		await thenAnswers(
			step,
			result,
			[
				["a", 0.875],
				["c", 0.75],
				["b", 0.5],
			],
			'"a" 0.875, "c" 0.75 and "b" 0.5',
		);
	},
);

scenario("The query is given to the worker as it is", async ({ step, t }) => {
	const server = await background(step, t);
	await givenThePairHolds(
		step,
		server,
		[
			["x", [1, 0, 0]],
			["y", [0, 1, 0]],
			["z", [0, 0, 1]],
		],
		'the rows of "x", "y" and "z", 1 in their first, second and third dimension',
	);
	await givenRefreshed(step, server);
	const result = await whenSearch(
		step,
		server,
		3,
		"with k 3 for a query of 0.6 and 0.8 in its first two dimensions",
		query({ 0: 0.6, 1: 0.8 }),
	);
	await step('Then it answers "y" 0.8, "x" 0.6 and "z" 0', () => {
		const answered = named(result.results);
		expect(answered.map(([n]) => n)).toEqual(["y", "x", "z"]);
		expect(answered[0][1]).toBeCloseTo(0.8, 6);
		expect(answered[1][1]).toBeCloseTo(0.6, 6);
		expect(answered[2][1]).toBe(0);
	});
});

scenario(
	"A store searched without k answers at most 50 ids",
	async ({ step, t }) => {
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
		await givenRefreshed(step, server);
		const result = await whenSearch(step, server, undefined, "without k");
		await step("Then it answers the 50 best ids, descending", () => {
			expect(named(result.results)).toEqual(
				Array.from({ length: 50 }, (_, i) => [
					`n${String(59 - i).padStart(2, "0")}`,
					(59 - i) / 64,
				]),
			);
		});
	},
);

scenario("allow is the only ids the worker may answer", async ({ step, t }) => {
	const server = await background(step, t);
	await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenRefreshed(step, server);
	const result = await whenSearch(
		step,
		server,
		3,
		'with k 3 and allow "b" and "d"',
		query(),
		{ allow: [uuid("b"), uuid("d")] },
	);
	await thenAnswers(
		step,
		result,
		[
			["b", 0.5],
			["d", 0.125],
		],
		'"b" 0.5 and "d" 0.125',
	);
});

scenario(
	"accept drops ids on the main thread before k are taken",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
		await givenRefreshed(step, server);
		const result = await whenSearch(
			step,
			server,
			2,
			'with k 2 and an accept that rejects "a"',
			query(),
			{ accept: { reject: uuid("a") } },
		);
		await thenAnswers(
			step,
			result,
			[
				["c", 0.75],
				["b", 0.5],
			],
			'"c" 0.75 and "b" 0.5',
		);
	},
);

scenario("accept is given only the 2k best ids", async ({ step, t }) => {
	const server = await background(step, t);
	await givenThePairHolds(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
	await givenRefreshed(step, server);
	const result = await whenSearch(
		step,
		server,
		1,
		'with k 1 and an accept that takes only "d"',
		query(),
		{ accept: { only: uuid("d") } },
	);
	await thenAnswers(step, result, [], "no ids");
	await step('And accept was asked about "a" and "c" only', () => {
		expect(server.asked.map(nameOf)).toEqual(["a", "c"]);
	});
});

scenario(
	"A query shorter than 256 dimensions is rejected by the worker",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await givenRefreshed(step, server);
		const result = await whenSearch(
			step,
			server,
			3,
			"with k 3 for a query of 100 dimensions",
			query({ 0: 1 }, 100),
		);
		await step(
			'Then the search rejects with "wrong query dimensions (100 ≠ 256)"',
			() => {
				expect(result).toEqual({
					rejected: "wrong query dimensions (100 ≠ 256)",
				});
			},
		);
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
		change: "the rows are one byte short",
		error: "broken vectors (2111 bytes for 2112)",
		apply: (server) => {
			server.short = true;
		},
	},
]) {
	scenario(
		`A failed refresh rejects and keeps what was loaded (${change})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
			await givenRefreshed(step, server);
			await step(`And the pair is now a new generation, and ${change}`, () => {
				server.pair = { ...server.pair, rev: server.pair.rev + 1 };
				apply(server);
			});
			const result = await whenRefresh(step, server);
			await step(`Then it rejects with "${error}"`, () => {
				expect(result.rejected).toBe(error);
			});
			await step("And the size is still 2", () => {
				expect(server.store.size).toBe(2);
			});
			await thenSearchAnswers(step, server, ["b", "a"], '"b" and "a"');
		},
	);
}

scenario(
	"A worker that cannot be loaded rejects the refresh",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await step(
			"And /fuzzy_search.worker.js answers with the status 404",
			() => {
				server.worker = answer(404, "no");
			},
		);
		await givenAStore(step, server);
		const result = await whenRefresh(step, server);
		await step("Then it rejects with an error", () => {
			expect(typeof result.rejected).toBe("string");
			expect(result.rejected).not.toBe("");
		});
		await step("And the size is still 0", () => {
			expect(result.size).toBe(0);
		});
	},
);

scenario(
	"A store whose worker failed starts a new worker at the next call",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenThePairHolds(step, server, ROWS_AB, 'the rows of "a" and "b"');
		await step(
			"And /fuzzy_search.worker.js answers with the status 404 once, then is served",
			() => {
				server.worker = () => {
					server.worker = () => undefined;
					return new Response("no", { status: 404 });
				};
			},
		);
		await givenAStore(step, server);
		const first = await whenRefresh(step, server);
		await step('Then it rejects with "the vector search worker failed"', () => {
			expect(first.rejected).toBe("the vector search worker failed");
		});
		let second;
		await step("When refresh() is called again", async () => {
			// a call that never settles (a dead worker kept) is told apart from a failure within 5 s
			second = await Promise.race([
				refresh(server),
				new Promise((resolve) =>
					setTimeout(() => resolve({ pending: true }), 5000).unref(),
				),
			]);
		});
		await thenResolvesWithSize(step, second, 2);
		await thenSearchAnswers(step, server, ["b", "a"], '"b" and "a"');
		await step("And /fuzzy_search.worker.js was requested twice", () => {
			expect(server.requests.worker).toBe(2);
		});
	},
);
