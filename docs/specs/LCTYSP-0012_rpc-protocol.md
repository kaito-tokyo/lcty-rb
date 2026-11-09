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

The prototype writes conversations in the format of [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) into a
directory of its own, `c-next/` of the data directory, so it never touches the real conversations.

## Transports

- **WebSocket:** `GET /v1/rpc` with `Upgrade: websocket` opens a WebSocket (RFC 6455, version 13). Every message is
  one text message holding one JSON-RPC message or one batch; a binary message closes the connection (1003). Both
  sides may send at any time: the page sends requests, the server sends responses and notifications.
- **Anything else** at `/v1/rpc` is refused: a `GET` without `Upgrade` gets `426`, and every other method `405`. There
  is no `POST`: a second transport would need the same checks again and would have no session (no `actorId`, no
  notifications, no `c.subscribe`), and every client has a WebSocket.
- **Origin.** A WebSocket handshake whose `Origin` is not one of the allowed origins is refused with `403`. The allowed origins are `LCTY_ALLOWED_ORIGIN` (origins separated by commas or
  spaces, such as `http://192.168.1.10:45280`), or else the server's own address (`http://<LCTY_HOST>:<PORT>`, and
  `http://localhost:<PORT>` when it listens on `127.0.0.1`). A request without `Origin` is accepted: it does not come
  from a page, and no page can make a browser send it. WebSocket is not covered by CORS, so without this check any page
  on the web could write to the user's conversations through the user's browser. Comparing `Origin` with `Host` is not
  enough: after DNS rebinding a page of another site reaches this server under its own name, and the browser sends that
  name in both.
- **Size.** One message, after its fragments are joined, is at most 64 MiB.
- **Ping.** The server answers a ping with a pong. Keeping an idle connection alive is the page's choice.

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
- **Notifications** (`c.created`, `c.appended`, `c.unappended`) announce every change, the one the receiving page made
  included, with the new `version` and the `actorId` of the change in their params. `c.appended` carries the element
  as written, as `{tag, attrs, innerHTML}`. A page applies a notification only when its `after` (or `id`) matches what
  it holds; otherwise it reads the conversation again.
- **The title** is changed with `c.update.title`, which the server fits into the slot and answers as written. The slot
  is in the middle of the file, so no id guards it: the last title written wins, which is enough for a value that is
  only shown. It is allowed while an `lcty-cmd` holds the conversation, and sends `c.meta.updated`.
- **A page follows one conversation.** `c.appended` and `c.unappended` go only to the connections that follow their
  conversation, set by `c.subscribe {cid, last}`; a page shows one conversation, so a connection follows at most one,
  and a new `c.subscribe` replaces the old one (`cid: null` follows none). `c.created`, which the list of conversations
  needs, still goes to every connection that receives it.
- **`c.meta.updated` keeps lists up to date.** Every change of a conversation (creating it, appending, unappending)
  also sends `c.meta.updated` with only what a list shows of it, the meta: `cid`, `lang`, `title`, `titleTypeId` (the
  id of `<title>`), `updatedAt` and `createdAt`. It goes to
  every connection that receives it, whatever it follows, and shares the version of the change it comes with: one
  change, one version, one or more notifications.
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

`c.list` returns the meta of every conversation, the same fields as `c.meta.updated`, with the version it was read at,
taken together, so a page fills its list from it and follows `c.meta.updated` from that version; after reconnecting it
reads it again. The same is also to be plain `GET`, so that a worker that keeps no WebSocket can read it (planned: `GET
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
