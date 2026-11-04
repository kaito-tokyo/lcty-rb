<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-006: HTTP API

- Status: Accepted
- Related: [LCTYSP-003](LCTYSP-003_conversation-file.md), [LCTYSP-004](LCTYSP-004_editing.md), [LCTYSP-007](LCTYSP-007_search.md), [LCTYSP-008](LCTYSP-008_vector-binary.md), [LCTYSP-009](LCTYSP-009_tags-and-memory.md)
- Implementation: `chatty.rb` (`ApiServlet`), client: `public/js/api/storage.js`

## Summary

chatty.rb answers `/api/*` on the same origin as the pages. Bodies are JSON unless stated otherwise. Errors return
`{"error": "…"}` with an HTTP status. Every request passes the `Host` / `Origin` check
([LCTYSP-001](LCTYSP-001_architecture.md)).

## Conversations

| Method | Path | Content |
|---|---|---|
| GET | `/api/conversations` | List, newest first: `[{id, title, created_at, updated_at, messages, forked_from, tags, message_ids}]`. `message_ids` are the ids of the rounds the conversation owns (its non-inherited user messages), used to map semantic search hits to conversations. |
| POST | `/api/conversations` | Create. Body `{meta, lines}`: `meta` (with `forked_from` for a fork) and initial lines (for example lines copied from the fork source). 409 if the id exists. Returns 201. |
| GET | `/api/conversations/:id` | The conversation as JSON: `{meta, title, tags, messages}` (presentation HTML is not included). Used outside the conversation page, for example when forking. |
| POST | `/api/conversations/:id/lines` | Append lines (a JSON array). `type` may be `message`, `title` or `tags`. A `title` line rewrites line 2 instead of being appended. Assistant messages may carry `content_html`. |
| POST | `/api/conversations/:id/pop` | Body `{"from": n}`: delete the messages from index `n`. **409 if `n` is before the last user message** ([LCTYSP-004](LCTYSP-004_editing.md)). |
| DELETE | `/api/conversations/:id` | Delete the conversation (and its index entries). |

- Lines are validated before anything is written ([LCTYSP-003](LCTYSP-003_conversation-file.md)): message ids must be
  UUIDv7, tag lists must be unique valid tag names, `content_html` must be a string, and characters XML cannot represent
  are rejected outside text strings. A rejected request writes nothing.
- Every write updates the search index for that conversation ([LCTYSP-007](LCTYSP-007_search.md)).

## Settings

| Method | Path | Content |
|---|---|---|
| GET | `/api/settings` | Settings built from `.env` (endpoint, API key, model names, …). Read only ([LCTYSP-010](LCTYSP-010_data-and-settings.md)). |

## Search

| Method | Path | Content |
|---|---|---|
| POST | `/api/search` | Keyword search. Body `{q, tags?, limit?}` (`limit` 1–200, default 50). Returns `{results: [{id, conv_id, snippet}]}` in rank order. `tags` limits results to conversations that have all of them. |
| POST | `/api/snippets` | Snippets of rounds. Body `{ids, q}` (up to 200 ids). Returns `{id: {conv_id, snippet}}`. Used for rounds found only by semantic search. |

## Vectors

| Method | Path | Content |
|---|---|---|
| GET | `/api/vectors/pending?model=&limit=` | Rounds waiting for embeddings: `[{id, rev, parts: [text, …]}]`, newest first, `limit` 1–16 (default 16). |
| PUT | `/api/vectors?model=&magic=lctyvLE0&size=3072&entry_count=&rev=<id>:<rev>,…` | Register vectors. Body: a registration vector binary (`application/octet-stream`, 768 dims). The vectors of each id in the body are replaced. Returns `{accepted, stale: [ids]}`. Up to 16 ids per request. |
| GET | `/api/vectors?model=` | The distribution vector binary (256 dims, merged). Carries an `ETag`; 304 when unchanged. |

- `model` may contain only `[A-Za-z0-9._-]` (it becomes part of file names).
- Details of the format and the checks are in [LCTYSP-008](LCTYSP-008_vector-binary.md).

## Tags and memory

| Method | Path | Content |
|---|---|---|
| GET | `/api/tags` | All tag definitions with their memory: `{tags: [{name, prompt, memory: [{id, text, at, source?}]}]}`, in definition order. |
| PUT | `/api/tags` | Replace all tag definitions (the tag editor). Handles renames; memory follows its tag. |
| POST | `/api/tags/:name/memory` | Add a memory item. Body `{text, source}`. Ruby assigns `id` and `at`. Returns 201 with the item. |
| PATCH | `/api/tags/:name/memory/:id` | Edit the text of a memory item. Body `{text}`. |
| DELETE | `/api/tags/:name/memory/:id` | Delete a memory item. |

See [LCTYSP-009](LCTYSP-009_tags-and-memory.md) for the meaning of tags and memory.

## Limits

- Request bodies are limited to 64 MiB (413 otherwise).
- The rev list of `PUT /api/vectors` is in the URL, and WEBrick accepts request lines of up to 2,083 bytes, which is why
  one PUT carries at most 16 ids.
