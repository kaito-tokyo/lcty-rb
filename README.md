<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# lcty-rb

A personal chat web UI for [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server`, served by a small
Ruby server on your own machine. Conversations are plain HTML files you can open, back up and keep.

- Chat with a local model; undo, regenerate and fork from any message.
- Search every conversation from the sidebar: keywords and semantic search (EmbeddingGemma 2), merged.
- Tags carry a system prompt and a memory; the model can propose memory items from a conversation.

## Requirements

- macOS's own Ruby, `/usr/bin/ruby` (2.6). It already has everything the server uses (WEBrick, SQLite3, Nokogiri):
  there is nothing to install.
- `llama-server` from llama.cpp, for the chat model and the embedding model.
- A current browser (Chrome or Safari).

## Run

Start the models (router mode: the chat and embedding models in `llm-backend/llama-cpp.ini`, on port 9931):

```bash
llm-backend/run-llama-cpp.sh
```

Start the server and open http://127.0.0.1:45280/:

```bash
/usr/bin/ruby lcty.rb
```

The browser talks to `llama-server` directly; the Ruby server serves the pages and keeps the conversations, the tags
and the search index.

Outside macOS, the dev container `.devcontainer/ruby-2.6.10` gives the same Ruby and libraries (`ruby:2.6.10` with the
`Gemfile`, installed into its image; rebuild it after changing the `Gemfile`). Run `ruby lcty.rb` in it; port 45280 is
forwarded. Its data
directory (`~/.local/share/tokyo.kaito.lcty-rb/Data`) is the volume `lcty-rb-data`, so it outlives a rebuild.

## Settings

- Server: only the environment variables `PORT` (default 45280), `LCTY_HOST` (the address to listen on, default
  `127.0.0.1`) and `LCTY_DATA_DIR` (default `~/Library/Application Support/tokyo.kaito.lcty-rb/Data` on macOS,
  `$XDG_DATA_HOME/tokyo.kaito.lcty-rb/Data`, that is `~/.local/share/…` by default, on Linux).
- Everything else (the `llama-server` URL, API key, model names) is set in the settings dialog (the ⚙︎ button in the sidebar) and stored in the
  browser. The default API key is `<hostname>-<user>`, the same as `run-llama-cpp.sh` uses.

## Data

Everything is in the data directory, `~/Library/Application Support/tokyo.kaito.lcty-rb/Data/` by default on macOS
(`LCTY_DATA_DIR`; see Settings for Linux):

- `c/<id>.html`: one file per conversation. Opened through the server (`/c/<id>.html`) it shows as the conversation.
- `tags.sqlite`: tag definitions, memory and tag changes.
- Files starting with `_` are derived (the search index, the vectors) and are rebuilt when deleted.

Back up everything that does not start with `_`:

```bash
rsync -a --exclude='_*' "$HOME/Library/Application Support/tokyo.kaito.lcty-rb/Data/" backup/
```

## Tests

The frontend unit tests that need no browser run in Node.js (26 or later, for its Web Workers) with its test runner, `node:test`; the other
frontend tests run in Chromium and WebKit with [Playwright](https://playwright.dev/). Node.js is needed for them only;
the server itself still needs nothing installed. The backend tests run on the server's Ruby with Minitest, which Ruby
2.6 bundles.

- **Frontend unit tests** (`tests/unit/`): one module of `public/` on its own, such as a worker or a function. Their
  behaviour is written as Gherkin features, `docs/specs/LCTYSP-1xxx_*.feature`, and each feature is tested by one test
  per Scenario, with the Scenario's title and its lines as the test's steps: in Node.js (a `.test.js` here) when the
  module needs no browser, or else on an empty page in the browsers (a `.spec.js`); a feature may have both
  ([LCTYSP-1000](docs/specs/LCTYSP-1000_frontend-unit-tests.md) explains them).
- **Frontend UI tests** (`tests/ui/`): drive the pages. Their Gherkin features will be
  `docs/specs/LCTYSP-2xxx_*.feature`.
- **Backend unit tests** (`tests/backend/`): one part of the Ruby server (`lib/`) on its own. Like the frontend unit
  tests, their Gherkin features are `docs/specs/LCTYSP-3xxx_*.feature`, and each feature has a `_test.rb` here that has
  one test per Scenario, with the Scenario's title and its lines as the steps
  ([LCTYSP-3000](docs/specs/LCTYSP-3000_backend-unit-tests.md) explains them).

The backend unit tests need neither Node.js nor a running server (the HTTP tests start their own on a free port), and
they use a new, empty data directory in the temporary folder, removed afterwards (`LCTY_TEST_KEEP_DATA=1` keeps it):

```bash
ruby tests/backend/run.rb
```

`npm run test:backend` does the same. For the frontend tests:

```bash
npm install
```

```bash
npm run test:ui:install
```

```bash
npm test
```

`npm test` runs the frontend unit and UI tests; `npm run test:unit` and `npm run test:ui` run one of the two. The unit
tests in Node.js need neither the server nor the browsers and take about a second: `npm run test:node` runs only them
(it also writes `test-results-node/scenarios.json`, which
`npm run check:scenarios -- --node test-results-node/scenarios.json` compares with the features). The browser tests
start their own server (port 45290, `LCTY_TEST_PORT` to change it) with an empty data directory in the temporary folder, removed afterwards
(`LCTY_TEST_KEEP_DATA=1` keeps it). `llama-server` is not used: the browser's requests to it are answered by a fake in
`tests/ui/fixtures.js`, so your conversations and models are never touched. Run one browser with
`npm test -- --project='*-chromium'`, or watch the browser tests with `npm test -- --ui`. The unit tests run in
parallel; the UI tests share the server's data directory, so they run one at a time, WebKit's after Chromium's.

`npm run check:biome` lints and checks the formatting (JavaScript, JSON and Markdown) with the Biome version pinned in
`package.json`, as CI does; `npx biome check --write` fixes the formatting. A bare `npx biome` without `npm install`
runs an unrelated npm package named `biome`.

CI runs on Linux. The unit tests in Node.js run on their own, without the server or the browsers
(`.github/workflows/node.yml`). The backend unit tests run inside the dev container `.devcontainer/ruby-2.6.10`, started
from its `devcontainer.json` with the Dev Container CLI (`.github/workflows/backend.yml`; the commands are in LCTYSP-3000). For
the frontend tests, `.devcontainer/ruby-2.6.10/compose.yml` runs the server on its own in the image of that dev container
(`ruby:2.6.10` with the libraries of the `Gemfile`, the versions macOS's `/usr/bin/ruby` has; on a Mac the server needs
neither the `Gemfile` nor Bundler), and the tests are pointed at it with `LCTY_TEST_SERVER_URL`. To do the same by
hand (`--build` rebuilds the image when the `Gemfile` has changed):

```bash
docker compose -f .devcontainer/ruby-2.6.10/compose.yml up --build --detach --wait
```

```bash
LCTY_TEST_SERVER_URL=http://127.0.0.1:45290 npm test
```

```bash
docker compose -f .devcontainer/ruby-2.6.10/compose.yml down
```

Its data directory is emptied whenever the container restarts (`docker compose -f .devcontainer/ruby-2.6.10/compose.yml restart`).

## Documentation

The design is in [docs/specs](docs/specs/README.md) (LCTYSP-0001 to LCTYSP-0011). Start with
[LCTYSP-0001 Architecture](docs/specs/LCTYSP-0001_architecture.md).

## License

[Apache-2.0](LICENSE)
