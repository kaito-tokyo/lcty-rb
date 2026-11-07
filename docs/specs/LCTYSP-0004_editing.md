<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0004: Editing a conversation

- Status: Accepted
- Related: [LCTYSP-0002](LCTYSP-0002_llm-backend.md), [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0006](LCTYSP-0006_http-api.md)

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
     ([LCTYSP-0007](LCTYSP-0007_search.md)).
   - `instructions` is taken over from the source, and so are its current tags. The new conversation
     does not record where it was forked from.
   - Each file stands on its own: deleting the source does not break the fork.
4. **Editing assistant messages is not offered.**
5. **Returning to the original after a fork can be slow.** Forking is fast, but continuing the original conversation
   afterwards may need a recompute ([LCTYSP-0002](LCTYSP-0002_llm-backend.md)).

## Server-side check (`pop`)

`POST /v1/conversations/:id/pop` with `{"from": n}` deletes the messages from index `n` (0-based, counting messages
only). **If `n` is before the last user message, it is rejected with 409.**

- `title` and `tags` elements after the cut are kept.
- The file is rewritten through a temporary file and `rename` ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)).
- Ruby checks only this one rule; it does not otherwise know what the messages mean.

## Sequences

### One turn

```
User → UI:      send
UI   → storage: POST …/lines [user]                  saved in parallel (on failure only a warning)
UI:             appends a volatile <lcty-cmd data-op="send"> to the DOM, which runs at once:
UI   → llm:     POST /v1/responses (stream)          sent at once, without waiting for the save
llm  → UI:      thinking/text deltas, drawn once per animation frame
llm  → UI:      completed (timings)
UI   → storage: POST …/lines [assistant]
```

A stopped or failed generation is also appended, with what was received so far and `status: "incomplete"`. Leaving the
page while generating would lose the partial reply, so a `beforeunload` confirmation is shown only during generation.

### Starting a conversation

```
User → UI:      on / (the top page): choose tags, edit the system prompt draft, write the first message
User → UI:      send
UI:             decides the conversation id
UI   → storage: POST /v1/conversations { meta, lines: [title, (inherited messages,) the first message, <lcty-cmd data-op="send">] }
UI:             moves to /c/<id>.html
UI (/c/<id>.html): the file ends with the send command → generates the reply at once
```

- Sending decides the id, so the URL is decided too and the page moves to it. The new conversation page only creates;
  the conversation page generates.
### Commands: deferred and volatile execution

An operation to run is a command tag, `<lcty-cmd data-op="…">`, and a command is a command object: when it becomes the
last element of `<lcty-c>`, it runs its operation and is responsible for it (while running it floats above the
composer with a spinner and a stop button, and can be aborted; [LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). **How it is appended controls when it runs:**

| Appended to                                       | Execution                                                                                          | Used for                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| the file (and so the DOM when the file is opened) | **Deferred**: runs whenever the conversation is opened while the command is still the last element | creating a conversation (`send`): a creation interrupted before its reply was saved resumes on the next open |
| the DOM only (in memory)                          | **Volatile**: runs now; nothing is left to resume after the page closes                            | sending and regenerating (`send`)                                                                            |

- The result is appended after the command, so a command that is no longer last has already run and stays hidden.
- Today the only operation is `send`: generate a reply to the last user message (nothing happens when the last
  message is not a user message). Unknown operations are ignored.
- Only creation writes a command to the file (the append API does not accept command lines).
- Undoing a turn removes the command along with the turn. Regenerating pops the reply and appends a new volatile
  `send`.

### Fork from here

```
User → UI:      "Fork from here" on user message #n
UI:             navigates to /?fork=<id>&at=<n>
UI   → storage: GET /v1/conversations/<id>
UI:             fills in the source's system prompt and tags, notes "forked from …" and puts message #n into
                the composer (messages 0..n-1 are not shown; they are copied when sending)
User → UI:      edit and send
UI   → storage: POST /v1/conversations
                  { meta: { instructions/tags of the source },
                    lines: [title, messages 0..n-1 with inherited: true, message #n, <lcty-cmd data-op="send">] }
UI:             moves to /c/<id>.html, which generates the reply
```
