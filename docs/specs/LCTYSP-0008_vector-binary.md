<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0008: Vector binary and semantic search

- Status: Accepted
- Related: [LCTYSP-0006](LCTYSP-0006_http-api.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)
- Implementation: `lib/v1/vector_records.rb` (vector binary), `lib/v1/vector_db.rb` (vector DB), `public/js/search/vectors.js`, `public/fuzzy_search.worker.js` (search worker), `public/bdot264.wat` (kernel; built to `public/bdot264.wasm`), `public/js/search/embed.js`

## Summary

The browser embeds rounds and registers them with the server as a **vector binary**, a fixed-size record format named
`lctyvLE0`. The server keeps them in a **vector DB** (SQLite) and serves the merged 256-dimension vectors back as two
files in one response, **the rows** (laid out exactly as the kernel's memory) and **the ids** (16 bytes per row), which
the browser scans with hand-written WebAssembly SIMD.

## Terms

- **Vector binary**: the exchange format for registration (`lctyvLE0`, PUT body, 768 dims).
- **Distribution files**: what the server serves, 256 dims, for the default embedding model: `vectors.eg2_264.dat` (the
  rows: 256 × Float32 LE + 32 zero bytes each, the kernel's row layout) and `vectors.eg2_264.idx` (16 bytes per row, the
  UUIDv7 message id, in the same order), at `/v1/vectors.eg2_264.dat` and `/v1/vectors.eg2_264.idx`; derived data in `data/` (`_vectors.eg2_264.dat`, `_vectors.eg2_264.idx`).
  The name says what the rows are: `eg2` the embedding model (embeddinggemma-2, the default), `264` the row layout of
  the kernel `bdot264` (256 floats and 32 B of padding). A different default model or row layout gets a new name.
- **Vector DB**: the persistent format in SQLite, `data/_vectors.<model>.sqlite` per embedding model (derived data). Only
  the server reads and writes it.

## Record format

Every record has a fixed size and everything is little-endian: a 16-byte control block `lctyvLE0[size][reserved]`, the
id, then the vector.

| Offset | Size | Content                                                                                     |
| ------ | ---- | ------------------------------------------------------------------------------------------- |
| 0      | 8    | Magic `lctyvLE0` (ASCII; v = vector, LE = little-endian, 0 = version)                       |
| 8      | 4    | Byte size of the following vector (uint32 LE; 1024 for distribution, 3072 for registration) |
| 12     | 4    | Reserved (0)                                                                                |
| 16     | 16   | Id (the 16 bytes of the UUIDv7 message id)                                                  |
| 32     | size | Vector (Float32 LE; 256 dims for distribution, 768 for registration)                        |

A record is 32 + size bytes (3,104 for registration), a multiple of 16.

- **The whole 16-byte control block is the magic.** For registration it is
  `6c 63 74 79 76 4c 45 30 | 00 0c 00 00 | 00 00 00 00`, and readers compare all 16 bytes. Reading with the wrong byte
  order turns 3072 into 786,432, so it can never match; a different dimension (another model) also changes the magic.
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

- `vec256` is computed at registration, so building the distribution files only concatenates rows. Truncation relies on
  EmbeddingGemma's Matryoshka representation.
- Vectors are stored L2-normalized, so a dot product is the cosine similarity.

## Registration (browser → server)

1. `GET /v1/vectors/pending?model=` returns rounds waiting for embeddings: `[{id, rev, parts}]`, newest first, up to 16.
2. The browser embeds every part (768 dims), encodes the records, and sends
   `PUT /v1/vectors?model=&magic=lctyvLE0&size=3072&entry_count=<n>&rev=<id>:<rev>,…` with
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

- `GET /v1/vectors.eg2_264.dat` and `GET /v1/vectors.eg2_264.idx` return the two distribution files, each `application/octet-stream`.
  - **Only the default embedding model is distributed** (`embedding_model` of `/v1/defaults.json`): the URLs and the
    files have fixed names. The browser embeds rounds and PUTs them with the model of its settings, but semantic search
    uses the files only when that model is the default one; with another it searches by keywords only and says why.
  - **The rows can be mapped into memory as they are:** n rows of 256 × Float32 LE followed by 32 zero bytes
    (1,056 B), which is the kernel's row layout, so the browser copies `vectors.eg2_264.dat` into its wasm memory unchanged.
  - **The ids are only for mapping a row to its round:** `vectors.eg2_264.idx` is n × 16 bytes, row i's UUIDv7 message id at
    16 × i. A file of ids alone keeps the rows free of anything but vectors.
  - Neither file has a header: the row count is the length of `vectors.eg2_264.idx` / 16, and `vectors.eg2_264.dat` must be exactly
    1,056 × that.
- Every valid vector is included, joined with the
  current rounds on `msg_id`, `part` and `rev`.
- The files are rewritten as a whole (temporary files, then `rename`, the ids first) on the next request after vectors
  or rounds change (and when the server has just started).
  There are no incremental fetches (no `Range`): **full sync only.** Deletions and replacements show up in the rewritten
  files, so no list of invalidated ids is needed.
- **Both files carry the same `ETag`**, the pair's version (`vectors.eg2_264.dat`'s modification time and both sizes),
  and nothing that gives them a freshness lifetime (no `Cache-Control`, no `Last-Modified`), so the browser revalidates
  every time and gets 304 when nothing changed. The worker fetches
  the two at once; when their `ETag`s differ (a rewrite between the two requests) it fetches the pair again. Storage on
  the browser side is left to the HTTP cache; when the `ETag` is unchanged the files are not read again.
- **The browser uses only what the server serves.** It never appends vectors it PUT itself.

### Garbage collection

- **Stale vectors are not deleted on the spot.** When a round disappears or its text changes, its vectors stay in the
  vector DB; at startup, vectors that match no current round (`msg_id`, `part`, `rev`) are deleted.
- The distribution files are joined on `rev`, so leftovers never mix in.
- After an undo returns to the same content, the remaining vectors are reused without embedding again.

## Search in the browser

Semantic search runs in a worker, `/fuzzy_search.worker.js` (a classic script with no imports, served from `public/`
with the kernel `/bdot264.wasm`; not `/c/` files, since a conversation file opened on its own does not need them,
[LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). `js/search/vectors.js` only sends it messages; the worker starts on first use.

1. **Load** (`{ op: "load", dat, idx }`, the two URLs): the worker fetches the distribution files itself (revalidated by `ETag`; when unchanged nothing is read
   again), checks that the two files agree in length and numbers the distinct ids from `vectors.eg2_264.idx` (a row → id index in an `Int32Array`; an id has a row per part of its round).
2. **Place:** `vectors.eg2_264.dat` is exactly the kernel's rows (256 floats + 32 B of zero padding, 1,056 B each; the kernel
   requires zero padding, since NaN × 0 is NaN), so it is copied as it is to `0x110000`. Nothing is rewritten in place.
3. **Search** (`{ op: "search", query, k, allow }`): the query is embedded (768 dims), its first 256 dims are
   L2-renormalized on the main thread, and the worker runs `bdot264(rows)`: the dot product of the query with every
   row, which is the cosine similarity because both are L2-normalized.
4. **Best per id, then the top k, both linear:** one pass keeps the best row of each id in a `Float32Array`; a second
   pass keeps k candidates and their minimum (a larger value replaces the minimum, which is then found again among
   the k; cheaper than a heap for small k), and only those k are sorted (insertion sort). Nothing is sorted in full,
   and only k results cross to the main thread.
5. **Filters:** with `tag:` filters the main thread sends `allow`, the rounds of the matching conversations, and the
   worker selects among them exactly; otherwise the worker returns 2k and the main thread drops rounds whose
   conversation is not in the list before taking k (50).

- **The kernel** is `bdot264.wat` → `bdot264.wasm`: it imports a fixed 256 MiB memory (query at 0,
  scores at `0x10000`, rows at `0x110000`, at most 250,000 rows) and accumulates with six `v128` registers over 11
  steps of 96 bytes per row.
- **Fallback:** when the engine rejects the wasm or the memory cannot be made, the worker computes the same scores in
  JavaScript over the same layout (a warning goes to the console). Relaxed SIMD (`f32x4.relaxed_madd`) is not
  supported by Safari, so a kernel using it falls back there; plain SIMD (`f32x4.mul` + `f32x4.add`) works in every
  current engine.
- Measured in Chromium (the worker, k = 50, two rows per id), from posting the query to receiving the results:
  10,000 rows 0.6 ms, 100,000 rows 3.2 ms, 250,000 rows 7.5 ms, of which the kernel is 0.2 / 2.1 / 5.4 ms; in
  JavaScript (the fallback) 3 / 27 / 59 ms. Loading (fetch, checks, placing) takes 19 / 119 / 293 ms, only when the
  file changed. Sorting every id instead of selecting the top k took 101 ms at 250,000 rows.
- How much accuracy truncation to 256 dims costs has not been compared with 768 dims yet.

## Why in the browser

Server-side brute force with Accelerate's `cblas_sgemv` through Fiddle was already within the 50 ms budget (1.5 ms for
10,000 × 768). Semantic search moved to the browser not for speed but so the browser can work with vectors itself.
Brute force stays: approximate nearest-neighbor indexes and candidate pre-filtering are not used, because a personal
collection (at most about 100,000 rounds) is fast enough.
