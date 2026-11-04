<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-004: Editing a conversation

- Status: Accepted
- Related: [LCTYSP-002](LCTYSP-002_llm-backend.md), [LCTYSP-003](LCTYSP-003_conversation-file.md), [LCTYSP-006](LCTYSP-006_http-api.md)

## Summary

Conversations are append-only. One operation may destructively remove at most the last turn; to change anything earlier
while keeping the original, the user forks. Editing assistant messages is not offered.

## Rules

1. **Conversations are not rewound in principle.** Conversation files are only appended to.
2. **Exception: one operation may destructively remove the last turn** (the last user message and the replies after it).
   The only constraint is "at most one turn per operation"; repeating it goes back any number of turns, down to the
   start.
   - **Undo** removes the last user message and its reply and puts the user message back into the composer.
   - **Regenerate** removes only the last reply and generates it again.
   - **Editing the last message** is undo, fix it in the composer, and send (also the way to retry after a stop or an
     error).
   - In every case the remaining part is the prefix of the previous state, so the cache applies (measured: regenerate
     0.07–0.16 s, edit and resend about 0.3 s).
   - What was removed is gone; there is no redo.
   - The rule limits what one mistake can lose to one turn. The server enforces it in `pop`.
3. **To change an earlier point while keeping the original, fork.** "Fork from here" is offered on user messages and can
   start from any point in one operation (the original is not cut, so rule 2 does not apply). It creates a new
   conversation that **copies** everything before that message (excluding the message itself); the edited message is
   then sent there. The original stays as it is.
   - Copied messages get `inherited: true`. The search index skips them so the same content is not found twice
     ([LCTYSP-007](LCTYSP-007_search.md)).
   - The new conversation's meta records `forked_from: {id, at}` (the source conversation and the index it forked at).
     `instructions` and `thinking` are taken over from the source, and so are its current tags.
   - Each file stands on its own: deleting the source does not break the fork.
4. **Editing assistant messages is not offered.**
5. **Returning to the original after a fork can be slow.** Forking is fast, but continuing the original conversation
   afterwards may need a recompute ([LCTYSP-002](LCTYSP-002_llm-backend.md)).

## Server-side check (`pop`)

`POST /api/conversations/:id/pop` with `{"from": n}` deletes the messages from index `n` (0-based, counting messages
only). **If `n` is before the last user message, it is rejected with 409.**

- `title` and `tags` elements after the cut are kept.
- The file is rewritten through a temporary file and `rename` ([LCTYSP-003](LCTYSP-003_conversation-file.md)).
- Ruby checks only this one rule; it does not otherwise know what the messages mean.

## Sequences

### One turn

```
User → UI:      send
UI   → llm:     POST /v1/responses (stream)          sent at once, without waiting for the save
UI   → storage: POST …/lines [user]                  saved in parallel (on failure only a warning)
llm  → UI:      reasoning/text deltas, drawn once per animation frame
llm  → UI:      completed (timings)
UI   → storage: POST …/lines [assistant]
```

A stopped or failed generation is also appended, with what was received so far and `status: "incomplete"`. Leaving the
page while generating would lose the partial reply, so a `beforeunload` confirmation is shown only during generation.

The first send from a new conversation (`/c/`) creates the file and switches the URL to `/c/<id>.html` with
`history.replaceState`, without reloading, so streaming continues.

### Fork from here

```
User → UI:      "Fork from here" on user message #n
UI:             navigates to /c/?fork=<id>&at=<n>
UI   → storage: GET /api/conversations/<id>
UI:             shows messages 0..n-1 (inherited) and puts message #n into the composer
User → UI:      edit and send
UI   → storage: POST /api/conversations
                  { meta: { instructions/thinking/tags of the source, forked_from: {id, at: n} },
                    lines: messages 0..n-1 with inherited: true }
UI:             continues with "one turn"
```
