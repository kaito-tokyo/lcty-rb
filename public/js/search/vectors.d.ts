// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The client of the semantic search worker and the query embedding of /v1/rpc (LCTYSP-0008, LCTYSP-0019).
//
// The server embeds every message and keeps the vectors in a pair of files, the rows (.dat) and the ids (.idx), with a
// JSON document of their generation, their number and their invalid rows (LCTYSP-0019). The worker keeps a copy of the
// pair in memory and fetches only what it lacks, by Range; nothing is kept across page loads. A query is embedded by
// the server too, over the tab's connection to /v1/rpc: the page never talks to an embedding model.

import type { RpcClient } from "../api/rpc.js";

/** The name of the vector pair of the server's default embedding model: its files, URLs and RPC methods. */
export const PAIR: "eg2_264";

/**
 * The query vector of text: vectors.eg2_264.embed of /v1/rpc, whose answer is the 1,024 bytes of 256 Float32 LE in
 * base64 (the first 256 dimensions of the model's, L2-normalized, with the prefix "task: search result | query: ").
 * Rejects with the server's RpcError (code 7 when no embedding server is ready), or when the answer is not 256 floats.
 */
export function embedQuery(
	rpc: Pick<RpcClient, "call">,
	text: string,
): Promise<Float32Array>;

/** A semantic search hit: [id, score]. */
export type VectorHit = [id: string, score: number];

/** The pair's JSON: its generation, its number of records (the header included) and its invalid rows. */
export interface PairSummary {
	rev: number;
	count: number;
	invalid: [first: number, last: number][];
}

/** The semantic search store, backed by the worker. */
export interface VectorStore {
	/** The number of rows loaded in the worker (0 before the first refresh or after the worker failed). */
	readonly size: number;
	/**
	 * Bring the worker's copy up to date with the server's pair from GET /v1/vectors.eg2_264.json. Concurrent calls share
	 * one load. While the notifications of the connection the copy was last loaded on keep it up to date (actor()
	 * answers the same actorId, and no notification failed to load), it fetches nothing and waits only for the loads
	 * already queued.
	 */
	refresh(): Promise<void>;
	/**
	 * The notification vectors.eg2_264.changed, whose parameters are the pair's JSON: bring a copy the worker has up to
	 * date from it, without fetching the JSON, after the loads already queued (so one that arrives during the first load
	 * is not lost). Before any load has been asked for it does nothing (the next refresh loads the pair).
	 * Resolves when it is loaded; a failure is logged, never rejected, and makes the next refresh fetch the JSON.
	 */
	changed(summary: PairSummary): Promise<void>;
	/**
	 * q: 256-dim query vector (embedQuery). Returns the k best ids (by their best row) as [[id, score], …], descending;
	 * [] while no rows are loaded.
	 * allow: the ids that may appear (the worker selects among them exactly), or null for all. accept: a last check on
	 * the main thread; the worker then returns 2k so a few rejected ids still leave k.
	 */
	search(
		q: Float32Array,
		k?: number,
		opts?: {
			allow?: readonly string[] | null;
			accept?: ((id: string) => boolean) | null;
		},
	): Promise<VectorHit[]>;
}

/**
 * Semantic search in a worker (fuzzy_search.worker.js at the root of the site): it keeps a copy of the vector pair and
 * scores the query against every row with bdot264 (LCTYSP-0008). The main thread only sends messages; the worker
 * starts on first use. The worker finds the pair from its own URL at the root of the site (LCTYSP-0005): the page
 * sends it no URL, so nothing the page is given can make the worker fetch from elsewhere.
 */
export function createVectorStore(opts?: {
	/** The actorId of the tab's connection to /v1/rpc, whose notifications the store is given (null without one). */
	actor?: () => string | null | undefined;
}): VectorStore;

// Internals:
// start(), w.onerror: when the worker failed (its script could not be loaded, or it threw), it is ended and dropped
// with what it had loaded, so the next call starts a new one instead of posting to a dead worker that never answers.
// The calls waiting for it reject, and the store no longer has a copy (loaded and following are cleared).
//
// enqueue(): the loads of the worker run one at a time, chained on state.tail, because two loads at once could leave
// the copy at the older one's end. A load that has not started yet (state.queued) takes what comes after it: a later
// summary replaces its summary, and a refresh turns it into a load from the JSON, which is fetched when it starts and so
// is at least as new as any summary before it. A refresh while a load from the JSON is running shares it.
// state.following is the actorId a load from the JSON was made with: the notifications of that connection follow the
// copy from then on. A new connection may have missed some, and a failed load leaves the copy behind, so either makes
// the next refresh fetch the JSON again. A notification may arrive after a JSON fetched later than it was sent; the
// worker ignores such an older summary of the same generation.
