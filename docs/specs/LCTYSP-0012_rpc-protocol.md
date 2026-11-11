<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0012: RPC protocol

- Status: Draft (prototype at `/v1/rpc`; nothing uses it yet)
- Related: [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) (the conversation file this protocol writes),
  [LCTYSP-0006](LCTYSP-0006_http-api.md) (the HTTP API it is to replace for changes),
  [LCTYSP-0010](LCTYSP-0010_data-and-settings.md) (the browser's copies it keeps up to date)
- Methods: [LCTYSP-0012_rpc-protocol.openrpc.yml](LCTYSP-0012_rpc-protocol.openrpc.yml) (OpenRPC, the source of the
  method list)
- Implementation: `lib/rpc/websocket.rb`, `lib/rpc/servlet.rb`, `lib/rpc/conv_store.rb`; tested by
  [LCTYSP-3020](LCTYSP-3020_rpc.feature) (each method) and [LCTYSP-3022](LCTYSP-3022_rpc-pages.feature) (several pages
  at once)

## Summary

`/v1/rpc` is the one place where the data of the server changes and where every change is announced. Messages are
JSON-RPC 2.0. A page keeps a WebSocket open to it: it sends requests and gets their responses, and the server sends a
notification of every change to every connection that receives it, numbered by a global version. The WebSocket is the
only transport: a page always has one, and so do tools and tests. Reading everything at once stays plain `GET`.

The prototype writes conversations in the format of [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) into
`c/` of the data directory, with every other conversation. A file of
[LCTYSP-0003](LCTYSP-0003_conversation-file.md) there, not converted yet (`tools/convert.rb`), is read but never
written, except its title slot. Every write that appends or removes a `user` or `model` message also brings the
search index up to date ([LCTYSP-0007](LCTYSP-0007_search.md)), as the HTTP API does for the files it writes; the
other elements change no round of the index.

## Transports

- **WebSocket:** `GET /v1/rpc` with `Upgrade: websocket` opens a WebSocket (RFC 6455, version 13). Every message is
  one text message holding one JSON-RPC message or one batch; a binary message closes the connection (1003). Both
  sides may send at any time: the page sends requests, the server sends responses and notifications.
- **Anything else** at `/v1/rpc` is refused: a `GET` without `Upgrade` gets `426`, and every other method `405`. There
  is no `POST`: a second transport would need the same checks again and would have no session (no `actorId`, no
  notifications, no `c.subscribe`), and every client has a WebSocket. The `405` says `Allow: GET`, and a body of up to
  64 KiB is read before it: the connection is closed after the answer, and closed with data unread it would be reset,
  which a client could get before the `405`.
- **Origin.** A WebSocket handshake whose `Origin` is not one of the allowed origins is refused with `403`. The allowed origins are the `--allowed-origin` options (of
  `server_settings.txt` or the command line) or `LCTY_ALLOWED_ORIGIN` ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md#settings); such as
  `http://192.168.1.10:45280`), or else the server's own address (`http://<host>:<port>`, and
  `http://localhost:<port>` when it listens on `127.0.0.1`). The server prints the allowed origins when it starts, and
  logs every refusal with the `Origin` it refused (quoted, at most 200 characters) and the allowed origins, so the one
  to add as `--allowed-origin` can be read from the log; the page gets only `cross-origin`. A request without `Origin` is accepted: it does not come
  from a page, and no page can make a browser send it. WebSocket is not covered by CORS, so without this check any page
  on the web could write to the user's conversations through the user's browser. Comparing `Origin` with `Host` is not
  enough: after DNS rebinding a page of another site reaches this server under its own name, and the browser sends that
  name in both.
- **Size.** One message, after its fragments are joined, is at most 64 MiB.
- **Ping.** The server answers a ping with a pong. Keeping an idle connection alive is the page's choice.
- **Stopping.** When the server stops (Ctrl-C, or launchd's `TERM`), it accepts no more connections and sends every
  open one a close frame with `1001` (going away); one the page has not closed within a second is dropped. WEBrick
  waits for the thread of every request before it ends, and a connection's thread reads until the page closes it, so
  without this a page left open kept the server running ([LCTYSP-3019](LCTYSP-3019_entry-point.feature)). A
  connection whose handshake was answered as the server stopped, before it joined the connections being closed, gets
  the close frame at once instead. The page
  reconnects as it does after any close, and finds the server again when it is started.

## Messages

Every message follows [JSON-RPC 2.0](https://www.jsonrpc.org/specification):

- A **request** is `{"jsonrpc": "2.0", "method", "params", "id"}`; `params` is an object. The response carries the same
  `id`, with `result` or `error`.
- A **notification** has no `id` and gets no response. The server sends its notifications this way.
- A **batch** is an array of requests, answered by an array of responses (notifications left out). A batch is not
  atomic: each request succeeds or fails on its own, in no promised order. Changes that must happen together are one
  method, never a batch.
- An **error** is `{"code", "message", "data"?}`. The codes JSON-RPC reserves are used as it defines them (`-32700`
  parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal
  error). The errors of the application are small positive numbers, with details in `data`:
  - `1` conflict: the last element is not the one the request names; `data.last` is the id of the last element (or
    `null`).
  - `2` locked: the last element is an `lcty-cmd`; `data.last` is its id.
  - `3` invalid: the element breaks a rule of the format; `message` says which.
  - `4` not found: there is no such conversation.
  - `5` exists: the conversation already exists.
  - `6` former: the conversation is in the format of LCTYSP-0003, which is never appended to or removed from here;
    `data.cid` is its id. Converting it (`tools/convert.rb`) makes it writable.

## The global version

Every change gets the next number of one version shared by all data: `"<boot>.<seq>"`. `<boot>` is new each time the
server starts; `<seq>` counts the changes since. Changes are numbered and announced one at a time, so every connection
sees the notifications in version order and with no gaps.

- `initialize` returns the current version. (Every response of `/v1/` is to carry it in the `Lcty-Version` header
  too: a page that reads everything with `GET` learns which version it read, and listens from there.)
- A page that sees another `<boot>` than the one it knew has missed changes it cannot get back (the server keeps no
  history across a restart) and reads everything again.

## Locks

Both locks are write locks: they decide whether a write goes through, and never hold up reading or sending.

- **`lcty-cmd` is an optimistic lock.** It is checked only at the last step of a write: a write to a conversation whose
  last element is an `lcty-cmd` is refused (`2`), except removing that `lcty-cmd`. Nothing else waits for it: the
  conversation can still be read (its file, `c.list`, the notifications), and a page that wants to write looks, tries,
  and handles the refusal.
- **The server serialises writes, not communication.** Inside one short critical section it writes a change, gives it
  the next version and queues its notification for every connection that receives it. Each connection has its own
  queue and its own thread that sends from it, responses included, so the messages of one connection keep their order
  (a page gets the notification of its own change before the response). A page that stops reading holds up nobody: when
  its queue grows past a limit (1024 messages in the prototype), its connection is dropped, and the page reconnects and
  reads again.
- The version says nothing about a single file. A page that needs to know whether its own copy of a file is current
  asks for that (planned, see [Open points](#open-points)).

## Both ends speak one protocol

The page and the server are two ends of the same protocol: there are not methods "to the server" and methods "to the
page", only methods, and either end may receive one. What each end receives is its capability, declared when the
session starts.

- **`initialize`** is the first request on a WebSocket. Its params carry the page's capabilities
  (`{"capabilities": {"receives": [method names]}}`); its result carries the server's (`receives`, the methods the
  server takes), with the protocol name, the global version and the page's `actorId`.
- **`actorId` is assigned by the server.** `initialize` returns a new UUID for the connection, the same for its whole
  life, and every notification of a change names the actor that made it (`actorId`). A page tells its own changes from those of other tabs by it: for its own, the notification arrives before
  the response, and the page applies the change once. It identifies a connection, not a person (there is one user).
- **An end sends only what the other end declared it receives.** The server sends a page no notification before
  `initialize`, and afterwards only those the page listed. A method the receiver did not declare is answered with
  `-32601`. A page that wants no notifications (a worker that only reads, say) declares none.
- **Capabilities are fixed for the session.** To change them, the page opens a new connection.
- **`rpc.discover`** returns the [OpenRPC](https://spec.open-rpc.org/) document of the protocol. Its source is
  [LCTYSP-0012_rpc-protocol.openrpc.yml](LCTYSP-0012_rpc-protocol.openrpc.yml), YAML so that it can hold comments; the
  server reads it at startup, and no JSON copy is kept in the repository. Every method, its params, its result and its
  errors are defined there; `x-receiver` says which end usually receives it.

## Methods

The [OpenRPC document](LCTYSP-0012_rpc-protocol.openrpc.yml) lists them; this section gives the rules a list cannot.

- **Conversations** (`c.create`, `c.append.*`, `c.unappend`) follow the two operations of
  [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md#writing): appending one element at the end and removing the
  last one.
- **There is one append method per element:** `c.append.msg` (`lcty-msg`), `c.append.thinking` (`lcty-thinking`) and
  `c.append.cmd` (`lcty-cmd`, the lock). The method names the element, so its params are only `cid`, `after`, `attrs`
  (the attributes as an object, in their one order) and `innerHTML` (the presentation; none for `lcty-cmd`). `after`
  names the last element as the page knows it (`null` before the first one). A new kind of element gets a method of its
  own, so each one has its own rules and its own entry in a page's capabilities.
- **One notification, `c.batch.updated`, announces every change of `c/`,** the one the receiving page made included:
  one change, one version, one notification. Its params are the new `version`, the `actorId` of the change and its
  `records`, one per copy in the browser that the change touches, in the order they are applied
  ([LCTYSP-0014](LCTYSP-0014_browser-sync.md#one-notification-for-every-change-of-c)). A record is `{store, op, row}`:
  - `c_meta` / `put`: the meta, only what a list shows of a conversation: `cid`, `lang`, `title`, `titleTypeId` (the
    id of `<title>`), `updatedAt` and `createdAt`. Creating, appending, unappending and changing the title send it.
  - `c_recordcount` / `put`: `{cid, count}`, the number of elements of the file but `lcty-c` (its lines less 4),
    counted while the file is still locked. Creating (`0`), appending and unappending send it.
  - `c_html` / `append`: `{cid, after, tag, attrs}`, the element as written, without its presentation. `c_html` /
    `unappend`: `{cid, id}`. A page applies one only when its `after` (or `id`) matches what it holds; otherwise the
    conversation is out of sync.
- **No HTML goes to a browser over `/v1/rpc`.** A page sends the presentation it made when it appends (`innerHTML`,
  which the server checks against the allowlist and keeps in the file), but nothing the server sends a page holds
  HTML: a page that shows an element another page wrote makes its presentation itself, from the text in the attributes
  (`data-content`, Markdown for a model message), as it does for its own. The DOM of a page then holds no HTML that
  another page made, whatever the allowlist lets through. A page that is opened still reads the file, presentation
  and all.
  - `c_meta` / `delete` and `c_recordcount` / `delete`: `{cid}`, a conversation deleted (today only through the HTTP
    API, so the `actorId` is `null`).

  A kind of update is a store, not a method, so a new one adds a record, not a notification.
- **`t.batch.updated` announces every change of the tags of conversations** in the same way, for the resource `t/`:
  its records are `t_has_many_c` / `delete` and `put`, rows `{tag, cid}`, the rows that went and then those that came.
  Tags are still written through the HTTP API ([LCTYSP-0006](LCTYSP-0006_http-api.md)), so its `actorId` is `null`.
- **The title** is changed with `c.update.title`, which the server fits into the slot and answers as written. The slot
  is in the middle of the file, so no id guards it: the last title written wins, which is enough for a value that is
  only shown. It is allowed while an `lcty-cmd` holds the conversation, and sends a `c_meta` record.
- **What was measured of a reply** (`timings`, `usage`, `client`) is kept out of the file
  ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md#moving-existing-files)), in `message_stats` of
  `lcty_c.sqlite`. `c.stats.put {cid, id, timings, usage, client}` records it for the reply whose `model` element has
  the id `id` (`msg-m-…`), replacing what was there, before or after the reply is appended. `c.stats.list {cid}`
  returns it for every reply of a conversation. Recording it is a change with a version and a `c_stats` record
  (`op` `put`, `row` `{cid, id, timings, usage, client}`) that goes only to the pages following the conversation,
  which show it; no database of the browser keeps it, so a page reads the others with `c.stats.list`. Unappending a
  reply forgets what was measured of it, and deleting a conversation everything measured of its replies, so no row is
  left without its reply.
- **A page follows one conversation.** `c_html` and `c_stats` records go only to the connections that follow their conversation,
  set by `c.subscribe {cid, last}`; a page shows one conversation, so a connection follows at most one, and a new
  `c.subscribe` replaces the old one (`cid: null` follows none). The other records go to every connection that
  receives `c.batch.updated`, whatever it follows. The server leaves out the records a connection does not get, and
  sends it nothing when none is left.
- **Subscribing checks the page against the server.** `last` is the id of the last element the page holds. The result
  gives the last id of the conversation now and whether the page's is it (`current`), together with the version from
  which the notifications of this conversation follow, all taken in one step with no change in between. A page that is
  not current reads the conversation again; one that is current has missed nothing since it loaded the file.

**Sending a request again is safe.** When a response is lost and the page sends the same `c.append.*` again, the second
one fails with `1` and `data.last` is the id of the page's own element: the first one succeeded. An id is made by the
page, so it knows its own.

**A finished reply** is written by removing the `lcty-cmd` and then appending the elements one by one. Each step names
the last id it expects, so a tab that acted in between makes the next step fail instead of mixing the two.

## Who holds an `lcty-cmd`

The holder of an `lcty-cmd` is the page that runs it, and only that page knows: it is volatile, and the server keeps
no record of it. A page that finds an `lcty-cmd` it did not start sends `c.cmd.held`; the server asks every other
connected page that receives `c.cmd.holds` (a request from the server, which the page answers) and answers whether one
of them holds it, and its `actorId`. A page that does not answer within a short time (2 s in the prototype) counts as
not holding it. When none holds it, the page asks the user whether to run it again or remove it.

## Reading everything

`c.list` returns the meta of every conversation, the same fields as a `c_meta` record, with the version it was read
at, taken together, so a page fills its list from it and follows the `c_meta` records from that version; after reconnecting it
reads it again. `c.recordcount.list` does the same for the counts of elements: every row of the server's cache
(`{cid, count}`, ordered by `cid`) with its version, so a page fills `c_recordcount` from it and follows the
`c_recordcount` records; a conversation the cache has no count for is not among them, and its count is unknown.
`t.c.list` does the same for the tags of conversations: every row of `t_has_many_c` (`{tag, cid}`) with its version,
followed by the records of `t.batch.updated`, the notification of every change of them (today made through the HTTP
API, so its `actorId` is `null`). The same is also to be plain `GET`, so that a worker that keeps no WebSocket can read it (planned: `GET
/v1/lcty_c_meta.json` and `GET /v1/lcty_t_full.json`, named after the database and the store of the browser's copy,
[LCTYSP-0010](LCTYSP-0010_data-and-settings.md)). Both carry `Lcty-Version`: the version they were read at, read before
the data so that the data is at least that new. The page then listens from that version; a notification it already holds
is recognised by its ids and ignored.

## Open points

- **Notifications carry whole elements.** A long reply is sent in full to every connection following the conversation.
  Whether notifications carry only ids, and pages fetch what they need, is undecided.
- **`data-at`.** The prototype accepts any ISO 8601 time with an offset; whether one form (UTC with milliseconds, or
  local time) is required is undecided.
- **Conflict or locked first.** When the last element is an `lcty-cmd` and the request names another `after`, the
  prototype answers `1`, not `2`. Which is checked first is undecided.
- **Checking more than the last id.** `c.subscribe` compares only the last element. Whether a hash of the page's whole
  content (the skeleton of the integrity check) is needed is undecided, as is the check for pages other than a
  conversation.
- **The methods of tags, settings and vectors**, the timings and usage kept in a database, and the `GET` reads above.
- **Many tabs.** Each tab keeps its own WebSocket; whether one connection is shared (a SharedWorker) is left until the
  number of connections matters.
