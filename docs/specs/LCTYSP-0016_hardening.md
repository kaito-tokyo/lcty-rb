<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0016: Hardening

- Status: Draft. A plan: nothing of it is implemented yet.
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md#security) (security), [LCTYSP-0006](LCTYSP-0006_http-api.md)
  (the HTTP API), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md#authentication) (Basic authentication and the
  allowed origins), [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md) (`/v1/rpc`)

## Summary

The server is reached by browsers, and a browser does what any page tells it to: it sends requests to the server from
other sites, with the credentials it holds, and it reads what a page of the right origin is allowed to read. lcty-rb
checks almost nothing of this today. This plan checks every request before it is served (its `Host`, the `Origin` of
a write, the type of its body), answers with the headers that keep a browser from misusing the pages (a Content
Security Policy among them), and then moves every write to `/v1/rpc`, so that one way in has to be guarded.

## What is guarded against

lcty-rb runs on the user's machine and is reached from it, from the local network, or through an HTTPS reverse proxy
([LCTYSP-0010](LCTYSP-0010_data-and-settings.md#authentication)). The attacker of this plan is a web page the user
opens in the same browser, on any site:

- **Cross-site writes (CSRF).** The page sends a request to lcty-rb. The browser sends it with the user's Basic
  credentials, so authentication does not stop it.
- **DNS rebinding.** The page is served from a name the attacker controls, which then resolves to the address lcty-rb
  listens on. The browser sees the same origin, so the page reads what lcty-rb answers, conversations included.
- **Cross-origin reads and embedding.** The page loads a response of lcty-rb as a script, an image or a frame, or
  opens a page of lcty-rb in a frame to make the user click in it (clickjacking).
- **Script in a conversation.** A model's reply or a pasted text that holds markup. The presentation goes through an
  allowlist ([LCTYSP-0012](LCTYSP-0012_rpc-protocol.md), `ConvHtml::ALLOWED`), and the policy below is a second wall
  behind it.

Not guarded against here: a person or a program on the machine itself (it can read the data directory), the network
between the browser and lcty-rb (TLS in front is the user's: [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)), and
llama-server, which the browser talks to on its own.

## What was found

Checked on 2026-11-11 against the main branch (`33c6721`), with a server of its own on an empty data directory:

- **A cross-site write goes through.** `POST /v1/conversations` with `Origin: http://evil.example` and
  `Content-Type: text/plain` was answered `201` and created the conversation. A browser sends such a request from
  any page without asking the server first: it is a "simple" request of CORS, and the server reads the body as JSON
  whatever its type. The same holds for every `POST` of the HTTP API: the lines of a conversation (its tags among
  them), `pop`, and the memory of a tag. `PUT` and `DELETE` need a preflight, which the server answers without any
  CORS header, so a browser does not send them from another site.
- **Any `Host` is served.** A request with `Host: attacker.example` was answered `200`.
- **No protective header is sent.** No `Content-Security-Policy`, `X-Content-Type-Options`, `frame-ancestors` or
  `X-Frame-Options`, `Referrer-Policy`, or `Cross-Origin-*-Policy`.
- **The server says what it is.** `Server: WEBrick/1.9.1 (Ruby/2.6.10/2022-04-12)`, and an unknown path is answered
  with WEBrick's own HTML page in ISO-8859-1.
- **`OPTIONS` is answered `200`** with `Allow: DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT` (WEBrick's default), without
  CORS headers.
- **Already in place:** `/v1/rpc` checks `Origin` (`--allowed-origin`, [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md));
  a message of `/v1/rpc` and a body of `PUT /v1/vectors` are at most 64 MiB; the HTML a page shows from another page
  is made by the page itself ([LCTYSP-0014](LCTYSP-0014_browser-sync.md#applying-notifications)); Basic
  authentication when users are given.

What the pages need, which the policy below must allow:

- No inline `<script>`, no event attribute (`onclick=`), no `eval` or `new Function`, no `blob:` or `data:` script.
  Scripts and workers are files of the same origin (`lcty.v1.*`, `fuzzy_search.worker.js`).
- The only inline style in HTML is `style="text-align:…"` on `th` and `td` of a table in a presentation
  (`ConvHtml::ATTR_OK`). Styles set from scripts (`element.style`) are not affected by a policy.
- `/v1/rpc` is a WebSocket of the same origin.
- llama-server is another origin, set in the browser's settings, so the server cannot know it.

## Plan

In order. Each step is one pull request with its tests, and each leaves the server working.

### 1. Check every request

- **`Host`:** only a host the server is reached by is served: an address it listens on (`--bind-ip`), `localhost`
  when it listens on `127.0.0.1` or `::1`, and the host of every `--allowed-origin`, each with the port. Any other is
  refused before a servlet sees it, the WebSocket of `/v1/rpc` included. Behind a reverse proxy the proxy's name is an
  allowed origin already, so it is allowed; a proxy that sends `Host: 127.0.0.1` is allowed too.
- **The origin of a write:** a request other than `GET` and `HEAD` is served only when its `Origin` is one of the
  allowed origins, or, without `Origin`, when `Sec-Fetch-Site` is `same-origin` or `none`. A request with neither
  header (`curl`, the tests) is served, as `/v1/rpc` serves one without `Origin`: it is not a browser, so it is not
  sent on a page's behalf.
- **The type of a body:** a request with a JSON body (every `POST` and `PUT` of the HTTP API but `PUT /v1/vectors`,
  whose body is binary) is refused with `415` unless its `Content-Type` is `application/json`. A page of another site
  cannot send that type without a preflight, which is never granted.
- **`OPTIONS`:** answered `405` without CORS headers, as any method the server does not serve: there is no CORS, and
  no other origin is ever given access.
- **The size of a body:** every body of the HTTP API is at most 64 MiB, as `/v1/rpc`'s messages, checked from
  `Content-Length` before it is read.

### 2. Answer with protective headers

On every response:

- `Content-Security-Policy`:
  - `default-src 'self'`; `script-src 'self'`; `worker-src 'self'`
  - `style-src 'self'`, and the inline style of tables (decision 2)
  - `img-src 'self' data:`; `font-src 'self'`
  - `connect-src 'self' http: https:`: the pages connect to llama-server, wherever the user set it (`'self'` covers
    the WebSocket of `/v1/rpc`; to be checked in Safari)
  - `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`, so another site cannot load a response as a script or an image
- `Permissions-Policy` that turns off what no page uses (camera, microphone, geolocation, payment, USB and the like)
- No `Server` header with versions; an error is answered with a short body of its own (JSON for `/v1/`, plain text
  otherwise) in UTF-8.

On the responses of `/v1/` also `Cache-Control: no-store`: they hold conversations, and the pages read them fresh.

`Strict-Transport-Security` belongs to the HTTPS proxy in front, not to lcty-rb, which speaks HTTP; the README says
so. A conversation file opened directly (`file://`) gets no header and is not affected.

### 3. Every write through `/v1/rpc`

With step 1 the HTTP API is closed to other sites; this step leaves one way to write, checked once. In order:

1. The tags of a conversation and deleting a conversation.
2. The tag definitions (now with an ETag and `If-Match`) and adding a memory item.
3. The vectors of semantic search, which are binary.
4. The writes of the HTTP API are removed: it serves reads only. Writing the conversations of LCTYSP-0003 (`POST
   /v1/conversations`, its lines and `pop`), which no page uses any more, goes with them; the tests that create such
   files need another way, since in CI the server runs in a container of its own.

### 4. Keep it checked

- Each check and header has a backend scenario, run against a server with its settings.
- The UI tests fail on any report of the Content Security Policy (`securitypolicyviolation`), in Chromium and WebKit.
- LCTYSP-0001 points here, and the README says what lcty-rb guards against and what is left to the proxy.

## Decisions to make

Each has the one this plan proposes first.

1. **`Accept`:** not checked. A response of the HTTP API is JSON whatever `Accept` says, and refusing one (`406`)
   would not stop any of the attacks above: the type of the body and the origin do. The other way: answer `406` to a
   request of `/v1/` whose `Accept` does not admit `application/json`.
2. **The inline style of tables:** allowed with `style-src-attr 'unsafe-inline'`, since a style attribute can only be
   `text-align:left|center|right` in a file (the allowlist) and a page makes the presentation itself. The other way:
   classes (`lcty-align-center` and the like) instead of `style`, which changes the presentation of LCTYSP-0013 and
   the files written so far.
3. **The answer to a `Host` that is not served:** `421 Misdirected Request`, which says that the request reached a
   server that does not answer for that name. The other way: `403`.
