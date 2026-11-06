// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// fuzzy_search.worker.js: semantic search off the main thread (LCTYSP-008). A classic worker with no imports, started
// by js/search/vectors.js as new Worker("/fuzzy_search.worker.js"). It is not a /c/ file: it works on the server's
// vector data, which a conversation file opened on its own does not need (LCTYSP-005).
//
// It fetches the distribution files itself (vectors.eg2_264.dat, the rows, and vectors.eg2_264.idx, the 16-byte id of each row, at the
// URLs the page gives), keeps them, and scores a query against every row with bdot264.wasm. Rows and query
// are L2-normalized, so a dot product is the cosine similarity. When the wasm cannot be used (the engine rejects it, or the 256 MiB memory cannot be made), the same scores are computed in
// JavaScript over the same layout.
//
//   { id, op: "load", dat, idx } (URLs)            → { id, rows }
//   { id, op: "search", query: Float32Array(256), k, allow }
//     → { id, results: [[msgId, score], …] } (the k best ids by their best row, descending; allow: the ids that may
//       appear, or null for all)
//   on failure                                     → { id, error: message }
//
// Memory layout of bdot264 (bdot264.wat): query at 0 (f32 × 256 + 32 B of padding), scores at 0x10000 (one
// f32 per row), rows at 0x110000 (f32 × 256 + 32 B of padding that must be zero, 1056 B each, at most 250,000).
// vectors.eg2_264.dat is exactly those rows (the server writes the zero padding), so it is copied as it is to 0x110000;
// vectors.eg2_264.idx has the 16-byte id of each row, in the same order.

const DIM = 256;
const REC = 1056; // bytes per row: 256 × f32 + 32 B of zero padding
const ID = 16; // bytes per id
const QUERY = 0;
const SCORES = 0x10000;
const ROWS = 0x110000;
const MAX_ROWS = 250000;
const PAGES = 4096; // 256 MiB, as bdot264 imports it

const state = {
	kernel: null,
	buffer: null,
	etag: null,
	rows: 0,
	rowId: null, // Int32Array: row → index of its id in ids
	ids: [], // the distinct ids, in order of first appearance
	index: null, // Map: id → its index in ids
	best: null, // Float32Array: the best score of each id (reused by every search)
};

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

/** The pair (dat, idx) as bytes with its ETag, or null when it is the one already loaded. Both files carry the same ETag
 * (the pair's version): a pair fetched across a rewrite on the server is fetched again. */
async function fetchPair(dat, idx) {
	for (let attempt = 0; ; attempt++) {
		const [d, i] = await Promise.all([fetch(dat), fetch(idx)]);
		for (const r of [d, i])
			if (!r.ok && r.status !== 0)
				throw new Error(`failed to fetch the vectors (HTTP ${r.status})`);
		const etag = d.headers.get("ETag");
		if (etag !== i.headers.get("ETag") && attempt < 2) continue;
		if (etag && etag === state.etag) return null;
		const [rows, idBytes] = await Promise.all([
			d.arrayBuffer().then((b) => new Uint8Array(b)),
			i.arrayBuffer().then((b) => new Uint8Array(b)),
		]);
		return { etag, rows, idBytes };
	}
}

/** Fetch the distribution files (unchanged when the ETag is the same) and put them in place. Returns the row count. */
async function load(dat, idx) {
	const pair = await fetchPair(dat, idx);
	if (!pair) return state.rows;
	const { etag, rows, idBytes } = pair;
	const n = rows.length / REC;
	if (!Number.isInteger(n) || idBytes.length !== n * ID)
		throw new Error(
			`broken vectors (${rows.length} bytes of rows for ${idBytes.length / ID} ids)`,
		);
	if (n > MAX_ROWS)
		throw new Error(`too many vectors (${n}; the limit is ${MAX_ROWS})`);
	const rowId = new Int32Array(n);
	const ids = [];
	const index = new Map();
	for (let i = 0; i < n; i++) {
		const id = uuid(idBytes, i * ID);
		let j = index.get(id);
		if (j === undefined) {
			j = ids.length;
			ids.push(id);
			index.set(id, j);
		}
		rowId[i] = j;
	}
	const { memory } = await kernel();
	const buffer = memory ? memory.buffer : new ArrayBuffer(ROWS + n * REC);
	new Uint8Array(buffer).set(rows, ROWS); // the rows are the kernel's layout, padding included
	const best = new Float32Array(ids.length);
	Object.assign(state, {
		buffer,
		etag,
		rows: n,
		rowId,
		ids,
		index,
		best,
	});
	return n;
}

/** Scores every row against query (256 dims, L2-normalized); returns the k best ids by their best row. */
function search(query, k, allow) {
	const { rows, rowId, ids, index, best, buffer } = state;
	if (!rows) return [];
	if (query.length !== DIM)
		throw new Error(`wrong query dimensions (${query.length} ≠ ${DIM})`);
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
	// The best row of each id. An id that may not appear stays at -Infinity
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
		if (op === "load")
			self.postMessage({ id, rows: await load(data.dat, data.idx) });
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
