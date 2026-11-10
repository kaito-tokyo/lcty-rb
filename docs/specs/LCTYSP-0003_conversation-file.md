<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0003: Conversation file

- Status: Accepted; to be superseded by [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) (the `lcty-msg`
  format, a draft) once the pages write it
- Related: [LCTYSP-0004](LCTYSP-0004_editing.md), [LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-0008](LCTYSP-0008_vector-binary.md), [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md)
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
  the creation time. Collecting them is enough to build the sidebar's list (the `GET /v1/meta-all.json` of before read
  only these lines of each file). The system prompt, which may be long, is not among them; it is on line 5.
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
    changes are not written to the file:** they are kept in `lcty_t.sqlite`, and the current tags are those, or these
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
