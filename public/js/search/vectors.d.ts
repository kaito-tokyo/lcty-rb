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

/** Dimensions of a vector for registration (PUT): 768. */
export const FULL_DIM: number;

/** A registration vector binary: the PUT body, the byte size of each vector, and the number of records. */
export interface EncodedRecords {
	body: Uint8Array;
	size: number;
	count: number;
}

/**
 * [{id, vec: Float32Array}] → { body: registration vector binary (PUT body), size, count }.
 * Each record is a 32-byte head (control block and the UUID's bytes) and the 768-dim vector.
 * Throws when a vector does not have FULL_DIM dimensions.
 */
export function encodeRecords(
	items: readonly { id: string; vec: Float32Array }[],
): EncodedRecords;

/** A semantic search hit: [id, score]. */
export type VectorHit = [id: string, score: number];

/** The semantic search store, backed by the worker. */
export interface VectorStore {
	/** The number of rows loaded in the worker (0 before the first refresh or after the worker failed). */
	readonly size: number;
	/** Refetch if the files changed (concurrent calls share one fetch). */
	refresh(): Promise<void>;
	/**
	 * q: 768-dim query vector. Returns the k best ids (by their best round) as [[id, score], …], descending; [] while
	 * no rows are loaded.
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
 * Semantic search in a worker (fuzzy_search.worker.js at the root of the site): it fetches the distribution files,
 * keeps them, and scores the query against every row with bdot264 (LCTYSP-0008). The main thread only sends
 * messages; the worker starts on first use. The worker is given the files as whole URLs (siteUrl, LCTYSP-0005).
 */
export function createVectorStore(): VectorStore;

// Internals:
// The distributed vectors have 256 dimensions (DIM). truncate(vec) turns a 768-dim query vector into one of them: it
// takes the first 256 dims and L2-renormalizes them (Matryoshka representation).
// start(), w.onerror: when the worker failed (its script could not be loaded, or it threw), it is ended and dropped
// with what it had loaded, so the next call starts a new one instead of posting to a dead worker that never answers.
// The calls waiting for it reject (a refresh in progress clears its shared state.loading when it rejects).
