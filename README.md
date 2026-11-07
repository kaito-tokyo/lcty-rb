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

## UI tests

The UI tests in `tests/ui/` drive the pages in Chromium and WebKit with [Playwright](https://playwright.dev/). Node.js
is needed for the tests only; the server itself still needs nothing installed.

```bash
npm install
```

```bash
npm run test:ui:install
```

```bash
npm run test:ui
```

The tests start their own server (port 45290, `LCTY_TEST_PORT` to change it) with an empty data directory in the
temporary folder, removed afterwards (`LCTY_TEST_KEEP_DATA=1` keeps it). `llama-server` is not used: the browser's
requests to it are answered by a fake in `tests/ui/fixtures.js`, so your conversations and models are never touched.
Run one browser with `npm run test:ui -- --project=chromium`, or watch the tests with `npm run test:ui -- --ui`.

CI runs on Linux: `.devcontainer/ruby-2.6.10/compose.yml` runs the server on its own in the image of that dev container
(`ruby:2.6.10` with the libraries of the `Gemfile`, the versions macOS's `/usr/bin/ruby` has; on a Mac the server needs
neither the `Gemfile` nor Bundler), and the tests are pointed at it with `LCTY_TEST_SERVER_URL`. To do the same by
hand (`--build` rebuilds the image when the `Gemfile` has changed):

```bash
docker compose -f .devcontainer/ruby-2.6.10/compose.yml up --build --detach --wait
```

```bash
LCTY_TEST_SERVER_URL=http://127.0.0.1:45290 npm run test:ui
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
