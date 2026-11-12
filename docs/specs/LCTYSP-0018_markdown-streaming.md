<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0018: Markdown streaming

- Status: Draft. `lcty-elements.js` streams a reply as [In the page](#in-the-page) says, with the tail's box and
  following the reply of `tail-box.js`; every question of [Open questions](#open-questions) is decided.
- Related: [LCTYSP-0017](LCTYSP-0017_markdown.md) (the HTML of a complete text),
  [LCTYSP-0005](LCTYSP-0005_page-and-elements.md#rendering-streams) (rendering streams),
  [LCTYSP-1025](LCTYSP-1025_gfm-parser.feature) (the tests of the parser, streamed too)

## Summary

A reply streams in a few characters at a time. [LCTYSP-0017](LCTYSP-0017_markdown.md) says what HTML a complete text
gives, and that once its end is given the DOM is that HTML, however the text was cut. This spec says what the page
shows while the text is still coming in.

The text is split at one boundary. The part before it is made of **committed blocks**: top-level blocks that GFM has
ended, whose HTML can no longer change. The part after it is the **tail**, which the next characters may still change.
A committed block is written by one converter, exactly as LCTYSP-0017 says. The tail may be shown by another one, a
heuristic that only has to look right for a moment, since whatever it shows is replaced when its text is committed.

## The commit boundary

- **The blocks are cut by GFM's block parser** (`BlockParser` of `js/convert/gfm/gfm_blocks.js`). Its `advance` takes
  the first top-level block of the tail once the tail's lines end it ([LCTYSP-1025](LCTYSP-1025_gfm-parser.feature)). A
  block it takes is committed; the rest that it gives is the new tail.
- **When to try `advance` is a guess.** `BlockWatch` (`js/convert/gfm/converter.js`) reads each complete line of the
  tail once and says when the tail may have ended its first block. It may say yes too often, never too seldom for long:
  a block it misses is taken at the next yes, or at the end.
- **A committed block is final.** Its HTML is made once, by the committed converter, and is never changed afterwards,
  but for one case: a link reference definition that comes after its use.
- **A definition after its use writes the committed blocks again.** A block's inlines are parsed when it is committed,
  with the definitions read so far. When a block that is committed brings a definition the document did not have, and
  blocks were committed before it, the committed text is parsed whole and the `<article>` written again from it, so a
  reference link used before its definition becomes a link at once. It costs the committed text's length, once for each
  block that brings new definitions; a definition of a label already defined changes nothing, as the first one counts.
- **Committing replaces the tail's view of that text.** Whatever was shown for the text of a block that is committed,
  by the tail converter, is removed, and the committed block's HTML takes its place. The page never merges or patches
  the two: the committed HTML is always made afresh from the committed block.
- **At the end, everything is committed.** When the reply ends, the tail is advanced with `end`, which takes every block
  left, and the tail is empty. The DOM is then the committed blocks one after another, which is the HTML of
  LCTYSP-0017 for the whole text.

## Two converters

- **The committed converter** writes a committed block as LCTYSP-0017's output, from the document tree of the block
  phase and the inline phase. It is the only one whose output is kept: what the page saves in the `<article>` is the
  committed blocks' HTML.
- **The tail converter** writes the tail for the moment. It is a heuristic: it may read the tail differently from GFM,
  and it may show less than GFM would (plain text, say). It writes only elements and attributes that LCTYSP-0017's
  output has ([Nothing else](LCTYSP-0017_markdown.md#nothing-else)), and escapes text as that output does, since what
  it shows is the model's text as much as a committed block is.
- **They are independent.** Each is its own module: neither imports the other, and neither shares code for writing
  HTML with the other. Both may read the document tables the parsers share (`NodeTable`, `SpanStore` and the parsed
  text) and the parser's state, but only read them: the tables are written by the parsers alone.
- **The tail converter is optional.** Without it the tail is not shown, and the page shows the committed blocks only;
  the rules above still hold.

## In the page

- **The `<article>` holds the committed blocks only.** They are appended to it in order, so at every moment it is what
  would be saved of the text committed so far, and nothing has to be left out of it when it is saved.
- **The tail's view is right after the `<article>`**, outside it: one element, its next sibling, which only the tail
  converter writes. Being after the last committed block, it reads as the end of the reply. It is removed when the
  reply ends, the tail being empty then.
- **Drawing is batched**, once a frame with `requestAnimationFrame`
  ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md#rendering-streams)). A delta only appends to the text. In a frame the
  page tries `advance` as `BlockWatch` says, writes the blocks it took, and then lets the tail converter redraw the
  tail.
- **The cost of a frame does not grow with the reply.** A committed block is written once; a frame's work is the new
  characters, the blocks taken, and the tail's redraw, which costs the tail's length at most.
- **The tail converter is `convert/tail.js`,** a parser of its own (the second choice of
  [Open questions](#open-questions) 1), which imports nothing and shares nothing with `convert/gfm/`
  ([LCTYSP-1027](LCTYSP-1027_tail-converter.feature)):
  - Each frame it reads the whole tail again, blocks and inlines, as GFM reads them where that is simple, and gives the
    nodes that show it, LCTYSP-0017's elements and attributes only. A complete text that uses only what it reads gives
    what the committed converter writes.
  - It makes no guess that the next characters often undo: what is not closed yet (`**`, a backtick, a link without
    its `)`) is text, a table is a table only from its delimiter row, and a line that may still grow does not make the
    lines above a table or a setext heading. A reference link is its text as written, and a suggested next message is
    a button from its opening tag, its text running to the end of the line.
  - It changes the view rather than writing it again ([DOM writes](#dom-writes)): an element of the same tag and
    attributes is kept and its children compared in turn, a text that grows at its end is appended to its text node,
    and only what differs is made, replaced or removed. An open fenced code block writes its last line without a line
    end, so its code grows in one text node.

### The tail's box

The tail's view is a box whose size the page sets, not its content: it is reserved ahead, the tail is written inside
it, and it is made larger only when what is written no longer fits. So what the tail converter writes is laid out
inside a box of a fixed size, which is the case containment is for
([What the browser engines say](#what-the-browser-engines-say)), and the page's height changes a few times in a reply
instead of every frame.

- **The box is reserved.** It is `div.md-tail`, made with the reply's first delta, a third of the view's height high
  (`innerHeight / 3`), and `contain: strict` (size, layout and paint): its content never changes the layout around it,
  nor its size.
- **It grows in steps.** The content is one element inside the box, `div.md-tail-content`, laid out at its own height.
  When that height is more than the box's, the box is made as tall as the content and a step more, a third of the
  view's height again. The height is read without forcing a layout: a `ResizeObserver` on the content reports it after
  the browser has laid the frame out, and the box is changed in that callback, so the browser lays the page out once
  more before it paints and no frame shows the content cut off.
- **A commit does not move what is below.** When a block is committed, its HTML is added to the `<article>` above the
  box and its text leaves the tail, so the box is made smaller by the height the `<article>` gained, as far as the
  content still fits: the reply's height stays, and the page does not jump at each commit. The same `ResizeObserver`
  reads the `<article>`'s height. While the box is there the `<article>` is `display: flow-root`, so that its blocks'
  margins are inside it and its height is all that a commit adds above the box.
- **At the end the box goes.** When the reply ends the tail is empty, and the box is removed with the room left in it;
  the page's height falls once, by what was reserved and not used.

The box also gives the page a simple measure of whether the reader is at the reply's end:

- **Following the reply.** The page follows the reply from when at least 80% of the box comes into view (80% of the
  view's height, when the box is taller than the view): it keeps the end of the tail's content in view as the content
  grows, 16px above the composer. It stops following when the box leaves the view entirely,
  or when the reader scrolls: a scroll the page did not make itself, by a wheel, a touch, a key or the scroll bar,
  stops it at once, even with the box still in view, so the page never pulls the reader back. Following starts again
  only when the box comes into view again by 80%, as it does when the reader goes back to the end, or presses "To the
  bottom". Whether the box is in view is read from an `IntersectionObserver` on it, at every 5%, with no read of
  layout. The reader's scrolls are told apart by their input, not by the scroll events, which the page's own changes
  of height cause too; a scroll bar drawn over the page, as macOS's is, leaves no input to see, so dragging it does
  not stop following.
- **The one way the page scrolls by itself.** Following is the exception
  [LCTYSP-0005](LCTYSP-0005_page-and-elements.md#rendering-streams) makes to scrolling being the user's: only while the
  reader is at the reply's end, and never on opening a page or sending.

### How others write a stream

How streamed Markdown is put into the DOM elsewhere, as of 2026-11 (see [Sources](#sources)):

- **Everything again, each chunk.** The text so far is converted whole and set with `innerHTML`. Chrome's guide on
  rendering streamed LLM responses calls this the slow way: every chunk makes the browser remove and rebuild what it
  had, and parse and lay out the whole again. lcty-rb's renderer before LCTYSP-0017 avoided it already, by fixing
  finished blocks.
- **Append only.** A streaming parser writes elements as the characters come and never changes one it has written
  (`streaming-markdown`, which Chrome's guide shows; it appends with `appendChild`, and plain text with `append`, not
  `textContent +=`). It is cheap, and what was streamed stays selectable, but its guesses are final: it is "optimistic",
  so a mark read one way stays read that way. GFM cannot be read so: a line may turn a paragraph into a heading or a
  table later.
- **Finished blocks once, the last one again.** The text is cut into blocks; a block that is finished is rendered once
  and kept, and only the last one is parsed and rendered again on each update (Vercel's `streamdown`, which also
  repairs unclosed marks of the last block before rendering it with `remend`; `semidown`; StreamMD, which keeps an
  unfinished line apart from the blocks; Svelte's `svelte-markdown`, which diffs the tokens of a whole new parse). It is
  this spec's design: the committed blocks are the finished ones. Those libraries decide a block is finished by a guess
  (`streamdown`: it ends with a blank line and two more blocks follow), where this spec uses GFM's block parser, so a
  committed block is never wrong.
- **Morphing.** A library makes an element's DOM match new HTML by changing only the nodes that differ (`morphdom`,
  `idiomorph`, which matches nodes better and is about as fast). None of the sources compares it with `innerHTML` by
  measurement; `morphdom` says only that patching small changes may be faster.
- **Skipping what is out of view.** `content-visibility: auto` skips the layout and paint of what is off the screen,
  but its sources advise against it for content that changes, and
  [LCTYSP-0005](LCTYSP-0005_page-and-elements.md#rendering-streams) does not use it for messages, as it makes the
  browser restore the scroll position against estimated heights.

### What the browser engines say

What the engineers of Chromium and WebKit, and Igalia, who implemented containment in both, have written about the
work a change makes (see [Sources](#sources)):

- **A change is laid out for the whole document unless a box contains it.** Layout is document-wide: a change in one
  element may make the browser check every element. `contain: layout` makes an element's inside and outside
  independent for layout, so a change inside it is laid out from it, not from the document's root: in WebKit the
  element becomes a relayout boundary, and layout starts at it rather than at the view (bug 227948, which measured
  about 2.3 times as many runs a second on its test). Igalia measured layout going from about 4 ms to 0.04 ms for a
  change of text among 10,000 elements, with `contain: strict` on boxes of a fixed size. Chrome's article recommends
  `contain: content` (layout and paint) as the usual value.
- **A box of a fixed size can be laid out alone; one whose size follows its content cannot.** `contain: size` makes an
  element's size independent of its children, so their changes never move what is around it, but an element without a
  given size is then 0 by 0; on its own it brings little. A reply that streams in grows, so its box cannot be fixed,
  and a change in it still moves what follows it. The tail's view is at the end of the reply, so what follows it is
  little: the composer and the page's end.
- **Layout is cached by its inputs.** Chromium's LayoutNG keeps an immutable fragment for each box with the
  constraints it was laid out under, and lays a box out again only when those change; a size given in fixed units is
  not invalidated by a change of the available size, a percentage is. A frame's change is meant to cost what changed,
  under a millisecond: what does not change is reused, from style to paint.
- **Text is laid out by the paragraph.** Inline layout is cached per paragraph, and text is shaped and broken into
  lines a paragraph at a time; the width of a text is not the sum of its parts' widths. So a change of text inside a
  paragraph lays the whole paragraph out again, and a long paragraph that grows each frame costs its length a frame.
- **Reading layout between writes forces it.** A read of a layout value (`getBoundingClientRect`, `offsetHeight`) after
  a change makes the browser lay out at once (a forced synchronous layout); reads and writes by turns lay out many
  times a frame (web.dev, Chrome DevTools' Forced Reflow insight). A frame should write and leave layout to the
  browser, before it paints.
- **Content that is off the screen can be skipped**, with `content-visibility: auto`, which also brings layout, style
  and paint containment; `contain-intrinsic-size: auto` keeps the size last laid out as the placeholder. Chrome's guide
  on complex layouts recommends it for self-contained regions.
  [LCTYSP-0005](LCTYSP-0005_page-and-elements.md#rendering-streams) turned it down for messages because of estimated
  heights; the remembered size answers part of that.
- **Scroll anchoring** keeps what the reader sees still when content above it changes (Chrome since 56, Firefox, and
  `overflow-anchor: none` to opt out). WebKit does not have it (bug 171099). A reply streams in below what is read,
  so it matters only when the view of a block above the reader is replaced by a committed block of another height.

What this means for the page, to be measured before it is decided:

- Each message's `<article>`, and the tail's view, as a box of `contain: layout` (or `content`), so that a change in
  the tail is laid out from the tail and not from the conversation.
- The tail's paragraphs kept short: a paragraph is laid out whole, so the paragraph being written is the frame's
  text layout.
- No read of layout between the frame's writes.

What the sources leave open, and the measurements below look at: how much rewriting the last block costs against
morphing it, and whether a committed block is cheaper made with DOM methods or as parsed HTML. No source gives numbers
for Safari.

### DOM writes

What a frame costs is mostly what it does to the DOM: the nodes it makes and removes, and the style and layout they
need before the frame is painted. The ways of writing were measured on a reply streamed in ([DOM writes](#dom-writes-1)
under Measurements):

- **The tail's view is changed, not rewritten.** Each frame the tail converter makes its view what it is to show by
  keeping every node that is already right: an element of the same name and attributes is kept and its children are
  compared in turn, a text node's data is set only when it differs, and only the nodes that differ are made, replaced
  or removed. Rewriting the view whole each frame (`innerHTML`, or nodes made afresh and `replaceChildren`) cost about
  nine times as much, as a tail is mostly the same from one frame to the next and grows at its end.
- **A committed block is written once, as DOM nodes.** Making its nodes with the DOM's methods and parsing its HTML cost
  the same, so it is made as [LCTYSP-0017](LCTYSP-0017_markdown.md#what-changes) says, without `innerHTML`. It is
  appended to the `<article>`, and nothing written before it is touched.
- **Comparing the tail's top-level blocks as HTML strings saved little**: a tail is mostly one long open list or block
  quote, which is one top-level block that changes every frame.

## Open questions

1. **What the tail converter shows.** Decided: a parser of its own, `convert/tail.js` ([In the page](#in-the-page)).
   The committed boundary is a top-level block, so a long list or block quote stays
   in the tail until it ends. In replies written by a model, the tail was over 500 characters for 18–77% of the stream
   (see [Measurements](#measurements)). Choices:
   - **Plain text.** The tail's characters, escaped, its line ends as `<br>`. Nothing to get wrong, but the Markdown's
     marks show until the block is committed, and then the view changes at once.
   - **A parser of its own.** The tail converter reads the tail again each frame with a heuristic of its own, blocks and
     inlines, and draws that. It costs the tail's length a frame, and shares nothing with GFM's parser.
   - **The block parser's open tree.** The rows under the root of the last `advance` (row 1) are the tail's blocks as
     GFM reads them so far, list items and paragraphs with their spans; the tail converter reads them, and draws their
     inlines with a heuristic of its own. They are up to date only when `advance` has read every complete line of the
     tail: with `BlockWatch` deciding, `advance` ran 8 to 15 times a text, and what the open tree held fell short of the
     tail by as much as the tail itself (up to 4,289 characters, over 200 for 36–85% of the chunks of the pull request
     bodies). So `advance` would be tried once a frame, not only when `BlockWatch` says so; each try reads the tail from
     its start, which costs its lines rather than its characters (an open list of 22 lines and 4,000 characters took
     0.013 ms).
   - **The closed children first.** An open list's or block quote's children that have closed are written as committed
     ones before the rest. An item closes when the next one starts, but a list's tightness is known only at its end, so
     a list that turns out loose has its items written again.
2. **Link reference definitions after their use.** Decided: the committed blocks are written again as soon as a
   block brings a new definition ([The commit boundary](#the-commit-boundary)), so the DOM at the end is the whole
   text's. Writing again only the blocks with a bracket that matched no definition would cost less, but needs the
   inline parser to tell which those are, and a reply rarely has a definition at all.
3. **Code blocks in the tail.** Decided: an unfinished fenced code block, often the longest tail, grows in one text
   node, as the tail converter changes the view rather than writing it again and writes an open block's last line
   without a line end.
4. **What moves when a block is committed.** Decided: the tail converter avoids guesses that are often wrong. The
   committed HTML may still differ from the tail's view of the same text (a list that turns out loose, a definition
   that comes after its use, what the heuristic does not read), and the view then changes once at the commit.
5. **Suggested next messages** ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md#rendering-streams)). Decided: the tail
   converter shows one as soon as its opening tag arrives, its text running to its closing tag or the end of its
   line.
6. **The size of the tail's box.** Decided: a third of the view's height reserved, and a third more at each step
   ([The tail's box](#the-tails-box)). A larger reserve grows less often but leaves more room unused at the end, which
   the page loses at once when the box is removed.

## Measurements

### Block streaming

Block streaming with GFM's parser was checked on 12 Markdown texts written by a model (a reply of 603 characters and 11
pull request bodies of 1,712 to 5,041), cut into chunks of 1 to 12 characters at random, with `BlockWatch`, each
block's inlines parsed when it was committed:

- The committed blocks' HTML, one after another, was the whole text's in every text.
- The cost was 0.3 to 4 ms for a whole text, and 1.3 ms at most for one chunk; `advance` ran 8 to 15 times a text.
- The tail was long: at most 258 characters in the short reply, and 812 to 4,388 in the pull request bodies, whose
  large nested lists stay in the tail until they end. It was over 500 characters for 18–77% of the chunks of those.
- A block was committed at most 397 characters after its last one had come in: a block's end is known only once the
  next line is complete, and that line may be a long paragraph.

### DOM writes

A reply of 9,394 characters (three texts written by a model, one after another) was streamed 6 characters a frame,
1,566 frames, in the Chromium of the Claude desktop app (156), below 40 replies already shown. Each frame appended the
blocks committed in it and redrew the tail with the tail parsed whole, the style and layout done at its end
(`getBoundingClientRect`); the time is the median of 5 runs:

| Way                                                                  | All frames | Median frame | 95% of frames | Worst frame |
| -------------------------------------------------------------------- | ---------- | ------------ | ------------- | ----------- |
| `insertAdjacentHTML` for a committed block, `innerHTML` for the tail | 404 ms     | 0.2 ms       | 0.7 ms        | 2.2 ms      |
| DOM methods for both, the tail made afresh (`replaceChildren`)       | 408 ms     | 0.2 ms       | 0.7 ms        | 6.0 ms      |
| DOM methods for both, the tail's nodes kept where right              | 44 ms      | 0.0 ms       | 0.1 ms        | 1.0 ms      |
| The tail's top-level blocks compared as HTML, changed ones parsed    | 371 ms     | 0.2 ms       | 0.6 ms        | 2.2 ms      |

The committed blocks' HTML was the same in every way. The timer of a page that is not cross-origin isolated counts in
steps of 0.1 ms, so the frames' times are coarse; the totals are not. Safari and Firefox were not measured.

## Sources

- Chrome for Developers, [Best practices to render streamed LLM responses](https://developer.chrome.com/docs/ai/render-llm-responses)
  (2025-01).
- [thetarnav/streaming-markdown](https://github.com/thetarnav/streaming-markdown), an append-only streaming parser.
- [vercel/streamdown](https://github.com/vercel/streamdown): `packages/streamdown/lib/parse-blocks.tsx` (the blocks and
  the reuse of a finished prefix) and `packages/remend` (closing unclosed marks).
- [chuanqisun/semidown](https://github.com/chuanqisun/semidown), semi-incremental: finished blocks once, the rest
  parsed again.
- [I made streaming Markdown 300x faster](https://dev.to/jvoltci/i-made-streaming-markdown-300x-faster-heres-the-architecture-4a9f)
  (StreamMD): only the new characters parsed, an unfinished line kept apart.
- [@humanspeak/svelte-markdown](https://app.unpkg.com/@humanspeak/svelte-markdown@1.8.5/files/dist/utils/incremental-parser.d.ts):
  the whole parsed again, its tokens diffed with the last ones.
- [bigskysoftware/idiomorph](https://github.com/bigskysoftware/idiomorph) and [morphdom](https://npmjs.com/morphdom),
  DOM morphing.
- Paul Lewis, [CSS containment in Chrome 52](https://developer.chrome.com/blog/css-containment) (Chrome for Developers).
- Manuel Rego Casasnovas, [An introduction to CSS Containment](https://blogs.igalia.com/mrego/2019/01/11/an-introduction-to-css-containment/)
  (Igalia, 2019).
- WebKit [bug 227948](https://bugs.webkit.org/show_bug.cgi?id=227948): layout containment as a relayout boundary, with
  a performance test (r280286, 2021).
- Ian Kilpatrick and Koji Ishii, [RenderingNG deep-dive: LayoutNG](https://developer.chrome.com/docs/chromium/layoutng)
  (Chrome for Developers), and Ian Kilpatrick on [Igalia Chats](https://www.igalia.com/chats/ian-fps) (2023).
- Chrome for Developers,
  [Optimizing interactions in complex layouts](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/interactions-in-complex-layouts).
- web.dev, [Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing).
- [CSS Scroll Anchoring Module Level 1](https://www.w3.org/TR/css-scroll-anchoring/), and WebKit
  [bug 171099](https://bugs.webkit.org/show_bug.cgi?id=171099) (scroll anchoring in WebKit).
- [CSS Containment Module Level 2](https://www.w3.org/TR/css-contain-2) and LogRocket,
  [Using CSS content-visibility](https://blog.logrocket.com/using-css-content-visibility-boost-rendering-performance)
  (not for content that changes).
