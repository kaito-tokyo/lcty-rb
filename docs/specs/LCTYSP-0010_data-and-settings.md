<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0010: Data directory and settings

- Status: Accepted. Keeping the browser's copies up to date is to be superseded by
  [LCTYSP-0014](LCTYSP-0014_browser-sync.md) once the pages use `/v1/rpc`.
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md), [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md), [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)
- Implementation: `lib/config.rb` (`LCTY_DATA_DIR`, the port, and the options of `server_settings.txt`, the
  environment and the command line), `lcty.rb` (the base URL, the command line and choosing the port),
  `lib/rpc/servlet.rb` (the allowed origins), `lib/v1/servlet.rb` (`/v1/defaults.json`), `public/js/common.js`, `public/js/ui/settings-dialog.js`, `public/js/api/meta-db.js`, `public/lcty.v1/lcty.v1.c.worker.cjs`

## Summary

All data lives in the data directory, `~/Library/Application Support/tokyo.kaito.lcty-rb/Data/` by default on macOS
(`$XDG_DATA_HOME/tokyo.kaito.lcty-rb/Data/` elsewhere; `LCTY_DATA_DIR`, below); the specs write it as `data/`. Files whose names start with `_` are derived and can be deleted at any
time; everything else is the source of truth. The server has only a few settings: `LCTY_DATA_DIR` and the port,
environment variables, and the options of lcty.rb, kept in `server_settings.txt` of the data directory and overridden
by environment variables and the command line; every other setting is kept by the browser.

## Data directory

**Rule: files (and directories) in `data/` whose names start with `_` are derived data.** They are rebuilt from the
source of truth at startup or by the browser. Everything else is source-of-truth data.

- **The format does not decide it.** SQLite is not automatically derived, nor JSON automatically the source; SQLite is a
  stable format and may hold source-of-truth data ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). The file name alone
  tells.
- **Uses:**
  - Backups only need files that do not start with `_` (for example `rsync -a --exclude='_*' data/ backup/`).
  - When the index misbehaves or its format changes, delete the `_` files and restart.

**Rule: what the server can make again from the files alone is one file, `_index.sqlite`, discarded and made anew at
every start.** No other such cache file is added: a new one is a table there, and what the server sends that is built
from it is built in memory on request and never written to disk. It has no schema version and is never migrated.

**Rule: the SQLite files are cut as the browser's IndexedDB databases are,** one per resource, each with one integer
version, `PRAGMA user_version`, brought up by code at startup; a newer one is refused
([LCTYSP-0015](LCTYSP-0015_schema-versions.md)). At startup the server also renames `tags.sqlite` to `lcty_t.sqlite`,
carries the vectors of the old `_index.sqlite` over to `lcty_fuzzy_search.sqlite` once, and deletes the cache files of
the layout before that (`_vectors.*`).

| File                                          | Kind                                                                                                                             | Rebuilt by                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `c/*.html`                                    | Source (conversations; same layout as the URL `/c/<id>.html`)                                                                    | —                                                                                                                                                      |
| `c/lcty.v1.js`, `c/lcty.v1.css`               | Copies (what reading a conversation offline needs, from `public/lcty.v1/`: at startup, rewritten only when changed; LCTYSP-0005) | —                                                                                                                                                      |
| `lcty_t.sqlite`                               | Source (the current tags of conversations, `t_has_many_c`; tag definitions and memory are `t/`, below)                           | —                                                                                                                                                      |
| `lcty_c.sqlite`                               | Source (what was measured of the replies of conversations of LCTYSP-0013; `c.stats.put` and `lcty.rb convert`)                   | —                                                                                                                                                      |
| `server_settings.txt`                         | Source (the options of lcty.rb, one per line; [below](#settings))                                                                | —                                                                                                                                                      |
| `c-former/*.html`                             | Source (every conversation file as it was before `lcty.rb convert` converted it; never deleted)                                  | —                                                                                                                                                      |
| `lcty_fuzzy_search.sqlite` (+ `-wal`, `-shm`) | The vectors of every embedding model: derived, but only the browser can make them again, so they are kept and backed up          | Re-embedded by the browser while a page is open, when lost ([LCTYSP-0008](LCTYSP-0008_vector-binary.md))                                               |
| `_index.sqlite` (+ `-wal`, `-shm`)            | Derived (rounds and FTS, the tags of conversations for filtering, the counts of messages and of elements)                        | Discarded and rebuilt from the conversation files at every start ([LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0015](LCTYSP-0015_schema-versions.md)) |

### Tag files

Tag definitions and memory are one HTML file per tag
([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#storage-one-html-file-per-tag)), so the data directory also holds
the following. The rule on `_` is unchanged.

| File                                      | Kind                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t/NNNNN-<file-name part>.html`           | Source (one file per tag: display name, operation policies, prompt and memory; rewritten whole, via a temporary file whose name starts with `.` and a rename) |
| `lcty.v1.*`, `c/lcty.v1.*`, `t/lcty.v1.*` | Source (a copy of the assets in every directory that holds HTML, so each file loads them by name alone; published at startup, rewritten only when changed)    |
| `t.lock`                                  | Holds no data: the file `flock` is taken on (shared for get-all, exclusive for replace-all and add-memory). Created when missing; backups may leave it out    |
| `lcty_t.sqlite`                           | Source, but only `t_has_many_c` (the current tags of conversations). The `tags` and `memory` tables are dropped by a migration, without conversion            |

In the browser, IndexedDB is split by resource: `lcty_c` (stores `c_meta`, `c_recordcount` and `sync`, owned by
`lcty.v1.c.worker.cjs`, below) and `lcty_t` (stores `t_full` and `t_set`, a full copy of the tags, one row per tag
file, with the set's `ETag`, and `t_has_many_c` and `sync`, the tags of conversations; owned by `lcty.v1.t.worker.cjs`)
([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#in-the-browser-t_full-like-c_meta)). The names are the resources',
cut at the same grain as the server's SQLite files ([LCTYSP-0015](LCTYSP-0015_schema-versions.md)); each database's
own version says what it stores.

- SQLite files use WAL mode. To back up `lcty_t.sqlite` or `lcty_fuzzy_search.sqlite`, copy its `-wal` with it or run
  `PRAGMA wal_checkpoint` first.

### In the browser

- **IndexedDB `lcty_c`** (derived; it can be dropped at any time; version 2). Its stores follow the server over
  `/v1/rpc` ([LCTYSP-0014](LCTYSP-0014_browser-sync.md)), and an upgrade drops every store and recreates them empty:
  - store `c_meta` (key `cid`): the meta of every conversation as `c.list` gives it, `{cid, lang, title, titleTypeId,
    updatedAt, createdAt}`.
  - store `c_recordcount` (key `cid`): `{cid, count}`, the number of elements of each conversation as
    `c.recordcount.list` gives it; a conversation without a row has an unknown count.
  - store `sync` (key `store`): `{store, boot, seq}`, the global version each of the two was last brought to.
- **Every operation on it is one worker:** `lcty.v1.c.worker.cjs` (a classic worker script with no imports, served at
  `/lcty.v1/lcty.v1.c.worker.cjs` with the frame that starts it; never copied into `data/c/`, since a conversation file
  opened on its own does not need it, [LCTYSP-0005](LCTYSP-0005_page-and-elements.md)), the same pattern as `lcty.v1.t.worker.cjs`
  ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). Started by `new Worker(url)` for the first operation and kept for
  the life of the page, it is posted one message `{id, op, endpoint, payload}` per operation and posts one back,
  `{id, result}` or `{id, errorType, ...}` (the RPC of the workers, [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)). A
  worker started for each operation was given up: the reads that follow `/v1/rpc` start late, and a worker that is still
  loading when the page is left fails to load, which WebKit reports as an error of the page. It is the only code that opens
  the database, so the schema is defined there alone ([LCTYSP-1001](LCTYSP-1001_lcty-c.feature)). It never talks to
  the server: the page posts what its connection received.
  - `replace` `{store, version, rows}` replaces `c_meta` or `c_recordcount` with a full read, unless the store holds a
    newer version of the same boot; `apply` `{version, records}` writes the `c_meta` and `c_recordcount` records of a
    `c.batch.updated` onto a store of the same boot holding an older version, and leaves the others. Each checks and
    writes in one transaction (the version rule of LCTYSP-0014).
  - `get` answers `{items, counts, stale}`: `c_meta` newest first by `updatedAt`, then by `cid`; the counts by `cid`;
    and `stale` true, with no items, when `c_meta` has never been filled. It opens the database without a version and
    never creates it (an upgrade that would create it is aborted).
- **When the copies change:** whenever the tab's connection to `/v1/rpc` opens, the first time and after every
  reconnection, the sidebar reads `c.list` and `c.recordcount.list` and replaces the copies (`readMetaDbFrom(rpc)`,
  `js/api/meta-db.js`, called by `js/ui/sidebar.js`), and every `c.batch.updated` is applied (`applyMetaBatch`). In a
  tab the operations run one at a time, in order, and the notifications that arrive while the lists are being read
  are applied after them. Tabs do not coordinate: the version rule keeps a copy from going back, whichever writes last.
- **The refresh button** (`lcty-sidebar__refresh`, next to the settings button) reads the lists again at once. The list
  is shown again through `onMetaDbChange`; a failure is shown as a toast.
- **Readers:** `lcty.v1.cjs` (`<lcty-sidebar>`, when it is in the document) reads the copies (through the worker's
  `get`, found at `../lcty.v1/lcty.v1.c.worker.cjs` from the page, which is one directory below the root) to fill the
  sidebar before any module has loaded, without tags. Once the module has loaded, the sidebar's list comes from
  `readMetaDb()` (`js/api/meta-db.js`, the worker's `get`) and the tags of the conversations from `t_has_many_c` of
  `lcty_t` ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)), read again whenever this tab has stored a change of either
  ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). Every connection is closed when its operation ends, so an upgrade
  is not blocked.
- **`GET /v1/meta-all.json` is gone.** It gave the rows of version 1 (`id`, `title`, `created_at`, `updated_at_hint`,
  `setup_tags`, `tags_hint`, `messages_hint`), built from the head lines of the files and the search index.
- **No `localStorage` copy.** A snapshot of the newest conversations in `localStorage` key `lcty.meta.v1`, read
  synchronously for the first paint, was removed to keep the meta's handling simple; a browser that still has the key
  ignores it.
- **One order everywhere:** lists of conversations are newest first by the file's modification time (`updatedAt`, or
  `updated_at_hint` in `/v1/conversations`), then by id (which starts with the creation time), on the server (`c.list`,
  `/v1/conversations`), in `readMetaDb()` and in the sidebar. With the date alone, conversations with the same time
  came out in a different order from different sources, and swapped places when the module redrew the list.
- `localStorage` key `lcty.settings.v1`: the changed settings (below).

## Settings

**Rule: the server has only a few settings, read at startup. Everything else is a browser setting.** The server never
talks to the LLM ([LCTYSP-0001](LCTYSP-0001_architecture.md)), so the endpoint, key and model names only matter to the
browser.

- **Two settings are environment variables only:**
  - `LCTY_DATA_DIR` says where the data directory is, so it cannot be kept in it. Default:
    `~/Library/Application Support/tokyo.kaito.lcty-rb/Data` on macOS, and `$XDG_DATA_HOME/tokyo.kaito.lcty-rb/Data`
    elsewhere (below).
  - The port is `LCTY_PORT`, else `PORT` (an integer from 1 to 65535). Each server of a machine needs a port of its
    own, so the port is not kept with the data. A port asked for that is taken stops the server (the pages, bookmarks
    and allowed origins name it). Without either, the server listens on the first free port from 45280 to 45379, and
    says which.
- **The others are the options of lcty.rb**, one OptionParser for the command line and the file:
  - `--bind-ip=ADDRESS`: an IP address to listen on (IPv4 or IPv6, not a host name), once per address. Default
    `127.0.0.1`. Every address is listened on at the same port; without a port asked for, the first one free on all of
    them is taken, and an address that is not one of this machine stops the server. An address given twice is
    listened on once.
  - `--base-url=PATH`: the path the site is served under ([LCTYSP-3019](LCTYSP-3019_entry-point.feature)). Default
    `/`.
  - `--allowed-origin=ORIGIN`: an origin whose pages may use `/v1/rpc` ([LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)),
    once per origin. Default: `http://<address>:<port>` of every address listened on, and `http://localhost:<port>`
    when one of them is `127.0.0.1`.
  - `--help` lists them; `--port` is refused with a pointer to `LCTY_PORT`.
  - Not `--host`: it named an address to listen on with a word that reads as a host to connect to, and took one
    address only. `--bind-ip` replaced it (and `LCTY_BIND_IP` replaced `LCTY_HOST`) without an alias.
- **`server_settings.txt` of the data directory** holds the options, one per line, as they would be written on the
  command line (`--bind-ip=0.0.0.0`, or the option and its value separated by spaces). Blank lines and lines starting
  with `#` are left out; any other line that does not start with `--` is an error.

  ```
  # lcty-rb
  --bind-ip=127.0.0.1
  --bind-ip=192.168.1.10
  --allowed-origin=http://127.0.0.1:45280
  --allowed-origin=http://192.168.1.10:45280
  --allowed-origin=http://umireon-macbook-pro-2021.local:45280
  ```

- **Why a file:** a server started by launchd (a LaunchAgent) gets its environment only from its plist, which is
  awkward to edit and to reload. The data directory is where the data already is, and the file is backed up with it.
  Its name has no leading `_`, so it is source-of-truth data. Lines of options, not JSON: the same parser and the
  same names as the command line, comments, and nothing to quote.
- **Order:** the default, then the file, then the environment variables that are set and not empty (`LCTY_BIND_IP`
  and `LCTY_ALLOWED_ORIGIN`, their values separated by commas or spaces, and `LCTY_BASE_URL`), then the command line,
  each replacing the ones before (the addresses or origins of one source replace those of another; within one they
  add up). The
  tests and the container of CI set environment variables, and nothing has to be written into a data directory for
  that.
- **The file is read once, when the server starts.** A changed file applies after a restart. When there is no file,
  every setting takes its default, and nothing is created. A `server_settings.json` of an earlier version is not read.
- **A setting that cannot be used stops the server:** an option that is not one (so a typo never passes unseen), one
  without its value, `--port`, an address to listen on that is not an IP address, or a port that is not a number. lcty.rb prints
  `lcty-rb: <where>: <what is wrong>` (the path of the file, or "the command line" with the usage) and exits with the
  status 1 ([LCTYSP-3008](LCTYSP-3008_server-settings.feature)).
- **At startup the server prints** the URL of every address at its port, the data directory, the origins whose pages may use
  `/v1/rpc`, and the settings file it read, or that there is none.

- **The data directory is outside the repository** by default, in the per-user application data folder (named by the
  reverse-DNS id `tokyo.kaito.lcty-rb`), so a checkout can be moved, cleaned or replaced without touching the data. It
  is created at startup if missing. A relative `LCTY_DATA_DIR` is resolved against the repository root.
  - **macOS:** `~/Library/Application Support`. Windows uses the same path for now.
  - **Elsewhere (Linux etc.):** `$XDG_DATA_HOME`, or `~/.local/share` when it is unset or not an absolute path, as the
    XDG Base Directory spec says. The data directory holds the conversations and the tags (the user's data), not
    settings, so it belongs in the data home, not `$XDG_CONFIG_HOME`.

- **Defaults:** `GET /v1/defaults.json` returns the defaults of the browser settings. It is generated by lcty.rb (the API
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
