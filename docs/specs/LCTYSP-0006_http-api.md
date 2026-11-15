<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0006: HTTP API

- Status: Accepted; reads only. Every write goes through the RPC protocol of
  [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md) (`/v1/rpc`, [LCTYSP-0016](LCTYSP-0016_hardening.md#3-every-write-through-v1rpc)),
  and the writes of this API (creating, appending to, popping and deleting conversations) are gone. What stays here is
  plain reading: the conversations of [LCTYSP-0003](LCTYSP-0003_conversation-file.md), the searches and the vector
  binaries.
- Related: [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0004](LCTYSP-0004_editing.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md), [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md), [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)
- Implementation: `lib/v1/servlet.rb` (`Chatty::V1::Servlet`, mounted at `/v1`), client: `public/js/api/storage.js`

## Summary

lcty.rb answers `/v1/*` on the same origin as the pages, with `GET` and, for the searches, `POST`; any other method is
405. Bodies are JSON unless stated otherwise. Errors return `{"error": "…"}` with an HTTP status. Every request is
checked first by the request guard of [LCTYSP-0016](LCTYSP-0016_hardening.md) (its `Host`, the `Origin` of a `POST`,
the type and the size of its body).

## Conversations

| Method | Path                    | Content                                                                                                                                                                                                                                            |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/conversations`     | List, newest first: `[{id, title, created_at, updated_at_hint, messages, tags, message_ids}]`. `message_ids` are the ids of the rounds the conversation owns (its non-inherited user messages), used to map semantic search hits to conversations. |
| GET    | `/v1/conversations/:id` | The conversation as JSON: `{meta, title, tags, messages}` (presentation HTML is not included). Used outside the conversation page, for example when forking.                                                                                       |

- **`updated_at_hint` is only a hint (the name says so).** It is the file's modification time, so copying, syncing, restoring a
  backup or editing a file by hand changes it too. It orders lists and is shown as a rough date; nothing depends on it
  being exact. The conversation files record no update time.
- A conversation is created, appended to, retitled, retagged and deleted over `/v1/rpc` (`c.create`, `c.append.msg`,
  `c.update.title`, `c.update.tags`, `c.delete`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)). The earlier writes of
  this API (`POST /v1/conversations`, `POST /v1/conversations/:id/lines` and `…/pop`) answer 404 and
  `DELETE /v1/conversations/:id` 405; nothing writes the format of LCTYSP-0003 any more.

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
read and written over `/v1/rpc` (`t.list`, `t.replace`, `t.memory.add`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)):
`GET /v1/tags` and `POST /v1/tags/:file/memory` answer 404, and `PUT /v1/tags` 405.

- The tags of a conversation, like `data-setup-tags` of a new conversation and `tag:` in `POST /v1/search`, are
  references (file-name parts, `c~23`), checked mechanically only: valid UTF-8, no whitespace or control characters,
  no `/`, `\` or `:`, at most 244 bytes.

See [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) for the meaning of tags and memory.

## Limits

- Request bodies are limited to 64 MiB (413 otherwise).
