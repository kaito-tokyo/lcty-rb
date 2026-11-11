<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0014: Browser copies and sync

- Status: Draft. It supersedes the part of [LCTYSP-0010](LCTYSP-0010_data-and-settings.md#in-the-browser) about
  keeping the browser's copies of the list up to date, which now follow [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md).
- Related: [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md) (the protocol),
  [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) (the conversation file),
  [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) and [LCTYSP-0010](LCTYSP-0010_data-and-settings.md) (the copies and
  their workers)
- Implementation: the conversation page and the new conversation page (`lcty.v1.async.mjs`, `js/pages/new.js`)
  through `js/api/rpc.js` ([LCTYSP-1022](LCTYSP-1022_rpc-client.feature)), tested by
  [LCTYSP-2002](LCTYSP-2002_conversation-page.feature); the server sends `c.batch.updated` (`lib/rpc/servlet.rb`),
  and what the pages rely on from it is tested by [LCTYSP-3020](LCTYSP-3020_rpc.feature) and
  [LCTYSP-3022](LCTYSP-3022_rpc-pages.feature); the server also answers `t.c.list` and sends `t.batch.updated`
  (`lib/tag_store.rb`, tested by [LCTYSP-3005](LCTYSP-3005_tag-store.feature) and LCTYSP-3020). Every page with the
  sidebar shares the tab's connection (`js/api/tab-rpc.js`), over which the sidebar follows the lists
  (`js/ui/sidebar.js`, `js/api/meta-db.js` and `js/api/lcty-t.js`, [LCTYSP-1010](LCTYSP-1010_meta-db.feature) and
  [LCTYSP-1021](LCTYSP-1021_lcty-t.feature)); the workers keep the copies under the version rule
  ([LCTYSP-1001](LCTYSP-1001_lcty-c.feature)).

## Summary

How a page keeps what it shows up to date once changes come over `/v1/rpc`. Each tab keeps one WebSocket of its own.
The page reads everything once, then applies the notifications it receives; after a reconnection it reads everything
again. The browser's copies in IndexedDB stay what LCTYSP-0010 says they are, opened only by their workers, and record
the version they were last brought to, so that an older answer never overwrites a newer one, whichever tab writes it.

## One WebSocket per tab

- **The page's module opens it** when the page is shown, at the site's `v1/rpc` (`siteUrl("v1/rpc")`, with `http:`
  replaced by `ws:` and `https:` by `wss:`), and sends `initialize` with the methods the page receives. A file opened
  directly (`file://`) has no module running and opens nothing.
- **One connection for the parts of the page** (`js/api/tab-rpc.js`): the sidebar and the page register the
  notifications they follow, the requests they answer and what to read when the connection opens, and then the page
  opens it (`tabRpc()`); `initialize` declares all of them, so registering after that is refused.
- **Not a SharedWorker:** the pages are separate documents, so a SharedWorker would end with each page of a tab that is
  left, and WebSocket connections are not limited like HTTP/1.1 connections to one host. One per tab is simpler.
- **What each page receives:** every page `c.batch.updated` ([below](#one-notification-for-every-change-of-c)) and
  `t.batch.updated`: the sidebar's list from their `c_meta`, `c_recordcount` and `t_has_many_c` records, and on the
  conversation page also the `c_html` records of the conversation it follows. The conversation page of a file of
  LCTYSP-0013 also receives `c.cmd.holds` (it runs commands).
- **The `actorId`** that `initialize` returns is kept for the life of the connection. A notification with the page's own
  `actorId` is of its own change, which it has applied already when it sent it or applies once from the response.
- **Reconnecting:** when the connection closes, the page opens a new one, waiting longer each time it fails (from 1 s up
  to 30 s), and starts again from [Starting](#starting). It does not try to replay what it missed.

## One notification for every change of `c/`

- **`c.batch.updated` is the one interface for every change of `c/`.** It replaces the notifications of
  [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md#methods) (`c.created`, `c.meta.updated`, `c.appended` and
  `c.unappended`). A method per kind of update said nothing a record cannot say, and a
  change touches several copies at once; a new kind of update adds a store, not a method.
- **One change, one version, one notification:** its params are `{version, actorId, records}`, the version and the
  actor of the change, and the records of every copy it changes, in the order they are applied.
- **A record is `{store, op, row}`,** where `store` names the browser's copy it changes:
  - `c_meta`, `op` `put`: `row` is the meta of the conversation (creating it, appending, unappending, changing the
    title).
  - `c_recordcount`, `op` `put`: `row` is `{cid, count}` (creating it, appending, unappending).
  - `c_html`, the document of the conversation: `op` `append` with `row` `{cid, after, tag, attrs, innerHTML}`, the
    element as written; `op` `unappend` with `row` `{cid, id}`.
  - `c_meta` and `c_recordcount`, `op` `delete`: `row` is `{cid}` (deleting a conversation, today through the HTTP
    API, with the `actorId` `null`).
- **`t.batch.updated` does the same for `t/`:** its records are those of `t_has_many_c` of `lcty_t`, `op` `delete`
  and then `put` with `row` `{tag, cid}`, the rows of a conversation's tags that went and those that came. Tags are
  still written through the HTTP API, so its `actorId` is `null`. A page that shows the sidebar declares it beside
  `c.batch.updated`.
- **Each connection gets the records it follows:** `c_html` records go only to the connections that follow their
  conversation (`c.subscribe`), the others to every connection that receives `c.batch.updated`. The server leaves out
  the records a connection does not get, and sends it nothing when none is left. A page declares in `receives` the
  notifications themselves, not the stores.

## The version of a copy

- **Each copy records the version it holds:** `lcty_c` and `lcty_t` have a store `sync` with one row per copy that
  follows the server, `{store, boot, seq}` (`c_meta`, `c_recordcount`, `t_has_many_c`), the global version
  (`<boot>.<seq>`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md#the-global-version)) the copy was last brought to. One row
  per copy, not per database: `c.list` and `c.recordcount.list` are two reads at two versions, and a change may touch
  one store and not the other, so one version for both would refuse one of them.
- **A write is applied only when it is newer, in the same transaction:** the worker opens one read-write transaction
  over the store it changes and `sync`, reads the row, and checks the version it brings:
  - a full read (`replace`) is written unless the copy holds a newer version of the same `boot` (the same version is
    written again); a version of another `boot` replaces everything;
  - a change (`apply`) is written only onto a copy of the same `boot` that holds an older version. A copy that holds no
    version or one of another `boot` is missing what came before, and waits for the full read that every connection
    makes.

  It then stores that version.
- **A tab writes in the order it received:** its operations on a database run one at a time, and the notifications that
  arrive while the lists are being read are held and written after them. Otherwise a change received after `c.list`
  could be written before the list, onto an old copy, and the list, older than the change, would then be refused.
- **Gaps are not looked for:** versions number the changes of every resource, and a page receives only some of them
  (the notifications it declared and the conversation it follows), so the next version it gets is not always one more.
  Missing a change is only possible while disconnected, and every reconnection reads everything again.
- **Why in IndexedDB and not in a tab:** read-write transactions over the same stores are serialised across the tabs
  and workers of the origin, so checking the version and writing in one transaction keeps a copy from going back,
  whichever tab answers last. No SharedWorker or lock between tabs is needed. A transaction cannot wait for the network,
  so the page reads first and the worker checks the version when it writes.

## The rows of `c_meta`

- **A row is the meta, as `c.list` and the `c_meta` records of `c.batch.updated` give it:** `{cid, lang, title, titleTypeId, updatedAt,
  createdAt}`, with the key `cid`. Nothing is added or renamed on the way, so the worker stores what it receives.
  - `cid`: the id of the conversation, its file name.
  - `lang`: `lang` of line 1.
  - `title`: the title in the slot of line 3.
  - `titleTypeId`: the id of `<title>` on line 3 as it is (`__` and the size of the slot,
    [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md)).
  - `updatedAt`: when the file was last changed (its modification time), which orders the list.
  - `createdAt`: `data-created-at` of line 4.
- **The rows of version 1** (`id`, `title`, `created_at`, `updated_at_hint`, `setup_tags`, `tags_hint`,
  `messages_hint`, from `GET /v1/meta-all.json`) were replaced by these at version 2 of `lcty_c`; the store was
  recreated, nothing converted ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)), and the endpoint is gone.

## What the sidebar shows besides the meta

- **The tags of a conversation come from `lcty_t`:** the tag database is their source of truth, so the browser's
  copy of it holds them too, and the sidebar reads them from there with the display names of the tags. `c_meta` holds
  none. The store is `t_has_many_c`, the table of the same name in `lcty_t.sqlite`
  ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md#the-tags-of-a-conversation)): which conversations each tag has, one
  row `{tag, cid}` per tag and conversation, keyed by both. `t.c.list` answers every row with its version and
  `t.batch.updated` the changes; the sidebar shows a conversation's tags in the order of the tags' files (`t_full`).
- **The number of messages is a store of its own in `lcty_c`: `c_recordcount`.** It is a resource of `c/`, so it
  belongs in the database of `c/`; but it costs more than the meta (counting reads the whole file, where the meta needs
  only the head lines and the modification time), so it is kept apart from `c_meta` and can be read, updated or left
  stale on its own. A row is one conversation's count, keyed by `cid`, under the same version rule as every other
  store.
- **What `c_recordcount` counts:** every element of the file but `lcty-c`, whatever its kind (`lcty-msg`, `lcty-cmd`
  and the others of [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md)). Every element is one line and line 4,
  `<lcty-c … />`, is the last of the head, so the count is the number of lines of the file less 4; the server counts
  lines and parses none.
- **The server counts when it writes the file and caches the count in `_index.sqlite`:** creating a conversation, and
  appending or unappending an element, store the file's new count in a table of its own there,
  `c_recordcount (cid TEXT PRIMARY KEY, count INTEGER NOT NULL)`, while the conversation's write is still in progress,
  so a count is never read from a file being written. The count is answered from this table, never from the file: a
  conversation the table has no row for has its count answered as unknown (`null`), and the sidebar shows no number
  for it. The table is derived data like the rest of `_index.sqlite` ([LCTYSP-0007](LCTYSP-0007_search.md)) and is
  filled at startup by counting the lines of the files. The `conv_stats` of the search index (the number of messages
  behind `messages_hint`) went with `messages_hint`.
- **The `tags_hint` and `messages_hint` of version 1** (from the search index) went with those rows. A file of
  LCTYSP-0003 not yet converted has no tags in the sidebar unless its tags were changed (`data-setup-tags` is not
  read); `tools/convert.rb` writes them into `t_has_many_c`.

## Upgrading the databases

While lcty-rb is being developed, the databases are upgraded roughly: adding `sync` and `c_recordcount` raised
`lcty_c` to version 2, adding `t_has_many_c` and `sync` raised `lcty_t` to version 3, and changing any store raises
the version again; the upgrade drops every store and recreates them empty, and the next read fills them from the
server. Nothing is converted, and no care is taken for pages of older code
still open (they are closed by `versionchange` and read again when reloaded). Everything in them is a copy.

## Starting

When the connection is open and `initialize` has answered:

1. **The list:** `c.list` answers the meta of every conversation with its version; the worker of `lcty_c` replaces
   `c_meta` with it under the rule above. The sidebar shows the list from `c_meta`. `c.recordcount.list` answers every
   cached count with its version in the same way, and the worker replaces `c_recordcount` with it; a conversation it
   does not list has no number in the sidebar.
2. **The conversation shown** (the conversation page only): `c.subscribe` with its `cid` and the id of the last element
   in the document. When the answer is not `current`, the conversation is [out of sync](#out-of-sync); when it is,
   nothing was missed since the file was loaded, and the notifications of the conversation follow from the version
   answered.
3. **A lock found at the end:** when the last element is an `lcty-cmd` the page did not start, it calls `c.cmd.held`.
   When a page holds it, it shows that a reply is being made in another tab; when none does, it asks the user whether
   to run it again or remove it ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md#lcty-cmd)).

## Applying notifications

- **The `c_meta` and `c_recordcount` records** of a `c.batch.updated` are written by the worker of `lcty_c` in one
  transaction under the version rule, and the sidebar is redrawn from them.
- **The `c_html` records** of the conversation shown that another page made (another `actorId`) put the conversation
  [out of sync](#out-of-sync): they are not applied to the document, whether or not they follow its last element.
  Those of the page's own `actorId` are already in its document. Applying the records that follow is left for later.
- **`c.cmd.holds`** is answered `{holds: true}` while the page runs that `lcty-cmd`, `{holds: false}` otherwise, at
  once: the page that asked waits only a short time.

## Out of sync

A copy is out of sync when the page finds that it no longer follows the server: `c.subscribe` answers not `current`, a
`c_html` record does not follow the document's last element, or a write is refused with error `1` that
is not the page's own resend.

- **Changes to that resource are refused in the page:** the page sends no more writes for it (appending, unappending,
  the title, commands), stops applying its notifications, and shows an error that asks the user to reload the page.
  What it shows stays as it is until then, and other resources are not affected (the sidebar keeps its list).
- **Reloading the page is the only way back,** and only the user does it: the page never reloads itself, nor reads
  the conversation again and patches the document in place. A page that patches what it has could get it wrong
  without anyone seeing; a reload starts from the file as the server has it.
- **Except where it is trivial:** a copy that is replaced as a whole whenever it is read, such as `c_meta` from
  `c.list` after reconnecting, needs no user. Any other recovery has to be argued as trivial in this spec first.

## Writing

- **The page writes over its connection** with the methods of [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md), naming as
  `after` the last element of its document.
- **Error `1` (conflict):** another tab wrote first. When `data.last` is the id of the element the page just sent, its
  earlier request went through (a resend); otherwise the conversation is [out of sync](#out-of-sync).
- **Error `2` (locked):** a reply is being made; the page does as in step 3 of [Starting](#starting).
- **Workers without a WebSocket** never write; they read with `GET` (the planned `GET /v1/lcty_c_meta.json` and
  `GET /v1/lcty_t_full.json`, which carry `Lcty-Version`) and write into their database under the same rule.

## Open points

- **Writing tags, settings and vectors** has no RPC methods yet, and the tag definitions (`t_full`) are not read over
  it, so `t_full` keeps its sync of today until they do.
- **Protecting the user's data before the reload:** what the user has in the page and the server does not (an unsent
  message in the composer, say) must not be lost when the user reloads an out-of-sync page; how it is kept is to be
  discussed.
