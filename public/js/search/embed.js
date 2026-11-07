// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Embeddings (LCTYSP-0007, LCTYSP-0008). The browser talks to the embedding model directly, to register the index and to vectorize queries.

import { putVectors, vectorsPending } from "../api/storage.js";
import { encodeRecords, FULL_DIM } from "./vectors.js";

const DOC_PREFIX = "title: none | text: ";
const QUERY_PREFIX = "task: search result | query: ";
const BATCH_CHARS = 6000; // Rough number of characters per request

export function embeddingConfig(backend) {
	if (!backend?.embedding_model) return null;
	return { backend, model: backend.embedding_model };
}

/** Embed texts; returns an array of 768-dim Float32Arrays. */
async function embed(cfg, texts, signal) {
	const { backend } = cfg;
	const headers = { "Content-Type": "application/json" };
	if (backend.api_key) headers.Authorization = `Bearer ${backend.api_key}`;
	const r = await fetch(
		`${backend.base_url.replace(/\/+$/, "")}/v1/embeddings`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ model: cfg.model, input: texts }),
			signal,
		},
	);
	const j = await r.json().catch(() => ({}));
	if (!r.ok || !j.data) throw new Error(j.error?.message || `HTTP ${r.status}`);
	return j.data
		.sort((a, b) => a.index - b.index)
		.map((d) => {
			if (d.embedding.length !== FULL_DIM)
				throw new Error(
					`wrong dimensions (${d.embedding.length} ≠ ${FULL_DIM})`,
				);
			return Float32Array.from(d.embedding);
		});
}

export async function embedQuery(cfg, q, signal) {
	return (await embed(cfg, [QUERY_PREFIX + q], signal))[0];
}

/**
 * Embed and register the unindexed rounds one batch after another until none are left (LCTYSP-0008).
 * Every part of a round is embedded and PUT as a registration vector binary (768 dims). The server drops it if the revision (rev) changed.
 * Only one runs at a time. A kick() while running causes one more pass after it finishes.
 */
export function createIndexer({ getConfig, onError }) {
	let running = false;
	let again = false;
	const failed = new Set(); // Rounds whose embedding failed in this session (too large etc.)

	async function embedRound(cfg, round) {
		try {
			return await embed(
				cfg,
				round.parts.map((t) => DOC_PREFIX + t),
			);
		} catch (e) {
			failed.add(round.id + round.rev);
			onError?.(e);
			return null;
		}
	}

	async function drain() {
		const cfg = getConfig();
		if (!cfg) return;
		const sent = new Set(); // Never send the same round twice in one pass (stops even if the server keeps returning already registered rounds)
		for (;;) {
			const pending = (await vectorsPending(cfg.model)).filter(
				(p) => !failed.has(p.id + p.rev) && !sent.has(p.id + p.rev),
			);
			if (!pending.length) return;
			const batch = [];
			let chars = 0;
			for (const p of pending) {
				const n = p.parts.reduce((a, t) => a + t.length, 0);
				if (batch.length && chars + n > BATCH_CHARS) break;
				batch.push(p);
				chars += n;
				sent.add(p.id + p.rev);
			}
			let vecs = null;
			try {
				vecs = await embed(
					cfg,
					batch.flatMap((p) => p.parts.map((t) => DOC_PREFIX + t)),
				);
			} catch {
				// If the batch fails, try round by round
			}
			const items = [];
			const revs = [];
			let k = 0;
			for (const p of batch) {
				const list = vecs
					? vecs.slice(k, k + p.parts.length)
					: await embedRound(cfg, p);
				if (vecs) k += p.parts.length;
				if (!list) continue;
				for (const vec of list) items.push({ id: p.id, vec });
				revs.push([p.id, p.rev]);
			}
			if (items.length) await putVectors(cfg.model, revs, encodeRecords(items));
		}
	}
	async function kick() {
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			do {
				again = false;
				await drain();
			} while (again);
		} catch (e) {
			onError?.(e);
		} finally {
			running = false;
		}
	}

	return { kick };
}
