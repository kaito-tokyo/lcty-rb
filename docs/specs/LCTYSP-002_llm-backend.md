<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-002: LLM backend

- Status: Accepted
- Related: [LCTYSP-001](LCTYSP-001_architecture.md), [LCTYSP-004](LCTYSP-004_editing.md), [LCTYSP-010](LCTYSP-010_data-and-settings.md)

## Summary

The browser streams replies from llama-server through the Responses API and keeps the prefix of every request
identical so that llama-server's prompt cache applies. One llama-server in router mode serves both the chat model and
the embedding model on a single port.

## Responses API

- Requests use `POST /v1/responses` with `stream: true`.
- llama-server does not support `previous_response_id`, so **every request sends `instructions` and the whole history
  as `input`**.
- The reply (`response.output_text.delta`) and the reasoning (`response.reasoning_text.delta`) arrive as separate event
  types. `<think>` never leaks into the reply text.
- `model` must name a model defined in the router (`default` returns 400).

### Client interface (`public/js/llm/client.js`)

```js
stream({ backend, instructions, input, thinking, extraBody, signal })
  // → AsyncIterator<Event>
  //   { type: "reasoning", delta }
  //   { type: "text",      delta }
  //   { type: "done",      usage, timings, incomplete? }   // timings are llama-server specific
  //   { type: "error",     message }
```

- `extraBody` adds parameters to one request only (for example `response_format` for memory proposals,
  [LCTYSP-009](LCTYSP-009_tags-and-memory.md)).
- Stopping is `AbortController`.

### Building the input (`public/js/llm/history.js`)

`buildRequest()` is a pure function that lays out the saved strings mechanically.

| Saved data | Sent as |
|---|---|
| user message | `{"role":"user","content": text}` |
| assistant message | `{"type":"message","role":"assistant","content": text}` (400 without `type`) |
| assistant reasoning | not sent |
| assistant message with an empty body (aborted by an error) | not sent |
| messages copied by a fork (`inherited`) | sent like any other message |
| system prompt | top-level `instructions` |

## Keeping the cache effective

These rules keep the prefix identical from one request to the next:

1. **Send saved content as the exact same string.** No trimming, newline normalization, Markdown reformatting or
   summarizing when sending. The saved string is exactly what was streamed
   ([LCTYSP-003](LCTYSP-003_conversation-file.md) guarantees a byte-exact round trip).
2. **`instructions` is fixed when the conversation starts.** It never contains values that change per request, such as
   the date. Changing it mid-conversation means starting a new conversation.
3. **Past reasoning is never sent.** It is saved, but only reply text goes into the history. Doing this consistently
   keeps the prefix aligned (measured: about 60 tokens recomputed).
4. **Thinking on/off is fixed per conversation.** The chat template embeds it near the start, so switching mid-way
   recomputes everything (measured). `chat_template_kwargs.enable_thinking` is always sent explicitly.
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

These results shape the editing rules in [LCTYSP-004](LCTYSP-004_editing.md). The UI never sends server-specific slot
controls such as `id_slot`, and llama-server keeps its default `--slot-prompt-similarity 0.10`.

## llama-server in router mode

- **A single port (:12345) serves both the chat model and the embedding model.** Configuration is
  `server/llama-router.ini`; `server/start-llama-router.sh` starts it.
- Each model runs as a child process and requests are routed by `model`. CORS, the API key and cache behavior are the
  same as when running a single model (measured).

| Name | File | Main settings | Memory |
|---|---|---|---|
| `gemma-4-26b` | gemma-4-26B-A4B-it-qat-q4_0 (Q4_0) | KV q8_0, mlock, parallel 1 | about 16.5 GB |
| `embeddinggemma-2` | ggml-org/embeddinggemma-2-GGUF (Q8_0) | `embedding`, ctx 8192, batch-size / ubatch-size 8192 | about 0.5 GB |

- **INI sections use short names and models are given as `hf-repo = repository:tag`.** Missing models are downloaded on
  first start, so the start script does not pass `--offline`.
  - `[*]` sets `no-mmproj = true` so the image/audio projector (about 1 GB) is not downloaded.
  - `[*]` sets `dedup-cache-models = true` so the same model does not appear twice in `/v1/models`.
  - A section without `hf-repo` (or `model`) defines a preset without a model, and startup never finishes.
- The embedding model's physical batch (`ubatch-size`, default 512) is raised to the context size, 8192. Embeddings
  process one input in a single batch, so inputs over 512 tokens fail with "input is too large to process" otherwise.
- `--models-max 2` keeps both models loaded. Unloading the chat model would also drop its cache.

## Backend settings

The browser receives one backend from `GET /api/settings` ([LCTYSP-010](LCTYSP-010_data-and-settings.md)):

```json
{ "id": "local", "label": "llama-server", "base_url": "http://localhost:12345",
  "api": "responses", "api_key": "…", "model": "gemma-4-26b",
  "embedding_model": "embeddinggemma-2", "embedding_dim": 768,
  "thinking_kwarg": true, "extra": {} }
```

- `embedding_dim` is fixed by the vector format ([LCTYSP-008](LCTYSP-008_vector-binary.md)) and cannot be configured.
- `thinking_kwarg` controls whether thinking is sent as `chat_template_kwargs.enable_thinking`.

## Verified assumptions

Checked on 2026-11-04 with llama.cpp build 11669:

- `/v1/responses` works, including the streaming event names.
- CORS preflight passes and `Authorization` is allowed.
- Reasoning arrives separately as `reasoning_text.delta` (Gemma needs `enable_thinking`).
- With a single slot, the cache survives switching conversations.
- Router mode behaves the same for CORS, caching and streaming.
- EmbeddingGemma 2 runs on llama.cpp and is accurate enough for natural-language search in Japanese (5–6 of 6
  questions correct).
