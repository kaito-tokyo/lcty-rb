<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-010: Data directory and settings

- Status: Accepted
- Related: [LCTYSP-001](LCTYSP-001_architecture.md), [LCTYSP-003](LCTYSP-003_conversation-file.md), [LCTYSP-007](LCTYSP-007_search.md), [LCTYSP-008](LCTYSP-008_vector-binary.md), [LCTYSP-009](LCTYSP-009_tags-and-memory.md)
- Implementation: `lib/config.rb` (`PORT`, `LCTY_HOST`, `LCTY_DATA_DIR`), `lib/v1/servlet.rb` (`/v1/defaults.json`), `public/js/common.js`, `public/js/ui/settings-dialog.js`, `public/js/api/meta-db.js`, `public/js/sync_meta.worker.js`

## Summary

All data lives in the data directory, `~/Library/Application Support/tokyo.kaito.lcty-rb/Data/` by default on macOS
(`$XDG_DATA_HOME/tokyo.kaito.lcty-rb/Data/` elsewhere; `LCTY_DATA_DIR`, below); the specs write it as `data/`. Files whose names start with `_` are derived and can be deleted at any
time; everything else is the source of truth. Settings are not data: the server has only `PORT`, `LCTY_HOST` and `LCTY_DATA_DIR`, and
every other setting is kept by the browser.

## Data directory

**Rule: files (and directories) in `data/` whose names start with `_` are derived data.** They are rebuilt from the
source of truth at startup or by the browser. Everything else is source-of-truth data.

- **The format does not decide it.** SQLite is not automatically derived, nor JSON automatically the source; SQLite is a
  stable format and may hold source-of-truth data ([LCTYSP-009](LCTYSP-009_tags-and-memory.md)). The file name alone
  tells.
- **Uses:**
  - Backups only need files that do not start with `_` (for example `rsync -a --exclude='_*' data/ backup/`).
  - When the index misbehaves or its format changes, delete the `_` files and restart.

| File                                           | Kind                                                                                                                   | Rebuilt by                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `c/*.html`                                     | Source (conversations; same layout as the URL `/c/<id>.html`)                                                          | —                                                                                           |
| `c/lcty.v1.js`, `c/lcty.v1.css`                | Source (what reading a conversation offline needs: published at startup, rewritten only when changed; LCTYSP-005)      | —                                                                                           |
| `tags.sqlite`                                  | Source (tag definitions, memory and the tags of conversations changed after creation)                                  | —                                                                                           |
| `_index.sqlite` (+ `-wal`, `-shm`)             | Derived (rounds and FTS)                                                                                               | Rebuilt from the conversation files at startup ([LCTYSP-007](LCTYSP-007_search.md))         |
| `_vectors.<model>.sqlite` (+ `-wal`, `-shm`)   | Derived (vector DB)                                                                                                    | Re-embedded by the browser while a page is open ([LCTYSP-008](LCTYSP-008_vector-binary.md)) |
| `_vectors.eg2_264.dat`, `_vectors.eg2_264.idx` | Derived (distribution files of the default embedding model: the rows and their ids, served as `/v1/vectors.eg2_264.*`) | Rebuilt from the vector DB on the next request                                              |

- SQLite files use WAL mode. To back up `tags.sqlite`, copy `tags.sqlite-wal` with it or run `PRAGMA wal_checkpoint`
  first.

### In the browser

- **IndexedDB `lcty`** (derived; it can be dropped at any time):
  - store `c_meta` (key `id`): a copy of `GET /v1/meta-all.json`, the meta of every conversation read from its head lines
    ([LCTYSP-003](LCTYSP-003_conversation-file.md), [LCTYSP-006](LCTYSP-006_http-api.md)). It holds `setup_tags` (the
    tags at creation), `updated_at_hint`, `tags_hint` and `messages_hint` (the current tags and the number of
    messages, from the search index); the last three are only hints. It is the only store: upgrading from an older
    version (the stores `meta` and `sync` of the retired `meta_db.worker.js`) drops every other store.
- **A sync is one worker:** `js/sync_meta.worker.js` (a classic worker with no imports, served at
  `/js/sync_meta.worker.js`; not a `/c/` file, since a conversation file opened on its own does not need it,
  [LCTYSP-005](LCTYSP-005_page-and-elements.md)). Started by `new Worker`, it fetches `GET /v1/meta-all.json`, clears and
  fills `c_meta` in one transaction (so a conversation deleted on the server disappears from it too), and posts
  `undefined`, or an `Error` when any step failed (the copy is then left as it was). Then `js/api/meta-db.js` terminates
  it. It is the only code that opens the database with a version, so the schema is defined there alone; a database it
  cannot open (a newer version left by other code, a broken database) is deleted and created again.
- **When a sync runs:** opening a page and sending a change of conversations to the server (creating, appending lines,
  popping, deleting: `js/api/storage.js`) request one, run when the browser is idle (`requestIdleCallback`, at most 10 s
  later; 1 s later where it is missing); requests made before it starts share it. In a tab at most one worker runs: a
  sync requested while one runs is run once after it, so an older response never overwrites a newer one in this tab
  and a change made meanwhile is still fetched. Tabs do not coordinate: the transaction that commits last wins.
  Changes not made through this browser (a file edited by hand, another browser) are seen at the next sync.
- **The refresh button** (`lcty-sidebar__refresh`, next to the settings button) removes the snapshot and syncs at once,
  not when idle. The list is shown again through `onMetaDbChange`; a failure is shown as a toast.
- **Readers:** `lcty.v1.js` (`<lcty-sidebar>`, when it is in the document) reads the snapshot below, or `c_meta` when
  there is none, to fill the sidebar before any module has loaded. Once the module has loaded, the sidebar's list and
  its `tag:` filters come from `c_meta`, read on the main thread by `readMetaDb()` (`js/api/meta-db.js`), which tells
  whether there is a copy yet (`stale` until the first sync has finished), read again whenever a sync has stored a new
  list (`onMetaDbChange`: in this tab when its sync finishes, in other tabs through the snapshot's `storage` event)
  ([LCTYSP-005](LCTYSP-005_page-and-elements.md)). Readers open the database without a version, never create it (an
  upgrade that would create it is aborted) and close each connection as soon as they have read, so the worker's
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
setting.** The server never talks to the LLM ([LCTYSP-001](LCTYSP-001_architecture.md)), so the endpoint, key and model
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
  ([LCTYSP-008](LCTYSP-008_vector-binary.md)).
- A default system prompt for new conversations is not a setting; tag drafts take that role
  ([LCTYSP-009](LCTYSP-009_tags-and-memory.md)).

## Open questions

- Whether to warm the cache when an older conversation is opened (for example by sending a request with no output as
  soon as it opens; whether llama-server accepts that is unverified).
- Whether a Chat Completions adapter is worth adding (not needed so far).
