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
- No inline style in HTML. The one there was, `style="text-align:…"` on `th` and `td` of a table in a presentation,
  becomes a class ([LCTYSP-0017](LCTYSP-0017_markdown.md#decisions), decision 4). Styles set from scripts
  (`element.style`) are not affected by a policy.
- `/v1/rpc` is a WebSocket of the same origin.
- llama-server is another origin, set in the browser's settings, so the server cannot know it.

## Plan

In order. Each step is one pull request with its tests, and each leaves the server working.

### 1. Check every request

- **`Host`:** only a host the server is reached by is served: an address it listens on (`--bind-ip`), `localhost`
  when it listens on `127.0.0.1` or `::1`, and the host of every `--allowed-origin`, each with the port. Any other is
  refused before a servlet sees it, the WebSocket of `/v1/rpc` included. Behind a reverse proxy the proxy's name is an
  allowed origin already, so it is allowed; a proxy that sends `Host: 127.0.0.1` is allowed too.
  - **A `Host` that is not served is answered `421 Misdirected Request`:** RFC 9110 defines it for a request sent to a
    server that cannot or will not answer for its target, which is this case. OWASP sets no status for it: its Secure
    Headers Project, its testing guide (WSTG-INJT-17) and its verification standard (ASVS 5.0) say nothing of one.
  - **A request without `Host`, or with more than one, is answered `400`,** as RFC 9112 requires.
- **The origin of a write,** as OWASP's CSRF Prevention Cheat Sheet lays it out
  ([below](#owasp-csrf-prevention-cheat-sheet)): a request other than `GET` and `HEAD` is served only when
  - its `Sec-Fetch-Site`, when it has one, is `same-origin`: `cross-site` and `same-site` are refused, since no page
    of another origin writes here, a sibling host of the same site included;
  - and its `Origin`, when it has one, is one of the allowed origins. This is the fallback the Cheat Sheet requires:
    a browser sends `Sec-Fetch-*` only to a potentially trustworthy URL (HTTPS, `localhost`, `127.0.0.0/8`, `::1`),
    so a page reached over plain HTTP at an address of the local network sends `Origin` alone.

  A refused write is answered `403` and logged with its `Origin` and `Sec-Fetch-Site`, as `/v1/rpc` logs an `Origin`
  it refuses, so a page that a setting shuts out can be found. A request with neither header is served (`curl`, the
  tests), as `/v1/rpc` serves one without `Origin`. The Cheat Sheet would refuse it for a sensitive endpoint
  ("fail-safe"), but every browser sends `Origin` with these methods, so such a request is not one a page sent on the
  user's behalf; and step 3 leaves no write in the HTTP API.
- **The type of a body:** a request with a JSON body (every `POST` and `PUT` of the HTTP API but `PUT /v1/vectors`,
  whose body is binary) is refused with `415` unless its `Content-Type` is `application/json`. A page of another site
  cannot send that type without a preflight, which is never granted.
- **No CORS:** no response has an `Access-Control-*` header, and the `Origin` of a request is never copied into one.
  A preflight (`OPTIONS`) is answered `403` without any CORS header, as the OWASP Secure Headers Project advises for
  a preflight that does not pass ([below](#owasp-secure-headers-project)): every page is of the server's own origin,
  so no other origin is ever given access.
- **The size of a body:** every body of the HTTP API is at most 64 MiB, as `/v1/rpc`'s messages, checked from
  `Content-Length` before it is read.
- **Not `Accept`:** the type of a response is fixed by its path and extension (`.json`, `.html`, `.js`, `/v1/` is
  JSON), so there is nothing to negotiate and nothing to refuse with `406`. Refusing one would stop none of the
  attacks above either: the origin and the type of the body do.

### 2. Answer with protective headers

The baseline is the configuration the OWASP Secure Headers Project proposes ([below](#owasp-secure-headers-project)),
checked against OWASP's HTTP Security Response Headers Cheat Sheet
([below](#owasp-http-security-response-headers-cheat-sheet)) and changed only where lcty-rb needs it; each change says
why.

On every response:

- `Content-Security-Policy`, for a page: everything closed, then opened for what the pages load, as the Content
  Security Policy Cheat Sheet tightens its basic policy ([below](#owasp-content-security-policy-cheat-sheet)):
  - `default-src 'none'`: no fonts, media, frames, manifests or objects, which no page uses
  - `script-src 'self'`; `worker-src 'self'`: the scripts and workers are files of the site
  - `style-src 'self'`: the style sheets are files of the site, and no presentation has a `style` attribute
    ([LCTYSP-0017](LCTYSP-0017_markdown.md))
  - `img-src 'self'`: no page shows an image; the browser may ask for `/favicon.ico`
  - `connect-src 'self' http: https:`: the pages connect to llama-server, wherever the user set it (`'self'` covers
    the WebSocket of `/v1/rpc`; to be checked in Safari)
  - `object-src 'none'`; `base-uri 'none'` (OWASP: `'self'`; no page has a `<base>`); `form-action 'self'` and
    `frame-ancestors 'none'`, which do not fall back to `default-src`
  - Not `upgrade-insecure-requests` (OWASP proposes it): lcty-rb and llama-server are reached over plain HTTP on the
    machine or the local network, and upgrading their requests would break them. Behind an HTTPS proxy the proxy may
    add it.
  - `'self'` and nothing else: no nonce, no hash, no Subresource Integrity, no `'strict-dynamic'`. The Cheat Sheet
    calls a strict policy current practice ([below](#owasp-content-security-policy-cheat-sheet)); for lcty-rb
    `'self'` alone is the stricter one, and pinning the site's own scripts would guard nothing.
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` for a response that is not a page (the JSON of
  `/v1/`, an error), as OWASP advises for an API: a response opened as a document runs nothing.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`, for browsers that do not know `frame-ancestors` (the CSP Cheat Sheet calls it obsolete
  where `frame-ancestors` is known; it costs nothing where it is)
- `Referrer-Policy: no-referrer` (the Cheat Sheet: `strict-origin-when-cross-origin`, the browsers' default). No page
  needs a `Referer`, and with the default a link in a reply would tell the site it leads to the address lcty-rb is
  reached at, a name of the local network among them.
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin` (the Cheat Sheet: `same-site`), so another site cannot load a response
  as a script or an image. No other host of the same site loads lcty-rb's resources, and on a local network the "site"
  of an address is not one the user chose.
- `Cross-Origin-Embedder-Policy: require-corp`: every resource of a page is of its own origin, and llama-server is
  fetched with CORS, which `require-corp` allows; to be checked with the workers in Safari, and left out if it breaks
  them
- `Permissions-Policy` as OWASP proposes it, every feature turned off but `sync-xhr=(self)`: no page uses the camera,
  the microphone, the clipboard API, full screen and the rest (code is copied with the browser's own copy)
- `X-Permitted-Cross-Domain-Policies: none`
- `X-DNS-Prefetch-Control: off` (Chromium): a presentation that slipped a link past the allowlist could not leak
  through a DNS lookup
- `X-Robots-Tag: noindex, nofollow` (the Cheat Sheet, for private content): a crawler that reaches a server
  published without users indexes nothing of it.
- No `Server` header (OWASP lists it among the headers to remove); an error is answered with a short body of its own
  (JSON for `/v1/`, plain text otherwise) in UTF-8.
- A `Content-Type` on every response with a body, with `charset=utf-8` on every text type (the Cheat Sheet: the
  charset of an HTML page guards against XSS; ASVS 5.0 4.1.1). The site's own types already have it
  (`Servlets::MIME_TYPES`); WEBrick's error pages (`ISO-8859-1`) and any type it would fall back to do not. A binary
  file is `application/octet-stream` (the vectors are already).
- The realm of Basic authentication (`WWW-Authenticate: Basic realm="…"`) is the base URL (`Lcty.base_url`, `/`
  by default), not `lcty-rb`: it does not name the software, as OWASP advises, and the servers one host serves under
  paths of their own (`/lcty-a/`, `/lcty-b/` behind one proxy) are protection spaces of their own, so a browser never
  tries the password of one on another. Whether a browser shows the realm is not taken into account. A base URL with
  `"`, `\` or a control character is refused when the settings are read, so the realm needs no escaping.

What may be kept:

- `Cache-Control: private, no-cache` on what holds the user's data: the responses of `/v1/`, the conversation files
  (`/c/<id>.html`) and the tag files (`/t/*.html`). `no-cache` makes the browser check its copy with the `ETag`
  before it uses it (`304` when nothing changed), so a page shows what the server has, opens fast and keeps the
  back-forward cache. `private` keeps them out of a shared cache: a caching proxy in front of a server without users
  would otherwise hand one person's conversations to another. A response to a request with `Authorization` is kept out
  of a shared cache anyway.
- The code and styles (`/lcty.v1/`, `/js/`, the CSS) keep `Cache-Control: no-cache` with their `ETag`: they hold no
  data.
- Not `no-store` (OWASP: `no-store, max-age=0` for sensitive content). It keeps a response out of the browser's own
  cache, against another program on the device reading the cache. That attacker is out of scope here: the data
  directory holds the conversations in plain text on the server's machine, which is often the same one, and a program
  that reads the browser's cache reads its IndexedDB and settings, the API key among them, as well. On a phone the
  browser's cache is closed to other apps. `no-store` would cost a full read of every conversation opened, and the
  back-forward cache in some browsers, for no guard. The Cheat Sheet notes that `private` and `no-cache` still let
  the browser store a response; that is what is wanted here. No page uses the Cache API, which ignores these headers.

Left out, with the reason:

- `Strict-Transport-Security`: lcty-rb speaks HTTP, and the header is only honoured over HTTPS; it belongs to the
  HTTPS proxy in front (OWASP: `max-age=63072000; includeSubDomains`), and the README says so.
- `Clear-Site-Data`: OWASP sends it at logout, and Basic authentication has none. On any other response it would wipe
  the browser's settings and its copies of the conversations (LCTYSP-0014).
- `Integrity-Policy`: OWASP does not propose it, since every script would need its Subresource Integrity; the scripts
  are of the same origin.
- `X-XSS-Protection`: the Cheat Sheet says not to send it (or to send `0`), since the filter it turns on can itself
  open holes; the policy above allows no inline script. WEBrick does not send it.
- `Expect-CT` and `Public-Key-Pins`: obsolete; the Cheat Sheet says not to use them.
- `Access-Control-Allow-Origin` and the other CORS headers: no other origin is given access (step 1).

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
- The UI tests fail on any report of the Content Security Policy (`securitypolicyviolation`), in Chromium, WebKit and
  Firefox, so a policy that breaks a page is found before it ships.
- The headers are compared with OWASP's lists (`ci/headers_add.json` and `ci/headers_remove.json` of the Secure
  Headers Project) and with its HTTP Security Response Headers, CSRF Prevention and Content Security Policy Cheat
  Sheets when this spec is revised: what they add is either done here or listed as not taken, with the reason.
- LCTYSP-0001 points here, and the README says what lcty-rb guards against and what is left to the proxy.

## Decisions made

1. **The inline style of tables:** settled by [LCTYSP-0017](LCTYSP-0017_markdown.md#decisions), which defines the
   output of Markdown: the alignment of a column is a class (`align-left`, `align-center`, `align-right`), so no
   `style-src-attr 'unsafe-inline'` is needed. Tables of the files written so far lose their alignment until their
   presentation is made again.

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
- `Cache-Control: no-store, max-age=0` (not taken: `private, no-cache` instead, above)
- `X-DNS-Prefetch-Control: off`

Its other advice that this plan follows:

- Remove the headers that tell which software answers, `Server` among them, and give `WWW-Authenticate` a realm
  that does not name it.
- Validate a preflight's `Origin`, `Access-Control-Request-Method` and `Access-Control-Request-Headers` against what
  is allowed, and answer one that fails with `403` and no CORS header; never copy `Origin` into
  `Access-Control-Allow-Origin`. lcty-rb allows no other origin, so every preflight fails.
- CORS is a rule for the browser, not access control: the server checks the origin of a write itself (step 1).
- A CSP matters for an API too, and directives such as `form-action` do not fall back to `default-src`.

Its advice that this plan does not follow: keeping sensitive responses out of the browser's cache (`no-store`), for
the reasons above.

## OWASP HTTP Security Response Headers Cheat Sheet

The [HTTP Security Response Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
of the OWASP Cheat Sheet Series (`cheatsheets/HTTP_Headers_Cheat_Sheet.md` of
[OWASP/CheatSheetSeries](https://github.com/OWASP/CheatSheetSeries), as of 2026-10-04) explains each header and
recommends a value. Where it differs from the Secure Headers Project, or adds to it:

- `Referrer-Policy: strict-origin-when-cross-origin`: not taken; `no-referrer`, above.
- `Cross-Origin-Resource-Policy: same-site`: not taken; `same-origin`, above.
- `Content-Type` with the right type and `charset` on every response: taken, above.
- `X-Robots-Tag: noindex, nofollow` for private content: taken, above.
- `X-XSS-Protection`: not to be sent, or `0`: followed (not sent).
- `Expect-CT` and `Public-Key-Pins`: not to be used: followed.
- `Server` removed or made non-informative, and no `X-Powered-By`: followed (WEBrick sends no `X-Powered-By`).
- `Cache-Control`: `no-store` for sensitive responses, `private` to keep them out of shared caches, with the warning
  that `no-cache` lets a response be stored: `private, no-cache`, for the reasons above.
- CSP: the Content Security Policy Cheat Sheet is the guide for its details, and a CSP may be meaningless on a REST
  API's responses; the plan sends the short `default-src 'none'` one there anyway, as the Secure Headers Project
  advises.
- `Access-Control-Allow-Origin`: set to a fixed origin if used at all: not used.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`: left to the HTTPS proxy, above.
- File downloads: `Content-Disposition: attachment` and `application/octet-stream` for files users provide. lcty-rb
  serves none for download: a conversation file is a page, and the vectors are `application/octet-stream`.

## OWASP CSRF Prevention Cheat Sheet

The [Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
(`cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md` of OWASP/CheatSheetSeries, as of 2026-11-10)
writes its advice for cookie sessions, but a browser sends Basic credentials with every request as it sends cookies,
so the same attack applies. How the plan follows it:

- **Fetch Metadata, with the origin as the fallback:** `Sec-Fetch-Site` is the primary signal, `cross-site` is refused
  for a method that is not safe, `same-site` is refused unless sibling hosts are trusted (they are not), and the
  `Origin` check is mandatory for browsers that send no `Sec-Fetch-*`: step 1. Over plain HTTP at a local address no
  browser sends `Sec-Fetch-*`, so there the `Origin` check is all there is.
- **No simple content types:** a JSON endpoint that takes `text/plain` is open to a cross-site form; `415` for any
  other `Content-Type`: step 1.
- **No state change on a safe method:** every `GET` of the HTTP API reads, and the writes of `/v1/rpc` go over a
  WebSocket whose handshake checks `Origin` ([LCTYSP-0012](LCTYSP-0012_rpc-protocol.md); ASVS 5.0 4.4.2).
- **Client-side CSRF** (a page that turns what is in its own URL into a request): no page writes from its URL. The new
  conversation page reads `?fork=` only to fill the input, which the user still sends, and `?q=` only to search.
- **Log first, then enforce:** refusals are logged with what was checked (step 1). A personal server needs no
  separate log-only period: the tests and the log show what a check shuts out.
- **`Vary: Sec-Fetch-Site, Origin`:** not needed. Only the answer to a write depends on those headers, and no cache
  keeps one.
- **Not taken:**
  - Tokens (synchronizer or signed double-submit cookies): they need state or cookies that lcty-rb does not have,
    and the checks above cover the browsers it supports.
  - A custom request header (`X-CSRF-Token`): `Content-Type: application/json` already makes a write a request that
    needs a preflight, which no other origin passes. The Cheat Sheet notes that a browser bug could break that, which
    is why the origin is checked as well.
  - `SameSite` cookies: lcty-rb sets no cookie.
  - Asking the user again (re-authentication, a confirmation) before a write: every write is the user's own action
    on a page already, and deleting asks first.

## OWASP Content Security Policy Cheat Sheet

The [Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
(`cheatsheets/Content_Security_Policy_Cheat_Sheet.md` of OWASP/CheatSheetSeries, as of 2026-10-04). How the policy of
step 2 follows it:

- **Delivered as a header on every response,** not only on the pages, and not as `X-Content-Security-Policy` or
  `X-WebKit-CSP`, which are obsolete.
- **Its tightened basic policy** (`default-src 'none'` and only what is used) is the shape of the page policy:
  same-origin scripts, workers, styles and connections, no inline script or `eval`, no framing, no form sent
  elsewhere. lcty-rb also allows connections to any HTTP(S) origin, for llama-server, and keeps `frame-ancestors`
  at `'none'` (the Cheat Sheet's sample: `'self'`; no page frames another).
- **A strict policy (nonces or hashes with `strict-dynamic`): not taken.** The Cheat Sheet prefers it to an
  allowlist, since an allowlist is bypassed through a listed host that serves attacker-controlled script (a CDN, a
  JSONP endpoint). For lcty-rb, `script-src 'self'` is the policy:
  - The format of the files leaves no place for Subresource Integrity. A conversation file is appended to and kept
    ([LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md)); its head names `lcty.v1.js` as it was when the file
    was made, and an `integrity` written there would be wrong after every new version of `lcty.v1`. Pinning by hash
    needs that integrity (below), so the site's scripts are allowed by `'self'`.
  - It lists no other host, and a script never passes its trust on: `'strict-dynamic'` would let any script that a
    trusted one creates run, wherever it comes from.
  - Nonces are for HTML and scripts made per response. lcty-rb is designed to need none: its pages and scripts are
    static files, and a nonce would also defeat the `ETag` of every page.
  - Pinning the site's own scripts by hash needs Subresource Integrity on them (a hash matches an external script only
    through its `integrity`; without it, Chromium and WebKit both refuse it). Integrity guards a script against the
    host that serves it, and here that host is the one that serves the page with the hashes: whoever can change one
    can change the other. Checked on 2026-11-11, WebKit also refuses a statically imported module pinned by the
    `integrity` of an import map, which Chromium allows, and neither pins a worker.
  - What a hash would still stop, an injected `<script src>` pointing at a script of the site, needs an injection,
    which the allowlist of presentations and pages that make their own presentation leave no place for; and the site
    serves nothing an attacker controls as a script (exact types and `nosniff`).

  To be looked at again if a page ever needs an inline script or a script from another host.
- **The `object-src 'none'` and `base-uri 'none'` of its strict samples:** taken.
- **`style-src-attr`:** not needed; decision 1 made the alignment of tables a class.
- **`Content-Security-Policy-Report-Only` first, and `report-to`:** not taken. There is no endpoint to collect
  reports, and one would be another way to write to the server; instead the UI tests fail on any violation in
  Chromium, WebKit and Firefox (step 4), before a policy ships.
- **A `<meta http-equiv="Content-Security-Policy">`:** the Cheat Sheet's way when headers cannot be set. A
  conversation file opened directly (`file://`) gets no header, and a meta tag in its head would give it the same
  policy but `frame-ancestors`. It changes the head of LCTYSP-0013, so it is left for later.
- **`upgrade-insecure-requests`:** for a site moving to HTTPS; not taken, as above.
