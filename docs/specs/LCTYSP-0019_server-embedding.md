<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0019: Embedding on the server

- Status: Draft. Nothing of it is implemented: the browser still embeds rounds
  ([LCTYSP-0008](LCTYSP-0008_vector-binary.md)).
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md), [LCTYSP-0002](LCTYSP-0002_llm-backend.md),
  [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md),
  [LCTYSP-0010](LCTYSP-0010_data-and-settings.md), [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md),
  [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md)

## Summary

The embedding model moves from the browser to the server. lcty.rb starts a `llama-server` of its own for the embedding
model, as a child process listening on a UNIX domain socket in a temporary directory, and embeds with it both the
messages of the conversations, in the background, and the queries of semantic search. The browser no longer has an
embedding model setting and never talks to an embedding model.

What is embedded is one `lcty-msg` ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md)), not a round. A message's
content never changes for its id, so its vectors never change either: they are only ever added, or invalidated when
the message goes away.

The vectors are kept in two files, the **rows** (`.dat`) and the **ids** (`.idx`), which are the source of truth. While
the server runs, the rows are only appended to, except that a row may be filled with NaN, and the ids are only ever
appended to; every start begins a new generation by writing their headers again. The browser keeps a copy of both and
fetches only what it does not have yet, with `Range`. A small JSON document, made by the server from the two files,
saves the browser from finding the invalid rows itself.

The chat model is untouched: the browser still streams replies from llama-server directly
([LCTYSP-0002](LCTYSP-0002_llm-backend.md)).

## Why the embedding model is the server's

The chat model and the embedding model only look alike, as two models behind llama-server. The chat model is the
user's choice: any model the router serves can answer, a reply streams, and keeping its prefix identical is what makes
llama-server's cache work. Nothing of a reply depends on which model wrote the replies before it.

The embedding model is part of the index:

- **Its vectors are kept on the server** and only mean something against vectors of the same model. Changing the model
  makes every vector useless; it is rebuilding the index, not a preference.
- **The distribution files already name one model** (`vectors.eg2_264.*`, [LCTYSP-0008](LCTYSP-0008_vector-binary.md)),
  and semantic search refuses to run when the browser's `embedding_model` is not the server's default
  (`public/js/search/search-panel.js`). The setting exists, but it cannot really be chosen.
- **Its prompts are fixed** (`title: none | text: `, `task: search result | query: `,
  [LCTYSP-0007](LCTYSP-0007_search.md)), and so are its dimensions. Nothing streams and there is no cache to keep.
- **Only the browser can index today,** so nothing is embedded while no page is open, and lost vectors come back only
  as pages are used.

## What is embedded

- **One `lcty-msg` of role `user` or `model` is embedded on its own,** with the prefix `title: none | text: ` and its
  `data-content`. `system` and `memory` are not: they are snapshots of tags, copied into every conversation that has the
  tag. `lcty-thinking`, `lcty-tool` and `lcty-cmd` are not part of the conversation's text
  ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md#principles)).
- **A message longer than 6,000 characters is split into parts,** each embedded on its own, so each fits the model's
  8,192-token context. Every part is a row with the message's id; search keeps the best row of each id.
- **The vectors of an id never change.** A message's content is fixed for its id: a file changes only by appending a
  line at its end or removing its last line, and a copied conversation gets new ids
  ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md#principles)). A regenerated reply is a new message with a new
  id. So nothing like the `rev` of a round is needed, neither in the files nor in memory: a row is out of date only
  when its message no longer exists, or when the whole system changes (another model, another row layout), which makes
  a new generation ([The vector DB](#the-vector-db)).
- **Rounds are not used for search.** A round, a user message and the reply after it, means nothing to search: what is
  looked for is a conversation, and search keeps the best hit of each conversation, whether it was the question or the
  reply. A round's content also changes when its reply is regenerated, which is why the vectors needed a `rev`.

## The embedding server

### Process

- **lcty.rb starts one child process, `llama-server`,** for the embedding model alone (not router mode):

  ```
  llama-server --hf-repo ggml-org/embeddinggemma-2-GGUF:Q8_0 --embedding \
    -c 8192 -b 8192 -ub 8192 -ngl all --no-webui --host <socket>
  ```

  `-c`, `-b` and `-ub` are those of the router's section today ([LCTYSP-0002](LCTYSP-0002_llm-backend.md)): one input
  is processed in one batch, so the batch must be the context size.
- **Its environment has no `LLAMA_*` variable.** `LLAMA_API_KEY` and `LLAMA_ARG_*` of the user's shell (those
  `llm-backend/run-llama-cpp.sh` exports, for one) would otherwise apply to it: an API key, another host or port, a
  models preset. Everything it needs is on its command line.
- **No API key, no port.** It listens on a UNIX domain socket only (`--host` ending in `.sock`); it opens no TCP port.
  Who may connect is decided by the directory's permissions.
- **The model is downloaded on the first start** to llama.cpp's cache, as the router does today; `--offline` is not
  passed.

### The socket

- **The socket is `embedding.sock` in a directory made by `Dir.mktmpdir('lcty-')`** at startup, under `TMPDIR`. The
  directory is `0700`, so only the user can reach the socket, whatever the socket's own mode.
- **A new directory at every start,** so a socket left by a server that did not stop cleanly is never in the way, and
  the data directory's location does not matter.
- **The path must fit `sun_path`:** 104 bytes on macOS, 108 on Linux. With macOS's default `TMPDIR`
  (`/var/folders/…/T/`) it is 85 bytes. A longer one (a `TMPDIR` set deep) is checked before starting the child: the
  embedding server is not started and the log says why.

### Lifetime

- **Started after the data is opened, before the server listens, without waiting for it.** The child takes about a
  second to load the model (more on the first start, which downloads it); the site is served meanwhile. lcty.rb polls
  `GET /health` on the socket until it answers 200.
- **Until then, and whenever it is down, query embedding is unavailable** and keyword search alone is used, with the
  notice of [LCTYSP-0007](LCTYSP-0007_search.md). The vectors already made can still be fetched.
- **Stopped with the server.** `Lcty.stop` (INT, TERM) sends TERM to the child, waits for it a few seconds, sends KILL
  if it is still there, and then removes the directory. The child is stopped first: its socket is in the directory.
- **A child that exits on its own is started again** with a growing delay, and the log says how it exited.
- **A child left behind is found by a pid file.** When lcty.rb is killed with KILL or crashes, nothing stops the child,
  which keeps about 0.5 GB; llama-server has no option to exit with its parent. So lcty.rb writes the child's pid and
  socket path to `lcty_embedding.pid` in the data directory (the temporary directory is another one at every start,
  so it cannot hold it), and removes the file when it stops the child. At the next start, a file that is still there
  is checked: if that pid is alive and its command line is `llama-server` with that socket path, it is sent TERM and
  its directory is removed. Otherwise the pid was taken by another process and nothing is done to it.

### Talking to it

- **HTTP/1.1 over the socket, one connection per request** (`Connection: close`). Ruby 2.6's `Net::HTTP` cannot open a
  UNIX socket, so lcty.rb writes the request itself on a `UNIXSocket` and reads the response: `POST /v1/embeddings`
  with `{"input": [text, …]}`, and `GET /health`.
- **A request blocks only its own thread.** Waiting on the socket releases the GVL, so the other requests of WEBrick
  go on.
- Every vector is checked to have 768 dimensions; anything else is an error. The server keeps the first 256 and
  L2-normalizes them (EmbeddingGemma's Matryoshka representation, as [LCTYSP-0008](LCTYSP-0008_vector-binary.md)
  does today); the 768 dimensions are not kept, since the server can embed again whenever it needs to.

## The vector DB

Two files in the data directory, the source of truth, for the default model and row layout:
`lcty_fuzzy_search.eg2_264.dat` and `lcty_fuzzy_search.eg2_264.idx`. `eg2_264` names the model and the row layout, as
the distribution files do today ([LCTYSP-0008](LCTYSP-0008_vector-binary.md#terms)). They replace
`lcty_fuzzy_search.sqlite`.

### Records

Both files are arrays of fixed-size records, and record _i_ of one belongs with record _i_ of the other. Everything is
little-endian.

- **`.dat`: 1,056 bytes a record,** the row of the kernel `bdot264`: 256 × Float32, then 32 zero bytes
  ([LCTYSP-0008](LCTYSP-0008_vector-binary.md#search-in-the-browser)). The file is placed into the kernel's memory as it
  is.
- **`.idx`: 16 bytes a record,** the 16 bytes of the message's UUIDv7 (the UUID of its `id`, without the prefix
  `msg-u-` or `msg-m-`).
- **Record 0 is the header of both** and names the **generation** of the pair by its `rev`: a 48-bit count of
  milliseconds since the Unix epoch, the time the generation began. A new generation's `rev` is the current time, or
  one more than the `rev` before it if that is not smaller, so `rev` always grows, even when the clock goes back.
  - **In `.idx`, a UUIDv8** carrying `rev` by the rule of UUIDv7's timestamp: octets 0–5 are `rev`, big-endian; octet 6
    holds the version 8 in its high nibble and octet 8 the variant `10` in its two high bits; every other bit is zero.
    The UUID is a function of `rev`, so it adds nothing to identify a generation; it is only how `rev` is written as an
    id.
  - **In `.dat`, 256 NaNs,** three of them with payloads: floats 0–2 are `0x7FC00000` OR'd with 16 bits of `rev`, most
    significant first (float 0 bits 47–32, float 2 bits 15–0); floats 3–255 are `0x7FC00000`. The quiet bit is set in
    every one, so a payload of zero is still a NaN, never an infinity. The 32 bytes after them are zero, as in every
    row.
  - Reading one record of each tells whether a `.dat` and an `.idx` are of the same generation: they hold the same
    `rev`. Record 0 scores NaN against any query, so search never takes it, and its id is a UUIDv8, never the UUIDv7 of
    a message, even when their times are the same.
  - **`rev` fits a JavaScript number** (it is below 2^53), so it is read as one, from three 16-bit payloads or from six
    octets, and written as one in the JSON.
- **The payloads are read and written as integers,** never as floats: a float operation may replace a NaN's payload.
  In JavaScript through `Uint32Array` or `DataView#getUint32`, in Ruby with `L<`. Copying the bytes, as the worker
  does, keeps them.

### Writing

- **`.idx` is only ever appended to.** Not one byte of it changes within a generation; its header is written again
  only at a start ([Starting](#starting)).
- **`.dat` is appended to, and a row may be filled with NaN;** nothing else changes. A NaN row is invalid: its 256
  floats are `0x7FC00000` and its 32 bytes of padding stay zero (the kernel needs them zero: NaN × 0 is NaN). Its id is
  left as it was.
- **New rows are appended to `.dat` and then their ids to `.idx`.** The number of rows is that of `.idx`; a longer
  `.dat` is a write that did not finish, and is cut back at the next start.
- **A message's rows are invalidated when it goes away:** when its line is removed (`c.unappend`) and when its
  conversation is deleted. Every row with its id is filled with NaN.
- **Before appending, the indexer checks that the message still exists.** A message removed while it was being
  embedded is dropped. There is nothing else to check, since the content of an id cannot have changed.
- **Why NaN:** a NaN row's score is NaN against any query, and every comparison with NaN is false. The worker keeps the
  best row of an id with `score > best` from −∞ and the top k with `v > min` (`public/fuzzy_search.worker.js`), so a
  NaN row is never taken, and an id whose rows are all NaN stays at −∞ and is never taken either. A zero row would score
  0, above every negative score. Code that handles scores has to keep this: no `Math.max` or full sort over scores
  that could let a NaN through.

### Starting

At every start, before the server listens, lcty.rb does only two things to the pair, cutting back and making good what
is missing, and then begins a new generation:

1. **Cut back** `.idx` to whole records and `.dat` to the rows of `.idx` (a write that did not finish).
2. **Fill with NaN** every row whose id is not a current `user` or `model` message and that is not NaN yet.
3. **Write a new header** to both files in place, with a new `rev`: `.dat` first, then `.idx`. A pair that does not
   exist yet is made with a header and no rows.
4. **Queue** every message without a valid row for embedding.

- **Starting is the one exception to "`.idx` is only appended to".** The rules of [Writing](#writing) are kept by the
  running server, the only writer; a start is the change from one run to the next, so it is where an exception
  belongs, and one that writes a header changes no row.
- **Nothing is dropped or moved.** No row changes its number, so no file is written anew or renamed. NaN rows stay
  until the pair is made again.
- **Headers that disagree** mean a start that stopped between the two writes. The next start writes both again, so
  nothing else is done about it.
- **Every start is a new generation,** so a browser's copy is fetched again after a restart. Since the copy is kept in
  memory only ([Distribution](#distribution)), a page loaded again fetches it whole anyway.
- **The check against the messages is by id alone.** It finds messages that went away while the server was down or
  failed to invalidate them. It cannot find a message whose content was changed outside the server (a file edited by
  hand, a backup restored over newer files): then the pair is deleted and made again.
- **Another model or row layout is another pair** (another name, [Settings](#settings)), made from nothing. The old pair
  is left as it is, so going back to its model needs no embedding.

### The JSON

- **`GET` of a JSON document that the server makes from the pair,** in memory, on every request; it is never written
  to disk. It is not needed: everything in it can be found by reading the pair. It saves the browser scanning `.dat`
  for NaN rows.
- It holds the generation (`rev`, a number), the number of records (header included), and the invalid rows as ranges
  of record numbers (`[[first, last], …]`, ascending). A message's parts are adjacent rows, so the ranges stay short.
- **The browser fetches it whole every time,** revalidated by `ETag` (a digest of its content), so an unchanged one
  costs a 304.
- The server keeps the invalid ranges in memory, made at startup by scanning `.dat` and updated as rows are
  invalidated.

## Distribution

- **The URLs** are `/v1/vectors.eg2_264.dat`, `/v1/vectors.eg2_264.idx` and `/v1/vectors.eg2_264.json`, named after the
  pair as the distribution files are today.
- **`.dat` and `.idx` are served with `Range`,** with the generation in `If-Match`. Their `ETag` is `"<rev>"`, the
  generation's `rev` in decimal, so a request carries `If-Match: "<rev>"`; one for another generation than the current
  one is answered 412, and the browser starts again from the JSON. Only `bytes=<first>-<last>` is supported; the answer
  is 206, `application/octet-stream`.
- **The browser keeps a copy of the pair in the worker's memory only,** not in OPFS or IndexedDB: a page loaded again
  fetches it whole. Over localhost that is fast, and a copy kept across loads would need its own handling of
  generations. It can be added if it is measured to be slow. The copy is brought up to date from the JSON:
  1. **Another generation** (or no copy): fetch both files whole, up to the JSON's number of records.
  2. **The same generation:** fetch the records from the end of the copy to the JSON's number, of both files, and
     append them.
  3. **Fill with NaN** every row of the invalid ranges in the copy (the server's file has them as NaN already; the
     copy may have them from before).
- **The three can be fetched separately.** Within a generation the records below the JSON's number change only by
  becoming NaN, so a range fetched after the JSON holds the same rows, or rows that became NaN since, which the next
  JSON lists anyway.
- **`/v1/rpc` announces a change** (rows appended or invalidated) with the notification `vectors.eg2_264.changed`, sent
  to the pages that list it in `receives` of `initialize` ([LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)). Its parameters
  are the JSON's content, so the page need not fetch the JSON again. A new generation comes only with a new run of the
  server, whose pages connect again.
- `GET /v1/vectors/pending`, `PUT /v1/vectors` and the vector binary `lctyvLE0` go: nothing outside the server
  registers vectors any more.

## Query embedding

- **The method `vectors.eg2_264.embed` of `/v1/rpc` embeds a query,** named after the pair whose vectors it matches,
  as `c.create` is named after what it acts on: the page sends the text; the server embeds it with the prefix
  `task: search result | query: ` and returns its first 256 dimensions, L2-normalized, the query the worker takes
  ([LCTYSP-0008](LCTYSP-0008_vector-binary.md#search-in-the-browser)). Whether the vector comes back as JSON numbers or
  as bytes is open.
- **Budget:** measured over the socket from `/usr/bin/ruby`, one embedding takes 12 ms once warm (24.6 ms for the
  first), so a search stays within 50 ms ([LCTYSP-0001](LCTYSP-0001_architecture.md)).

## Settings

Options of lcty.rb, in `server_settings.txt` or on the command line ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)):

| Option                         | Default                               | Meaning                                             |
| ------------------------------ | ------------------------------------- | --------------------------------------------------- |
| `--llama-server=PATH`          | `llama-server` (from `PATH`)          | The `llama-server` to start for the embedding model |
| `--embedding-hf-repo=REPO:TAG` | `ggml-org/embeddinggemma-2-GGUF:Q8_0` | The model, as `--hf-repo` of llama-server           |
| `--no-embedding`               | (embedding on)                        | Start no embedding server: keyword search only      |

- **The pair is named `<slug>_<floats>`,** the floats of a row (264 today). The slug is `eg2` for the default
  repository; for another `--embedding-hf-repo` it is the first 8 hex digits of the SHA-256 of `REPO:TAG`. The same
  name is used for the files, the URLs and the RPC names.
- **The browser setting `embedding_model` goes,** with its field in the settings dialog and its key in
  `/v1/defaults.json`. A stored value is ignored.
- A `llama-server` that cannot be found or fails to start is not an error of lcty.rb: it starts, logs why, and serves
  keyword search only.

## What changes elsewhere

- [LCTYSP-0001](LCTYSP-0001_architecture.md): "Inference traffic never goes through Ruby" and "Ruby does not know the
  LLM exists" become true of the chat model only. Ruby gets a fourth job, embedding.
- [LCTYSP-0002](LCTYSP-0002_llm-backend.md): the router serves the chat model only. The section `[embeddinggemma-2]`
  leaves `llm-backend/llama-cpp.ini`; left there, the model would be loaded twice (about 0.5 GB more). `embedding_model`
  leaves the backend settings.
- [LCTYSP-0006](LCTYSP-0006_http-api.md): `GET /v1/vectors/pending`, `PUT /v1/vectors` and the distribution files go;
  the pair with `Range` and the JSON come.
- [LCTYSP-0007](LCTYSP-0007_search.md): the unit of search is a message, not a round, for keyword search too. A term
  shorter than three characters is required to appear (`LIKE`); split between a question and its reply it would match
  neither message, so that requirement is checked per conversation. The query is embedded by the server.
- [LCTYSP-0008](LCTYSP-0008_vector-binary.md): registration, the vector binary, the vector DB in SQLite and the full
  sync go; the kernel, the worker's search and the row layout stay. The worker skips record 0, appends ranges and fills
  invalid rows with NaN.
- [LCTYSP-0010](LCTYSP-0010_data-and-settings.md): the pair replaces `lcty_fuzzy_search.sqlite` in the data directory
  and is kept and backed up (making it again embeds every message); the new options; `embedding_model` leaves the
  browser settings.
- [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md): `vectors.eg2_264.embed` and `vectors.eg2_264.changed`.
- [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) is a prerequisite: the files of today
  ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)) have no id for every message that is fixed with its content.
- `public/js/search/embed.js` and its feature [LCTYSP-1012](LCTYSP-1012_embedding.feature) go, as do the parts of
  [LCTYSP-1011](LCTYSP-1011_vector-store.feature), [LCTYSP-3006](LCTYSP-3006_vector-records.feature) and
  [LCTYSP-3007](LCTYSP-3007_vector-db.feature) about the vector binary and the SQLite DB; the pair, the indexer and the
  embedding server get backend features (`LCTYSP-3xxx`).
- README: `llm-backend/run-llama-cpp.sh` is for the chat model only; lcty.rb needs `llama-server` on `PATH` for
  semantic search.

## Rejected

- **`llama-embedding`, the command:** its vectors are those of llama-server (cosine 1.0, largest difference 5e-8), but
  every run loads the model, 0.9–1.6 s. Fine for a batch of messages, far over the budget for a query, so a resident
  process is needed anyway, and one is enough for both.
- **Ruby calls the router's `/v1/embeddings`:** the smallest change, but Ruby would have to know the router's URL and
  API key, and the embedding model would still be configured in `llm-backend/llama-cpp.ini`, apart from the index it
  belongs to.
- **RubyGems:** the gems that run a model (informers 1.3.0, onnxruntime 0.11.8, tokenizers 0.7.0) need Ruby 3.2 or
  3.3, not `/usr/bin/ruby` 2.6, and lcty.rb installs nothing ([LCTYSP-0001](LCTYSP-0001_architecture.md)). A native
  binding would also put the model in WEBrick's process: its memory, the GVL held during inference, and its crashes.
- **Rounds as the unit:** see [What is embedded](#what-is-embedded).
- **A `rev` for every row:** it is needed only for rounds, whose content changes under one id. With messages it would
  only add state to keep in step.
- **Deleting a row by moving the rows after it,** or keeping deletions only in the JSON: either changes the record
  numbers or makes the JSON necessary. A NaN row keeps every number, and the pair alone says what is valid.
- **Zero rows for deleted ones:** a zero row scores 0, above every negative score, so it would need its id cleared and
  a check in the worker.
- **Dropping invalid rows at a start** into a new pair, renamed into place: a start does only cutting back and making
  good. Writing a pair anew also needs two renames, which are not one, and a way to finish a pair left between them.
- **A generation number that counts up, or a random UUID:** a count starts again at 0 when the pair is made again, so
  an old copy could look current; a random part says nothing about order. A time in milliseconds does both, as long
  as it is kept growing.
- **Keeping the generation across a restart** when nothing changed: it would save fetching the pair once per restart,
  but a start would then have to decide whether it changed anything.

## Verified assumptions

Checked on 2026-11-13 with llama.cpp build 12110 (Homebrew) and embeddinggemma-2 Q8_0:

- `--host` with a path ending in `.sock` makes llama-server listen on a UNIX socket and open no TCP port (`lsof`).
- `POST /v1/embeddings` over the socket from `/usr/bin/ruby`'s `UNIXSocket` returns 768 dimensions.
- A socket path over 104 bytes makes llama-server exit with `couldn't bind HTTP server socket`.
- The socket file is left behind when llama-server is killed.
- `LLAMA_API_KEY` in the environment makes llama-server require that key.
- The vectors of `llama-embedding` and of llama-server's `/v1/embeddings` are the same.
- `Dir.mktmpdir` under macOS's default `TMPDIR` makes a `0700` directory, and the socket's path in it is 85 bytes.
- `public/fuzzy_search.worker.js` never takes a row or an id whose score is NaN (by reading the code; not run).

## Open questions

1. **When NaN rows go:** a start keeps them, so they only grow. Deleting the pair, which makes it again and embeds
   every message, is the only way here. Whether a command that writes the pair anew is wanted.
2. **Accuracy per message:** the check of [LCTYSP-0002](LCTYSP-0002_llm-backend.md#verified-assumptions) (5–6 of 6
   questions) embedded rounds. It is to be measured again before this is implemented, with messages, and with 256
   dimensions against 768, which [LCTYSP-0008](LCTYSP-0008_vector-binary.md#search-in-the-browser) has not compared
   yet.
3. **The form of the query's vector** in the answer of `vectors.eg2_264.embed`: JSON numbers or bytes.
