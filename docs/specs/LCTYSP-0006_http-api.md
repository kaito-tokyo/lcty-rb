<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0006: HTTP API

- Status: Accepted; to be replaced for every change by the RPC protocol of [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)
  (`/v1/rpc`). Until the pages use it, this API is what they call. What stays plain `GET` after that (reading whole
  stores, the vector binaries) is to be kept here.
- Related: [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0004](LCTYSP-0004_editing.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md), [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md), [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)
- Implementation: `lib/v1/servlet.rb` (`Chatty::V1::Servlet`, mounted at `/v1`), client: `public/js/api/storage.js`

## Summary

lcty.rb answers `/v1/*` on the same origin as the pages. Bodies are JSON unless stated otherwise. Errors return
`{"error": "…"}` with an HTTP status. Requests are not checked for `Host` or `Origin`
([LCTYSP-0001](LCTYSP-0001_architecture.md)).

## Conversations

| Method | Path                          | Content                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/conversations`           | List, newest first: `[{id, title, created_at, updated_at_hint, messages, tags, message_ids}]`. `message_ids` are the ids of the rounds the conversation owns (its non-inherited user messages), used to map semantic search hits to conversations.                                                                                                      |
| POST   | `/v1/conversations`           | Create. Body `{meta, lines}`: `meta` (`{id, created_at, tags, instructions}`; other keys are ignored) and initial lines (for example lines copied from the fork source). 409 if the id exists. Returns 201.                                                                                                                                             |
| GET    | `/v1/conversations/:id`       | The conversation as JSON: `{meta, title, tags, messages}` (presentation HTML is not included). Used outside the conversation page, for example when forking.                                                                                                                                                                                            |
| POST   | `/v1/conversations/:id/lines` | Append lines (a JSON array). `type` may be `message`, `title` or `tags`. A `title` line overwrites the title slot on line 2 instead of being appended; a `tags` line sets the conversation's current tags in `tags.sqlite` and is not written to the file ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). Assistant messages may carry `content_html`. |
| POST   | `/v1/conversations/:id/pop`   | Body `{"from": n}`: delete the messages from index `n`. **409 if `n` is before the last user message** ([LCTYSP-0004](LCTYSP-0004_editing.md)).                                                                                                                                                                                                         |
| DELETE | `/v1/conversations/:id`       | Delete the conversation (and its index entries).                                                                                                                                                                                                                                                                                                        |

- **`updated_at_hint` is only a hint (the name says so).** It is the file's modification time, so copying, syncing, restoring a
  backup or editing a file by hand changes it too. It orders lists and is shown as a rough date; nothing depends on it
  being exact. The conversation files record no update time.
- Lines are validated before anything is written ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)): message ids must be
  UUIDv7, tag lists must be unique valid tag names, `content_html` must be a string, and characters XML cannot represent
  are rejected outside text strings. A rejected request writes nothing.
- Every write updates the search index for that conversation ([LCTYSP-0007](LCTYSP-0007_search.md)).

## Settings

| Method | Path                | Content                                                                                                                            |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/defaults.json` | Defaults of the browser settings (endpoint, API key, model names, …). Read only ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)). |

## Search

| Method | Path           | Content                                                                                                                                                                                           |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/search`   | Keyword search. Body `{q, tags?, limit?}` (`limit` 1–200, default 50). Returns `{results: [{id, conv_id, snippet}]}` in rank order. `tags` limits results to conversations that have all of them. |
| POST   | `/v1/snippets` | Snippets of rounds. Body `{ids, q}` (up to 200 ids). Returns `{id: {conv_id, snippet}}`. Used for rounds found only by semantic search.                                                           |

## Vectors

The server embeds every message itself and keeps the vectors in a pair of files; nothing outside the server registers
vectors ([LCTYSP-0019](LCTYSP-0019_server-embedding.md)).

| Method | Path                                                 | Content                                                                                                                                                                                          |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/vectors.eg2_264.json`                           | The pair's generation, its number of records and its invalid rows: `{rev, count, invalid: [[first, last], …]}`, with an `ETag` of its content (304 when unchanged); 503 before the pair is open. |
| GET    | `/v1/vectors.eg2_264.dat`, `/v1/vectors.eg2_264.idx` | The rows (1,056 bytes each) and the ids (16 bytes each) of the pair, by `Range: bytes=<first>-<last>` (206) or whole (200). `ETag: "<rev>"`; `If-Match` of another generation is 412.            |

- `eg2_264` names the pair of the default embedding model; another `--embedding-hf-repo` names another one
  ([LCTYSP-0019](LCTYSP-0019_server-embedding.md#settings)). A query is embedded over `/v1/rpc`
  (`vectors.eg2_264.embed`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)).

## Tags and memory

The tag definitions and their memory (one HTML file per tag in `t/`,
[LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#storage-one-html-file-per-tag)) are no longer part of this API: they are
read and written over `/v1/rpc` (`t.list`, `t.replace`, `t.memory.add`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)),
and `GET` and `PUT /v1/tags` and `POST /v1/tags/:file/memory` answer 404.

- The `tags` line of `POST /v1/conversations/:id/lines` sets the rows of the conversation in `t_has_many_c` of
  `lcty_t.sqlite`, and the change is announced over `/v1/rpc` as `t.batch.updated`; `DELETE /v1/conversations/:id`
  is announced as a `c.batch.updated` that deletes it from `c_meta` and `c_recordcount`, and a `t.batch.updated` for
  its rows ([LCTYSP-0014](LCTYSP-0014_browser-sync.md)). Its tags, like
  `data-setup-tags` of a new conversation and `tag:` in `POST /v1/search`, are references (file-name parts, `c~23`),
  checked mechanically only: valid UTF-8, no whitespace or control characters, no `/`, `\` or `:`, at most 244 bytes.

See [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) for the meaning of tags and memory.

## Limits

- Request bodies are limited to 64 MiB (413 otherwise).
