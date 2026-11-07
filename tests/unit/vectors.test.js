// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1011: the scenarios of docs/specs/LCTYSP-1011_vector-store.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// encodeRecords and FULL_DIM of js/search/vectors.js are pure. The store (createVectorStore()) starts the real worker
// /fuzzy_search.worker.js (LCTYSP-1013) as a Web Worker of Node.js 26 (node-preload.cjs). Its requests, and the request
// of its script, are answered by routeFetch (node-unit.js), as routes do in the browser: the distribution files are
// built by the test in the layout of LCTYSP-0008, and the script and /bdot264.wasm are the files of public/ unless the
// test makes the script fail.

import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const { createVectorStore, encodeRecords, FULL_DIM } = await import(
	publicUrl("js/search/vectors.js")
);

// the control block of registration: "lctyvLE0", 3072 as uint32 LE, a reserved 0 (LCTYSP-3006)
const CONTROL = "6c637479764c4530" + "000c0000" + "00000000";
const ID = "0190f3a1-7c2e-7abc-8def-0123456789ab";

/** A vector of n Float32 values that are all different and exact. */
const vector = (n, seed = 0) =>
	Array.from({ length: n }, (_, i) => (i - 300) / 8 + seed);

/** Bytes of Float32 LE as hex. */
const f32hex = (values) =>
	Buffer.from(Float32Array.from(values).buffer).toString("hex");

/** encodeRecords of items [{id, vec: values, view?}], as {hex, size, count} or {error}. */
function encode(items) {
	try {
		const { body, size, count } = encodeRecords(
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
		const hex = Buffer.from(body.buffer, body.byteOffset, body.length).toString(
			"hex",
		);
		return { isUint8Array: body instanceof Uint8Array, hex, size, count };
	} catch (e) {
		return { error: e.message };
	}
}

scenario(
	"A record is the control block, the id and the vector",
	async ({ step }) => {
		const vec = vector(768);
		await step("Given a UUIDv7 id and a vector of 768 Float32 values", () => {
			expect(ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		});
		let result;
		await step("When encodeRecords encodes them", () => {
			result = encode([{ id: ID, vec }]);
		});
		await step(
			"Then it returns a body of 3,104 bytes, the size 3072 and the count 1",
			() => {
				expect(result.isUint8Array).toBe(true);
				expect(result.hex.length / 2).toBe(3104);
				expect(result.size).toBe(3072);
				expect(result.count).toBe(1);
			},
		);
		await step(
			"And the bytes 0 to 15 are 6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00",
			() => {
				expect(result.hex.slice(0, 32)).toBe(
					"6c637479764c4530000c000000000000",
				);
			},
		);
		await step("And the bytes 16 to 31 are the 16 bytes of the id", () => {
			expect(result.hex.slice(32, 64)).toBe(ID.replace(/-/g, ""));
		});
		await step("And the rest is the vector as Float32 LE", () => {
			expect(result.hex.slice(64)).toBe(f32hex(vec));
		});
	},
);

scenario("Records follow each other in the order given", async ({ step }) => {
	const other = "0190f3a1-7c2e-7abc-8def-ba9876543210";
	const items = [
		{ id: ID, vec: vector(768, 1) },
		{ id: other, vec: vector(768, 2) },
		{ id: ID, vec: vector(768, 3) },
	];
	await step(
		"Given three items, the first and the third with the same id",
		() => {
			expect(items[0].id).toBe(items[2].id);
		},
	);
	let result;
	await step("When encodeRecords encodes them", () => {
		result = encode(items);
	});
	await step(
		"Then it returns a body of 9,312 bytes, the size 3072 and the count 3",
		() => {
			expect(result.hex.length / 2).toBe(9312);
			expect(result.size).toBe(3072);
			expect(result.count).toBe(3);
		},
	);
	await step(
		"And each record of 3,104 bytes is the control block, the id and the vector of its item, in order",
		() => {
			items.forEach(({ id, vec }, i) => {
				expect(result.hex.slice(i * 6208, (i + 1) * 6208)).toBe(
					CONTROL + id.replace(/-/g, "") + f32hex(vec),
				);
			});
		},
	);
});

scenario("No items encode to an empty body", async ({ step }) => {
	let result;
	await step("When encodeRecords encodes no items", () => {
		result = encode([]);
	});
	await step(
		"Then it returns a body of 0 bytes, the size 3072 and the count 0",
		() => {
			expect(result).toEqual({
				isUint8Array: true,
				hex: "",
				size: 3072,
				count: 0,
			});
		},
	);
});

scenario(
	"A vector that is a view of a larger array is encoded from its own values",
	async ({ step }) => {
		let item;
		await step(
			"Given an item whose vector is the 768 values from the 11th of a Float32Array of 1,000",
			() => {
				// the array holds 0, 1, …, 999; the view starts at the value 10
				item = { id: ID, view: { length: 1000, from: 10 } };
			},
		);
		let result;
		await step("When encodeRecords encodes it", () => {
			result = encode([item]);
		});
		await step(
			"Then the bytes from 32 are those 768 values as Float32 LE",
			() => {
				expect(result.hex.length / 2).toBe(3104);
				expect(result.hex.slice(64)).toBe(
					f32hex(Array.from({ length: 768 }, (_, i) => i + 10)),
				);
			},
		);
	},
);

for (const dims of [256, 767, 769]) {
	scenario(
		`A vector that does not have 768 dimensions is rejected (${dims})`,
		async ({ step }) => {
			let item;
			await step(`Given an item whose vector has ${dims} values`, () => {
				item = { id: ID, vec: vector(dims) };
			});
			let result;
			await step("When encodeRecords encodes it", () => {
				result = encode([item]);
			});
			await step(`Then it throws "wrong dimensions (${dims} ≠ 768)"`, () => {
				expect(result).toEqual({ error: `wrong dimensions (${dims} ≠ 768)` });
			});
		},
	);
}

scenario("FULL_DIM is the dimension of registration", async ({ step }) => {
	await step("Then FULL_DIM is 768", () => {
		expect(FULL_DIM).toBe(768);
	});
});

// ---- The store ----

const DAT = "/v1/vectors.eg2_264.dat";
const IDX = "/v1/vectors.eg2_264.idx";
const WORKER = "/fuzzy_search.worker.js";
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

/** An answer of a route: a response with the status. */
const answer = (status, body) => () => new Response(body, { status });

/**
 * The files answered by the test. server.files is the pair, server.etag the ETag of both (or null), server.fail an
 * answer per file that replaces it, server.worker the answer of /fuzzy_search.worker.js (undefined: the real file);
 * server.requests counts the requests. server.store is the store the Scenario makes.
 */
async function background(step, t) {
	const server = {
		files: { dat: Buffer.alloc(0), idx: Buffer.alloc(0) },
		etag: null,
		fail: {},
		worker: () => undefined,
		requests: { dat: 0, idx: 0, worker: 0 },
		store: null,
		asked: [],
	};
	await step(
		"Given /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx are answered by the test",
		() => {
			routeFetch(t, (request) => {
				const path = new URL(request.url).pathname;
				const key = { [DAT]: "dat", [IDX]: "idx" }[path];
				if (key) {
					server.requests[key]++;
					if (server.fail[key]) return server.fail[key](request);
					return new Response(server.files[key], {
						headers: {
							"Content-Type": "application/octet-stream",
							...(server.etag ? { ETag: server.etag } : {}),
						},
					});
				}
				if (path === WORKER) {
					server.requests.worker++;
					return server.worker(request);
				}
			});
		},
	);
	return server;
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

async function givenTheFilesHold(step, server, rows, text, etag = null) {
	await step(`Given the files hold ${text}`, () => {
		server.files = files(rows);
		server.etag = etag;
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
	"A refresh loads the distribution files in the worker",
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
		await givenAStore(step, server);
		const result = await whenRefresh(step, server);
		await thenResolvesWithSize(step, result, 3);
		await step("And /fuzzy_search.worker.js was requested once", () => {
			expect(server.requests.worker).toBe(1);
		});
		await step("And each file was requested once", () => {
			expect(server.requests.dat).toBe(1);
			expect(server.requests.idx).toBe(1);
		});
	},
);

scenario("Concurrent refreshes share one load", async ({ step, t }) => {
	const server = await background(step, t);
	await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
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
	await step("And each file was requested once", () => {
		expect(server.requests.dat).toBe(1);
		expect(server.requests.idx).toBe(1);
	});
});

scenario(
	"A refresh after the files changed loads the new rows in the same worker",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
			step,
			server,
			ROWS_AB,
			'the rows of "a" and "b", with the ETag "v1"',
			'"v1"',
		);
		await givenRefreshed(step, server);
		await step(
			'And the files now hold the row of "c", with the ETag "v2"',
			() => {
				server.files = files([["c", 0.75]]);
				server.etag = '"v2"';
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
	"Refreshing empty files leaves the store empty",
	async ({ step, t }) => {
		const server = await background(step, t);
		await step("Given the files are empty", () => {
			server.files = { dat: Buffer.alloc(0), idx: Buffer.alloc(0) };
		});
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
		await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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

scenario(
	"The query is cut to its first 256 dimensions and renormalized",
	async ({ step, t }) => {
		const server = await background(step, t);
		await givenTheFilesHold(
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
			"with k 3 for a query of 3 and 4 in its first two dimensions, 100 in the 257th and -50 in the 768th",
			query({ 0: 3, 1: 4, 256: 100, 767: -50 }),
		);
		await step('Then it answers "y" 0.8, "x" 0.6 and "z" 0', () => {
			const answered = named(result.results);
			expect(answered.map(([n]) => n)).toEqual(["y", "x", "z"]);
			expect(answered[0][1]).toBeCloseTo(0.8, 6);
			expect(answered[1][1]).toBeCloseTo(0.6, 6);
			expect(answered[2][1]).toBe(0);
		});
	},
);

scenario("A query of zeros scores every row 0", async ({ step, t }) => {
	const server = await background(step, t);
	await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
	await givenRefreshed(step, server);
	const result = await whenSearch(
		step,
		server,
		3,
		"with k 3 for a query of 768 zeros",
		query({}),
	);
	await step('Then it answers "a" and "b", both with the score 0', () => {
		expect(named(result.results).sort()).toEqual([
			["a", 0],
			["b", 0],
		]);
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
		await givenTheFilesHold(
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
	await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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
		await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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
	await givenTheFilesHold(step, server, ROWS_ABCDA, ROWS_ABCDA_TEXT);
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
		await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
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
		error: "broken vectors (2111 bytes of rows for 2 ids)",
		apply: (server) => {
			server.files.dat = server.files.dat.subarray(0, 2 * REC - 1);
		},
	},
]) {
	scenario(
		`A failed refresh rejects and keeps what was loaded (${change})`,
		async ({ step, t }) => {
			const server = await background(step, t);
			await givenTheFilesHold(
				step,
				server,
				ROWS_AB,
				'the rows of "a" and "b", with the ETag "v1"',
				'"v1"',
			);
			await givenRefreshed(step, server);
			await step(`And with the ETag "v2", ${change}`, () => {
				server.etag = '"v2"';
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
		await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
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
		await givenTheFilesHold(step, server, ROWS_AB, 'the rows of "a" and "b"');
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
