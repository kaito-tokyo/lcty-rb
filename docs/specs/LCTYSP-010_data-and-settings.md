<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-010: Data directory and settings

- Status: Accepted
- Related: [LCTYSP-001](LCTYSP-001_architecture.md), [LCTYSP-003](LCTYSP-003_conversation-file.md), [LCTYSP-007](LCTYSP-007_search.md), [LCTYSP-008](LCTYSP-008_vector-binary.md), [LCTYSP-009](LCTYSP-009_tags-and-memory.md)
- Implementation: `chatty.rb`, `lib/env.rb`

## Summary

All data lives under `data/` (configurable). Files whose names start with `_` are derived and can be deleted at any
time; everything else is the source of truth. Settings are environment, not data: they live in `.env` at the repository
root.

## Data directory

**Rule: files (and directories) in `data/` whose names start with `_` are derived data.** They are rebuilt from the
source of truth at startup or by the browser. Everything else is source-of-truth data.

- **The format does not decide it.** SQLite is not automatically derived, nor JSON automatically the source; SQLite is a
  stable format and may hold source-of-truth data ([LCTYSP-009](LCTYSP-009_tags-and-memory.md)). The file name alone
  tells.
- **Uses:**
  - Backups only need files that do not start with `_` (for example `rsync -a --exclude='_*' data/ backup/`).
  - When the index misbehaves or its format changes, delete the `_` files and restart.

| File | Kind | Rebuilt by |
|---|---|---|
| `c/*.html` | Source (conversations; same layout as the URL `/c/<id>.html`) | — |
| `tags.sqlite` | Source (tag definitions and memory) | — |
| `_index.sqlite` (+ `-wal`, `-shm`) | Derived (rounds and FTS) | Rebuilt from the conversation files at startup ([LCTYSP-007](LCTYSP-007_search.md)) |
| `_vectors.<model>.sqlite` (+ `-wal`, `-shm`) | Derived (vector DB) | Re-embedded by the browser while a page is open ([LCTYSP-008](LCTYSP-008_vector-binary.md)) |
| `_vectors.<model>.256.bin` | Derived (distribution vector binary) | Rebuilt from the vector DB on the next request |

- SQLite files use WAL mode. To back up `tags.sqlite`, copy `tags.sqlite-wal` with it or run `PRAGMA wal_checkpoint`
  first.

## Settings

- **Why `.env`:** endpoints and API keys are environment, not data. Keeping them in `data/` would mix secrets into
  backups.
- **Precedence:** real environment variables → `.env` → defaults. `.env` is not committed; the template `.env.example`
  is.
- **Parser:** a minimal implementation without gems (`lib/env.rb`): `KEY=VALUE`, `#` comments (whole lines and a trailing
  ` # …` after an unquoted value), `'…'` / `"…"` quotes, an optional `export` prefix and `~` expansion.
- **Reloading:** `.env` is reread on every `GET /api/settings`, so reloading the page applies changes. `CHATTY_PORT` and
  `CHATTY_DATA` are fixed at startup.
- **API key:** set `LLAMA_API_KEY` directly or point `LLAMA_API_KEY_FILE` to a file (the first non-empty line is used).
  Pointing it to the same file as llama-server's `--api-key-file` avoids keeping the key twice. The browser connects to
  llama-server directly ([LCTYSP-001](LCTYSP-001_architecture.md)), so the key is handed to it by `GET /api/settings`,
  which answers only same-origin requests that pass the `Host` / `Origin` check.
- **The settings page** only shows the current values and tests the connection; it does not edit anything.

| Variable | Default | Meaning |
|---|---|---|
| `LLAMA_BASE_URL` | `http://localhost:12345` | llama-server (router mode) endpoint |
| `LLAMA_API_KEY` / `LLAMA_API_KEY_FILE` | (none) | API key, or a file containing it |
| `CHAT_MODEL` | `gemma-4-26b` | Chat model name (a section of the router INI) |
| `EMBEDDING_MODEL` | `embeddinggemma-2` | Embedding model name. Empty disables semantic search |
| `THINKING_KWARG` | `true` | Whether to send thinking on/off as `chat_template_kwargs.enable_thinking` |
| `DEFAULT_THINKING` | `false` | Whether new conversations start with thinking enabled |
| `CHATTY_PORT` | `8765` | chatty.rb listen port (fixed at startup) |
| `CHATTY_DATA` | `./data` | Data directory (fixed at startup) |

- The embedding dimension is fixed by the vector format (768 registered, 256 distributed) and is not a setting
  ([LCTYSP-008](LCTYSP-008_vector-binary.md)).
- A default system prompt for new conversations is not a setting; tag drafts take that role
  ([LCTYSP-009](LCTYSP-009_tags-and-memory.md)).

## Open questions

- Where data should live by default: `data/` in the repository, or `~/Library/Application Support/lcty-rb/`.
- Whether to warm the cache when an older conversation is opened (for example by sending a request with no output as
  soon as it opens; whether llama-server accepts that is unverified).
- Whether a Chat Completions adapter is worth adding (not needed so far).
