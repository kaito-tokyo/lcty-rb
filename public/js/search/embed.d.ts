// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Embeddings (LCTYSP-0007, LCTYSP-0008). The browser talks to the embedding model directly, to register the index and
// to vectorize queries.

/** The backend settings the embedding model is reached through. */
export interface EmbeddingBackend {
	base_url: string;
	api_key?: string;
	embedding_model?: string;
}

/** The backend and the embedding model to use with it. */
export interface EmbeddingConfig {
	backend: EmbeddingBackend;
	model: string;
}

/** The embedding config of a backend, or null when it has no embedding_model. */
export function embeddingConfig(
	backend: EmbeddingBackend | null | undefined,
): EmbeddingConfig | null;

/**
 * Embed a search query (with the query prefix); resolves to one 768-dim Float32Array.
 * Rejects on an HTTP error or a vector of the wrong dimensions.
 */
export function embedQuery(
	cfg: EmbeddingConfig,
	q: string,
	signal?: AbortSignal,
): Promise<Float32Array>;

/**
 * Embed and register the unindexed rounds one batch after another until none are left (LCTYSP-0008).
 * Every part of a round is embedded and PUT as a registration vector binary (768 dims). The server drops it if the
 * revision (rev) changed.
 * Only one runs at a time. A kick() while running causes one more pass after it finishes.
 * getConfig is read at the start of each pass (null skips it); onError receives the errors of failed embeddings and
 * of the pass itself.
 */
export function createIndexer(opts: {
	getConfig: () => EmbeddingConfig | null;
	onError?: (e: unknown) => void;
}): { kick(): Promise<void> };

// Internals:
// embed(cfg, texts, signal) posts to <base_url>/v1/embeddings (Bearer api_key when set) and returns an array of
// 768-dim (FULL_DIM) Float32Arrays in input order; it throws on an HTTP error or wrong dimensions.
// Documents are prefixed with "title: none | text: ", queries with "task: search result | query: ".
// A batch holds roughly BATCH_CHARS (6000) characters of parts per request.
// drain(): `failed` holds the rounds (id + rev) whose embedding failed in this session (too large etc.), and they are
// skipped from then on. `sent` makes sure the same round is never sent twice in one pass, so the pass stops even if
// the server keeps returning already registered rounds. If a whole batch fails, it is retried round by round
// (embedRound).
