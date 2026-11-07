<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0005: Pages and custom elements

- Status: Accepted
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md), [LCTYSP-0003](LCTYSP-0003_conversation-file.md), [LCTYSP-0007](LCTYSP-0007_search.md), [LCTYSP-0011](LCTYSP-0011_module-bundler.md)
- Implementation: `lib/c/servlet.rb`, `public/c/lcty.v1.js` (documented in `public/c/lcty.v1.d.ts`), `public/c/lcty.v1.*`,
  `public/js/ui/lcty-elements.js`, `public/js/pages/*.js`

## Summary

The UI is a multi-page application with no build step. A conversation page is the conversation file itself: a classic
script defines the custom elements synchronously in `<head>`, so the DOM structure is settled in one parsing pass, and
a module imported once the page has loaded attaches every feature without blocking rendering.

## Pages

| URL            | Page                            | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/c/`          | New conversation (the top page) | Separate components, not `<lcty-c>`: `<lcty-sidebar>` and a creation card in plain HTML (tag checkboxes ending with a ⚙︎ that opens the same tags dialog as the sidebar's タグ button — tag definitions and memory, [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md) — and a system prompt draft) holding a `<lcty-composer>` for the first message. Sending creates the file and moves to `/c/<id>.html` ([LCTYSP-0004](LCTYSP-0004_editing.md)). `?fork=<id>&at=<n>` forks ([LCTYSP-0004](LCTYSP-0004_editing.md)); `?q=…` puts a query into the sidebar's search box. `/c/index.html` is the same page; `/c` redirects here (with its query) and `/` moves here |
| `/c/<id>.html` | Conversation                    | Messages, composer, undo / regenerate / fork, tags (labels), memory proposals. `#c-msg-<message UUIDv7>` (the message element's `id`) scrolls to that round; a bare `#<message UUIDv7>` from older links still works                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **Every page has the same sidebar** (`<lcty-sidebar>`): new conversation (opened in a new window, so the current
  conversation stays where it is), the tags button right of it, the refresh button, the settings button, the search box
  and the conversation list. The conversation page has it inside `lcty-c`'s Shadow DOM; the new conversation page puts it
  at the top of `<body>`. Its behavior is `js/ui/sidebar.js` (search is `js/search/search-panel.js`). Choosing a conversation
  navigates to it; a match inside the current conversation scrolls to that round instead. The タグ (Tags) button opens the tags
  dialog (the tag editor, a modal `<dialog id="tags-dialog">` built by `js/tags.js` and appended to `<body>`;
  [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)) on every page; saving updates the page's tag choices. The ⚙︎ button opens the
  settings dialog (a modal `<dialog>`, `js/ui/settings-dialog.js`, appended to `<body>`): editing the browser settings and a connection test
  ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)).
- **Revision draft (not implemented): a tag reorder page.** With tags stored as one HTML file per tag
  ([LCTYSP-0009, revision draft](LCTYSP-0009_tags-and-memory.md#revision-draft-one-html-file-per-tag)), reordering
  moves out of the tag editor, which loses its ↑↓ buttons. A separate page at `/t/` (`public/t/index.html`, also
  `/t/index.html`; one directory below the root like every page, see [Routing](#routing)) has the sidebar like every
  page, lists the tags in their current (file-name) order with their display names, lets the user move them, and on
  save renumbers them `00010`, `00020`, … and sends the whole set with `PUT /v1/tags`
  ([LCTYSP-0006](LCTYSP-0006_http-api.md)). The contents of the tags are not changed. The tags dialog links to it
  (`../t/` from the pages in `/c/`).
  - `/t/` mirrors `/c/`: the conversations are `data/c/` and `/c/`, the tags `data/t/` and `/t/`. Should tag files ever
    be served under `/t/`, their names start with five digits (`00010-ruby.html`) and cannot collide with
    `index.html`. Whether they are served is not settled.
  - Its entry module would be a bundle `/t/index.js` like `/c/index.js` ([LCTYSP-0011](LCTYSP-0011_module-bundler.md)),
    so `siteUrl()` finds the root from it. `/t` without the slash redirects to `t/` as `/c` does.
- Narrow screens (720px or less): the conversation page hides the sidebar; the new conversation page shows it above its content.
- The history sent back to the model is read from the DOM: each `<lcty-message>` reads its text from attributes, which
  are exactly the saved strings ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)). No JSON has to be fetched to open a
  conversation.

### Routing

- **The site may be served under any path, not only at the root of its host** (behind a proxy, for example). So the
  pages and modules never write a URL that starts with `/`; the paths in this document (`/c/`, `/v1/`, …) are relative
  to the root of the site. The rules that make this work:
  - **Every HTML page is one directory below the root** (`/*/*.html`): the new conversation page and the conversations
    are in `/c/`. A page refers to the files of its own directory by their names (`lcty.v1.js`, `<id>.html`, `./`) and
    to the others through `../`.
  - **A module finds the root from its own URL:** `siteUrl(path)` of `public/js/site.js` is `path` resolved against
    the directory above the file that runs it, `js/site.js` itself or the bundle it is part of (`/c/index.js`,
    [LCTYSP-0011](LCTYSP-0011_module-bundler.md)), which is one directory below the root like the pages. The API
    client asks it for `v1/…`, `convUrl()` for `c/<id>.html`, and the pages for the workers, which are given whole URLs
    (or, for `js/sync_c_meta.worker.js`, resolve `../v1/meta-all.json` against their own URL).
  - `/` itself (`public/index.html`) only moves to `c/` (a `<meta http-equiv="refresh">`, without the query).
- **Under `/c/`, only conversation files come from `data/c/`.** `<id>.html` returns the conversation file untouched,
  and `/c/` itself (and `/c/index.html`) is the new conversation page, `public/c/index.html`; `/c` without the slash
  redirects to `c/` with its query, so that the page's relative paths resolve. The `lcty.v1.*` files always come from
  `public/c/`, the server's own copy, so an edit there shows at the next load without a restart; the copies of
  `lcty.v1.js` and `lcty.v1.css` in `data/c/` (below) are never served. The page's entry `/c/index.js` is the bundle
  served from memory (`lib/module_servlet.rb`). Nothing else is served.
  The header lines use relative paths, so the same file works over HTTP and opened directly.
- **`/c/` URLs are permanent** (conversation permalinks and the files the header lines load), so they are never moved
  under a versioned path such as `/v1/`. The assets carry their version in the file name (`lcty.v1.*`).
- Everything else under `/` is served from `public/` (`/` is `public/index.html`, which moves to `c/`).
- Ruby answers dynamically under `/v1/*` ([LCTYSP-0006](LCTYSP-0006_http-api.md), including `/v1/defaults.json` of
  [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)). Everything under `/c/` is static.
- **Serving code lives per URL prefix:** `/c/` in `lib/c/servlet.rb` (`Chatty::C::Servlet`), `/v1/` in
  `lib/v1/servlet.rb` (`Chatty::V1::Servlet`). Everything about vectors (the vector binary and the vector DB) is under
  `lib/v1/` too.
- **`chatty.rb` only wires the servlets together:** it opens the data (`Chatty.open_data`), builds the WEBrick server and
  mounts `/v1`, `/c` and `/`. At startup it publishes the `lcty.v1.*` files (`C.publish_assets`). It also applies transparent gzip to every servlet
  (`GzipServer`): 200 responses to GET of text-like types of 1 KiB or more, when `Accept-Encoding` allows gzip. The
  ETag is kept and `Vary: Accept-Encoding` is added, so conditional GETs still return 304. Shared parts live in `lib/`: settings
  (`lib/config.rb`) and storage (`lib/store.rb`).

## The `lcty.v1` files

Every page loads the same files, from `/c/` over HTTP. What reading a conversation offline needs, `lcty.v1.js` (the
frame) and `lcty.v1.css`, is also published at startup into `data/c/`, next to the conversation files: it belongs to
the user together with the conversations it renders, so a backup of `data/` keeps both
([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)). Each copy is rewritten only when its content changed, and `/c/` never
serves them (above). Nothing else is published there; other files in `data/c/` (copies an older server made) are left
as they are.

**Rule (path design): `c/lcty.v1.*` holds what a conversation file loads.** The header lines load them by relative
paths, so over HTTP they are `/c/lcty.v1.*` (in `public/c/`), and opened directly the two in `data/c/` are found next
to the file. A file a conversation file does not need on its own (one that only serves the
other pages, or a copy of server data such as the sidebar's meta database) is not a `/c/` file: it lives under
`public/` outside `public/c/` and is served from the root of the site (`js/sync_c_meta.worker.js`,
[LCTYSP-0010](LCTYSP-0010_data-and-settings.md); `fuzzy_search.worker.js` and `bdot264.wasm`,
[LCTYSP-0008](LCTYSP-0008_vector-binary.md)). The `lcty.v1.` prefix is for `/c/` files only. The new conversation page
(`index.html` and its entry `index.js`) is in `public/c/` too, as a page of `/c/`, but it is not published into
`data/c/`.

The `/c/` files refer to each other by **relative paths only**, so they work wherever the folder is: over HTTP at
`/c/` and opened directly from `data/c/` (`file://`, where only `lcty.v1.js` and `lcty.v1.css` are). The stylesheet is
linked once, by line 2, and no Shadow DOM
loads one (it would need a path of its own). The links between the pages are relative too: the sidebar links to the
new conversation page as `./` and to a conversation as `<id>.html`, since every page that shows it is in `/c/`.

| File (`/c/`)                         | Source                                                                       | Role                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lcty.v1.css`                        | `public/c/lcty.v1.css` (copied)                                              | The stylesheet for every page, loaded by `<link>` so pages are styled even without scripts.                                                                                                                                                                                                                                                                                                            |
| `lcty.v1.js`                         | `public/c/lcty.v1.js` (copied; generated from `lcty.v1.mjs`)                 | Classic script loaded synchronously in `<head>`. Declares `LctyT` and the custom elements (DOM structure only) and defines the elements at its end.                                                                                                                                                                                                                                                    |
| `lcty.v1.lang-ja.js`                 | `public/c/lcty.v1.lang-ja.js` (copied; generated from `lcty.v1.lang-ja.mjs`) | The Japanese texts, `LctyT.addLang("ja", …);`, a classic script loaded right after `lcty.v1.js`.                                                                                                                                                                                                                                                                                                       |
| `lcty.v1.mjs`, `lcty.v1.lang-ja.mjs` | `public/c/` (copied)                                                         | The ES module sources of the two above (`export` / `import` where the classic scripts have comments). Not loaded by the pages.                                                                                                                                                                                                                                                                         |
| `lcty.v1.module.js`                  | `public/c/lcty.v1.module.js` (copied)                                        | The module entry of the conversation page, imported by `<lcty-c>` once the page has loaded (so it never blocks rendering): it attaches the event listeners and features `/c/<id>.html` needs (the page code is written in it directly). Not bundled: it imports the modules in `public/js/` through `../js/…`, which the browser fetches from `/js/` of the site, so the features work over HTTP only. |

Types and documentation of `lcty.v1.js` are in `public/c/lcty.v1.d.ts`. `public/js/` (the modules) is not copied into
`data/c/`: it is served from `/js/` of the site, imported by `lcty.v1.module.js`, and bundled into `/c/index.js`. The `.d.ts` and `.license` files stay in the repository.

The new conversation page has its own module entry, which is not part of `data/c/`: `public/c/index.js` (`/c/`,
`js/pages/new.js`). It is bundled at startup and served from memory at `/c/index.js`
(`lib/module_servlet.rb`). The entry only imports the page's init function (`initNewPage` in `js/pages/new.js`) and calls it.
The workers are not `/c/` files either: `public/js/sync_c_meta.worker.js` (`/js/sync_c_meta.worker.js`, which fills the
sidebar's meta database, a copy of server data; a module worker that no module imports, so it is never bundled) and `public/fuzzy_search.worker.js` (`/fuzzy_search.worker.js`, semantic search,
with its kernel `public/bdot264.wasm`, built from `public/bdot264.wat`) work on server data, which a conversation file
opened on its own does not need.

- **The new conversation page's entry is bundled at startup** into one module file, by the module bundler
  ([LCTYSP-0011](LCTYSP-0011_module-bundler.md)): every module becomes a block and its code is never rewritten. This
  relies on conventions the modules follow (imports and exports on single lines, immutable exports, and every module
  except the entry only declaring at its top level); the server does not start when one is broken. So module state is a
  `const state = { … }` literal, classes are returned by functions (`cmdElementClass`, `convListClass`), and only the
  entry runs code at the top level: `lcty.v1.module.js` (not bundled, but following the same conventions) holds the
  conversation page's code, and `index.js` calls an init function.
- **`v1` is the rendering version.** When the format changes, the version goes up (`lcty-c.v2.*`) and old files keep
  opening with the old version.
- **The sources are ES modules; the served files are classic scripts generated from them and committed.**
  `public/c/lcty.v1.mjs` marks its exported declarations with `export`, and `public/c/lcty.v1.lang-ja.mjs` imports
  `LctyT` from it. The command that generates each classic script is in the head comment of its `.mjs`, which is
  canonical (`bin/prepare-commit.sh` only runs them): `export` becomes `/*export*/` and a line starting with `//?` loses
  that prefix in `lcty.v1.js`, and `import` becomes `// import` in the language script. The classic scripts are marked
  `linguist-generated` in `.gitattributes`. The server copies them as they are.
- **The classic script defines the elements at its end.** In `lcty.v1.mjs` the last line is
  `//?defineLctyV1CustomElements();`, so importing the module defines nothing (and `defineLctyV1CustomElements(registry)`
  can target another registry; it defaults to `globalThis.customElements`), while `lcty.v1.js` defines them as it runs.
  The elements are created while the body is parsed, after the language script in `<head>` has registered its texts.
- **The page's features are imported, not loaded by the header.** `<lcty-c>`'s `connectedCallback` imports
  `./lcty.v1.module.js` (resolved against the script's own URL) on the window's `load` event, or at once when the page
  has already loaded. It is not preloaded: after the first visit it comes from the HTTP cache (WEBrick sends
  `ETag` and `Last-Modified`; how long a copy is used without asking is the browser's default). Opened directly (`file://`), the import fails and the error is left as it is.
- **There is no inline script,** so a Content Security Policy needs only `script-src 'self'`. (chatty.rb does not
  send a CSP header yet.)
- The new conversation page (`/c/`) loads the same two classic scripts next to it, then its own entry `index.js`
  (`/c/index.js`) as a module script (deferred, so it never blocks rendering).
- Markdown rendering is the ordinary module `js/ui/markdown.js` on every page.

## Custom elements

**Only interactive parts are custom elements.** Structure without behavior of its own (frames, cards, headings, hints)
is plain HTML styled by `lcty.v1.css`; a custom element is used where a part has its own interaction or state (the
sidebar, the composer, messages, commands), or where a conversation file has to be assembled by one element
(`<lcty-c>`).

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

### Styling

- **Styling comes from outside through `::part()`** (multiple names are allowed, such as
  `part="lcty-message__action lcty-message__action--undo"`, and they combine with host conditions such as
  `lcty-message[data-last-user]::part(lcty-message__action--undo)`). CSS variables and inherited
  properties (`font`, `color`) reach inside. The old piercing selectors (`/deep/`, `>>>`) no longer exist.
- **Rule: styling belongs to the root CSS (`lcty.v1.css`).** Look and layout are written there, through `::part()`
  for what is inside a Shadow DOM. The exception is fine-grained tuning of a UI control that only serves its
  behavior (a textarea's `resize` and `outline`, a button's inner padding): that may be kept inside the Shadow DOM as an adopted stylesheet
  (`adoptedStyleSheets`): a `CSSStyleSheet` built with `replaceSync` in the element's constructor, right where its
  Shadow DOM is made, so the tuning sits next to the elements it tunes. It must stay
  small, since it is part of `lcty.v1.js`, and it never sets what the page would want to change (colors, sizes of
  text, spacing between elements, layout). Today: in `<lcty-c>` (the tag chip's × as a bare button, and the floating area letting clicks through
  between its buttons); in `<lcty-composer>` (the textarea as a bare field: no border, background,
  outline or resize handle, its inner padding and maximum height). Page rules through `::part()` still win over
  them (the outer tree's normal declarations come first in the cascade).
- **No Shadow DOM loads a stylesheet.** The page links `lcty.v1.css` once (line 2 of a conversation file, the
  `<head>` of the other pages), and every element inside a Shadow DOM that needs styling has a part. Nothing inside
  gets the page's element rules (`button`, `input`), and each part carries what it needs.
- **Rule: no global reset.** A rule such as `* { box-sizing: border-box }` or `button { font: inherit }` reaches only
  the Light DOM, so it would have to be repeated in every Shadow DOM (an adopted sheet each) to mean the same
  everywhere. Instead each rule says what its element needs: `box-sizing: border-box` where a width or height
  includes padding or border, `font: inherit` (and `color: inherit`) on controls. The button look is one rule for
  `button` / `a.button` and every `::part(lcty-button)`, so it carries those for all of them. A shorthand `font: inherit`
  in a `::part()` rule wins over an adopted sheet, so a `line-height` it must keep is written after it, in the same
  rule.
  - **Where `box-sizing: border-box` is written:** on a box whose width or height is set (a length, `100%`, `min()`,
    `max-width` / `max-height`) and that has padding or a border: the fields and the inputs at `width: 100%` (the
    search box, the title, the composer's textarea, the memory items), the sidebar's conversation items, the fixed
    widths (the sidebar, the tag picker), the boxes at most `--content-width` wide with padding (`lcty-message`, the
    composer, the system prompt, `main.narrow`, a running `lcty-cmd`), the creation card and the dialogs, and the
    thinking text (its `max-height`).
  - **Everything else keeps the browser's default** (`content-box`; buttons and checkboxes are `border-box` there):
    a box whose size comes from its content or its container is the same either way. `lcty-cmd`'s spinner is
    `content-box` on purpose: 14 px plus its 2 px border.
  - A new rule that sets a size on a box with padding or a border needs the declaration too; without it the box
    grows by its padding and border.
- **Rule: part names are BEM, with the custom element's tag name as the block.** What `::part()` can select is in
  effect one namespace: exported parts merge into the outer host's, and a short name (`tag`, `list`) soon means two
  things. The tag name is unique by construction (the custom element registry), so `<block>__<element>` never
  collides:
  - **element:** `lcty-c__header`, `lcty-sidebar__search`, `lcty-conv-list__title`, `lcty-message__foot`,
    `lcty-composer__input`, `lcty-cmd__spinner`. A block that is not a custom element is named the same way:
    `lcty-memory` (the memory dialog's contents, built by `js/tags.js`).
  - **modifier** (a state or a variant), added next to the element's own name, since `::part()` cannot be followed
    by attribute selectors: `part="lcty-conv-list__item lcty-conv-list__item--current"`,
    `lcty-c__tag lcty-c__tag--unknown`, `lcty-message__action lcty-message__action--undo`. Host states stay host
    conditions (`lcty-c[busy]::part(lcty-composer__send)`).
  - **mix** (a look shared across blocks): its own block added as another name, `part="lcty-c__delete lcty-button lcty-button--danger"`.
    Every button of the Shadow DOMs (and the sidebar's links) is `lcty-button`, with `--primary` or `--danger`; it is
    styled in one rule together with the pages' `button` / `a.button`, and the element part keeps only what differs.
  - **a nested element's host** is an element of the outer block: `lcty-c__sidebar`, `lcty-c__composer`.
- **Parts today.**
  - `lcty-c`: `__sidebar`, `__header`, `__title`, `__tags`, `__tag-list`, `__tag` (`--unknown`), `__tag-name`,
    `__tag-remove`, `__tag-picker`, `__propose-memory`, `__delete`, `__spacer`, `__dock`,
    `__float`, `__to-end`, `__end`, `__composer`,
    `__memory`.
  - `lcty-setup`: `__details`, `__summary`, `__text`.
  - `lcty-memory`: `__form`, `__title`, `__hint`, `__proposals`, `__proposal`, `__adopt`, `__tag`, `__text`,
    `__buttons`, `__spacer`.
  - `lcty-button` (mix): `lcty-button`, `lcty-button--primary`, `lcty-button--danger`.
  - `lcty-sidebar`: `__nav`, `__link` (new and settings), `__new`, `__settings` (the button opening the settings dialog), `__search-box`, `__search`, `__search-status`, `__list`.
  - `lcty-conv-list`: `__empty`, `__items`, `__entry`, `__item` (`--current`), `__title`, `__snippet`, `__tags`,
    `__tag`, `__tag-name`, `__meta`.
  - `lcty-message`: `__head`, `__who`, `__actions`, `__action` (`--undo`, `--fork`, `--regenerate`), `__thinking`,
    `__thinking-summary`, `__thinking-body`, `__foot`, `__status`, `__info`, `__timings`.
  - `lcty-composer`: `__form`, `__input`, `__buttons`, `__send`, `__stop`.
  - `lcty-cmd`: `__box`, `__spinner`, `__label`, `__stop`.
- **Nested Shadow DOMs export their parts under their own names.** `<lcty-c>` exports the sidebar's (and its list's)
  and the composer's parts unchanged (`exportparts`, `lcty-button` included), so a rule for them is written once per host:
  `lcty-sidebar::part(lcty-sidebar__nav), lcty-c::part(lcty-sidebar__nav)`. The two sidebar helpers in
  `lcty.v1.js` add the block to the element names they are given (`"item item--current"` becomes
  `lcty-conv-list__item lcty-conv-list__item--current`).
- Parts toggled with `hidden` set no `display`, or the part rule would override `hidden`.
- **`<lcty-cmd>`** is Light DOM (a file element); its Shadow DOM's parts are styled with `lcty-cmd::part(…)`.
- **How `lcty.v1.css` is arranged.** In order: the tokens (custom properties: colors, with their dark values; radii
  `--radius-control` / `--radius-card` / `--radius-pill`; `--shadow-float`; `--sidebar-width`; `--content-width`;
  `--font-mono`), the base (`[hidden]`, the button look, fields, tag chips), the pages, then one section per block
  (`<lcty-sidebar>` with `<lcty-conv-list>`, `<lcty-c>`, `<lcty-composer>`, `<lcty-message>` with its Markdown,
  `<lcty-cmd>`), the dialogs and forms (with the block `lcty-memory`), and last the narrow screens. A page's class that
  looks the same as a part shares its rule (`.hint, lcty-c::part(lcty-memory__hint)`), so one look is written once.
- **Comments in the code say what a rule or element does; the reasons and the rules behind it are here.** The code
  points to this section (LCTYSP-0005) rather than repeating it.
- Elements carry no stylesheet of their own, so many messages cost only their shadow roots. Measured with an 8 MB,
  6,000-message conversation: about 0.15 s from receiving it to `DOMContentLoaded` (about 20 ms without scripts; building
  each shadow root from `innerHTML` took 1–1.7 s).

### Elements

| Element           | Shadow DOM                                                                                                                                                                                      | Exposed fields                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<lcty-sidebar>`  | Head (new conversation, settings), search box, conversation list                                                                                                                                | `search`, `searchStatus`, `list`                                                                                                                                              |
| `<lcty-c>`        | The frame of a conversation file (used only under `/c/`): `<lcty-sidebar>`, header, `<slot>`, spacer, composer, memory dialog                                                                   | `sidebar`, `titleInput`, `tags`, `tagList`, `tagPicker`, `proposeMemoryButton`, `deleteButton`, `composer`, `toEndButton`, `dock`, `memoryDialog`                             |
| `<lcty-setup>`    | The system prompt (a file element, line 5): `<details>` with its text, from `data-instructions` (or `data-instructions-base64`)                                                                 | `text`                                                                                                                                                                        |
| `<lcty-message>`  | Head (who, action buttons for the role), a reply's thinking (collapsed, from `data-thinking`), `<slot>`, foot                                                                                   | `who`, `undoButton`, `forkButton`, `regenerateButton`, `thinking`, `thinkingSummary`, `thinkingBody` (`null` when the role has none), `foot`, `statusText`, `info`, `timings` |
| `<lcty-composer>` | Form (input, send, stop)                                                                                                                                                                        | `form`, `input`, `sendButton`, `stopButton`                                                                                                                                   |
| `<lcty-cmd>`      | Spinner, label, stop button (shown only while running, floating above the composer through `slot="float"`). **Defined in a module** (`js/ui/lcty-cmd.js`), because a command is behavior itself | `label`, `stopButton`, `run()`, `abort()`                                                                                                                                     |

- `<lcty-message>` builds buttons per role: user gets undo and fork, assistant gets regenerate. Parser-created elements
  have no `data-role` in the constructor, so `attributeChangedCallback` rebuilds the template with the role, replacing the
  fields. CSS shows undo only on the last user message (marked `data-last-user`) and regenerate only on the last reply.
- `<article>` (the reply body) is a plain container, not a defined element. A reply's thinking is part of
  `<lcty-message>` itself: its Shadow DOM shows `data-thinking` (or `data-thinking-base64`) as a collapsed `<details>`
  between the head and the content, so it is there at the first paint (and opened directly, without the module), and
  nothing is added to the file. While a reply is generated the module writes the summary ("Thinking… (n characters)")
  and, while it is open, the body; at the end it sets `data-thinking` and the element shows it. Files written before
  had a `<lcty-thinking>` child of the message; `lcty.v1.css` hides it and the module removes it.
- **A message's foot is the element's too,** settled at the first paint: it shows why an incomplete reply ended
  (`data-status`, `data-error`: "Stopped" or "Error: …") as text, and an ⓘ when the message has `data-timings` or
  `data-client`. The ⓘ is a button that opens a popover (`popovertarget`, no script; `popover="auto"`, so a click
  outside closes it) with the timings (tokens, speed, time to the first output), one per line. The module fills the
  popover in, so doing it after the first paint changes nothing on screen. Where anchor positioning is supported the popover opens just
  above the ⓘ, its implicit anchor (below it when there is no room); elsewhere it is centered, as popovers are by
  default.
- `<lcty-conv-list>` (the sidebar's conversation list) is defined in `lcty.v1.js` like the other elements: it builds
  the items (title, tag chips, date and, when known, the message count) as parts of `<lcty-sidebar>`'s Shadow DOM
  and fires `select` and `tag`. Pages give it items (`show(items, empty)`) and the current conversation (`current`).
  Each item is a link (`<a href="/c/<id>.html">`, with `#c-msg-<chunk id>` for a search result), so it can be opened
  in a new tab from the context menu or with a modified or middle click; those are left to the browser. A plain click
  fires `select` (cancelable) first: a page that handles it (scrolling within the open conversation) cancels it,
  otherwise the link is followed.
- Ids in the frame are styling hooks for CSS. Code reaches elements through the fields.

### Structure in `lcty.v1.js`, features in modules

- **`lcty.v1.js` defines DOM structure only.** Each element builds its Shadow DOM in its constructor with a small
  helper `$(el, attrs, ...children)` (`$(el, part, attrs, ...children)` in `<lcty-sidebar>`, where every element gets a part): attribute values are strings, as the DOM defines them (a boolean attribute is
  written as `""`; one that is absent is not written). `connectedCallback` is not extended later, elements fire no custom events
  of their own, and behavior is not mixed into the classes (no jQuery-style extension).
- **Every feature lives in modules** loaded from the page entries (`lcty.v1.module.js`, `index.js`; `js/pages/*.js`, `js/ui/lcty-elements.js`, `js/ui/sidebar.js`, `js/ui/settings-dialog.js`):
  Markdown rendering, streaming, thinking display, the timings text (in the popover the foot's ⓘ opens), sending with Enter (Shift+Enter inserts a
  newline; Enter during IME composition is ignored), generation, saving, selecting the code of
  a code block ("Select all", so the browser's own copy takes it; no clipboard API, which needs a secure context) and
  auto-resizing the composer. They attach handlers directly to exposed fields
  (`container.composer.form.onsubmit = …`, `message.undoButton.onclick = …`) and use plain functions that operate on the
  DOM (`appendMessage(container, m)`, `messageOf(el)`, …). Per-element state lives in `WeakMap`s.
- **The tree is decided in `lcty.v1.js`; modules never change it.** A module sets values, attributes and handlers on
  the fields, and appends to Light DOM only what the conversation file gets (messages), and sets the document title and attributes
  (`data-tag-defs`). So the page painted before the module has loaded has its final layout.
- **Each piece of the frame follows one input, and nothing is redrawn as a whole.**
  - **The title** is read once, in the constructor: the `<title>` is line 3 and `<lcty-c>` line 4, so it is already
    there. Later changes are the module's.
  - **The tag chips** follow `data-setup-tags` (for now the tags
    at creation only: the current tags in `tags.sqlite` are not shown in the header yet); **the picker's choices**
    and which chips are unknown follow `data-tag-defs`, the tag definitions, set only once they have arrived (until
    then nothing is marked unknown or disabled; the picker's width is fixed). Each is rebuilt in
    `attributeChangedCallback` for its attribute only.
  - **The system prompt is `<lcty-setup>` itself**, the first of the file's elements: it shows its own text (collapsed)
    through the `<slot>`, so nothing is copied into the frame.
  - **What shows before the first message is CSS:** `lcty-c:not(:has(> lcty-message))` hides the system prompt, the
    tags and "propose memory" (which also needs `data-setup-tags`); an empty `lcty-setup` is
    hidden too. No script watches the children.
  - Buttons do nothing until the module has loaded.
- **The sidebar's list is filled from the browser's copy of the meta, on every page.** `<lcty-sidebar>` fills its list
  as soon as it is in the document, before any module has loaded ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)):
  - from the `localStorage` snapshot `lcty.meta.v1` (the newest 20 conversations: id, title, `updated_at_hint`,
    `tags_hint` and `messages_hint`),
    synchronously, so the first view is there at the first paint;
  - when there is no snapshot, from IndexedDB `lcty` (store `c_meta`), asynchronously. The database is only read: when
    it does not exist yet it is not created (the meta sync worker owns the schema), and the list stays empty.

  These items have titles, dates, `tags_hint` as their tags and `messages_hint` as their counts (`showCached`), so
  they look the same as the module's items when the hints are up to date. `<lcty-c>`
  marks its own conversation as current when it is connected. Once the module has loaded, it shows the list from the same copy
  (IndexedDB, all conversations; `js/search/search-panel.js`) and reads it again whenever a sync has stored a new
  list, in this tab or another; a cached result that arrives after that is ignored. The sidebar does not fetch
  `/v1/conversations` to show the list. Before the first sync of a new browser the copy is empty, and the list stays
  blank instead of saying there are no conversations. A conversation created or changed outside this browser
  appears when the copy is next invalidated ([LCTYSP-0010](LCTYSP-0010_data-and-settings.md)).
- **Moving between pages keeps the sidebar in place.** `lcty.v1.css` turns on cross-document view transitions
  (`@view-transition { navigation: auto; }`) and names the sidebar (`view-transition-name: lcty-sidebar`), so on a
  same-origin navigation the browser keeps the sidebar where it is while the rest of the page changes. Only the sidebar
  takes part: the root is not captured (`:root { view-transition-name: none; }`), so the rest of the page changes at
  once, without a cross-fade. It is CSS only:
  it scrolls nothing and changes no tree, and a browser without it navigates as usual.

### Layout of the conversation page

- `<lcty-c>` is line 4, after the `<title>` (which the parser moves into the head), so it is created before the content. What it
  needs to know is on its own attributes (`id`, `data-setup-tags`, `data-created-at`; the
  system prompt is its first child, `lcty-setup`); its
  constructor builds the frame, and the parser then appends the file's elements to Light DOM, shown through the
  `<slot>` between the header and the composer. `lcty-setup` is the first of them; `lcty-cmd`
  shows itself only while it runs.
- **`<lcty-c>` is used only under `/c/`.** A conversation file cannot be assembled from parts (it is a fixed head and
  appended elements), so `<lcty-c>` does everything there. Other pages place components individually.
- The header is `position: sticky` at the top, the composer is `sticky` at the bottom, and the sidebar is
  `position: fixed`. A growing spacer after the `<slot>` keeps the composer at the bottom even with few messages.
- **The new conversation page (`/c/`)** puts the creation card (`main.new-card`, plain HTML) in the middle of the screen, framed like a dialog (border,
  rounded corners, shadow; at most 760px wide) so it reads as creating something. The sidebar is the same as on every
  page.
- **The whole page (window) scrolls.** New messages are appended to the end of `lcty-c`'s Light DOM.
- Content is never hidden while loading and does not move afterwards.

## Rendering streams

Rendering must stay cheaper than generation:

- Deltas arrive per token (a few bytes, about 50 per second). Receiving one only appends to a string buffer.
- Drawing is batched with `requestAnimationFrame`, once per frame.
- Markdown rendering fixes finished blocks in the DOM and redraws only the last, unfinished block (redrawing everything
  would be O(n²)). An unfinished code block is appended to a text node instead of being redrawn.
- Thinking is collapsed. While a reply streams in, its text is added to the body only while it is open.
- Markdown to HTML always escapes text and only allows `http:`, `https:` and `mailto:` link URLs. LLM output is never put
  into the DOM as raw HTML.
- **Suggested next messages are the one tag Markdown rendering reads:**
  `<suggestion-for-user-turn>text</suggestion-for-user-turn>`. The system prompt may ask the model to end a reply with a
  few of them, one per line. The text runs to the closing tag, or to the end of the line when the closing tag is
  missing (a reply still streaming in shows the button as soon as the opening tag arrives; a forgotten closing tag is
  forgiven). The text is plain text (no Markdown inside) and an empty one shows nothing. It is rendered where it is
  written as `<button type="button" class="suggestion">text</button>` (no URL, so the link rule above is unchanged; the
  file's allowlist already keeps it). Clicking one puts its text into the composer, to edit and send. Inside a code span
  it stays text. The reply's content keeps the tags as written, so the history sent back is unchanged. The earlier
  autolink form `<x-suggestion-for-user-turn:text>` is no longer read (replies saved with it keep their saved buttons).
- Messages do not use `content-visibility: auto`. Off-screen messages would get estimated heights, so the page's
  height changes after the first paint and the browser restores the scroll position against an estimated layout
  (Safari landed at a different place on every reload).
- **The rendering is settled by `lcty.v1.js`; the module is not needed for it.** The module runs after parsing and may
  run after the first paint; it prepares the messages (feet) and the header synchronously, and
  only then waits for the settings and the tags.
- **Scrolling is the user's.** The page never moves to the end by itself: where it opens is the browser's (the top, the
  `#c-msg-…` element, or on reload the previous position); the page does not touch `history.scrollRestoration`. Moving to the end
  on open fought the browser's restoration and the estimated heights of off-screen messages, and sometimes ended at
  the top.
- **"To the bottom" floats above the composer** (`#to-end` in `<lcty-c>`), shown while the end is out of view (more
  than 48px below): an `IntersectionObserver` watches an empty element at the end of the frame (`lcty-c__end`). It moves to the end once.
- **A running command floats next to it.** While an `lcty-cmd` runs (every generation does: sending, regenerating, a
  new conversation), it sets `slot="float"` on itself and floats next to "To the bottom" with its spinner and a stop
  button; when it ends it removes the attribute and is hidden again. Nothing scrolls the page except the button: not
  sending, not a reply streaming in.
- Not adopted: streaming insertion APIs such as `streamAppendHTML` (behind a flag as of 2026-11, not in Safari). The hard
  part, incremental Markdown parsing, has to be written anyway, and rendering is not a bottleneck.

## UI texts

UI texts follow `<html lang>`, matched exactly against the registered language tags (pages write `lang` as it is
registered, e.g. `ja`).

- **x-default is written where the text is used.** Elements call `LctyT._("send", "Send")`: the key and the x-default
  (English) text. There is no x-default table.
- **Languages are separate scripts.** `lcty.v1.lang-ja.js` (generated from `public/c/lcty.v1.lang-ja.mjs`; the language comes from the file name) calls `LctyT.addLang("ja", {…})`; tables are frozen when
  registered. A page loads the languages it needs after `lcty.v1.js` and before its body.
- **`LctyT._(key, text, lang = <html lang>)`** returns the translation when that language has the key (an empty
  translation counts as none), otherwise `text`. Callers always pass `text`; leaving it out shows `undefined`, so a
  missing text is visible.
- **Modules use `tr(key, text, vars)`** (`js/i18n.js`): `LctyT._` plus `{name}` placeholders filled from `vars`
  (`tr("searchFailed", "Search failed: {error}", { error: e.message })`), so a language can order the parts its own
  way. Toasts, statuses, confirmations, timings, the tag editor and the prompts sent for memory proposals all go
  through it.
- **Static HTML is English with keys,** localized by the page's init (`localize()`): `data-lcty-t="key"` replaces an
  element's text, and `data-lcty-t-placeholder` / `-title` / `-aria-label` replace that attribute. The English written
  in the HTML is the x-default, so a page without scripts or without the language shows English. Text around inline
  markup is split into elements (`<span data-lcty-t="…Before">` `<code>…</code>` `<span data-lcty-t="…After">`).
- **No Japanese outside the language tables.** Code writes English; Japanese lives only in
  `lcty.v1.lang-ja.mjs`. Messages that never reach the screen (internal errors, the server's messages) are plain
  English.
- All keys are listed in `LctyTextKey` in `public/c/lcty.v1.d.ts`.
