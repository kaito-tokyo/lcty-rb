<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0001: Architecture

- Status: Accepted
- Related: [LCTYSP-0002](LCTYSP-0002_llm-backend.md), [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)

## Summary

lcty-rb is a personal chat web UI for local LLMs served by llama-server. It runs on the Ruby that ships with macOS
(`/usr/bin/ruby`, Ruby.framework, 2.6) using only its standard library and bundled gems, and it stores every
conversation as a plain HTML file instead of in a database server.

The top priority is performance, above all the time from sending a message to the first token on screen.

## Overview

```
                 ┌──────────────────────────────────┐
                 │ Browser (MPA, plain ES modules)   │
                 │  - pages and custom elements      │
                 │  - LLM client (Responses API)     │
                 │  - storage client, search         │
                 └───────┬────────────────┬─────────┘
   same origin           │                │  cross origin (CORS)
   static files, /v1/*   │                │  POST /v1/responses (SSE), /v1/embeddings
                 ┌───────▼──────┐  ┌──────▼──────────────────┐
                 │ lcty.rb      │  │ llama-server             │
                 │ (WEBrick)    │  │ (router mode, :12345)    │
                 │ 127.0.0.1    │  └─────────────────────────┘
                 └───────┬──────┘
                         │
                   data/c/<id>.html, data/*.sqlite
```

Two principles drive the design:

1. **Inference traffic never goes through Ruby.** The browser talks to llama-server directly.
2. **The prefix of the history sent to the model stays identical across requests.** llama-server reuses its cache for
   the shared prefix and recomputes everything after the first difference ([LCTYSP-0002](LCTYSP-0002_llm-backend.md)).

## Decisions

### The browser accesses the LLM backend directly (CORS)

- Removes the latency of a relay and the fragile part of relaying SSE through WEBrick. Stopping uses `AbortController`.
- Verified: llama-server answers preflight requests, echoes the `Origin` in `Access-Control-Allow-Origin`, and allows
  every header (`*`), including `Authorization`.
- The API key is a browser setting whose default comes from `GET /v1/defaults.json` ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)).
  This is acceptable because everything is bound to localhost; the key only guards against connecting to the wrong server.

### Ruby has three jobs: serving static files, the storage API, and the search index

- Ruby does not know the LLM exists. It never talks to the chat model or the embedding model.
- Ruby barely interprets conversations. The exceptions are the rule that limits undo to one turn
  ([LCTYSP-0004](LCTYSP-0004_editing.md)), validation of what it writes ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)),
  and deriving the search index ([LCTYSP-0007](LCTYSP-0007_search.md)).
- Pages are static files. Ruby never assembles HTML from templates; it only serves files (copying `lcty.v1.js` and `lcty.v1.css` into `data/c/` at startup) and answers `/v1/*`
  ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-0006](LCTYSP-0006_http-api.md)).

### The source of truth is files on the server

- One conversation is one file, `data/c/<id>.html`, and it is append-only
  ([LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0004](LCTYSP-0004_editing.md)).
- The browser keeps only caches for display.
- Files whose names start with `_` are derived data and can be rebuilt ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)).

### No build step on the front end

- Plain ES modules, no external libraries and no CDN.
- Pages are a multi-page application: every page has its own URL ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)).

### Runs on macOS's Ruby.framework

- Targets `/usr/bin/ruby` 2.6 with its standard library and the gems bundled with macOS (`webrick`, `sqlite3`,
  `nokogiri`). Nothing has to be installed.
- The code uses only syntax and APIs available in 2.6, so it also runs on ordinary Ruby once those three gems are
  installed.

## Security

- Listens on `127.0.0.1` by default; `--bind-ip` (or `LCTY_BIND_IP`) names other addresses, one or more
  ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)).
  There is no authentication, so an address other than loopback makes the conversations readable and writable by
  anyone who can reach it.
- Requests are not checked: there is no `Host` / `Origin` check and no headers are added to every response. The server
  is meant for the user's own machine and mostly serves static files, whose caching is the browser's default (WEBrick
  sends `ETag` and `Last-Modified`).
- Conversation ids are limited to `[A-Za-z0-9_-]{1,80}`.

## Encoding

- `Encoding.default_external` is set to UTF-8 at startup, because without `LANG` Ruby 2.6 defaults to US-ASCII.
  File I/O also states UTF-8 explicitly.
- WEBrick hands over paths and query values as ASCII-8BIT. Bound to SQLite as is, they compare as BLOBs and never
  match, so they are converted to UTF-8 on arrival.

## Performance budget

Measured with gemma-4-26B-A4B on an Apple silicon Mac:

| Situation                                     | Time to the first delta                 |
| --------------------------------------------- | --------------------------------------- |
| Sending about 5,900 tokens for the first time | 12.1 s                                  |
| Same content plus one more round at the end   | 0.25 s                                  |
| One character changed near the start          | 13.1 s                                  |
| Switching to another conversation and back    | 0.09 s (the in-RAM cache still applies) |

- Prompt processing runs at about 450 tok/s and generation at about 40–55 tok/s, so perceived speed depends almost
  entirely on whether the prefix can be reused.
- Browser and Ruby processing are noise compared with that, but stream rendering must never fall behind generation
  ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)).
- **Search budget: an operation that finishes within 50 ms counts as instant.** Nothing is optimized beyond that.
