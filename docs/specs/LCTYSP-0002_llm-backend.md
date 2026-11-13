<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0002: LLM backend

- Status: Accepted
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md), [LCTYSP-0004](LCTYSP-0004_editing.md), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)

## Summary

The browser streams replies from llama-server through the Responses API and keeps the prefix of every request
identical so that llama-server's prompt cache applies. One llama-server in router mode serves the chat model on a
single port. The embedding model is not the router's: lcty.rb starts a llama-server of its own for it
([LCTYSP-0019](LCTYSP-0019_server-embedding.md)).

## Responses API

- Requests use `POST /v1/responses` with `stream: true`.
- llama-server does not support `previous_response_id`, so **every request sends `instructions` and the whole history
  as `input`**.
- The reply (`response.output_text.delta`) and the thinking (`response.reasoning_text.delta`) arrive as separate event
  types. `<think>` never leaks into the reply text.
- `model` must name a model defined in the router (`default` returns 400).

### Client interface (`public/js/llm/client.js`)

```js
stream({ backend, instructions, input, extraBody, signal });
// → AsyncIterator<Event>
//   { type: "thinking", delta }
//   { type: "text",      delta }
//   { type: "done",      usage, timings, incomplete? }   // timings are llama-server specific
//   { type: "error",     message }
```

- `extraBody` adds parameters to one request only (for example `response_format` for memory proposals,
  [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)).
- Stopping is `AbortController`.

### Building the input (`public/js/llm/history.js`)

`buildRequest()` is a pure function that lays out the saved strings mechanically.

| Saved data                                                 | Sent as                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| user message                                               | `{"role":"user","content": text}`                                            |
| assistant message                                          | `{"type":"message","role":"assistant","content": text}` (400 without `type`) |
| assistant thinking                                         | not sent                                                                     |
| assistant message with an empty body (aborted by an error) | not sent                                                                     |
| messages copied by a fork (`inherited`)                    | sent like any other message                                                  |
| system prompt                                              | top-level `instructions`                                                     |

## Keeping the cache effective

These rules keep the prefix identical from one request to the next:

1. **Send saved content as the exact same string.** No trimming, newline normalization, Markdown reformatting or
   summarizing when sending. The saved string is exactly what was streamed
   ([LCTYSP-0003](LCTYSP-0003_conversation-file.md) guarantees a byte-exact round trip).
2. **`instructions` is fixed when the conversation starts.** It never contains values that change per request, such as
   the date. Changing it mid-conversation means starting a new conversation.
3. **Past thinking is never sent.** It is saved, but only reply text goes into the history. Doing this consistently
   keeps the prefix aligned (measured: about 60 tokens recomputed).
4. **Thinking is not switched by the UI.** Requests carry no `chat_template_kwargs.enable_thinking`: whether the model
   thinks is llama-server's (its defaults and chat template; with the bundled setup Gemma 4 thinks). The chat template
   embeds it near the start, so switching it mid-way would recompute everything (measured); leaving it to the server
   keeps it the same for every request.
5. **Sampling settings (temperature etc.) are not handled by the UI.** They are left out of requests and use
   llama-server's defaults (the model's recommended values).
6. **History is never truncated silently.** Dropping old messages changes the prefix. The context is 262k tokens; any
   reduction has to be an explicit operation.
7. **Known limitation: the previous reply is recomputed every turn.** Gemma 4's template inserts a thinking block (an
   empty one when thinking is off) at generation time but not when rendering history. This cannot be avoided on the
   client. The cost is about the length of the previous reply and does not grow with the conversation.

### Cache behavior around editing

Measured on a 16k-token conversation:

- Continuing from a user message whose prefix is unchanged costs **0.1–0.6 s**. llama-server keeps a checkpoint just
  before each user message.
- **Returning to an abandoned branch can take tens of seconds** (34–54 s), because the server-side cache is overwritten
  by the branch used last.
- **Editing an assistant message in the middle recomputes thousands of tokens** (24 s). Sliding-window models can only
  roll back to the previous checkpoint.

These results shape the editing rules in [LCTYSP-0004](LCTYSP-0004_editing.md). The UI never sends server-specific slot
controls such as `id_slot`, and llama-server keeps its default `--slot-prompt-similarity 0.10`.

## llama-server in router mode

- **A single port serves the chat model.** Configuration is `llm-backend/llama-cpp.ini`;
  `llm-backend/run-llama-cpp.sh` starts it. The section `[embeddinggemma-2]` left it when the server took over
  embedding (LCTYSP-0019): left there, the model would be loaded twice. The table below keeps its settings, which
  lcty.rb's own llama-server uses.
- Each model runs as a child process and requests are routed by `model`. CORS, the API key and cache behavior are the
  same as when running a single model (measured).

| Name               | File                                  | Main settings                                        | Memory        |
| ------------------ | ------------------------------------- | ---------------------------------------------------- | ------------- |
| `gemma-4-26b`      | gemma-4-26B-A4B-it-qat-q4_0 (Q4_0)    | KV q8_0, mlock, parallel 1                           | about 16.5 GB |
| `embeddinggemma-2` | ggml-org/embeddinggemma-2-GGUF (Q8_0) | `embedding`, ctx 8192, batch-size / ubatch-size 8192 | about 0.5 GB  |

- **INI sections use short names and models are given as `hf-repo = repository:tag`.** Missing models are downloaded on
  first start, so the start script does not pass `--offline`.
  - `[*]` sets `no-mmproj = true` so the image/audio projector (about 1 GB) is not downloaded.
  - `[*]` sets `dedup-cache-models = true` so the same model does not appear twice in `/v1/models`.
  - A section without `hf-repo` (or `model`) defines a preset without a model, and startup never finishes.
- The embedding model's physical batch (`ubatch-size`, default 512) is raised to the context size, 8192. Embeddings
  process one input in a single batch, so inputs over 512 tokens fail with "input is too large to process" otherwise.
- `--models-max 2` keeps both models loaded. Unloading the chat model would also drop its cache.

## Backend settings

The browser builds one backend from its settings ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)):

```json
{
	"id": "local",
	"label": "llama-server",
	"base_url": "http://127.0.0.1:9931",
	"api": "responses",
	"api_key": "…",
	"model": "gemma-4-26b-a4b-it",
	"extra": {}
}
```

- The embedding model is not a backend setting: the server embeds ([LCTYSP-0019](LCTYSP-0019_server-embedding.md)).

## Verified assumptions

Checked on 2026-11-04 with llama.cpp build 11669:

- `/v1/responses` works, including the streaming event names.
- CORS preflight passes and `Authorization` is allowed.
- Thinking arrives separately as `reasoning_text.delta`. Without `enable_thinking` in the request Gemma 4 still thinks
  (checked on 2026-11-06).
- With a single slot, the cache survives switching conversations.
- Router mode behaves the same for CORS, caching and streaming.
- EmbeddingGemma 2 runs on llama.cpp and is accurate enough for natural-language search in Japanese (5–6 of 6
  questions correct).
