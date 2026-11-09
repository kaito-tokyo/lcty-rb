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

| Method | Path                          | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/meta-all.json`           | The meta of every conversation, newest first: `[{id, title, created_at, updated_at_hint, setup_tags, tags_hint, messages_hint}]`. Read from the head lines only (lines 1 to 4, [LCTYSP-0003](LCTYSP-0003_conversation-file.md)), so the rest of each file is not read: `setup_tags` are the tags at creation. `tags_hint` are the current tags as the search index recorded them (`conv_tags`, [LCTYSP-0007](LCTYSP-0007_search.md)): a hint, since the index is derived and follows a file edited by hand only at the next start. `messages_hint` is the number of messages, from the index likewise (`conv_stats`). A file without valid meta lines is skipped with a warning. The browser keeps a copy in IndexedDB ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)). |
| GET    | `/v1/conversations`           | List, newest first: `[{id, title, created_at, updated_at_hint, messages, tags, message_ids}]`. `message_ids` are the ids of the rounds the conversation owns (its non-inherited user messages), used to map semantic search hits to conversations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/v1/conversations`           | Create. Body `{meta, lines}`: `meta` (`{id, created_at, tags, instructions}`; other keys are ignored) and initial lines (for example lines copied from the fork source). 409 if the id exists. Returns 201.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/v1/conversations/:id`       | The conversation as JSON: `{meta, title, tags, messages}` (presentation HTML is not included). Used outside the conversation page, for example when forking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/v1/conversations/:id/lines` | Append lines (a JSON array). `type` may be `message`, `title` or `tags`. A `title` line overwrites the title slot on line 2 instead of being appended; a `tags` line sets the conversation's current tags in `tags.sqlite` and is not written to the file ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). Assistant messages may carry `content_html`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/v1/conversations/:id/pop`   | Body `{"from": n}`: delete the messages from index `n`. **409 if `n` is before the last user message** ([LCTYSP-0004](LCTYSP-0004_editing.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DELETE | `/v1/conversations/:id`       | Delete the conversation (and its index entries).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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

| Method | Path                                                                        | Content                                                                                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/vectors/pending?model=&limit=`                                         | Rounds waiting for embeddings: `[{id, rev, parts: [text, …]}]`, newest first, `limit` 1–16 (default 16).                                                                                                                                                                            |
| PUT    | `/v1/vectors?model=&magic=lctyvLE0&size=3072&entry_count=&rev=<id>:<rev>,…` | Register vectors. Body: a registration vector binary (`application/octet-stream`, 768 dims). The vectors of each id in the body are replaced. Returns `{accepted, stale: [ids]}`. Up to 16 ids per request.                                                                         |
| GET    | `/v1/vectors.eg2_264.dat`, `/v1/vectors.eg2_264.idx`                        | The distribution files of the default embedding model (256 dims, merged): `vectors.eg2_264.dat`, the rows in the kernel's memory layout, and `vectors.eg2_264.idx`, 16 bytes per row ([LCTYSP-0008](LCTYSP-0008_vector-binary.md)). Both carry the same `ETag`; 304 when unchanged. |

- `model` may contain only `[A-Za-z0-9._-]` (it becomes part of file names).
- Details of the format and the checks are in [LCTYSP-0008](LCTYSP-0008_vector-binary.md).

## Tags and memory

| Method | Path                    | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/tags`              | Get all: `{tags: [{file, name, ops: [{type, content}], prompt, memory: [{id, text, at, source?}]}]}` (the markup of LCTYSP-0009), one entry per tag file in `t/` in file-name order; `file` is the file name as listed by the file system (`NNNNN-<file-name part>.html`). The server parses the HTML. A tag file without `<lcty-t>` is listed with a warning as `{file, name, ops: [], prompt: "", memory: [], invalid: true}`, its `name` taken from the file name ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#tag-files-without-lcty-t)). Under the shared lock on `t.lock`. Returns an `ETag` for the whole set.            |
| PUT    | `/v1/tags`              | Replace all: the complete set in the same JSON form. Requires `If-Match` (428 without it, 412 when the set changed). Under the exclusive lock on `t.lock`, the file names are checked (mechanically only) and the whole request is rejected with 400, writing nothing, if one fails; then the server writes each file's HTML via a temporary file and a rename, and deletes tag files not in the set. A tag sent with `invalid: true` is kept as it is, neither written nor deleted; only a listed file without `<lcty-t>` can be sent so (400 otherwise), and no other tag may be written over it (400). Returns the new `ETag`. |
| POST   | `/v1/tags/:file/memory` | Add a memory item to the tag in file `:file` (`00010-ruby.html`). Body `{text, source}`. Under the exclusive lock, the server rewrites that one file; Ruby assigns `id` and `at`. Returns 201 with the item. 404 when the file does not exist, 409 when it has no `<lcty-t>` (the file is not changed). Changes the set's `ETag`.                                                                                                                                                                                                                                                                                                 |

- Tag definitions and memory are one HTML file per tag in `t/`
  ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#storage-one-html-file-per-tag)).
- Names are passed through untouched; the browser normalizes and validates them, and NFC-normalizes the names it
  receives before comparing them. The server writes and parses the HTML; the browser never sees it through this API.
- There are no `PATCH` or `DELETE` on memory items (404): the tag editor edits memory through replace-all.
- There is no reorder or rename endpoint; the reorder page and the tag editor send replace-all.
- The `tags` line of `POST /v1/conversations/:id/lines` sets `conversation_tags` in `tags.sqlite`. Its tags, like
  `data-setup-tags` of a new conversation and `tag:` in `POST /v1/search`, are references (file-name parts, `c~23`),
  checked mechanically only: valid UTF-8, no whitespace or control characters, no `/`, `\` or `:`, at most 244 bytes.

See [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) for the meaning of tags and memory.

## Limits

- Request bodies are limited to 64 MiB (413 otherwise).
- The rev list of `PUT /v1/vectors` is in the URL, and WEBrick accepts request lines of up to 2,083 bytes, which is why
  one PUT carries at most 16 ids.
