<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0015: Schema versions

- Status: Draft.
- Related: [LCTYSP-0010](LCTYSP-0010_data-and-settings.md) (the data directory and its files),
  [LCTYSP-0007](LCTYSP-0007_search.md) (`_index.sqlite`), [LCTYSP-0008](LCTYSP-0008_vector-binary.md)
  (`lcty_fuzzy_search.sqlite`), [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) (`lcty_t.sqlite`),
  [LCTYSP-0014](LCTYSP-0014_browser-sync.md) (the browser's databases)
- Implementation: `lib/search_index.rb`, `lib/v1/vector_db.rb`, `lib/tag_store.rb`, `Chatty.open_data` in
  `lib/store.rb`; tested by [LCTYSP-3004](LCTYSP-3004_search-index.feature),
  [LCTYSP-3005](LCTYSP-3005_tag-store.feature) and [LCTYSP-3007](LCTYSP-3007_vector-db.feature)

## Summary

The SQLite files of the server are cut as the browser's IndexedDB databases are: one file per resource, each with one
integer version, `PRAGMA user_version`, that the server brings up by code at startup, as a page does in
`onupgradeneeded`. What the server can make again from the files alone needs no migration and is one file,
`_index.sqlite`, which is discarded and made anew at every start.

## Why not a migration framework

lcty runs on the user's own machine, and nothing about that machine is under its control: when a newer version is
installed, whether an older one is run again afterwards, and whether two run on the same data at once. Migration
frameworks (Rails, Django, Flyway, Liquibase, Prisma and the rest, [below](#what-other-frameworks-keep)) assume an
operator who deploys one version everywhere and runs every migration of one database together; their bookkeeping is
one whole that every table shares, which is too rigid here. IndexedDB was made for the same conditions as lcty (tabs
of different versions of a page on one origin) and splits the problem by database instead, so lcty follows it on both
sides.

## One file per resource, as the browser's databases

- **The server's files and the browser's databases are cut at the same grain:** `lcty_c.sqlite` and the browser's
  `lcty_c` for `c/`, `lcty_t.sqlite` and `lcty_t` for `t/`, `lcty_fuzzy_search.sqlite` for the vectors of fuzzy
  (semantic) search. A resource whose data needs migrating has a file of its own, so its version is its own.
- **Today's files:**
  - `lcty_t.sqlite`: `conversation_tags`, source data ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)).
  - `lcty_fuzzy_search.sqlite`: `vectors`, which only the browser can make again
    ([LCTYSP-0008](LCTYSP-0008_vector-binary.md)). It has no leading `_`, so backups keep it.
  - `lcty_c.sqlite`: not made yet; nothing of `c/` needs migrating today (the conversation files are the source of
    truth, and everything derived from them is in `_index.sqlite`).
- **The browser's databases** are renamed to match, `lcty_v1_c` → `lcty_c` and `lcty_v1_t` → `lcty_t` (planned, in a
  change of its own; [LCTYSP-0014](LCTYSP-0014_browser-sync.md)).

## One integer version per file

- **`PRAGMA user_version` is the file's version,** one integer for the whole file, as an IndexedDB database's version.
- **The server brings a file up by code,** as `onupgradeneeded` does with `oldVersion`: at startup it reads the
  version and runs, in one transaction, what takes a file of that version to the current one. There is no migrations
  table and no history.
- **A file of a newer version is refused,** as IndexedDB refuses to open a database at a lower version than it has
  (`VersionError`): a newer server wrote it, and its data is kept for that server.
- **A version is kept across a rename:** `lcty_t.sqlite` keeps the version `tags.sqlite` had (3).

## `_index.sqlite`: discarded at every start

- **What the Ruby server can make again from the files alone needs no migration,** so it is all in `_index.sqlite`:
  the rounds and keyword index, the tags of conversations for filtering, the counts of messages and of elements
  ([LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0014](LCTYSP-0014_browser-sync.md)).
- **It is discarded and made anew at every start** (`SearchIndex.discard`, the file with its `-wal` and `-shm`), and
  the full sync fills it again. It has no version: whatever an older or newer server left in it is never read.
- What is served from it is built in memory on request and never written to disk
  ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md#data-directory)).

## The layout before

At startup, before anything is opened (`Chatty.open_data`):

1. `tags.sqlite` is renamed to `lcty_t.sqlite` when the latter does not exist, after a checkpoint, and its `-wal` and
   `-shm` are removed (`TagStore.rename_former`).
2. When `lcty_fuzzy_search.sqlite` does not exist and the old `_index.sqlite` has a table `vectors` (with `model`),
   its vectors are carried over into a new `lcty_fuzzy_search.sqlite` (`VectorDB.carry_over`), so the browser need not
   embed everything again.
3. `_index.sqlite` is discarded.
4. The cache files of the layout before that (`_vectors.*`) are deleted after the vectors are garbage-collected.

## What other frameworks keep

A survey of the bookkeeping tables of migration tools, made before choosing IndexedDB's way. The columns are as their
documentation or source shows them; where a source was secondary it is said.

- **The current version only:**
  - Alembic: `alembic_version (version_num)`, one row holding the head revision.
  - golang-migrate: `schema_migrations (version, dirty)`, one row; `dirty` is set before a migration runs and cleared
    after it succeeds, and a dirty database refuses further migrations until someone repairs it.
  - Room (Android): `room_master_table (id, identity_hash)`, one row; the hash is computed from the declared entities,
    and Room refuses a database whose schema changed without a new version.
- **One row per migration applied:**
  - Rails: `schema_migrations (version)`, and `ar_internal_metadata` (key, value) for the environment.
  - Django: `django_migrations (id, app, name, applied)`, migrations named per app.
  - Knex: `knex_migrations (id, name, batch, migration_time)` and a lock table `knex_migrations_lock (index,
    is_locked)`.
  - sqlx: `_sqlx_migrations`, keyed by `version`, with `description`, `installed_on` and `success` (a checksum and an
    execution time as well, by its source; not confirmed by documentation).
  - Prisma: `_prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at,
    applied_steps_count)` (from mirrors of its engine documentation).
- **A full history:**
  - Flyway: `flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by,
    installed_on, execution_time, success)`.
  - Liquibase: `DATABASECHANGELOG` (`ID`, `AUTHOR`, `FILENAME`, `DATEEXECUTED`, `ORDEREXECUTED`, `EXECTYPE`, `MD5SUM`
    and more) and a lock table `DATABASECHANGELOGLOCK`.

Every one of them keeps one bookkeeping for the whole database, and most of them a list of the migrations applied. No
one versions a part of a database apart from the rest; the nearest is Django, per app. IndexedDB gets the same
separation by making each part a database of its own, which a SQLite file can be as well.

## Open points

- **Telling other processes:** IndexedDB sends `versionchange` to the other connections before it upgrades and waits
  for them to close (`blocked` otherwise); SQLite has no such signal, so two servers on one data directory (one of them
  older) are not handled.
- **Copying a source file aside** before it is migrated.
- **When the steps for the layout before go away.**

## References

- Flyway: [the schema history table](https://documentation.red-gate.com/fd/flyway-schema-history-table-273973417.html)
- Liquibase: [the DATABASECHANGELOG table](https://docs.liquibase.com/concepts/databasechangelog-table.html)
- Prisma: [the mental model of Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/mental-model)
- golang-migrate: [the dirty flag](https://atlasgo.io/blog/2025/04/06/golang-migrate-dirty-secret)
- Knex: [migrations](https://knexjs.org/guide/migrations)
- Room: [understanding migrations with Room](https://medium.com/androiddevelopers/understanding-migrations-with-room-f01e04b07929)
- Rails: [dissecting Rails migrations](https://blog.appsignal.com/2020/04/14/dissecting-rails-migrationsl.html)
- Alembic: [the version table](https://sources.debian.org/src/alembic/1.18.4-2/tests/test_version_table.py)
