// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// fuzzy_search.worker.js: semantic search off the main thread (LCTYSP-0008, LCTYSP-0019). A classic worker with no
// imports, started by js/search/vectors.js as new Worker(siteUrl("fuzzy_search.worker.js")), at the root of the site. It
// is not a /c/ file: it works on the server's vector data, which a conversation file opened on its own does not need
// (LCTYSP-0005). bdot264.wasm and the vector pair (v1/vectors.eg2_264.*) are found from this file's own URL
// (self.location, the root of the site): a message never names a URL to fetch.
//
// It keeps a copy of the server's vector pair in memory and brings it up to date from the pair's JSON (LCTYSP-0019):
// another generation (rev) replaces the copy, the same one fetches only the records past the copy's end, with Range
// and If-Match of the generation, and the rows of the JSON's invalid ranges are filled with NaN. A summary of the same
// generation with fewer records than the copy is an older one (records are only added within a generation, and rows only
// become invalid), so it changes nothing: a notification may arrive after a JSON fetched later. Record 0, the header,
// is never fetched. A 412 (the generation changed between the JSON and the rows) starts again from the JSON. Rows and
// query are L2-normalized, so a dot product is the cosine similarity; a NaN row scores NaN, which is never taken. When
// the wasm cannot be used (the engine rejects it, or the 256 MiB memory cannot be made), the same scores are computed in
// JavaScript over the same layout.
//
//   { id, op: "load", summary? } (summary: the JSON's content, when the page has it already)
//     → { id, rows }
//   { id, op: "search", query: Float32Array(256), k, allow }
//     → { id, results: [[msgId, score], …] } (the k best ids by their best row, descending; allow: the ids that may
//       appear, or null for all)
//   on failure                                     → { id, error: message } (the copy is kept as it was)
//
// Memory layout of bdot264 (bdot264.wat): query at 0 (f32 × 256 + 32 B of padding), scores at 0x10000 (one
// f32 per row), rows at 0x110000 (f32 × 256 + 32 B of padding that must be zero, 1056 B each, at most 250,000).
// The records of .dat are exactly those rows (the server writes the zero padding), so they are copied as they are;
// row i of the copy is record i + 1 of the pair, and its id is record i + 1 of .idx.

const DIM = 256;
const REC = 1056; // bytes per row: 256 × f32 + 32 B of zero padding
const ID = 16; // bytes per id
const QUERY = 0;
const SCORES = 0x10000;
const ROWS = 0x110000;
const MAX_ROWS = 250000;
const PAGES = 4096; // 256 MiB, as bdot264 imports it
const QNAN = 0x7fc00000;
// The files of the vector pair of the default embedding model, at the root of the site like this file (LCTYSP-0019)
const PAIR = {
	json: new URL("v1/vectors.eg2_264.json", self.location),
	dat: new URL("v1/vectors.eg2_264.dat", self.location),
	idx: new URL("v1/vectors.eg2_264.idx", self.location),
};

const state = {
	kernel: null,
	buffer: null,
	rev: null, // the generation of the copy
	rows: 0,
	rowId: new Int32Array(1024), // row → index of its id in ids
	ids: [], // the distinct ids, in order of first appearance
	index: new Map(), // id → its index in ids
	best: null, // Float32Array: the best score of each id (reused by every search)
};

/** The generation changed between the JSON and a fetch of the rows (412): start again from the JSON. */
class Stale extends Error {}

/** bdot264 with its memory, or { bdot264: null } when it cannot be used (then JavaScript scores the rows). */
async function kernel() {
	if (state.kernel) return state.kernel;
	state.kernel = { bdot264: null, memory: null };
	try {
		const bytes = await (
			await fetch(new URL("bdot264.wasm", self.location))
		).arrayBuffer();
		if (WebAssembly.validate(bytes)) {
			const memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
			const { instance } = await WebAssembly.instantiate(bytes, {
				env: { memory },
			});
			state.kernel = { bdot264: instance.exports.bdot264, memory };
		}
	} catch (e) {
		console.warn("bdot264.wasm cannot be used; scoring in JavaScript", e);
	}
	return state.kernel;
}

function uuid(b, off) {
	let s = "";
	for (let i = 0; i < 16; i++) {
		if (i === 4 || i === 6 || i === 8 || i === 10) s += "-";
		s += b[off + i].toString(16).padStart(2, "0");
	}
	return s;
}

/** The pair's JSON: { rev, count, invalid } */
async function summaryOf(url) {
	const r = await fetch(url, { cache: "no-cache" }); // revalidated by its ETag
	if (!r.ok) throw new Error(`failed to fetch the vectors (HTTP ${r.status})`);
	return checked(await r.json());
}

/** s when it is the JSON of a pair (also a summary the page gives), else an Error */
function checked(s) {
	const int = Number.isSafeInteger;
	if (
		!int(s?.rev) ||
		!int(s.count) ||
		s.count < 1 ||
		!Array.isArray(s.invalid) ||
		!s.invalid.every((r) => Array.isArray(r) && int(r[0]) && int(r[1]))
	)
		throw new Error("broken vectors (not the JSON of a pair)");
	return s;
}

/** The bytes first to last of url, in the generation rev (Stale on 412) */
async function range(url, rev, first, last) {
	const r = await fetch(url, {
		headers: { Range: `bytes=${first}-${last}`, "If-Match": `"${rev}"` },
		cache: "no-store",
	});
	if (r.status === 412) throw new Stale();
	if (r.status !== 206)
		throw new Error(`failed to fetch the vectors (HTTP ${r.status})`);
	const bytes = new Uint8Array(await r.arrayBuffer());
	if (bytes.length !== last - first + 1)
		throw new Error(
			`broken vectors (${bytes.length} bytes for ${last - first + 1})`,
		);
	return bytes;
}

/** A buffer for n rows: the kernel's memory, or an ArrayBuffer grown by doubling (the rows it holds kept) */
function room(n, memory) {
	if (memory) return memory.buffer;
	const need = ROWS + n * REC;
	if (state.buffer && state.buffer.byteLength >= need) return state.buffer;
	const grown = new ArrayBuffer(
		Math.max(need, (state.buffer?.byteLength ?? ROWS) * 2),
	);
	if (state.buffer)
		new Uint8Array(grown).set(
			new Uint8Array(state.buffer, 0, ROWS + state.rows * REC),
		);
	return grown;
}

/** Bring the copy up to the summary s; Stale when the generation changed meanwhile */
async function sync({ rev, count, invalid }) {
	const n = count - 1; // rows, the header left out
	if (n > MAX_ROWS)
		throw new Error(`too many vectors (${n}; the limit is ${MAX_ROWS})`);
	// An older summary of this generation: the copy has all it says already
	if (state.rev === rev && n < state.rows) return state.rows;
	const from = state.rev === rev ? state.rows : 0;
	let rows = null;
	let idBytes = null;
	if (n > from) {
		[rows, idBytes] = await Promise.all([
			range(PAIR.dat, rev, (from + 1) * REC, count * REC - 1),
			range(PAIR.idx, rev, (from + 1) * ID, count * ID - 1),
		]);
	}
	const { memory } = await kernel();
	// Nothing below waits: the copy changes in one step, never half
	const buffer = room(n, memory);
	if (from === 0) {
		state.ids = [];
		state.index = new Map();
	}
	if (state.rowId.length < n) {
		const grown = new Int32Array(Math.max(n, state.rowId.length * 2));
		grown.set(state.rowId.subarray(0, from));
		state.rowId = grown;
	}
	if (rows) {
		new Uint8Array(buffer).set(rows, ROWS + from * REC); // the kernel's layout, padding included
		for (let i = from; i < n; i++) {
			const id = uuid(idBytes, (i - from) * ID);
			let j = state.index.get(id);
			if (j === undefined) {
				j = state.ids.length;
				state.ids.push(id);
				state.index.set(id, j);
			}
			state.rowId[i] = j;
		}
	}
	// The invalid rows: written as integers, NaN in every float, the padding left zero
	const u32 = new Uint32Array(buffer);
	for (const [a, b] of invalid) {
		for (let r = Math.max(a, 1); r <= Math.min(b, n); r++) {
			const base = (ROWS + (r - 1) * REC) / 4;
			u32.fill(QNAN, base, base + DIM);
		}
	}
	if (!state.best || state.best.length < state.ids.length)
		state.best = new Float32Array(Math.max(state.ids.length, 64));
	Object.assign(state, { buffer, rev, rows: n });
	return n;
}

/** Bring the copy up to date (from summary, or else from the JSON); returns the row count. */
async function load({ summary }) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const s =
			attempt === 0 && summary ? checked(summary) : await summaryOf(PAIR.json);
		try {
			return await sync(s);
		} catch (e) {
			if (!(e instanceof Stale)) throw e;
		}
	}
	throw new Error("the vectors changed while they were fetched");
}

/** Scores every row against query (256 dims, L2-normalized); returns the k best ids by their best row. */
function search(query, k, allow) {
	const { rows, rowId, ids, index, buffer } = state;
	if (!rows) return [];
	if (query.length !== DIM)
		throw new Error(`wrong query dimensions (${query.length} ≠ ${DIM})`);
	const best = state.best.subarray(0, ids.length);
	const f = new Float32Array(buffer);
	f.set(query, QUERY / 4);
	if (state.kernel.bdot264) {
		state.kernel.bdot264(rows);
	} else {
		for (let i = 0; i < rows; i++) {
			const base = (ROWS + i * REC) / 4;
			let d = 0;
			for (let j = 0; j < DIM; j++) d += f[base + j] * query[j];
			f[SCORES / 4 + i] = d;
		}
	}
	const scores = new Float32Array(buffer, SCORES, rows);
	// The best row of each id. An id that may not appear stays at -Infinity; so does one whose rows are all NaN
	best.fill(Number.NEGATIVE_INFINITY);
	if (allow) {
		const ok = new Uint8Array(ids.length);
		for (const id of allow) {
			const j = index.get(id);
			if (j !== undefined) ok[j] = 1;
		}
		for (let i = 0; i < rows; i++) {
			const j = rowId[i];
			if (ok[j] && scores[i] > best[j]) best[j] = scores[i];
		}
	} else {
		for (let i = 0; i < rows; i++) {
			const j = rowId[i];
			if (scores[i] > best[j]) best[j] = scores[i];
		}
	}
	return top(best, k).map((j) => [ids[j], best[j]]);
}

/**
 * The indices of the k largest values (descending), in one pass: keep k candidates and the smallest of them; a value
 * above it replaces it, and the smallest is found again among the k (cheaper than a heap for small k). Values that are
 * -Infinity (or NaN) are never taken.
 */
function top(values, k) {
	const n = Math.min(k, values.length);
	if (n <= 0) return [];
	const topValues = new Float32Array(n).fill(Number.NEGATIVE_INFINITY);
	const topIndices = new Int32Array(n).fill(-1);
	let minVal = Number.NEGATIVE_INFINITY;
	let minIdx = 0;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (v > minVal) {
			topValues[minIdx] = v;
			topIndices[minIdx] = i;
			minIdx = 0;
			minVal = topValues[0];
			for (let j = 1; j < n; j++) {
				if (topValues[j] < minVal) {
					minVal = topValues[j];
					minIdx = j;
				}
			}
		}
	}
	const order = [];
	for (let j = 0; j < n; j++) if (topIndices[j] >= 0) order.push(j);
	for (let a = 1; a < order.length; a++) {
		// insertion sort of the (at most k) candidates, descending
		const x = order[a];
		let b = a - 1;
		while (b >= 0 && topValues[order[b]] < topValues[x]) {
			order[b + 1] = order[b];
			b--;
		}
		order[b + 1] = x;
	}
	return order.map((j) => topIndices[j]);
}

self.onmessage = async ({ data }) => {
	const { id, op } = data;
	try {
		if (op === "load") self.postMessage({ id, rows: await load(data) });
		else if (op === "search")
			self.postMessage({
				id,
				results: search(data.query, data.k ?? 50, data.allow ?? null),
			});
		else throw new Error(`unknown op: ${op}`);
	} catch (e) {
		self.postMessage({ id, error: String(e?.message || e) });
	}
};
