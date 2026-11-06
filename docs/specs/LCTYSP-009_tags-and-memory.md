<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-009: Tags and memory

- Status: Accepted
- Related: [LCTYSP-002](LCTYSP-002_llm-backend.md), [LCTYSP-006](LCTYSP-006_http-api.md), [LCTYSP-007](LCTYSP-007_search.md), [LCTYSP-010](LCTYSP-010_data-and-settings.md)
- Implementation: `lib/tag_store.rb`, `public/js/tags.js`

## Summary

Conversations can carry tags. A tag has an optional prompt and a list of memory items; before a conversation starts,
the chosen tags compose a draft of the system prompt. After that, tags are only labels for search. Memory is proposed by
the model and added only when the user approves it.

## Tags

- There are no folders ([LCTYSP-007](LCTYSP-007_search.md)). Tags both shape a conversation and label it for filtering.
- **Tags are defined beforehand.** A tag has a name, an optional prompt and memory. Names are unique and contain no
  whitespace or `:` (to tell them apart from `tag:name` in search). The order of the definitions is the order in which
  drafts are composed.
- **The system prompt can only be set before the conversation starts.** It is fixed by the first send and saved as the
  conversation's instructions (the cache rule in [LCTYSP-002](LCTYSP-002_llm-backend.md)).
- **Tags are only a hint.** Choosing tags before starting composes a draft into the system prompt field; the user may
  edit it freely. What is sent is exactly the final content of that field.
- **Adding or removing tags after the start does not change the system prompt.** Such changes only act as labels for
  search. To change the system prompt, start a new conversation (a fork inherits its source's system prompt).
- **Editing a tag's prompt later does not affect existing conversations.** They store the fixed system prompt itself, so
  edits apply from the next draft. The cache and reproducibility are preserved.
- Tags carry only a prompt and memory. The model is not tied to tags.
- Deleting a tag definition keeps the name on conversations (shown as an undefined tag).

### Composing the draft

```
draft = for each chosen tag, in definition order, joined with "\n\n":
          the tag's prompt (trimmed; omitted when empty)
          if the tag has memory:
            "# メモリ（{tag name}）\n" + one "- {text}" line per item (in the order added)
```

- The order is the definition order, not the order of clicks. The same tags and memory always give the same draft, so
  starting without edits keeps the prefix identical and llama-server's in-RAM prompt cache can apply even across
  conversations.
- Changing tags before the start recomposes the draft and replaces the field. Once the user has edited the field by
  hand it is not replaced (so their text is not lost); a "Rebuild from tags" button appears instead.
- More memory makes the first send of a new conversation heavier (prompt processing is about 450 tok/s, so 2,000 tokens
  take about 4.5 s). The tag editor (the ⚙︎ at the end of the new conversation page's tag list) shows an estimate of the memory size.

### The tags of a conversation

- The tags at start are `<lcty-c>`'s `data-setup-tags`, written once when the conversation is created;
  `lcty-setup`'s `data-instructions` holds the system prompt actually sent. The two are not guaranteed to correspond (tags are a hint).
- **Changing tags later does not touch the conversation file.** The new tags are kept in `tags.sqlite` (table
  `conversation_tags`: the conversation id, the tags as a JSON array in the order given, and when they were set). The
  current tags are that row, or `data-setup-tags` when the tags were never changed
  ([LCTYSP-003](LCTYSP-003_conversation-file.md)). Deleting a conversation deletes its row. Tag names need not be
  defined (an undefined one shows as such), and renaming a tag definition does not rename it in conversations.
- The page sends a change as a `tags` line (`POST /v1/conversations/:id/lines`), which the server stores in
  `tags.sqlite` instead of appending it; the search index (`conv_tags`) follows it.
- **For now the header shows the tags at creation** (`data-setup-tags`), also after a change; the current tags live in
  `tags.sqlite`, and the sidebar and search use them ([LCTYSP-005](LCTYSP-005_page-and-elements.md)).
- Not adopted: appending an `lcty-tags` line to the file on each change. Tags are a hint for search and memory, not
  part of the record of the conversation, and keeping them out of the file keeps the file append-only for messages.
- A fork inherits its source's instructions and current tags ([LCTYSP-004](LCTYSP-004_editing.md)).

## Memory

- **A tag has memory:** a bullet list of what conversations with that tag should remember.
- **What to remember is instructed by the tag's prompt.** The UI has no memory policy of its own (for example, a "ruby"
  tag's prompt can say "remember the design decisions made and the constraints discovered").
- **Memory is proposed by the model and added only when the user approves.** It never grows by itself.
- **Memory enters the system prompt draft when a conversation starts.** After the start it is fixed; new memory does not
  change that conversation's system prompt.

### Proposal flow

```
User:          presses "Propose memory" in a conversation (never automatic)
UI → llm:      the current conversation (instructions + whole history) plus one temporary user message:
                 "From this conversation, propose what should be added to the memory of these tags, following the
                  system prompt's policy. Tags and current memory: … (do not propose duplicates)"
               response_format (JSON Schema) fixes the reply to {proposals: [{tag, text}]}
llm → UI:      the proposals
UI:            shows each proposal with accept / edit and accept / discard
UI → storage:  POST /v1/tags/:name/memory for each accepted one
```

- **The temporary message is never saved** and does not enter the history.
- **It is sent as a continuation, so the cache applies.** The prefix (instructions and the whole history) equals the
  previous state, so only the temporary message is computed. Continuing the conversation afterwards is also cheap, since
  llama-server keeps a checkpoint before the last user message ([LCTYSP-002](LCTYSP-002_llm-backend.md)).
- The targets are the conversation's current tags (including labels added after the start).
- Proposals only add items. Rewriting or removing existing items is not proposed; the user tidies memory in the tag
  editor.

## Storage

Tags and memory are source-of-truth data in `data/tags.sqlite`
([LCTYSP-010](LCTYSP-010_data-and-settings.md)):

```sql
CREATE TABLE tags (name TEXT PRIMARY KEY, prompt TEXT, position INTEGER NOT NULL);  -- position = draft order
CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE ON DELETE CASCADE,
  text TEXT NOT NULL, at TEXT NOT NULL, source_conv TEXT, source_msg TEXT);
```

- **Why SQLite:** memory is added, edited and deleted one item at a time, which suits row updates better than rewriting
  a whole JSON file. Transactions and foreign keys guarantee that memory follows a renamed tag.
- **A separate file from the index.** The index is derived and tags are the source of truth, so they live in separate
  files and the derived file can be deleted on its own. SQLite is a stable format and is fine for source-of-truth data.
- **Format changes migrate instead of rebuilding.** `PRAGMA user_version` decides which migrations to run; a newer
  version than the code knows is an error at startup (deleting would lose data).
- Saving the tag editor (`PUT /v1/tags`) is one transaction: create tags under new names first, move memory to them,
  then delete tags that disappeared (which also handles renames).
- `source` (`source_conv`, `source_msg`) records the conversation and its last message when the item was proposed, so
  an item can link back to where it came from.

API shape:

```json
{
	"tags": [
		{
			"name": "ruby",
			"prompt": "Answer with Ruby 2.6's standard library only. Remember design decisions and discovered constraints.",
			"memory": [
				{
					"id": "mem-3f9a…",
					"text": "WEBrick paths and query values are ASCII-8BIT; convert to UTF-8 before SQLite",
					"at": "…",
					"source": { "conv_id": "…", "msg_id": "…" }
				}
			]
		}
	]
}
```
