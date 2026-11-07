// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Vector binary (exchange format lctyvLE0) and the client of the semantic search worker (LCTYSP-0008).
//
//   0   8  magic "lctyvLE0"
//   8   4  byte size of the following vector (uint32 LE; 3072 for registration)
//   12  4  reserved (0)
//   16  16 id (UUIDv7)
//   32  n  vector (Float32 LE)
//
// The whole first 16 bytes (control block) act as the magic. lctyvLE0 is the registration format (PUT). The server
// distributes the merged vectors of its default embedding model differently, as two files: /v1/vectors.eg2_264.dat (the
// kernel's rows) and /v1/vectors.eg2_264.idx (the 16-byte ids); the worker fetches both whole (full sync only).
// Storage is left to the HTTP cache (the server returns an ETag and the browser revalidates every time).

import { uuidToBytes } from "../uuid.js";

const MAGIC = [0x6c, 0x63, 0x74, 0x79, 0x76, 0x4c, 0x45, 0x30]; // "lctyvLE0"
const HEAD = 32;
export const FULL_DIM = 768; // Dimensions for registration (PUT)
const DIM = 256; // Dimensions of the distributed vectors

function control(size) {
	const b = new Uint8Array(16);
	b.set(MAGIC, 0);
	new DataView(b.buffer).setUint32(8, size, true);
	return b;
}

/** [{id, vec: Float32Array}] → { body: registration vector binary (PUT body), size, count } */
export function encodeRecords(items) {
	const size = FULL_DIM * 4;
	const rec = HEAD + size;
	const out = new Uint8Array(items.length * rec);
	const ctl = control(size);
	items.forEach(({ id, vec }, i) => {
		if (vec.length !== FULL_DIM)
			throw new Error(`wrong dimensions (${vec.length} ≠ ${FULL_DIM})`);
		const off = i * rec;
		out.set(ctl, off);
		uuidToBytes(id, out, off + 16);
		out.set(new Uint8Array(vec.buffer, vec.byteOffset, size), off + HEAD);
	});
	return { body: out, size, count: items.length };
}

/** 768-dim query vector → take the first 256 dims and L2-renormalize (Matryoshka representation) */
function truncate(vec) {
	const q = Float32Array.from(vec.subarray(0, DIM));
	let n = 0;
	for (let i = 0; i < DIM; i++) n += q[i] * q[i];
	n = Math.sqrt(n) || 1;
	for (let i = 0; i < DIM; i++) q[i] /= n;
	return q;
}

/**
 * Semantic search in a worker (/fuzzy_search.worker.js): it fetches the distribution files, keeps them, and scores the query against every row with bdot264 (LCTYSP-0008). The main thread only sends
 * messages; the worker starts on first use.
 */
export function createVectorStore() {
	const state = {
		worker: null,
		seq: 0,
		pending: new Map(),
		rows: 0,
		loading: null,
	};

	function start() {
		const w = new Worker("/fuzzy_search.worker.js");
		w.onmessage = ({ data }) => {
			const p = state.pending.get(data.id);
			if (!p) return;
			state.pending.delete(data.id);
			if (data.error) p.reject(new Error(data.error));
			else p.resolve(data);
		};
		// The worker failed (its script could not be loaded, or it threw): end it and drop it with what it had loaded, so
		// the next call starts a new one instead of posting to a dead worker that never answers. The calls waiting for it
		// reject (a refresh in progress clears its shared state.loading when it rejects).
		w.onerror = (e) => {
			w.terminate();
			if (state.worker === w) {
				state.worker = null;
				state.rows = 0;
			}
			for (const p of state.pending.values())
				p.reject(new Error(e.message || "the vector search worker failed"));
			state.pending.clear();
		};
		return w;
	}

	function call(msg) {
		state.worker ||= start();
		const id = ++state.seq;
		return new Promise((resolve, reject) => {
			state.pending.set(id, { resolve, reject });
			state.worker.postMessage({ id, ...msg });
		});
	}

	return {
		get size() {
			return state.rows;
		},

		/** Refetch if the files changed (concurrent calls share one fetch) */
		async refresh() {
			const at = (name) => `/v1/${name}`;
			state.loading ||= call({
				op: "load",
				dat: at("vectors.eg2_264.dat"),
				idx: at("vectors.eg2_264.idx"),
			})
				.then((r) => {
					state.rows = r.rows;
				})
				.finally(() => {
					state.loading = null;
				});
			return state.loading;
		},

		/**
		 * q: 768-dim query vector. Returns the k best ids (by their best round) as [[id, score], …], descending.
		 * allow: the ids that may appear (the worker selects among them exactly), or null for all. accept: a last check on
		 * the main thread; the worker then returns 2k so a few rejected ids still leave k.
		 */
		async search(q, k = 50, { allow = null, accept = null } = {}) {
			if (!state.rows) return [];
			const { results } = await call({
				op: "search",
				query: truncate(q),
				k: accept ? 2 * k : k,
				allow,
			});
			return (accept ? results.filter(([id]) => accept(id)) : results).slice(
				0,
				k,
			);
		},
	};
}
