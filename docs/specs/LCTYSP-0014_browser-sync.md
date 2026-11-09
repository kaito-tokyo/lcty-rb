<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0014: Browser copies and sync

- Status: Draft. It is to supersede the part of [LCTYSP-0010](LCTYSP-0010_data-and-settings.md#in-the-browser) about
  keeping the browser's copies up to date, once the pages use [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md); until then
  LCTYSP-0010 describes what the pages do.
- Related: [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md) (the protocol),
  [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) (the conversation file),
  [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) and [LCTYSP-0010](LCTYSP-0010_data-and-settings.md) (the copies and
  their workers)
- Implementation: none yet; what the pages rely on from the server is tested by
  [LCTYSP-3022](LCTYSP-3022_rpc-pages.feature)

## Summary

How a page keeps what it shows up to date once changes come over `/v1/rpc`. Each tab keeps one WebSocket of its own.
The page reads everything once, then applies the notifications it receives; after a reconnection it reads everything
again. The browser's copies in IndexedDB stay what LCTYSP-0010 says they are, opened only by their workers, and record
the version they were last brought to, so that an older answer never overwrites a newer one, whichever tab writes it.

## One WebSocket per tab

- **The page's module opens it** when the page is shown, at the site's `v1/rpc` (`siteUrl("v1/rpc")`, with `http:`
  replaced by `ws:` and `https:` by `wss:`), and sends `initialize` with the methods the page receives. A file opened
  directly (`file://`) has no module running and opens nothing.
- **Not a SharedWorker:** the pages are separate documents, so a SharedWorker would end with each page of a tab that is
  left, and WebSocket connections are not limited like HTTP/1.1 connections to one host. One per tab is simpler.
- **What each page receives:** every page `c.meta.updated` (the sidebar's list); the conversation page also
  `c.appended` and `c.unappended` (it follows its conversation), and `c.cmd.holds` (it runs commands).
- **The `actorId`** that `initialize` returns is kept for the life of the connection. A notification with the page's own
  `actorId` is of its own change, which it has applied already when it sent it or applies once from the response.
- **Reconnecting:** when the connection closes, the page opens a new one, waiting longer each time it fails (from 1 s up
  to 30 s), and starts again from [Starting](#starting). It does not try to replay what it missed.

## The version of a copy

- **Each database records the version it holds:** `lcty_c` and `lcty_t` get a store `sync` with one row,
  `{boot, seq}`, the global version (`<boot>.<seq>`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md#the-global-version)) of
  the last data written into the database.
- **A write is applied only when it is newer, in the same transaction:** the worker opens one read-write transaction
  over the store it changes and `sync`, reads the row, and writes only when the version it brings has the same `boot`
  and a larger `seq`; it then stores that version. A version with another `boot` replaces everything (only a full read
  brings one) and stores the new version.
- **Gaps are not looked for:** versions number the changes of every resource, and a page receives only some of them
  (the notifications it declared and the conversation it follows), so the next version it gets is not always one more.
  Missing a change is only possible while disconnected, and every reconnection reads everything again.
- **Why in IndexedDB and not in a tab:** read-write transactions over the same stores are serialised across the tabs
  and workers of the origin, so checking the version and writing in one transaction keeps a copy from going back,
  whichever tab answers last. No SharedWorker or lock between tabs is needed. A transaction cannot wait for the network,
  so the worker fetches first and checks the version when it writes.

## Starting

When the connection is open and `initialize` has answered:

1. **The list:** `c.list` answers the meta of every conversation with its version; the worker of `lcty_c` replaces
   `c_meta` with it under the rule above. The sidebar shows the list from `c_meta`.
2. **The conversation shown** (the conversation page only): `c.subscribe` with its `cid` and the id of the last element
   in the document. When the answer is not `current`, the page reloads the conversation file; when it is, nothing was
   missed since the file was loaded, and the notifications of the conversation follow from the version answered.
3. **A lock found at the end:** when the last element is an `lcty-cmd` the page did not start, it calls `c.cmd.held`.
   When a page holds it, it shows that a reply is being made in another tab; when none does, it asks the user whether
   to run it again or remove it ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md#lcty-cmd)).

## Applying notifications

- **`c.meta.updated`** is written into `c_meta` by its worker under the version rule, and the sidebar is redrawn from
  `c_meta`.
- **`c.appended` and `c.unappended`** of the conversation shown are applied to the document when their `after` (or
  `id`) is the document's last element; otherwise the page reloads the conversation file. Those of its own `actorId` are
  skipped when already applied.
- **`c.cmd.holds`** is answered `{holds: true}` while the page runs that `lcty-cmd`, `{holds: false}` otherwise, at
  once: the page that asked waits only a short time.

## Writing

- **The page writes over its connection** with the methods of [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md), naming as
  `after` the last element of its document.
- **Error `1` (conflict):** another tab wrote first. When `data.last` is the id of the element the page just sent, its
  earlier request went through (a resend); otherwise the page reloads the conversation and the user tries again.
- **Error `2` (locked):** a reply is being made; the page does as in step 3 of [Starting](#starting).
- **Workers without a WebSocket** never write; they read with `GET` (the planned `GET /v1/lcty_c_meta.json` and
  `GET /v1/lcty_t_full.json`, which carry `Lcty-Version`) and write into their database under the same rule.

## Open points

- **The rows of `c_meta`:** the meta of `c.list` is `cid`, `lang`, `title` and `updatedAt`; today's rows also hold the
  tags and the number of messages (`tags_hint`, `messages_hint`) from the search index. Whether the sidebar keeps them,
  and where the tags of conversations come from in the browser (the tag database is their source of truth), is
  undecided.
- **Tags, settings and vectors** have no RPC methods yet, so `lcty_t` keeps its sync of today until they do.
- **The upgrade of the databases** for the store `sync` (a new version of `lcty_c` and `lcty_t`).
- **Reloading the conversation** when the page is stale: whether a whole reload of the page, or the elements read again
  and replaced in place.
