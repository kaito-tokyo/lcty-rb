<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0003: Conversation file

- Status: Accepted; revision drafted ([Revision draft: `lcty-msg`](#revision-draft-lcty-msg), not implemented)
- Related: [LCTYSP-0004](LCTYSP-0004_editing.md), [LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md)
- Implementation: `lib/conv_html.rb`, `lib/store.rb`

## Summary

Each conversation is one append-only file, `data/c/<id>.html`. The file is an HTML document that opens as the
conversation page by itself, and, apart from its first line, a well-formed XML fragment of custom elements. Text that
is sent back to the model lives in attributes (the source of truth); child elements hold presentation HTML.

## Why HTML

JSONL's one-record-per-line rule only works around the fact that JSON cannot be appended to. HTML can be appended to by
adding sibling elements at the end, keeps newlines in text as they are, and can be rendered directly as the
conversation page ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)).

## File layout

```html
<!DOCTYPE html><html lang="ja" />
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><script src="lcty.v1.js"></script><script src="lcty.v1.lang-ja.js"></script><link rel="stylesheet" href="lcty.v1.css" /></head>
<title id="__512">Title</title><!--7890123456789…34567890<!---->
<lcty-c id="c-20261104-…" data-setup-tags="ruby concise" data-created-at="…" />
<lcty-setup data-instructions="system prompt"></lcty-setup>
<lcty-message id="c-msg-0190…" data-role="user" data-at="…" data-content="user text"><div class="user-text">user text</div></lcty-message>
<lcty-message id="c-msg-0190…" data-role="assistant" data-status="completed" data-at="…" data-timings="{…}" data-client="{…}" data-content="# Heading&#10;…" data-thinking="thoughts"><article data-generator="lcty.v1"><h1>Heading</h1>…</article></lcty-message>
```

- **Rule: lines 1 to 4 are the head; the elements start on line 5.** Ruby reads the head lines on their own (the title
  slot on line 3 and the attributes of `<lcty-c>` on line 4), and the element parser sees lines 5 and later, a
  well-formed XML fragment (`<!DOCTYPE html>` and `<head>` are not XML). Every head line is complete on one line.
- **Lines 1 and 2 are a fixed header.** Line 1 is `<!DOCTYPE html><html lang="ja" />`; line 2 is the `<head>`, ending
  with `</head>`. It loads `lcty.v1.js` (the element definitions, which define the elements at its end) and
  `lcty.v1.lang-ja.js` (the Japanese texts, registered with `LctyT`), in that order, as classic scripts, and links the
  stylesheet. These names are permanent: over HTTP, `/c/` redirects each to its file in `/lcty.v1/`
  ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). The page's features, `lcty.v1.module.js`, are not in the header: `<lcty-c>` imports them once the page
  has loaded, so they never block rendering ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)). There is no inline script. The
  `/>` on `<html>` (and on `<lcty-c>`) is ignored by the HTML parser. Opened over HTTP, the file shows as the
  conversation.
- **Opened directly (`file://`, offline), the file still shows as the conversation.** It needs nothing but
  `lcty.v1.js` and `lcty.v1.css` next to it in `data/c/`, loaded by relative paths from line 2 (no Shadow DOM loads
  anything of its own, [LCTYSP-0005](LCTYSP-0005_page-and-elements.md)): the classic script builds the frame. Only
  reading is supported there, and every error is left as it is: the language script is not next to it (the frame shows
  the English x-default texts; the conversation itself is in the file), and importing the module fails (browsers refuse
  module scripts from `file://`, whose origin is `null`), so nothing is sent, nothing reaches the LLM server, and the
  sidebar's list is empty unless that origin has its own cached copy. None of this is needed to read it.
- **The head lines (1 to 4) hold only what a list of conversations needs:** the title, the id, the tags at creation and
  the creation time. Collecting them is enough to build the sidebar's database (`GET /v1/meta-all.json` reads only
  these lines of each file, [LCTYSP-0006](LCTYSP-0006_http-api.md)). The system prompt, which may be long, is not among
  them; it is on line 5.
- **Line 3 is the title slot:** `<title id="__512">[begin]…[end]<!---->`. The `<title>` comes after `</head>`; the
  parser moves it into the head, so it is the document's own title (the tab shows it even without JavaScript). The id
  carries the length of the slot right next to it: the slot is the 512 bytes from `[begin]` (just after the `>` of the
  opening tag) to `[end]` (just before the fixed `<!---->`, which is never overwritten). Ruby reads the title from the
  slot.
- **The slot is built from a ruler.** A blank slot is 512 digits aligned so that the last one is always `0`
  (`…7890`, just before `<!---->`, so a broken slot is easy to spot). Writing a title overwrites the head of the slot
  with `escaped title</title><!--`: the rest of the ruler and the `<!---->` after it become a comment. Digits never form
  `--`, so whatever the title, the comment always closes at the last `>` (when the ruler is used up it reads
  `<!--<!---->`, a harmless nested-comment parse error) and the slot keeps its length. The longest escaped title is
  therefore 500 bytes.
- **Line 4 is the frame, `<lcty-c … />`, whose attributes are what the frame needs to know.** They are written once,
  when the conversation is created, and never change (line 4 is never rewritten):
  - `id`: `c-` followed by the conversation id (see the id prefixes below);
  - `data-setup-tags`: the tags the conversation was created with (space separated, omitted when empty). **Tag
    changes are not written to the file:** they are kept in `tags.sqlite`, and the current tags are those, or these
    when the tags were never changed ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md));
  - `data-created-at`: when the conversation was created.

  In HTML the `/>` is ignored, so `<lcty-c>` stays open until the end of the file and every element from line 5 on
  becomes its child: appending is just writing at the end. As XML the line is a complete element on its own. Nothing
  else about a conversation is recorded: not the backend (the browser always uses its default backend) and not the
  conversation it was forked from.
- **Line 5 is `lcty-setup`**, the system prompt (see Elements).
- **Older heads are rewritten at startup.** Before 2026-11-07 the head was three lines starting with `<!` (the header
  with `data-lcty-tlrange`, then `<!--lcty-meta-->` with the title slot and with a never-closed `<lcty-c>`, which could
  also carry `data-thinking`). The server still reads that format, and at startup it rewrites every file whose head is
  not the current one (also a head edited by hand, or a header, lines 1 and 2, that has changed since), keeping what it holds and its modification time.
- **The title** is the current conversation title. Newlines become spaces. The escaped title is cut at a character
  boundary so it fits the slot (about 160 Japanese characters). Changing the title overwrites the slot in place (seek
  to its start, write exactly its length, fsync) under the file lock, so the rest of the file stays append-only. When
  the file has no valid slot, the whole file is rewritten instead.
- **Titles come from replies.** The system prompt asks the chat model to start every reply with a level-1 heading
  (`# タイトル`). This is best effort: when the first line of a reply is such a heading, the page sets it as the title.
  The heading stays in the reply's content, so the history sent back is exactly what the model wrote (the cache
  applies). Before the first reply the title is the first 30 characters of the first message; editing the title field
  by hand also overwrites the slot, and whichever comes later wins.
- **Rendering reads the title only from `<title>`.** The heading rule is applied once, when a reply is received: the
  page writes the title (into the slot) and puts the same text into the page's `<title>`. Nothing derives a title from
  the messages when a file is opened or listed, and nothing is added to it (no site name).
- **Lines 5 and later** are elements, one per line, separated by a single newline.
- **Element ids carry a prefix that may be added and removed freely.** The identity is the bare id (the conversation
  id, the message UUIDv7). As an element `id` it is written with a prefix, `c-` for `<lcty-c>` and `c-msg-` for
  `lcty-message`, only so that it can sit in a URL fragment and in CSS selectors and never collides with other ids in the
  document. Readers strip the prefix, writers add it, and everything else (the API, the index) uses the
  bare id.
- Ids are limited to `[A-Za-z0-9_-]`. Files whose names are not valid ids (copies such as `… copy.html`) are skipped
  with a warning.

## Elements

| Element        | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`      | The title, in the slot on line 3 (not an element of the body); changing it overwrites the slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `lcty-setup`   | The system prompt actually sent: `data-instructions` (or `data-instructions-base64`). Written on line 5 when the conversation is created. **Written exactly once and never overridden:** only the first `lcty-setup` counts, and a later one is ignored.                                                                                                                                                                                                                                                                                                                                                                   |
| `lcty-cmd`     | A command tag: an operation to run, abstracted as `data-op` (lowercase letters, digits and `-`) with `data-at`. A command written to the file runs when the file is opened while it is still the last element (deferred execution); commands appended only in memory never reach the file (volatile execution). Unknown operations are ignored. Today only `send`, written as the last line when a conversation is created ([LCTYSP-0004](LCTYSP-0004_editing.md)). Shown only while running (spinner and stop).                                                                                                           |
| `lcty-message` | One message. `id` is `c-msg-` followed by the message UUIDv7, so `#c-msg-…` links to the element. Attributes: `data-role`, `data-at`, `data-status`, `data-error`, `data-inherited`; JSON attributes `data-timings`, `data-client`, `data-usage`. Text is `data-content`, thinking is `data-thinking` (each `-base64` when needed, see below). Children are presentation: `div.user-text` for the user and `<article>` for the assistant. **Thinking has no presentation in the file**: it is `data-thinking` only, since it is not needed to read the conversation, and the page shows it (collapsed) from the attribute. |

- `data-status` is `completed` or `incomplete` (stopped or failed). A generating message is not written; it is appended
  once complete.
- `data-timings` is shown on screen and used for debugging. Whether the cache applied is visible in `cache_n`
  (`usage.cached_tokens` stays 0 and cannot be trusted).
- `data-inherited="true"` marks a message copied from the fork source ([LCTYSP-0004](LCTYSP-0004_editing.md)).

### Message ids

- Message ids are **UUIDv7** in canonical lowercase form. The first 48 bits are milliseconds, so ids sort roughly by
  creation time. They are 16 bytes in the vector binary ([LCTYSP-0008](LCTYSP-0008_vector-binary.md)).
- Both the browser (`newMsgId`) and Ruby (`Uuid.v7`) create them. Ruby rejects message ids that are not UUIDv7 with
  400 and assigns one to a message that has none.
- A fork copies messages with their ids unchanged.
- Conversation ids (`20261104-102300-a1b2`) are file names and are not UUIDs.

## Dual recording: text in attributes, presentation in children

- **Attributes are the source of truth.** An LLM reply is fundamentally a string without structure, which fits a single
  attribute value. `getAttribute` returns it exactly as written, unaffected by HTML parsing rules (such as the dropped
  newline after `<pre>`), and it is complete as soon as the element exists (child text arrives as parsing proceeds).
  Newline, tab and CR become `&#10;`, `&#9;` and `&#13;`; `<`, `&` and `"` become character references.
- Round trips were verified for 14 tricky cases (CR, CRLF, C1 controls, noncharacters, U+FFFD, emoji, U+2028, BOM, the
  literal string `&#0;`, …): both Ruby (XML) and the browser (HTML) read back the original string.
- **Children are for display.** Without scripts the file still reads as a conversation with headings and lists. On
  load the elements use the saved children as they are; Markdown is not rendered again.
- **The browser renders the reply's presentation HTML and sends it.** Appended lines carry `content_html`, rendered
  with the same `markdown.js` used on screen, so what is saved matches what was shown (a separate Ruby renderer would
  drift). Without `content_html` (for example through the API directly), `<article>` is written empty and the page
  renders it from the attribute on load.
- Presentation of user messages is built by Ruby from the text.
- **Renderer version.** Presentation HTML carries `data-generator="lcty.v1"`. A future renderer can re-render from the
  attributes, which are never lost.

### Presentation allowlist

Ruby parses `content_html` with gumbo (`Nokogiri::HTML5`) and keeps only what `markdown.js` emits:

- Elements: `p br hr strong em del blockquote h1–h6 ul ol li pre code table thead tbody tr th td a div span button`.
- Attributes: `ol[start]` (digits), `code[data-lang]`, `th/td[style]` (only `text-align:left|center|right`),
  `a[href]` (only `http:`, `https:`, `mailto:`), `a[target=_blank]`, `a[rel="noopener noreferrer"]`, `div/span/button[class]`,
  `button[type=button]`.
- `script style template iframe object embed noscript svg math head title meta link base form input textarea select`
  are dropped with their contents; other elements are unwrapped (their contents are kept).

This removes anything like a `<script>` that slipped into model output.

## Characters XML cannot represent

C0 controls other than tab, LF and CR (U+0000–U+001F), plus U+FFFE / U+FFFF, cannot be written in XML 1.0, not even as
character references. They are handled by the kind of value:

- **Text strings** (user messages, replies, thinking, system prompt) are kept byte-exact, because changing them would
  change the history sent back and miss the prefix cache. Only when a string contains such characters, its attribute is
  written as `name-base64` (base64 of the UTF-8 bytes) instead of `name`. Exactly one of the two is written, decided only
  by whether the string contains such characters, so the same string always gets the same form. Normal strings stay
  readable and greppable (base64 would also be 1.33× larger).
- **Presentation** replaces them with visible Control Pictures (ESC becomes `␛`).
- **The title** replaces them the same way (it is display only).
- **Everything else** (ids, tag names, …) is rejected with 400 naming the value. All lines are checked before anything
  is written, so a request never writes part of its lines.

## Writing

- **Only Ruby writes.** The browser sends lines as JSON and Ruby turns them into elements.
- **Well-formed XML at all times.** Elements are built with the Nokogiri DOM, never by joining strings, and written with
  `to_xhtml`. The result is reparsed in strict mode (`ParseOptions::STRICT`) before writing. `to_xhtml` writes HTML void
  elements as `<br />` and other empty elements as `<x></x>`, so the output reads the same as XML and as HTML (`to_xml`
  would write empty custom elements as `<x/>`, which HTML does not treat as closed).
- Appends take an exclusive `flock` and write all lines of one request in one `write`.
- Anything other than appending (undo, title changes) reads the file, removes or replaces elements, and rewrites the
  whole file through a temporary file and `rename`. These operations are rare. Rewriting preserves presentation HTML
  byte for byte.
- When reading, `Nokogiri::XML::DocumentFragment.parse` (recovery mode) is used. If it reports errors (a write that was
  interrupted), the last element is dropped with a warning.
- Ruby 2.6 ships nokogiri 1.13.8 with libxml2 2.9.13.

## Revision draft: `lcty-msg`

Status: draft, not implemented. Where this section disagrees with the sections above, this section is the design to
come; the sections above record the current format. Open points are listed at the end.

### Principles

- **`lcty-msg` is the core of a conversation.** Joining the `data-content` of every `lcty-msg` in file order (the
  value of `data-content-base64` decoded, where that is written), separated by `"\n\n"`, always reads as the
  conversation. The same elements, and only they, are what the history sent to the model is built from and what a
  Markdown export contains: `lcty-msg` defines the boundary of all three.
- **Everything else is incidental.** `lcty-thinking`, `lcty-tool` and `lcty-cmd` record what happened around the
  messages (thoughts, tool calls, commands). They are never part of the joined text or of an export, and may depend on
  the model, the backend or the page that wrote them. The element name alone tells which kind a line is.
- **Fat client, thin server.** The client builds every element: its attributes, its text and its rendered
  presentation. The server checks what it receives and writes it, or rejects the whole request (nothing of it is
  written); it never completes or corrects an element. Two exceptions: the title, which the server fits into the slot
  (as today), and `data-content-integrity`, which the server computes when the client sends the placeholder.
- **Lines are independent.** Every element is one line, and a line is checked on its own. The order of the lines has
  a canonical form (below), but it is not validated when writing, since that would mean reading the file; a reader
  makes the best of a file whose lines are out of order.
- **A file changes only at its end.** Lines are appended at the end, and undoing removes lines from the end; the title
  slot is still overwritten in place. Nothing in the middle of a file is ever rewritten.

### Example

```html
<!DOCTYPE html><html lang="ja" />
<head>…(line 2 as today)…</head>
<title id="__512">IndexedDBとlocalStorageの違い</title><!--…<!---->
<lcty-c id="c-20261105-100824-d3ad" data-created-at="2026-11-05T10:08:24+09:00" />
<lcty-msg data-role="system" id="sys-…" data-template="thinking" data-content-integrity="sha384-…" data-content="たくさん考えて"><article><p>たくさん考えて</p></article></lcty-msg>
<lcty-msg data-role="system" id="sys-…" data-tag="Ruby" data-content-integrity="sha384-…" data-content="あなたは Ruby に詳しいプログラマーです。"><article><p>あなたは Ruby に詳しいプログラマーです。</p></article></lcty-msg>
<lcty-msg data-role="memory" id="mem-…" data-tag="Ruby" data-content-integrity="sha384-…" data-content="ユーザーは macOS 付属の Ruby 2.6 を使っている"><article><p>ユーザーは macOS 付属の Ruby 2.6 を使っている</p></article></lcty-msg>
<lcty-msg data-role="system" id="sys-…" data-content-integrity="sha384-…" data-content="今回はフィボナッチ数列"><article><p>今回はフィボナッチ数列</p></article></lcty-msg>
<lcty-msg data-role="user" id="msg-u-…" data-at="2026-11-05T10:09:51+09:00" data-content-integrity="sha384-…" data-content="ブラウザの IndexedDB と localStorage の違いは？"><article>ブラウザの IndexedDB と localStorage の違いは？</article></lcty-msg>
<lcty-thinking id="think-…" data-at="2026-11-05T10:09:51+09:00" data-content-integrity="sha384-…" data-content="思考です"><article><p>思考です</p></article></lcty-thinking>
<lcty-msg data-role="model" id="msg-m-…" data-at="2026-11-05T10:10:37+09:00" data-content-integrity="sha384-…" data-content="ブラウザのクライアントサイド…"><article><p>ブラウザのクライアントサイド…</p></article></lcty-msg>
```

Lines 1 to 4 keep the head of today's format. Every line from line 5 on is one of the elements below.

### `lcty-msg`

- **`data-role`** is one of `system`, `memory`, `user` and `model`.
  - `system`: an instruction to the model. `data-template` names the template it came from; `data-tag` names the tag it
    came from; one without either is the instruction of this conversation.
  - `memory`: a memory of a tag (`data-tag`).
  - `user`: a message of the user.
  - `model`: a reply of the model.
- **`system` and `memory` are a snapshot taken when the conversation is created.** They are written before the first
  `user` and are not added later: changing the tags of a conversation affects the next conversation, not this one.
  `data-created-at` of `lcty-c` is their time.
- **`id`** is a prefix from the role followed by a UUIDv7: `sys-` (system), `mem-` (memory), `msg-u-` (user) and
  `msg-m-` (model). The server rejects an id whose prefix does not match `data-role`.
- **`data-at`** is when a `user` or `model` message was written.
- **`data-content`** is the text, kept byte for byte. A text holding characters XML cannot represent is written as
  `data-content-base64` instead (the rule of [Characters XML cannot represent](#characters-xml-cannot-represent));
  exactly one of the two is written, and the client chooses it by that rule.
- **`data-content-integrity`** is `sha384-` followed by the base64 (with padding) of the SHA-384 of the UTF-8 bytes of
  the text, as in Subresource Integrity. It is there to find format errors (an attribute written or read wrongly, a
  file edited by hand); it is not checked when writing. Checking it is left to whoever needs it: a check at startup, a
  script, the tests. A mismatch is reported as a format error and does not stop the file from being read. The client
  may send the placeholder `sha384-` (no digest), and the server then computes the value and writes it.
- **Attributes come in one order:** `data-role`, `id`, `data-at`, `data-template`, `data-tag`,
  `data-content-integrity`, then `data-content` or `data-content-base64`. An attribute that does not apply is left out.
  The server rejects attributes in any other order and never reorders them.
- **The child is one `<article>`,** the presentation, rendered by the client: the text as it is for `user` (shown with
  its newlines kept), and the HTML rendered from Markdown for the other roles. The server rejects an `<article>` that
  holds anything outside the [presentation allowlist](#presentation-allowlist), and for `user` one that holds anything
  but the text. The attribute is the source of truth; the presentation is for reading the file without scripts.

### The history sent to the model

Built from the file in order, element by element, by the element's name (Responses API,
[LCTYSP-0002](LCTYSP-0002_llm-backend.md)):

- `system` and `memory`: their texts joined by `"\n\n"`, in file order, are `instructions`. Nothing else is added.
- `user`: `{role: "user", content}`.
- `model`: `{type: "message", role: "assistant", content}`; a reply with an empty text is not sent.
- `lcty-thinking`, `lcty-cmd`: not sent.
- `lcty-tool`: sent only within the current turn (after the last `user`), so that the model can use the results of its
  calls; never for earlier turns. Past turns are therefore exactly the `lcty-msg` elements.

### `lcty-thinking`

The model's thinking for a reply, written before the `model` it belongs to. It has `id` (`think-` and a UUIDv7),
`data-at`, `data-content-integrity` and `data-content` (or `data-content-base64`), in that order, and an `<article>`
rendered like a reply. It is never sent back to the model.

### `lcty-tool` and `lcty-cmd`

Both are recorded alongside the messages and are designed later; only their names are fixed now.

- `lcty-tool` records a tool call and its result. Its form depends on the API and the model (how a call is shaped,
  who assigns its id, how parallel calls are ordered), so it is a record for the environment that produced it rather
  than a portable form. It is sent only as described above.
- `lcty-cmd` records a command. **Its children are never written to the file:** while it runs, what it produces
  (a message being generated, a call being made) is shown as its children, and only the finished elements are written,
  as lines of their own.

### Writing

The client sends elements as JSON, one object per element: `{attrs, innerHTML}`, where `attrs` holds the attributes in
the order above and `innerHTML` the presentation. `lcty-msg` (and `lcty-thinking`) and `lcty-cmd` are written by
separate operations of the API.

- **Creating** writes lines 1 to 4 and the first elements in one write, and fails when the file exists.
- **Appending** names `after`, the id of the element the new ones follow. The server appends only when the last
  element of the file has that id, and otherwise rejects the request with the id it found. Two tabs appending at once
  cannot both succeed, and a request sent again after it succeeded is recognised: the last id is then the client's own.
- **Undoing** names the first element to remove and the id of the last element of the file. The server checks the
  last id like an append, then truncates the file at the start of that element's line. Only lines at the end are ever
  removed.
- **Not in the file:** the timings, the token usage and which client and model produced a reply are kept in a database
  keyed by the message id, not in the file.

### Open points

- How a stopped or failed reply is recorded (today `data-status="incomplete"` and `data-error`); probably with
  `lcty-cmd`.
- Whether messages copied from the fork source keep a mark (today `data-inherited`).
- The tags at creation (today `data-setup-tags` on line 4), which the list of conversations reads from the head lines.
- The forms of `lcty-tool` and `lcty-cmd`.
- The hash that identifies the state of a conversation (for checking a page against the server), decided once this
  format is stable.
- How an export looks (headings for the roles, how the text of `user` is quoted, separators).
- How `system` and `memory` are shown on the page ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)).
