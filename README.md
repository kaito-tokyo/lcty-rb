<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# lcty-rb

A personal chat web UI for [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server`, served by a small
Ruby server on your own machine. Conversations are plain HTML files you can open, back up and keep.

- Chat with a local model, with or without thinking; undo, regenerate and fork from any message.
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

Start the server and open http://127.0.0.1:8765/:

```bash
/usr/bin/ruby chatty.rb
```

The browser talks to `llama-server` directly; the Ruby server serves the pages and keeps the conversations, the tags
and the search index.

## Settings

- Server: only the environment variables `PORT` (default 8765) and `LCTY_DATA_DIR` (default `data/`).
- Everything else (the `llama-server` URL, API key, model names, thinking) is set on `/settings` and stored in the
  browser. The default API key is `<hostname>-<user>`, the same as `run-llama-cpp.sh` uses.

## Data

Everything is in `data/`:

- `c/<id>.html`: one file per conversation. Opened through the server (`/c/<id>.html`) it shows as the conversation.
- `tags.sqlite`: tag definitions, memory and tag changes.
- Files starting with `_` are derived (the search index, the vectors) and are rebuilt when deleted.

Back up everything that does not start with `_`:

```bash
rsync -a --exclude='_*' data/ backup/
```

## Documentation

The design is in [docs/specs](docs/specs/README.md) (LCTYSP-001 to LCTYSP-011). Start with
[LCTYSP-001 Architecture](docs/specs/LCTYSP-001_architecture.md).

## License

[Apache-2.0](LICENSE)
