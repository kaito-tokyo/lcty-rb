<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-003: Conversation file

- Status: Accepted
- Related: [LCTYSP-004](LCTYSP-004_editing.md), [LCTYSP-005](LCTYSP-005_page-and-elements.md), [LCTYSP-008](LCTYSP-008_vector-binary.md)
- Implementation: `lib/conv_html.rb`

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
<!doctype html><html lang="ja"><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="lcty.v1.css" /><script src="lcty.v1.js?lang=ja"></script><script type="module" src="lcty.v1.esm.js"></script><lcty-container>
<title>Title</title>
<lcty-meta data-id="20261104-…" data-created-at="…" data-backend-id="local" data-thinking="false" data-tags="ruby concise" data-forked-from-id="" data-forked-from-at="" data-instructions="system prompt"></lcty-meta>
<lcty-message data-id="0190…" data-role="user" data-at="…" data-content="user text"><div class="user-text">user text</div></lcty-message>
<lcty-message data-id="0190…" data-role="assistant" data-status="completed" data-at="…" data-timings="{…}" data-client="{…}" data-content="# Heading&#10;…" data-reasoning="thoughts"><lcty-thinking data-generator="lcty.v1"><details><summary>…</summary><div class="thinking-body">thoughts</div></details></lcty-thinking><article data-generator="lcty.v1"><h1>Heading</h1>…</article></lcty-message>
<lcty-tags data-at="…">ruby concise travel</lcty-tags>
```

- **Line 1 is a fixed header.** It loads the stylesheet, the element definitions and the page module
  ([LCTYSP-005](LCTYSP-005_page-and-elements.md)). `<lcty-container>` is deliberately never closed: the HTML parser
  closes it at the end of the file, so every element from line 2 on becomes its child and appending is just writing at
  the end. Opened over HTTP, the file shows as the conversation (`file://` is not supported).
- **Line 2 is `<title>`**, the conversation title. HTML parsers treat a `<title>` in the body as the document title
  (checked in Edge and gumbo), so the tab shows it even without JavaScript. Newlines become spaces. Changing the title
  rewrites line 2.
- **Lines 3 and later** are elements, one per line, separated by a single newline.
- **Rule: lines starting with `<!` are skipped when reading.** Such lines (the doctype, comments) must be complete on one
  line. Text always escapes `<` as `&lt;`, so a text line never starts with a raw `<!`. `<!doctype html>` is not valid
  XML, but once that line is skipped the rest is a well-formed XML fragment.
- Ids are limited to `[A-Za-z0-9_-]`. Files whose names are not valid ids (copies such as `… copy.html`) are skipped
  with a warning.

## Elements

| Element | Content |
|---|---|
| `<title>` | The title. On line 2; changing it rewrites line 2. |
| `lcty-meta` | Always first after the title. Fixed when the conversation is created. `data-tags` holds the tags at start (space separated). `data-instructions` (or `data-instructions-base64`) is the system prompt. A fork has `data-forked-from-id` and `data-forked-from-at`. |
| `lcty-tags` | The current tags (space separated). Appended when tags change; the last one wins (otherwise `lcty-meta`'s `data-tags`). Does not change the system prompt ([LCTYSP-009](LCTYSP-009_tags-and-memory.md)). |
| `lcty-message` | One message. Attributes: `data-id`, `data-role`, `data-at`, `data-status`, `data-error`, `data-inherited`; JSON attributes `data-timings`, `data-client`, `data-usage`. Text is `data-content`, reasoning is `data-reasoning` (each `-base64` when needed, see below). Children are presentation: `div.user-text` for the user; `lcty-thinking` (when there is reasoning) and `<article>` for the assistant. |

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
- Presentation of user messages and of reasoning is built by Ruby from the text.
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

- **Text strings** (user messages, replies, reasoning, system prompt) are kept byte-exact, because changing them would
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
