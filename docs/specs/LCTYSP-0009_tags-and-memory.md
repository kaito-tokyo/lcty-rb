<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0009: Tags and memory

- Status: Accepted; revision drafted ([Revision draft: one HTML file per tag](#revision-draft-one-html-file-per-tag),
  not implemented)
- Related: [LCTYSP-0002](LCTYSP-0002_llm-backend.md), [LCTYSP-0006](LCTYSP-0006_http-api.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)
- Implementation: `lib/tag_store.rb`, `public/js/tags.js`

## Summary

Conversations can carry tags. A tag has an optional prompt and a list of memory items; before a conversation starts,
the chosen tags compose a draft of the system prompt. After that, tags are only labels for search. Memory is proposed by
the model and added only when the user approves it.

## Tags

- There are no folders ([LCTYSP-0007](LCTYSP-0007_search.md)). Tags both shape a conversation and label it for filtering.
- **Tags are defined beforehand.** A tag has a name, an optional prompt and memory. Names are unique and contain no
  whitespace or `:` (to tell them apart from `tag:name` in search). The order of the definitions is the order in which
  drafts are composed.
- **The system prompt can only be set before the conversation starts.** It is fixed by the first send and saved as the
  conversation's instructions (the cache rule in [LCTYSP-0002](LCTYSP-0002_llm-backend.md)).
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
  take about 4.5 s). The tag editor (the sidebar's タグ button on every page, or the ⚙︎ at the end of the new conversation page's tag list) shows an estimate of the memory size.

### The tags of a conversation

- The tags at start are `<lcty-c>`'s `data-setup-tags`, written once when the conversation is created;
  `lcty-setup`'s `data-instructions` holds the system prompt actually sent. The two are not guaranteed to correspond (tags are a hint).
- **Changing tags later does not touch the conversation file.** The new tags are kept in `tags.sqlite` (table
  `conversation_tags`: the conversation id, the tags as a JSON array in the order given, and when they were set). The
  current tags are that row, or `data-setup-tags` when the tags were never changed
  ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)). Deleting a conversation deletes its row. Tag names need not be
  defined (an undefined one shows as such), and renaming a tag definition does not rename it in conversations.
- The page sends a change as a `tags` line (`POST /v1/conversations/:id/lines`), which the server stores in
  `tags.sqlite` instead of appending it; the search index (`conv_tags`) follows it.
- **For now the header shows the tags at creation** (`data-setup-tags`), also after a change; the current tags live in
  `tags.sqlite`, and the sidebar and search use them ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)).
- Not adopted: appending an `lcty-tags` line to the file on each change. Tags are a hint for search and memory, not
  part of the record of the conversation, and keeping them out of the file keeps the file append-only for messages.
- A fork inherits its source's instructions and current tags ([LCTYSP-0004](LCTYSP-0004_editing.md)).

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
  llama-server keeps a checkpoint before the last user message ([LCTYSP-0002](LCTYSP-0002_llm-backend.md)).
- The targets are the conversation's current tags (including labels added after the start).
- Proposals only add items. Rewriting or removing existing items is not proposed; the user tidies memory in the tag
  editor.

## Storage

> This section describes the current implementation. The
> [revision draft](#revision-draft-one-html-file-per-tag) below moves tag definitions and memory to one HTML file per
> tag; until it is implemented, `tags.sqlite` stays as described here.

Tags and memory are source-of-truth data in `data/tags.sqlite`
([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)):

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

## Revision draft: one HTML file per tag

Status: draft, not implemented. This section records what has been decided for moving tag definitions and memory out
of `tags.sqlite` into one HTML file per tag, and lists what is still open. Where it disagrees with the sections above,
this section is the intended design; the sections above describe the code as it is today.

Scope: tag definitions (name, prompt, order) and memory. The current tags of conversations (`conversation_tags` in
`tags.sqlite`) are not covered here; how conversations refer to tags is open ([open questions](#open-questions)).

### Tag files

- **One file per tag:** `$LCTY_DATA_DIR/t/NNNNN-<file-name part>.html`.
  - `NNNNN` is a 5-digit, zero-padded order prefix. Tags are composed into the draft in file-name order (zero padding
    makes it the numeric order). Numbers are given in steps of 10 (`00010`, `00020`, …), so a tag can be put between
    two others without renaming the rest.
  - The file-name part is derived from the display name (below). Two names with the same file-name part are the same
    tag; the browser rejects a second definition with the same part.
  - **The browser always sends tags in this file-name form** (`00010-ruby.html`), never as a bare display name.
- **The display name is stored inside the HTML.** It keeps its case as the user typed it (after NFC), which the file
  name cannot give back (it is lowercased and escaped). The prompt and the memory items are stored in the same file.
  The server writes the markup ([below](#the-server-writes-the-html)) in the form of
  [Tag file markup](#tag-file-markup).
- Files in `t/` that do not match the tag file pattern (for example the temporary files below) are ignored.

### Tag file markup

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="lcty.v1.js"></script>
<script src="lcty.v1.lang-ja.js"></script>
<link rel="stylesheet" href="lcty.v1.css" />
</head>
<body>
<lcty-t data-tag="タグ名">
<lcty-tagop data-tag="タグ名" data-type="add-memory" data-content="一段落にまとめて"></lcty-tagop>
<lcty-system data-tag="タグ名" data-content="# 指示"></lcty-system>
<lcty-memory id="t-mem-0190…" data-tag="タグ名" data-at="…" data-source-conv="…" data-source-msg="…" data-content="メモリ1"></lcty-memory>
<lcty-memory id="t-mem-0190…" data-tag="タグ名" data-at="…" data-content="メモリ2"></lcty-memory>
</lcty-t>
</body>
</html>
```

- **Not append-only.** Unlike a conversation file ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)), a tag file is
  always rewritten whole (replace-all, add-memory), so `<lcty-t>` is an ordinary element closed with `</lcty-t>`, and
  the order of the lines carries no history.
- **The header** is the same as a conversation file's: `lcty.v1.js`, `lcty.v1.lang-ja.js` and `lcty.v1.css` by relative
  paths, so the file opens on its own (see [the assets](#lcty-v1-assets-in-every-directory) below).
- **`<lcty-t>`** wraps the tag. `data-tag` is the display name (NFC, case kept), the one place the name is stored.
- **Every child repeats `data-tag`,** with the same value, so each element says which tag it belongs to on its own (for
  example when elements of several tags are shown together). The server writes the same name everywhere; a reader uses
  `<lcty-t>`'s.
- **`<lcty-tagop>`: a policy for an operation on the tag.** The decision is that a tag file can carry these elements.
  `data-type` names the operation and `data-content` is the instruction for it; `add-memory` is the memory proposal
  policy (what conversations with this tag should remember and how to write it). At most one `<lcty-tagop>` per
  `data-type`; it is omitted when there is no policy. `data-type` is lowercase letters, digits and `-`; unknown types
  are ignored (and not kept when the server rewrites the file).
  - How the existing [proposal flow](#proposal-flow) uses the `add-memory` policy (instead of, or together with, the
    tag's prompt) is adjusted later.
- **`<lcty-system>`: the tag's prompt,** the part it contributes to the system prompt draft. At most one; omitted when
  the prompt is empty.
- **`<lcty-memory>`: one memory item,** in the order added. `data-content` is the text. `id` is `t-mem-` followed by the
  item id (a UUIDv7 for new items), so it can sit in a URL fragment and never collides with other ids. `data-at` is
  when it was added. `data-source-conv` and `data-source-msg` are the conversation and its last message it was proposed
  from (omitted when there is none).
- **Text strings** (`data-tag`, `data-content`) follow the conversation file's rule: when a string contains characters
  XML cannot represent, it is written as `name-base64` instead
  ([LCTYSP-0003](LCTYSP-0003_conversation-file.md#characters-xml-cannot-represent)). The display name cannot contain
  them (category C is forbidden), so in practice only `data-content` can.
- **No presentation children** for now: the elements are empty, and what is shown comes from `lcty.v1.js`.
- **The JSON of the API** mirrors the markup:
  `{file, name, ops: [{type, content}], prompt, memory: [{id, text, at, source?}]}`
  ([LCTYSP-0006](LCTYSP-0006_http-api.md)).

#### lcty.v1 assets in every directory

- Every directory that holds HTML has its own copy of `lcty.v1.*`, so a page or file refers to them by name alone
  (`lcty.v1.js`). In the data directory: `$LCTY_DATA_DIR/` (the root), `c/` and `t/`, published at startup as `c/` is
  today ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)). On the site: `/`, `/c/` and `/t/`.

### Character handling is the browser's

All Unicode-aware processing (normalization, case mapping, character categories) happens in the browser. Ruby passes
names through untouched and applies only mechanical checks; it uses no Unicode tables (Ruby 2.6's are old, and two
implementations could disagree).

**Display name (checked by the browser):**

- NFC-normalized, then 1–40 code points.
- Forbidden: every character of Unicode general categories Z (separators, including spaces) and C (controls, format
  characters, private use, surrogates, unassigned), and the ASCII characters `` : ; / " ' ` ~ \ | ``.
  - `:` keeps `tag:name` in search unambiguous; `/ \ :` and `" |` are path separators or reserved on common file
    systems; `~` is the escape character of the file-name part, so a name never contains a literal one.
  - Category Cf includes ZWJ, so emoji ZWJ sequences cannot be used in names. Category Cn depends on the browser's
    Unicode version, so a character newer than the browser is rejected there.
- Case is kept in the display name.

**File-name part (derived by the browser):**

```js
let part = name.normalize("NFC").toLowerCase().replaceAll("ς", "σ").normalize("NFC");
part = part.replace(/[!#$%&()*<>?[\]^{}]/g, (c) => "~" + c.charCodeAt(0).toString(16).padStart(2, "0"));
```

- NFC → lowercase (JavaScript `toLowerCase`, with final sigma `ς` mapped to `σ` so that where a sigma stands does not
  change the result) → NFC again (lowercasing can denormalize).
- Then the ASCII symbols `! # $ % & ( ) * < > ? [ ] ^ { }` are escaped as `~` plus two lowercase hex digits:
  `C#` → `c~23`, `100%` → `100~25`, `Ruby` → `ruby`. These characters have meaning in shells, URLs, globs or Windows
  file names. Non-ASCII characters are left as they are.
- **Lowercasing makes the files work on case-insensitive file systems** (APFS and HFS+ by default, NTFS): `Ruby` and
  `ruby` would otherwise be one file there and two files elsewhere.
- Typical names stay far below the 255-byte limit that Ruby checks; escaping triples an ASCII symbol, and lowercasing
  lengthens a few characters (such as `İ`).

**Checks in Ruby (mechanical only),** for each file name in a request:

- starts with 5 ASCII digits and `-`, and ends with `.html`;
- contains no `/`, `\`, `:` or NUL;
- at most 255 bytes, and valid UTF-8;
- the file-name parts (the name without the `NNNNN-` prefix) are unique within the request, compared byte by byte.

Ruby does not normalize, lowercase or otherwise rewrite names; what it writes is exactly what the browser sent.

**Notes:**

- NFC replaces CJK compatibility ideographs (those in U+F900–U+FAFF and U+2F800–U+2FA1F that have a canonical
  decomposition) with the unified ideographs. A user who typed a compatibility ideograph sees the unified one after
  saving.
- HFS+ stores file names decomposed (NFD-like). A name the server reads back from `t/` may therefore not be byte-equal
  to the NFC name the browser sent. The browser NFC-normalizes names it receives before comparing them with its own.
  The server must not rely on byte equality between names it wrote and names it lists either (see "Replace all").
- Possible later addition: the server reports the file system's behaviour (case and normalization sensitivity) to the
  browser, for example by probing `t/` at startup, so the browser can warn about names that would collide there.

### API: get-all and replace-all

Only two operations exist ([LCTYSP-0006](LCTYSP-0006_http-api.md)):

- **Get all:** list `t/`, read every tag file, return them in file-name order. Takes the shared lock.
- **Replace all:** the browser sends the complete set of tag files. Under the exclusive lock the server
  1. checks every file name (above) and rejects the whole request, writing nothing, if one fails;
  2. writes each file to a temporary file in `t/` (a name the listing ignores, for example starting with `.`) and
     renames it into place;
  3. deletes the tag files that were in `t/` before and are not in the request. A file the server has just written is
     never deleted, even when its listed name is not byte-equal to the requested one (HFS+); the server checks this
     mechanically, for example with `File.identical?` against the files it wrote.
- **Locking:** `flock` on `$LCTY_DATA_DIR/t.lock`, exclusive for replace-all, shared for get-all. The lock is global
  (one for all tags).
- **The server has no reorder or rename feature.** Reordering, renaming and editing all send a new complete set
  computed by the browser. The one per-tag operation is adding a memory item
  ([below](#adding-memory-has-its-own-endpoint)).
- Get-all returns an `ETag` and replace-all requires `If-Match`
  ([below](#concurrent-tabs-etag-and-if-match-crashes-are-accepted)).

### Reordering has its own page

- Reordering moves to a separate page at `/t/` ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). The tag editor loses its
  ↑↓ buttons; a tag added in the editor gets the number after the last one (largest + 10).
- The reorder page shows the tags in their current order, lets the user move them, and on save renumbers all of them
  in steps of 10 from `00010` and sends replace-all with the new file names and unchanged contents.
- Draft composition ([above](#composing-the-draft)) uses file-name order instead of the `position` column.

### The server writes the HTML

- The browser sends and receives JSON; the server builds each tag file's HTML from it and parses the files back into
  JSON for get-all, as it does for conversation files ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)). The markup
  and its escaping live in one place (Ruby), and the server can vouch for what is in `t/`.
- The server still does no Unicode processing: the display name, prompt and memory text are stored exactly as sent
  (HTML-escaped), and the file name is the one the browser sent.
- Memory items keep their `id` and `at` through replace-all; an item without `at` gets the current time, as
  `PUT /v1/tags` does today.
- Not adopted: the browser writes the HTML and the server stores the bytes. The markup would live in JavaScript and the
  server could not vouch for the content.

### Adding memory has its own endpoint

- Accepting a proposal uses a small add-memory endpoint ([LCTYSP-0006](LCTYSP-0006_http-api.md)) that names the tag by
  its file name (`00010-ruby.html`, as get-all returned it). Under the exclusive lock on `t.lock`, the server reads that
  one file, appends the item (assigning `id` and `at`), and writes the file back via a temporary file and a rename.
  A file that does not exist (for example renamed or renumbered by another tab) is 404, and the browser gets all again.
- It changes the set, so it changes the set's `ETag` (below): a tab that loaded the tags before the addition cannot
  replace-all over it without getting all again.
- Not adopted: adding memory through replace-all. Every addition would rewrite every file and could undo another tab's
  edits to other tags.
- Editing and deleting memory items stay in the tag editor and go through replace-all.

### Renaming is not a rename

- A rename changes the file-name part, so the tag becomes a different file: the browser sends the new file (carrying
  over the prompt and memory) and leaves out the old one, which replace-all deletes. The server has no notion of a
  rename.
- Conversations that refer to the old name show it as an undefined tag, as they do today after a rename.
- Not adopted: a stable id (for example a UUIDv7) inside each tag file that conversations refer to. It would need the
  id in conversation files or `conversation_tags` and a mapping for `tag:name` in search.

### Concurrent tabs: ETag and If-Match; crashes are accepted

- Get-all returns an `ETag` for the whole set of tag files, computed by the server under the lock from the listed file
  names and their contents (so a change made outside the server also changes it).
- Replace-all requires `If-Match` with that `ETag`. When another tab (or an add-memory request) has changed the set in
  between, it fails with 412 and writes nothing; the browser gets all again and the user redoes the edit on the new
  state. A request without `If-Match` is rejected with 428. A successful replace-all returns the new `ETag`.
- **A crash during replace-all is accepted:** it can leave a mix of old and new files. Each file itself is whole, thanks
  to the temporary file and rename.
- Not adopted for now: writing the whole set to `t.new/` and swapping directories with recovery at startup. It can be
  added later without changing the API.

### Open questions

To be settled before implementation.

1. **Conversation references and migration.**
   - References: conversations (`data-setup-tags`, `conversation_tags`, `tag:name` in search) would use the file-name
     part without the number (`c~23`), which does not change when tags are reordered. Existing references hold
     display names; since the derivation is deterministic, the browser can map them when reading, without rewriting
     conversation files.
   - Migration from `tags.sqlite`: (a) the server converts at startup (but then Ruby needs the lowercase and escape
     rules, against "character handling is the browser's"); (b) the browser converts: the server exposes the old tags
     once, the browser derives the file names and sends replace-all, and the server then moves `tags.sqlite` out of
     the way; (c) a separate one-off script. What happens to `conversation_tags` is decided together with the
     reference form.

Not yet discussed: whether tag files are served at a URL (for example `/t/NNNNN-<name>.html`, beside the reorder
page) or only through the API; how the proposal flow uses the `add-memory` policy (adjusted later); the updates to
[LCTYSP-0010](LCTYSP-0010_data-and-settings.md) (`t/`, `t.lock`) and to the tests (LCTYSP-3005).
