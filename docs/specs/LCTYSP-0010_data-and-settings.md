<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0010: Data directory and settings

- Status: Accepted
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md), [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md), [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)
- Implementation: `lib/config.rb` (`PORT`, `LCTY_HOST`, `LCTY_DATA_DIR`), `lib/v1/servlet.rb` (`/v1/defaults.json`), `public/js/common.js`, `public/js/ui/settings-dialog.js`, `public/js/api/meta-db.js`, `public/lcty_c.worker.js`

## Summary

All data lives in the data directory, `~/Library/Application Support/tokyo.kaito.lcty-rb/Data/` by default on macOS
(`$XDG_DATA_HOME/tokyo.kaito.lcty-rb/Data/` elsewhere; `LCTY_DATA_DIR`, below); the specs write it as `data/`. Files whose names start with `_` are derived and can be deleted at any
time; everything else is the source of truth. Settings are not data: the server has only `PORT`, `LCTY_HOST` and `LCTY_DATA_DIR`, and
every other setting is kept by the browser.

## Data directory

**Rule: files (and directories) in `data/` whose names start with `_` are derived data.** They are rebuilt from the
source of truth at startup or by the browser. Everything else is source-of-truth data.

- **The format does not decide it.** SQLite is not automatically derived, nor JSON automatically the source; SQLite is a
  stable format and may hold source-of-truth data ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). The file name alone
  tells.
- **Uses:**
  - Backups only need files that do not start with `_` (for example `rsync -a --exclude='_*' data/ backup/`).
  - When the index misbehaves or its format changes, delete the `_` files and restart.

| File                                           | Kind                                                                                                                   | Rebuilt by                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `c/*.html`                                     | Source (conversations; same layout as the URL `/c/<id>.html`)                                                          | —                                                                                             |
| `c/lcty.v1.js`, `c/lcty.v1.css`                | Source (what reading a conversation offline needs: published at startup, rewritten only when changed; LCTYSP-0005)     | —                                                                                             |
| `tags.sqlite`                                  | Source (the tags of conversations changed after creation; tag definitions and memory are `t/`, below)                  | —                                                                                             |
| `_index.sqlite` (+ `-wal`, `-shm`)             | Derived (rounds and FTS)                                                                                               | Rebuilt from the conversation files at startup ([LCTYSP-0007](LCTYSP-0007_search.md))         |
| `_vectors.<model>.sqlite` (+ `-wal`, `-shm`)   | Derived (vector DB)                                                                                                    | Re-embedded by the browser while a page is open ([LCTYSP-0008](LCTYSP-0008_vector-binary.md)) |
| `_vectors.eg2_264.dat`, `_vectors.eg2_264.idx` | Derived (distribution files of the default embedding model: the rows and their ids, served as `/v1/vectors.eg2_264.*`) | Rebuilt from the vector DB on the next request                                                |

### Revision: tag files (implemented, except the IndexedDB split)

With tag definitions and memory moved to one HTML file per tag
([LCTYSP-0009, revision draft](LCTYSP-0009_tags-and-memory.md#revision-draft-one-html-file-per-tag)), the data
directory changes as follows. The rule on `_` is unchanged.

| File                                      | Kind                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t/NNNNN-<file-name part>.html`           | Source (one file per tag: display name, operation policies, prompt and memory; rewritten whole, via a temporary file whose name starts with `.` and a rename)          |
| `lcty.v1.*`, `c/lcty.v1.*`, `t/lcty.v1.*` | Source (a copy of the assets in every directory that holds HTML, so each file loads them by name alone; published at startup, rewritten only when changed)             |
| `t.lock`                                  | Holds no data: the file `flock` is taken on (shared for get-all, exclusive for replace-all and add-memory). Created when missing; backups may leave it out             |
| `tags.sqlite`                             | Source, but only `conversation_tags` (the tags of conversations changed after creation). The `tags` and `memory` tables are dropped by a migration, without conversion |

In the browser, IndexedDB is split by resource: `lcty_c` (store `c_meta`, owned by `lcty_c.worker.js`, below) and
`lcty_t` (stores `t_full` and `t_set`, owned by `lcty_t.worker.js`), a full copy of the tags, one row per tag
file, with the set's `ETag`
([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#in-the-browser-t_full-like-c_meta)). The database before the split,
`lcty`, is deleted by `lcty_c.worker.js` after a sync, not converted.

- SQLite files use WAL mode. To back up `tags.sqlite`, copy `tags.sqlite-wal` with it or run `PRAGMA wal_checkpoint`
  first.

### In the browser

- **IndexedDB `lcty_c`** (derived; it can be dropped at any time; version 1):
  - store `c_meta` (key `id`): a copy of `GET /v1/meta-all.json`, the meta of every conversation read from its head lines
    ([LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0006](LCTYSP-0006_http-api.md)). It holds `setup_tags` (the
    tags at creation), `updated_at_hint`, `tags_hint` and `messages_hint` (the current tags and the number of
    messages, from the search index); the last three are only hints. It is the only store: an upgrade drops every
    other store.
- **Every operation on it is one worker:** `lcty_c.worker.js` (a classic worker script with no imports, served at
  `/lcty_c.worker.js`; not a `/c/` file, since a conversation file opened on its own does not need it,
  [LCTYSP-0005](LCTYSP-0005_page-and-elements.md)), the same pattern as `lcty_t.worker.js`
  ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). Started by `new Worker(url)` for one operation, it is posted one
  message `{id, op, endpoint}` and posts one back, `{id, result}` or `{id, errorType, ...}` (the RPC of the workers,
  [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)); then the page terminates it. It is the only code that opens the
  database, so the schema is defined there alone ([LCTYSP-1001](LCTYSP-1001_lcty-c.feature)).
  - `sync_meta` fetches `GET /v1/meta-all.json`, clears and fills `c_meta` in one transaction (so a conversation deleted
    on the server disappears from it too), deletes the old database `lcty`, and answers no result. When a step fails
    the copy is left as it was; when it cannot open the database (a newer version left by other code, a broken
    database), the sync fails with that error.
  - `get` answers `{items, stale}`: the copy newest first by `updated_at_hint`, then by id, or no items and `stale`
    true when there is no copy yet. It opens the database without a version and never creates it (an upgrade that
    would create it is aborted).
- **When a sync runs:** every page runs one at once whenever it is shown (`forceSyncMetaDb()`, called by
  `js/ui/sidebar.js` when the page loads and on `pageshow` from the back/forward cache, together with the tags'
  `sync_full`, [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). Loading the list and sending a change of conversations
  to the server (creating, appending lines, popping, deleting: `js/api/storage.js`) also request one, run when the
  browser is idle (`requestIdleCallback`, at most 10 s
  later; 1 s later where it is missing); requests made before it starts share it. In a tab at most one worker runs: a
  sync requested while one runs is run once after it, so an older response never overwrites a newer one in this tab
  and a change made meanwhile is still fetched. Tabs do not coordinate: the transaction that commits last wins.
  Changes not made through this browser (a file edited by hand, another browser) are seen at the next sync.
- **The refresh button** (`lcty-sidebar__refresh`, next to the settings button) removes the snapshot and syncs at once,
  not when idle. The list is shown again through `onMetaDbChange`; a failure is shown as a toast.
- **Readers:** `lcty.v1.js` (`<lcty-sidebar>`, when it is in the document) reads the snapshot below, or `c_meta` when
  there is none (through the worker's `get`, found at `../lcty_c.worker.js` from the page, which is one directory
  below the root), to fill the sidebar before any module has loaded. Once the module has loaded, the sidebar's list and
  its `tag:` filters come from `c_meta`, read by `readMetaDb()` (`js/api/meta-db.js`, the worker's `get`), which tells
  whether there is a copy yet (`stale` until the first sync has finished), read again whenever a sync has stored a new
  list (`onMetaDbChange`: in this tab when its sync finishes, in other tabs through the snapshot's `storage` event)
  ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). Every connection is closed when its operation ends, so an
  upgrade is not blocked.
- **`localStorage` key `lcty.meta.v1`**: a snapshot for the first view only: the newest 20 conversations by
  `updated_at_hint`, with only what the sidebar shows before a module has loaded (`[{id, title, updated_at_hint,
tags_hint, messages_hint}]`). Unlike
  IndexedDB, it can be read synchronously: the sidebar is filled from it before the first paint. Derived from the database:
  `js/api/meta-db.js` writes it on the main thread (workers have no `localStorage`) after each sync; when it does not
  fit, it is removed and the sidebar reads the database instead. A snapshot that is not a list is ignored, and the
  sidebar skips entries of it that have no `id`, reading `c_meta` instead when none is left.
- **One order everywhere:** lists of conversations are newest first by `updated_at_hint`, then by id (which starts with
  the creation time), on the server (`meta-all.json`, `/v1/conversations`), in `readMetaDb()`, in the snapshot and in
  the sidebar. With the date alone, conversations with the same `updated_at_hint` came out in a different order from the
  snapshot and from the database, and swapped places when the module redrew the list.
- `localStorage` key `lcty.settings.v1`: the changed settings (below).

## Settings

**Rule: the server has only three settings, all environment variables read at startup. Everything else is a browser
setting.** The server never talks to the LLM ([LCTYSP-0001](LCTYSP-0001_architecture.md)), so the endpoint, key and model
names only matter to the browser.

| Environment variable | Default                                                                                                               | Meaning                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `PORT`               | `45280`                                                                                                               | lcty.rb listen port    |
| `LCTY_HOST`          | `127.0.0.1`                                                                                                           | lcty.rb listen address |
| `LCTY_DATA_DIR`      | macOS: `~/Library/Application Support/tokyo.kaito.lcty-rb/Data`; elsewhere: `$XDG_DATA_HOME/tokyo.kaito.lcty-rb/Data` | Data directory         |

- **The data directory is outside the repository** by default, in the per-user application data folder (named by the
  reverse-DNS id `tokyo.kaito.lcty-rb`), so a checkout can be moved, cleaned or replaced without touching the data. It
  is created at startup if missing. A relative `LCTY_DATA_DIR` is resolved against the repository root.
  - **macOS:** `~/Library/Application Support`. Windows uses the same path for now.
  - **Elsewhere (Linux etc.):** `$XDG_DATA_HOME`, or `~/.local/share` when it is unset or not an absolute path, as the
    XDG Base Directory spec says. The data directory holds the conversations and the tags (the user's data), not
    settings, so it belongs in the data home, not `$XDG_CONFIG_HOME`.

- **Defaults:** `GET /v1/defaults.json` returns the defaults of the browser settings. It is generated by chatty.rb (the API
  key depends on the machine).
- **Changes are stored in the browser** (`localStorage`, key `lcty.settings.v1`) by the settings dialog (the sidebar's ⚙︎ button, on every page). Only the values
  that differ from the defaults are stored, so a changed default still applies to every setting left untouched. "Reset"
  removes the stored values. A stored value whose type differs from the default's is ignored.
- `localStorage` is per origin: `http://127.0.0.1:45280` and `http://localhost:45280` keep separate settings.
- Changes apply from the next page load. The connection test uses the values in the form, saved or not.

| Browser setting   | Default                 | Meaning                                              |
| ----------------- | ----------------------- | ---------------------------------------------------- |
| `base_url`        | `http://127.0.0.1:9931` | llama-server (router mode) endpoint                  |
| `api_key`         | `<hostname>-<user>`     | API key (empty sends none)                           |
| `model`           | `gemma-4-26b-a4b-it`    | Chat model name (a section of the router INI)        |
| `embedding_model` | `embeddinggemma-2`      | Embedding model name. Empty disables semantic search |

- **The API key is not a secret.** llama-server listens on 127.0.0.1 only. The key guards against connecting to the
  wrong server by accident: `llm-backend/run-llama-cpp.sh` uses the same `<hostname>-<user>` by default, so a mismatch
  shows up as 401.

- The embedding dimension is fixed by the vector format (768 registered, 256 distributed) and is not a setting
  ([LCTYSP-0008](LCTYSP-0008_vector-binary.md)).
- A default system prompt for new conversations is not a setting; tag drafts take that role
  ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)).

## Open questions

- Whether to warm the cache when an older conversation is opened (for example by sending a request with no output as
  soon as it opens; whether llama-server accepts that is unverified).
- Whether a Chat Completions adapter is worth adding (not needed so far).
