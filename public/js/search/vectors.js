// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The client of the semantic search worker and the query embedding of /v1/rpc (LCTYSP-0008, LCTYSP-0019).

import { siteUrl } from "../site.js";

// The vector pair of the server's default embedding model
export const PAIR = "eg2_264";
const DIM = 256;

/** The query vector of text, embedded by the server: 256 Float32, L2-normalized. */
export async function embedQuery(rpc, text) {
	const { vector } = await rpc.call(`vectors.${PAIR}.embed`, { text });
	const bytes = Uint8Array.from(atob(vector), (c) => c.charCodeAt(0));
	if (bytes.length !== DIM * 4)
		throw new Error(`wrong query dimensions (${bytes.length / 4} ≠ ${DIM})`);
	return new Float32Array(bytes.buffer);
}

/** Semantic search in a worker that scores the query against every row (LCTYSP-0005, LCTYSP-0008). */
export function createVectorStore() {
	const state = {
		worker: null,
		seq: 0,
		pending: new Map(),
		rows: 0,
		loading: null,
	};

	function start() {
		const w = new Worker(siteUrl("fuzzy_search.worker.js"));
		w.onmessage = ({ data }) => {
			const p = state.pending.get(data.id);
			if (!p) return;
			state.pending.delete(data.id);
			if (data.error) p.reject(new Error(data.error));
			else p.resolve(data);
		};
		// The worker failed: end and drop it so the next call starts a new one, and reject the calls waiting for it.
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

		/** Bring the worker's copy up to date (concurrent calls share one load) */
		async refresh(summary) {
			state.loading ||= call({ op: "load", summary })
				.then((r) => {
					state.rows = r.rows;
				})
				.finally(() => {
					state.loading = null;
				});
			return state.loading;
		},

		/** The k best ids for a 256-dim query vector, as [[id, score], …] descending. */
		async search(q, k = 50, { allow = null, accept = null } = {}) {
			if (!state.rows) return [];
			const { results } = await call({
				op: "search",
				query: q,
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
