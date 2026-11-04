<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-008: Vector binary and semantic search

- Status: Accepted
- Related: [LCTYSP-006](LCTYSP-006_http-api.md), [LCTYSP-007](LCTYSP-007_search.md), [LCTYSP-010](LCTYSP-010_data-and-settings.md)
- Implementation: `lib/vector_records.rb`, `lib/search_index.rb`, `public/js/search/vectors.js`, `public/js/search/sgemv.js`, `public/js/search/embed.js`

## Summary

The browser embeds rounds and registers them with the server as a **vector binary**, a fixed-size record format named
`lctyvLE0`. The server keeps them in a **vector DB** (SQLite) and serves a merged 256-dimension vector binary back,
which the browser scans with hand-written WebAssembly SIMD.

## Terms

- **Vector binary**: the exchange format (`lctyvLE0`). Used for registration (PUT body, 768 dims) and for distribution
  (`_vectors.<model>.256.bin`, 256 dims).
- **Vector DB**: the persistent format in SQLite, `data/_vectors.<model>.sqlite` per embedding model (derived data). Only
  the server reads and writes it.

## Record format

Every record has a fixed size and everything is little-endian: a 16-byte control block `lctyvLE0[size][reserved]`, the
id, then the vector.

| Offset | Size | Content |
|---|---|---|
| 0 | 8 | Magic `lctyvLE0` (ASCII; v = vector, LE = little-endian, 0 = version) |
| 8 | 4 | Byte size of the following vector (uint32 LE; 1024 for distribution, 3072 for registration) |
| 12 | 4 | Reserved (0) |
| 16 | 16 | Id (the 16 bytes of the UUIDv7 message id) |
| 32 | size | Vector (Float32 LE; 256 dims for distribution, 768 for registration) |

A record is 32 + size bytes (1,056 for distribution, 3,104 for registration), both multiples of 16.

- **The whole 16-byte control block is the magic.** For distribution it is
  `6c 63 74 79 76 4c 45 30 | 00 04 00 00 | 00 00 00 00`, and readers compare all 16 bytes. Reading with the wrong byte
  order turns 1024 into 262,144, so it can never match; a different dimension (another model) also changes the magic.
  Writers set reserved to 0, and version-0 readers reject anything else (a future use bumps the version).
- **The size is always in bytes**, so the next record's position (16 + 16 + size) can be computed without knowing the
  element type or the dimension.
- **Why little-endian:** WebAssembly memory is little-endian by specification. TypedArrays use native byte order, and in
  practice every machine running a browser is little-endian. Read from the start of the file, ids and vectors are 16-byte
  aligned and can be used by WASM SIMD as they are.
- **No compression.** A predictable size matters more (about 10 MB for 10,000 records; dense vectors shrink only 7–9%
  with gzip).
- **Ids and vectors are one-to-many.** A round split into parts has one record per part with the same id. Part numbers
  are not stored: search keeps the best score per id.

## Vector DB

- One file per embedding model, `data/_vectors.<model>.sqlite`, ATTACHed to `_index.sqlite` so it can be joined with the
  rounds. Model names become file names and may contain only `[A-Za-z0-9._-]`.

```sql
CREATE TABLE vectors (
  msg_id TEXT NOT NULL, part INTEGER NOT NULL, rev TEXT NOT NULL,
  vec BLOB NOT NULL,      -- 768 dims, Float32, L2-normalized (source of truth)
  vec256 BLOB NOT NULL,   -- the first 256 dims of vec, L2-renormalized (derived uniquely from vec)
  PRIMARY KEY (msg_id, part));
```

- `vec256` is computed at registration, so building the distribution binary only concatenates rows. Truncation relies on
  EmbeddingGemma's Matryoshka representation.
- Vectors are stored L2-normalized, so a dot product is the cosine similarity.

## Registration (browser → server)

1. `GET /api/vectors/pending?model=` returns rounds waiting for embeddings: `[{id, rev, parts}]`, newest first, up to 16.
2. The browser embeds every part (768 dims), encodes the records, and sends
   `PUT /api/vectors?model=&magic=lctyvLE0&size=3072&entry_count=<n>&rev=<id>:<rev>,…` with
   `Content-Type: application/octet-stream`.
3. Before reading the body, the server checks `magic`, `size` and `entry_count` from the query against the body length
   (n × 3,104) and returns 400 on mismatch. It also checks each record's control block.
4. The vectors of each id in the body replace all of that id's vectors (parts in body order). Ids not in the body are
   untouched.
5. **Stale vectors are not registered.** An id whose `rev` differs from the current text, or whose part count does not
   match, is dropped and reported in `stale` (an undo or regenerate happened while embedding). It shows up as pending
   again and is embedded next time.

- The rev list is in the URL (WEBrick accepts up to 2,083 bytes), so one PUT carries at most 16 ids. Several PUTs may run
  at once; merging everything into one file is the server's job.
- The indexer runs one pass at a time; a kick while running causes one more pass afterwards. Rounds that fail to embed
  (too large, …) are skipped for the rest of the session.

## Distribution (server → browser)

- `GET /api/vectors?model=` returns `data/_vectors.<model>.256.bin` (derived data): every valid vector, joined with the
  current rounds on `msg_id`, `part` and `rev`.
- The file is rewritten as a whole (temporary file, then `rename`) on the next request after vectors or rounds change.
  There are no incremental fetches (no `Range`): **full sync only.** Deletions and replacements show up in the rewritten
  file, so no list of invalidated ids is needed.
- It carries an `ETag` (modification time and size) and `Cache-Control: no-cache`, so the browser revalidates every
  time and gets 304 when nothing changed. Storage on the browser side is left to the HTTP cache; when the `ETag` is
  unchanged the file is not parsed again.
- **The browser uses only what the server serves.** It never appends vectors it PUT itself.

### Garbage collection

- **Stale vectors are not deleted on the spot.** When a round disappears or its text changes, its vectors stay in the
  vector DB; at startup, vectors that match no current round (`msg_id`, `part`, `rev`) are deleted.
- The distribution binary is joined on `rev`, so leftovers never mix in.
- After an undo returns to the same content, the remaining vectors are reused without embedding again.

## Search in the browser

1. Embed the query (768 dims), take the first 256 dims and L2-renormalize.
2. Put the downloaded bytes into WASM memory as they are and run SGEMV with a row stride of 1,056 bytes and a vector
   offset of 32 (no copying).
3. Keep the best score per id and take the top 50.

- `sgemv.js` assembles the WebAssembly module by hand (no external tools): `sgemv(base, rows, stride, dim, q, out)` with
  four `v128` accumulators.
- Measured (Chromium on this Mac, 10,000 × 256): SGEMV plus best-per-id and sorting about 3 ms (SGEMV alone 0.2 ms);
  validating the file and loading it into WASM about 11 ms (only when it changed). A whole search, including embedding
  the query, takes about 40 ms.
- How much accuracy truncation to 256 dims costs has not been compared with 768 dims yet.

## Why in the browser

Server-side brute force with Accelerate's `cblas_sgemv` through Fiddle was already within the 50 ms budget (1.5 ms for
10,000 × 768). Semantic search moved to the browser not for speed but so the browser can work with vectors itself.
Brute force stays: approximate nearest-neighbor indexes and candidate pre-filtering are not used, because a personal
collection (at most about 100,000 rounds) is fast enough.
