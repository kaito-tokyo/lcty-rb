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
- **No CORS:** no response has an `Access-Control-*` header, and the `Origin` of a request is never copied into one.
  A preflight (`OPTIONS`) is answered `403` without any CORS header, as the OWASP Secure Headers Project advises for
  a preflight that does not pass ([below](#owasp-secure-headers-project)): every page is of the server's own origin,
  so no other origin is ever given access.
- **The size of a body:** every body of the HTTP API is at most 64 MiB, as `/v1/rpc`'s messages, checked from
  `Content-Length` before it is read.

### 2. Answer with protective headers

The baseline is the configuration the OWASP Secure Headers Project proposes ([below](#owasp-secure-headers-project)),
changed only where lcty-rb needs it, and each change says why.

On every response:

- `Content-Security-Policy`, for a page:
  - `default-src 'self'`; `script-src 'self'`; `worker-src 'self'`
  - `style-src 'self'`, and the inline style of tables (decision 2)
  - `img-src 'self' data:`; `font-src 'self'`
  - `connect-src 'self' http: https:`: the pages connect to llama-server, wherever the user set it (`'self'` covers
    the WebSocket of `/v1/rpc`; to be checked in Safari)
  - `object-src 'none'`; `base-uri 'none'` (OWASP: `'self'`; no page has a `<base>`); `form-action 'self'`, which
    does not fall back to `default-src`; `frame-ancestors 'none'`
  - Not `upgrade-insecure-requests` (OWASP proposes it): lcty-rb and llama-server are reached over plain HTTP on the
    machine or the local network, and upgrading their requests would break them. Behind an HTTPS proxy the proxy may
    add it.
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` for a response that is not a page (the JSON of
  `/v1/`, an error), as OWASP advises for an API: a response opened as a document runs nothing.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`, for browsers that do not know `frame-ancestors`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`, so another site cannot load a response as a script or an image
- `Cross-Origin-Embedder-Policy: require-corp`: every resource of a page is of its own origin, and llama-server is
  fetched with CORS, which `require-corp` allows; to be checked with the workers in Safari, and left out if it breaks
  them
- `Permissions-Policy` as OWASP proposes it, every feature turned off but `sync-xhr=(self)`: no page uses the camera,
  the microphone, the clipboard API, full screen and the rest (code is copied with the browser's own copy)
- `X-Permitted-Cross-Domain-Policies: none`
- `X-DNS-Prefetch-Control: off` (Chromium): a presentation that slipped a link past the allowlist could not leak
  through a DNS lookup
- No `Server` header (OWASP lists it among the headers to remove); an error is answered with a short body of its own
  (JSON for `/v1/`, plain text otherwise) in UTF-8.

What may be kept, as OWASP advises for sensitive content:

- `Cache-Control: no-store, max-age=0` on what holds the user's data: the responses of `/v1/`, the conversation files
  (`/c/<id>.html`) and the tag files (`/t/*.html`). No other program on the machine finds them in the browser's
  cache.
- The code and styles (`/lcty.v1/`, `/js/`, the CSS) keep `Cache-Control: no-cache` with their `ETag`: they hold no
  data, and revalidating them keeps a page fast.

Left out, with the reason:

- `Strict-Transport-Security`: lcty-rb speaks HTTP, and the header is only honoured over HTTPS; it belongs to the
  HTTPS proxy in front (OWASP: `max-age=63072000; includeSubDomains`), and the README says so.
- `Clear-Site-Data`: OWASP sends it at logout, and Basic authentication has none. On any other response it would wipe
  the browser's settings and its copies of the conversations (LCTYSP-0014).
- `Integrity-Policy`: OWASP does not propose it, since every script would need its Subresource Integrity; the scripts
  are of the same origin.

A conversation file opened directly (`file://`) gets no header and is not affected.

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
- The UI tests fail on any report of the Content Security Policy (`securitypolicyviolation`), in Chromium and WebKit,
  so a policy that breaks a page is found before it ships.
- The headers are compared with OWASP's lists (`ci/headers_add.json` and `ci/headers_remove.json` of its repository)
  when this spec is revised: a header added there is either sent here or listed above as left out, with the reason.
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
4. **The realm of Basic authentication:** kept as `lcty-rb`. OWASP advises a generic realm, since the name tells an
   attacker which software answers; but the realm is what the browser shows when it asks for the password, and the
   user needs to know what asks. The other way: a generic realm (`RestrictedArea`), or one set by an option.

## OWASP Secure Headers Project

The [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/) keeps the headers it proposes to
send and to remove as data in its repository (`ci/headers_add.json` and `ci/headers_remove.json` of
[OWASP/www-project-secure-headers](https://github.com/OWASP/www-project-secure-headers)), with its advice in
`mainsite/03_best_practices.md`. As of its update of 2026-10-18, it proposes:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (left to the HTTPS proxy, above)
- `X-Frame-Options: deny`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none';
  frame-ancestors 'none'; upgrade-insecure-requests` (taken, with the changes above)
- `X-Permitted-Cross-Domain-Policies: none`
- `Referrer-Policy: no-referrer`
- `Clear-Site-Data: "cache","cookies","storage"` (at logout only; left out, above)
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy` with every feature turned off but `sync-xhr=(self)`
- `Cache-Control: no-store, max-age=0` (on what holds the user's data, above)
- `X-DNS-Prefetch-Control: off`

Its other advice that this plan follows:

- Remove the headers that tell which software answers, `Server` among them.
- Validate a preflight's `Origin`, `Access-Control-Request-Method` and `Access-Control-Request-Headers` against what
  is allowed, and answer one that fails with `403` and no CORS header; never copy `Origin` into
  `Access-Control-Allow-Origin`. lcty-rb allows no other origin, so every preflight fails.
- CORS is a rule for the browser, not access control: the server checks the origin of a write itself (step 1).
- A CSP matters for an API too, and directives such as `form-action` do not fall back to `default-src`.
- Do not let sensitive responses be cached (`no-store`).
