<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-003: Conversation file

- Status: Accepted
- Related: [LCTYSP-004](LCTYSP-004_editing.md), [LCTYSP-005](LCTYSP-005_page-and-elements.md), [LCTYSP-008](LCTYSP-008_vector-binary.md)
- Implementation: `lib/conv_html.rb`, `lib/store.rb`

## Summary

Each conversation is one append-only file, `data/c/<id>.html`. The file is an HTML document that opens as the
conversation page by itself, and, apart from its first line, a well-formed XML fragment of custom elements. Text that
is sent back to the model lives in attributes (the source of truth); child elements hold presentation HTML.

## Why HTML

JSONL's one-record-per-line rule only works around the fact that JSON cannot be appended to. HTML can be appended to by
adding sibling elements at the end, keeps newlines in text as they are, and can be rendered directly as the
conversation page ([LCTYSP-005](LCTYSP-005_page-and-elements.md)).

## File layout

```html
<!doctype html><html data-lcty-tlrange="0x0187,0x0387" lang="ja"><meta charset="utf-8">…<script type="module" src="lcty.v1.module.js"></script><link rel="stylesheet" href="lcty.v1.css"><script src="lcty.v1.js"></script><script src="lcty.v1.lang-ja.js"></script><script>defineLctyV1CustomElements();</script>
<!--lcty-meta--><title>Title</title><!--8901234567890…34567890-->
<!--lcty-meta--><lcty-c id="c-20261104-…" data-setup-tags="ruby concise" data-thinking="false" data-created-at="…">
<lcty-setup data-instructions="system prompt"></lcty-setup>
<lcty-message id="c-msg-0190…" data-role="user" data-at="…" data-content="user text"><div class="user-text">user text</div></lcty-message>
<lcty-message id="c-msg-0190…" data-role="assistant" data-status="completed" data-at="…" data-timings="{…}" data-client="{…}" data-content="# Heading&#10;…" data-thinking="thoughts"><article data-generator="lcty.v1"><h1>Heading</h1>…</article></lcty-message>
```

- **Rule: lines starting with `<!` are skipped when reading.** Such lines must be complete on one line. Text always
  escapes `<` as `&lt;`, so a text line never starts with a raw `<!`. Lines 1 to 3 all start with `<!`, so the element
  parser sees lines 4 and later, a well-formed XML fragment (`<!doctype html>` and the never-closed `<lcty-c>` are not
  valid XML). Ruby reads lines 2 and 3 on their own (the title slot and the attributes of `<lcty-c>`).
- **Line 1 is a fixed header.** It loads the page module, the stylesheet, the element definitions and the Japanese
  texts, in that order (`lcty.v1.js` before `lcty.v1.lang-ja.js`, which registers its table with `LctyT`), then defines
  the elements ([LCTYSP-005](LCTYSP-005_page-and-elements.md)). Opened over HTTP, the file shows as the conversation.
- **Opened directly (`file://`, offline), the file still shows as the conversation.** It needs nothing but the
  `lcty.v1.*` files next to it, all loaded by relative paths from line 1 (no Shadow DOM loads
  anything of its own, [LCTYSP-005](LCTYSP-005_page-and-elements.md)). Only reading is supported there: the module does not load (browsers
  refuse module scripts from `file://`, whose origin is `null`), so nothing is sent, nothing reaches the LLM server,
  and the sidebar's list is empty unless that origin has its own cached copy. None of this is needed to read it.
- **`<!--lcty-meta-->` starts lines 2 and 3.** The empty comment is there only so that those lines start with `<!` and
  the element parser skips them.
- **The `<!` lines (1 to 3) are the meta lines.** They hold only what a list of conversations needs: the title, the
  id, the tags at creation, whether thinking is on and the creation time. Collecting them is enough to build the
  sidebar's database (`GET /v1/meta-all.json` reads only these lines of each file,
  [LCTYSP-006](LCTYSP-006_http-api.md)). The system prompt, which may be long, is not among them; it is on line 4.
- **Line 2 is the title slot.** The browser puts the comment and the `<title>` in the head, so `<title>` is the
  document's own title (the tab shows it even without JavaScript).
- **Line 3 opens the frame, `<lcty-c>`, whose attributes are what the frame needs to know.** They are written once,
  when the conversation is created, and never change (line 3 is never rewritten):
  - `id`: `c-` followed by the conversation id (see the id prefixes below);
  - `data-setup-tags`: the tags the conversation was created with (space separated, omitted when empty). **Tag
    changes are not written to the file:** they are kept in `tags.sqlite`, and the current tags are those, or these
    when the tags were never changed ([LCTYSP-009](LCTYSP-009_tags-and-memory.md));
  - `data-thinking`: whether thinking is on (`true` / `false`);
  - `data-created-at`: when the conversation was created.

  `<lcty-c>` is deliberately never closed: the HTML parser closes it at the end of the file, so every element from line
  4 on becomes its child and appending is just writing at the end. Nothing else about a conversation is recorded: not
  the backend (the browser always uses its default backend) and not the conversation it was forked from.
- **Line 4 is `lcty-setup`**, the system prompt (see Elements).
- **The title slot is declared on line 1.** `data-lcty-tlrange="0xSSSS,0xEEEE"` on `<html>` is the half-open byte range
  from the `<` of `<title>` to the end of line 2 (just after `-->`, where the newline is):
  `<!--lcty-meta-->[begin]<title>…</title><!--…0-->[end]`. Both numbers are 4-digit hex, so the header length never
  depends on them. By default the slot is 512 bytes. Ruby reads the title from the slot.
- **The slot is built from a ruler.** A blank slot is a run of digits ending with `0-->` (the digits count up to the
  end, so the one just before `-->` is always `0`; a broken slot is easy to spot). Writing a title overwrites its head
  with `<title>…</title><!--`, which turns the rest of the ruler into the body of a comment; digits never form `--`, so
  the result is always a valid comment and the slot keeps its length. The longest escaped title is therefore 490 bytes
  (`<!---->` when the ruler is used up).
- **The title** is the current conversation title. Newlines become spaces. The escaped title is cut at a character
  boundary so the slot never exceeds 512 bytes (about 160 Japanese characters). Changing the title overwrites the slot
  in place (seek to its start, write exactly its length, fsync) under the file lock, so the rest of the file stays
  append-only. When the new title does not fit the slot, or the file has no valid slot, the whole file is rewritten
  with a default-size slot.
- **Titles come from replies.** The system prompt asks the chat model to start every reply with a level-1 heading
  (`# タイトル`). This is best effort: when the first line of a reply is such a heading, the page sets it as the title.
  The heading stays in the reply's content, so the history sent back is exactly what the model wrote (the cache
  applies). Before the first reply the title is the first 30 characters of the first message; editing the title field
  by hand also overwrites the slot, and whichever comes later wins.
- **Rendering reads the title only from `<title>`.** The heading rule is applied once, when a reply is received: the
  page writes the title (into the slot) and puts the same text into the page's `<title>`. Nothing derives a title from
  the messages when a file is opened or listed, and nothing is added to it (no site name).
- **Lines 4 and later** are elements, one per line, separated by a single newline.
- **Element ids carry a prefix that may be added and removed freely.** The identity is the bare id (the conversation
  id, the message UUIDv7). As an element `id` it is written with a prefix, `c-` for `<lcty-c>` and `c-msg-` for
  `lcty-message`, only so that it can sit in a URL fragment and in CSS selectors and never collides with other ids in the
  document. Readers strip the prefix, writers add it, and everything else (the API, the index) uses the
  bare id.
- Ids are limited to `[A-Za-z0-9_-]`. Files whose names are not valid ids (copies such as `… copy.html`) are skipped
  with a warning.

## Elements

| Element        | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`      | The title, in the slot on line 2 (not an element of the body); changing it overwrites the slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `lcty-setup`   | The system prompt actually sent: `data-instructions` (or `data-instructions-base64`). Written on line 4 when the conversation is created. **Written exactly once and never overridden:** only the first `lcty-setup` counts, and a later one is ignored. |
| `lcty-cmd`     | A command tag: an operation to run, abstracted as `data-op` (lowercase letters, digits and `-`) with `data-at`. A command written to the file runs when the file is opened while it is still the last element (deferred execution); commands appended only in memory never reach the file (volatile execution). Unknown operations are ignored. Today only `send`, written as the last line when a conversation is created ([LCTYSP-004](LCTYSP-004_editing.md)). Shown only while running (spinner and stop).                                                                           |
| `lcty-message` | One message. `id` is `c-msg-` followed by the message UUIDv7, so `#c-msg-…` links to the element. Attributes: `data-role`, `data-at`, `data-status`, `data-error`, `data-inherited`; JSON attributes `data-timings`, `data-client`, `data-usage`. Text is `data-content`, thinking is `data-thinking` (each `-base64` when needed, see below). Children are presentation: `div.user-text` for the user and `<article>` for the assistant. **Thinking has no presentation in the file**: it is `data-thinking` only, since it is not needed to read the conversation, and the page shows it (collapsed) from the attribute.                                                                                                   |

- `data-status` is `completed` or `incomplete` (stopped or failed). A generating message is not written; it is appended
  once complete.
- `data-timings` is shown on screen and used for debugging. Whether the cache applied is visible in `cache_n`
  (`usage.cached_tokens` stays 0 and cannot be trusted).
- `data-inherited="true"` marks a message copied from the fork source ([LCTYSP-004](LCTYSP-004_editing.md)).

### Message ids

- Message ids are **UUIDv7** in canonical lowercase form. The first 48 bits are milliseconds, so ids sort roughly by
  creation time. They are 16 bytes in the vector binary ([LCTYSP-008](LCTYSP-008_vector-binary.md)).
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
