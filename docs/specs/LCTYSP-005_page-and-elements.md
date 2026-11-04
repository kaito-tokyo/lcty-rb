<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-005: Pages and custom elements

- Status: Accepted
- Related: [LCTYSP-001](LCTYSP-001_architecture.md), [LCTYSP-003](LCTYSP-003_conversation-file.md), [LCTYSP-007](LCTYSP-007_search.md)
- Implementation: `public/c/lcty.v1.js` (documented in `public/c/lcty.v1.d.ts`), `public/c/lcty.v1.esm.js`,
  `public/js/ui/lcty-elements.js`, `public/js/pages/*.js`

## Summary

The UI is a multi-page application with no build step. A conversation page is the conversation file itself: a classic
script defines the custom elements synchronously in `<head>`, so the DOM structure is settled in one parsing pass, and
a module loaded after parsing attaches every feature.

## Pages

| URL | Page | Content |
|---|---|---|
| `/` | Search (home) | Search box, results and list, links to new conversation, tags, settings |
| `/c/` | New conversation | Tag picker, system prompt draft, thinking on/off, first message. `?fork=<id>&at=<n>` forks ([LCTYSP-004](LCTYSP-004_editing.md)) |
| `/c/<id>.html` | Conversation | Messages, composer, undo / regenerate / fork, tags (labels), memory proposals. `#<message UUIDv7>` scrolls to that round |
| `/tags` | Tags | Editing tag definitions and memory ([LCTYSP-009](LCTYSP-009_tags-and-memory.md)) |
| `/settings` | Settings | Current values from `.env` and a connection test ([LCTYSP-010](LCTYSP-010_data-and-settings.md)) |

- The conversation page has a sidebar with the search box and the conversation list. Search is shared with the home page
  (`js/search/search-panel.js`). Choosing a conversation navigates to it; a match inside the current conversation
  scrolls to that round instead.
- The history sent back to the model is read from the DOM: each `<lcty-message>` reads its text from attributes, which
  are exactly the saved strings ([LCTYSP-003](LCTYSP-003_conversation-file.md)). No JSON has to be fetched to open a
  conversation.

### Routing

- **Under `/c/`, requests are routed by extension.** `.html` returns `data/c/<id>.html` untouched; anything else is a
  static file from `public/c/` (`lcty.v1.js`, `lcty.v1.css`, `lcty.v1.esm.js`, and `index.html` for `/c/`). Because the
  header line uses relative paths, nothing needs special handling.
- `/c/` is `public/c/index.html`, a document with only the header line, which opens as an empty conversation.
- `/tags` and `/settings` return HTML from `public/`; everything else under `/` is served from `public/`.
- Ruby answers dynamically only under `/api/*` ([LCTYSP-006](LCTYSP-006_http-api.md)).

## The `lcty.v1` files

| File | Role |
|---|---|
| `lcty.v1.css` | The stylesheet for every page. Loaded by `<link>` in the header, so pages are styled even without scripts. |
| `lcty.v1.js` | Classic script loaded synchronously in `<head>`. Defines the custom elements: DOM structure only. |
| `lcty.v1.d.ts` | Types and documentation of `lcty.v1.js`. |
| `lcty.v1.esm.js` | Module entry (`<script type="module">`, runs after parsing). Loads `js/pages/conversation.js`. |

- **`v1` is the rendering version.** When the format changes, the version goes up (`lcty.v2.*`) and old files keep
  opening with the old version.
- **`lcty.v1.js` contains no comments except the SPDX lines,** because every conversation page loads it synchronously
  first and size matters. Its documentation lives in `lcty.v1.d.ts` and in this spec. The ERB conditions described
  below look like comments but are a mechanism, not documentation.
- Other pages (`/`, `/tags`, `/settings`) do not load `lcty.v1.js`. Markdown rendering there is the ordinary module
  `js/ui/markdown.js`.

## Custom elements

### Defined synchronously; the DOM is settled in one pass

- `lcty.v1.js` defines its element classes globally before the body is parsed, so every element is created by the
  parser (attributes, then the element, then its children as parsing continues). Nothing is moved or rebuilt afterwards.
- Because text lives in attributes and children are presentation, it does not matter when the children arrive.
- **Only autonomous custom elements** (`<lcty-message>` etc.) are used. Customized built-ins (`<p is="…">`) are not
  supported by Safari.

### Structure in Shadow DOM, content in Light DOM

- **Internal structure goes in Shadow DOM** (Light DOM is allowed, but Shadow DOM is right almost always). For
  parser-created elements the spec forbids adding children or attributes in the constructor, but attaching a shadow root
  is allowed, so the structure is built once in the constructor without flags.
- Each element's private `#template()` builds its structure with DOM APIs (no `innerHTML`) and stores inner elements in
  fields. Values that decide the structure are passed as arguments.
- **The conversation file's elements stay in Light DOM and are shown through `<slot>`.** Their display order follows the
  Shadow DOM, whenever they arrive.
- **Styling comes from outside through `::part()`** (multiple names are allowed, such as `part="action undo"`, and they
  combine with host conditions such as `lcty-message[data-last-user]::part(undo)`). CSS variables and inherited
  properties (`font`, `color`) reach inside. The old piercing selectors (`/deep/`, `>>>`) no longer exist. Only
  `lcty-container`'s frame, which has many parts, loads `lcty.v1.css` inside its shadow root.
- Elements carry no stylesheet of their own, so many messages cost only their shadow roots. Measured with an 8 MB,
  6,000-message conversation: about 0.15 s from receiving it to `DOMContentLoaded` (about 20 ms without scripts; building
  each shadow root from `innerHTML` took 1–1.7 s).

### Elements

| Element | Shadow DOM | Exposed fields |
|---|---|---|
| `<lcty-container>` | The frame: sidebar, header, setup area, `<slot>`, spacer, composer, memory dialog | `search`, `searchStatus`, `sideList`, `titleInput`, `tags`, `badges`, `proposeMemoryButton`, `deleteButton`, `setup`, `setupTags`, `setupInstructions`, `setupRecomposeButton`, `setupThinking`, `fixed`, `fixedInstructions`, `composer`, `memoryDialog` |
| `<lcty-message>` | Head (who, action buttons for the role), `<slot>`, foot | `who`, `undoButton`, `forkButton`, `regenerateButton` (`null` when the role has none), `foot` |
| `<lcty-composer>` | Form (input, send, stop) | `form`, `input`, `sendButton`, `stopButton` |

- `<lcty-message>` builds buttons per role: user gets undo and fork, assistant gets regenerate. Parser-created elements
  have no `data-role` in the constructor, so `attributeChangedCallback` rebuilds the template with the role, replacing the
  fields. CSS shows undo only on the last user message (marked `data-last-user`) and regenerate only on the last reply.
- `<lcty-thinking>` and `<article>` (the reply body) are plain containers, not defined elements.
- `<lcty-conv-list>` (the conversation list) is defined by a module; it is not part of conversation files.
- Ids in the frame are styling hooks for CSS. Code reaches elements through the fields.

### Structure in `lcty.v1.js`, features in modules

- **`lcty.v1.js` defines DOM structure only.** `connectedCallback` is not extended later, elements fire no custom events
  of their own, and behavior is not mixed into the classes (no jQuery-style extension).
- **Every feature lives in modules** loaded from `lcty.v1.esm.js` (`js/pages/conversation.js`, `js/ui/lcty-elements.js`):
  Markdown rendering, streaming, reasoning display, timings in the foot, sending with Enter (Shift+Enter inserts a
  newline; Enter during IME composition is ignored), generation, saving, following the end while scrolling, copying code
  blocks and auto-resizing the composer. They attach handlers directly to exposed fields
  (`container.composer.form.onsubmit = …`, `message.undoButton.onclick = …`) and use plain functions that operate on the
  DOM (`appendMessage(container, m)`, `messageOf(el)`, …). Per-element state lives in `WeakMap`s.
- Until the module has loaded, the content and frame are visible, buttons do nothing yet, and timings are not shown (the
  foot grows by a line when they appear).

### Layout of the conversation page

- `<lcty-container>` ends line 1, so it is created before the content. Its constructor builds the frame; the parser then
  appends the file's elements to Light DOM, shown through the `<slot>` between the setup area and the composer.
  `<title>`, `lcty-meta` and `lcty-tags` are `display: none`.
- The header is `position: sticky` at the top, the composer is `sticky` at the bottom, and the sidebar is
  `position: fixed`. A growing spacer after the `<slot>` keeps the composer at the bottom even with few messages.
- **The whole page (window) scrolls.** New messages are appended to the end of `lcty-container`'s Light DOM.
- Content is never hidden while loading and does not move afterwards.

## Rendering streams

Rendering must stay cheaper than generation:

- Deltas arrive per token (a few bytes, about 50 per second). Receiving one only appends to a string buffer.
- Drawing is batched with `requestAnimationFrame`, once per frame.
- Markdown rendering fixes finished blocks in the DOM and redraws only the last, unfinished block (redrawing everything
  would be O(n²)). An unfinished code block is appended to a text node instead of being redrawn.
- Reasoning is collapsed and not rendered while closed.
- Markdown to HTML always escapes text and only allows `http:`, `https:` and `mailto:` link URLs. LLM output is never put
  into the DOM as raw HTML.
- Each message uses `content-visibility: auto` so off-screen messages skip layout and painting.
- Not adopted: streaming insertion APIs such as `streamAppendHTML` (behind a flag as of 2026-11, not in Safari). The hard
  part, incremental Markdown parsing, has to be written anyway, and rendering is not a bottleneck.

## UI texts

`lcty.v1.js` supports every language and follows `<html lang>`. UI texts are tables in `LctyT`; elements look them up
with `LctyT._('send')`.

- **Tables.** `x-default` (English) is part of `LctyT` itself (the initial value of `#dicts`). Other languages are added
  with `LctyT.addLang('ja', {…})`; aliases with `LctyT.addAlias('ja-JP', 'ja')`. Tags are registered in canonical form
  (`ja`, `en-GB`, `zh-Hant-TW`); registration does not canonicalize. Tables are frozen when registered.
- **Closing registration.** `LctyT.freeze()` freezes `#dicts` once all languages are registered (later `addLang` /
  `addAlias` throw TypeError). `_()` throws before that and remembers the table for `<html lang>` on its first call.
- **Lookup (`LctyT.dict(lang)`).** Empty (`''` or `[]`) gives `x-default`. Otherwise: exact match of the first tag
  canonicalized by `Intl.getCanonicalLocales`, then its language part (`ja` for `ja-JP` or `ja-JP-u-ca-japanese`), then
  `x-default`. Invalid tags log `console.warn` and give `x-default`. `_()` falls back to `x-default` per item and returns
  the key itself for keys found nowhere, so missing texts show on screen.
- **Language blocks are wrapped in ERB conditions:** `/* <% if lang.nil? || lang == 'ja' %> */ … /* <% end %> */`. The
  ERB tags sit inside JS comments, so without ERB the file is valid JS with every language (how it is served today).
  Rendering it with ERB and `lang = 'ja'` keeps only that language and `x-default` (`lang = nil` keeps all). All of these
  were checked to be valid JS.
- **The query in `lcty.v1.js?lang=ja` is an optimization hint** for serving such a rendered file. The server ignores it
  today and the script never reads it; only `<html lang>` decides the language.
- Texts in the modules (toasts, timings, the tag picker, …) and the other pages are still Japanese only.
