<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0007: Search

- Status: Accepted
- Related: [LCTYSP-0006](LCTYSP-0006_http-api.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md), [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)
- Implementation: `lib/search_index.rb`, `public/js/search/`

## Summary

Conversations are organized by search alone; there are no folders. Search combines keyword search, which runs on the
server over a SQLite FTS5 index, with semantic search, which runs in the browser over embeddings
([LCTYSP-0008](LCTYSP-0008_vector-binary.md)). The browser merges both with Reciprocal Rank Fusion.

## The index

- **The index is derived data** in `data/_index.sqlite` and can always be rebuilt from the conversation files
  ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)); it is discarded and made anew at every start
  ([LCTYSP-0015](LCTYSP-0015_schema-versions.md)).
- It uses the sqlite3 gem bundled with `/usr/bin/ruby` (1.3.13, SQLite 3.54). FTS5 and the trigram tokenizer are
  available. Extension loading is disabled (`OMIT_LOAD_EXTENSION`), so vector extensions such as sqlite-vec cannot be
  used. Only APIs that exist in that gem version are used (`Database#execute`, `#transaction`, `SQLite3::Blob`).
- WEBrick uses a thread per request, so there is one connection guarded by a Mutex.

### Rounds (chunks)

- **One round is one user message and the reply that follows.** Its id is the user message's id.
- Rounds are derived by Ruby from the conversation file whenever a conversation is created, appended to, popped or
  deleted, and at startup. A round without a finished reply is not indexed yet.
- Rounds longer than 6,000 characters are split into parts so each part fits the embedding model's 8,192-token context.
- **Messages copied by a fork (`inherited`) are not indexed.** Their ids equal the originals, which are found in the
  source conversation.
- `rev` is the first 16 hex digits of the SHA-256 of the round's whole text. It changes when the text changes.
- A message id that already belongs to another conversation (for example a copied file) is skipped with a warning; the
  first one registered wins.

### Schema

```sql
CREATE TABLE chunks (
  msg_id TEXT NOT NULL, part INTEGER NOT NULL, conv_id TEXT NOT NULL, rev TEXT NOT NULL, text TEXT NOT NULL, at TEXT,
  PRIMARY KEY (msg_id, part));
CREATE INDEX chunks_conv ON chunks(conv_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, tokenize='trigram');   -- rowid = chunks.rowid, NFKC + lowercase
CREATE TABLE conv_tags (conv_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (conv_id, tag));
CREATE TABLE c_recordcount (cid TEXT PRIMARY KEY, count INTEGER NOT NULL);  -- conversations of /v1/rpc (LCTYSP-0014)
```

- **No schema version:** the file is discarded at every start (`SearchIndex.discard`) and the tables are made anew,
  so a change to them needs no migration; the full sync fills them.
- The vectors are not here: they are the vector pair of the server
  ([LCTYSP-0019](LCTYSP-0019_server-embedding.md#the-vector-db)).

## Keyword search (server)

- Text is normalized with NFKC and lowercased.
- Terms of three or more characters are split into trigrams, matched with OR and ranked by `bm25()`, so natural-language
  queries match partially even when the wording differs.
- Trigrams cannot match terms shorter than three characters (two-character Japanese words such as 京都 are common), so
  such terms are required to appear in the text (`LIKE`).
- Results are distinct rounds in rank order, each with a snippet around the first matching term.

## Semantic search (browser)

- The server embeds the query with the prefix `task: search result | query: ` (`vectors.eg2_264.embed` of `/v1/rpc`);
  it embedded every user and model message with `title: none | text: ` (EmbeddingGemma 2's recommended prompts).
  Titles are not embedded because they can change ([LCTYSP-0019](LCTYSP-0019_server-embedding.md)).
- Scoring runs in the browser over the worker's copy of the vector pair (256 dims, brute force with WASM SIMD) and
  takes the best score per id ([LCTYSP-0008](LCTYSP-0008_vector-binary.md#search-in-the-browser)).
- When the server has no embedding server ready, only keyword search is used and a notice is shown.

## Merging (browser)

```
browser → /v1/rpc vectors.eg2_264.embed {text} ┐ in parallel
browser → POST /v1/search {q, tags}           ┘
browser: vector search over the worker's copy of the vector pair, each hit counted for its round
browser: merge with RRF (score = Σ 1 / (60 + rank)), keep the best round per conversation (up to 30)
browser → POST /v1/snippets {ids, q}          only for rounds without a snippet (semantic-only hits)
```

- A semantic hit is a message, user or model ([LCTYSP-0019](LCTYSP-0019_server-embedding.md#what-is-embedded)). It is
  mapped to its round and its conversation with `message_rounds` from `GET /v1/conversations` (each own message with
  the user message of its round), and the best message of a round counts for it. The sidebar's list comes from
  the browser's copy of the meta ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)), so this is fetched only when a
  semantic search runs, and kept until the list changes. `tag:` filters use the tags of the browser's copy
  `t_has_many_c` ([LCTYSP-0014](LCTYSP-0014_browser-sync.md)).

## Filtering by tag

- `tag:name` in the query filters to conversations that have the tag (several are combined with AND). `tag:name` alone
  lists those conversations newest first.
- The server filters keyword search with `conv_tags`, updated on every sync with the conversation's current tags. The
  browser filters semantic hits with the tags from the conversation list.
- Conversation lists and results show current tags; clicking a tag searches for `tag:name`.
- `conv_tags` is only for filtering: the sidebar's list has the tags of `t_has_many_c` and the counts of
  `c_recordcount` ([LCTYSP-0014](LCTYSP-0014_browser-sync.md)). `conv_stats` and the hints of `GET /v1/meta-all.json`
  that it and `conv_tags` gave went with that endpoint.

## Budget

An operation within 50 ms counts as instant ([LCTYSP-0001](LCTYSP-0001_architecture.md)). Measured: one search, including
embedding the query, takes about 40 ms.
