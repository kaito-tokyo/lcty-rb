<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0017: Markdown

- Status: Draft. The rules below are what the renderer is to do; `markdown.js` does not follow them all yet (see
  [What changes](#what-changes)).
- Related: [LCTYSP-0003](LCTYSP-0003_conversation-file.md#presentation-allowlist) (the presentation allowlist),
  [LCTYSP-0005](LCTYSP-0005_page-and-elements.md) (rendering streams, suggested next messages),
  [LCTYSP-0013](LCTYSP-0013_conversation-file-lcty-msg.md) (the `<article>` of a message),
  [LCTYSP-0016](LCTYSP-0016_hardening.md) (the Content Security Policy),
  [LCTYSP-1014](LCTYSP-1014_markdown.feature) (the tests of `markdown.js`),
  [LCTYSP-0018](LCTYSP-0018_markdown-streaming.md) (the DOM while a text streams in)

## Summary

A model's reply, a thinking and a system message are Markdown, and a page turns each into the `<article>` HTML that is
shown and saved. Until now nothing said which Markdown that is, or what HTML may come out of it: the renderer was the
only definition, and the server's allowlist and the page's Content Security Policy had to follow whatever it emitted.

This spec fixes both ends. The input is read with one grammar, the
[GitHub Flavored Markdown Spec](https://github.github.com/gfm/) (GFM). The output is not GFM's HTML but a small HTML of
lcty-rb's own, defined element by element below. That output is the one list the server's allowlist
(`ConvHtml::ALLOWED`) and the Content Security Policy are made from: what is not in it never comes out of the
renderer, and the server drops it if it does.

## Input: GFM is the only grammar

- **The grammar is GFM, version 0.29-gfm (2019-04-06)**, with all of its extensions: tables, task list items,
  strikethrough, extended autolinks and the disallowed raw HTML rule. It includes CommonMark 0.29, which GFM is built
  on. No other Markdown is read: no footnotes, no math, no definition lists, no front matter, no attributes `{…}`, no
  emoji shortcodes, no wiki links.
- **How a text is cut into blocks and inlines is GFM's**, to the letter: the precedence of blocks and inlines, lazy
  continuation lines, the tight and loose lists, the delimiter rules of emphasis, the matching of brackets in links,
  backslash escapes, entity and numeric character references, tabs. Where `markdown.js` and GFM disagree, GFM is right.
- **Every text is valid.** GFM has no syntax errors: any string has one reading. So the renderer never refuses a text,
  and the same text always gives the same HTML, byte for byte.
- **The text is read as it is stored** (the attribute of [LCTYSP-0003](LCTYSP-0003_conversation-file.md), decoded from
  base64 when it is written so). GFM's preprocessing applies: CRLF and CR are line ends, and U+0000 is read as U+FFFD.
  Other characters XML cannot hold are kept in the text and escaped in the output as any character is (they cannot
  appear in the saved `<article>`; see [Output text](#output-text)).
- **The one tag read in a text is `<suggestion-for-user-turn>`.** GFM reads it as raw inline HTML (its name is a valid
  tag name); this spec gives it its own output ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md), suggested next
  messages). Every other raw HTML is text (see [Raw HTML](#raw-html)).

## Output: the HTML of lcty-rb

The renderer's output is an HTML fragment, the contents of an `<article>`. It is written only with the elements and
attributes of the table below, in the form given there. It is never GFM's reference HTML; where the two differ, the
table wins.

### Blocks

| GFM                                    | Output                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraph                              | `<p>…</p>`; in a tight list item, the inlines alone, without `<p>`                                                                                                                            |
| ATX heading, setext heading of level n | `<hn>…</hn>` (`h1` to `h6`)                                                                                                                                                                   |
| Thematic break                         | `<hr>`                                                                                                                                                                                        |
| Block quote                            | `<blockquote>…</blockquote>`, its blocks inside                                                                                                                                               |
| Bullet list                            | `<ul>…</ul>`                                                                                                                                                                                  |
| Ordered list                           | `<ol>…</ol>`, with `start="n"` when it does not start at 1 (n: at most 9 digits, as GFM allows)                                                                                               |
| List item                              | `<li>…</li>`                                                                                                                                                                                  |
| Task list item                         | `<li>`, its first inline `<span class="task">☐</span>` or `<span class="task done">☑</span>` and a space (see [Decisions](#decisions))                                                        |
| Fenced code block, indented code block | `<div class="codeblock"><div class="codebar"><span class="lang">lang</span><button type="button" class="select">Select all</button></div><pre><code data-lang="lang">code</code></pre></div>` |
| Table                                  | `<div class="table-wrap"><table><thead><tr><th>…</th>…</tr></thead><tbody><tr><td>…</td>…</tr>…</tbody></table></div>`; `<tbody>` only when there are rows                                    |
| Column alignment                       | `class="align-left"`, `class="align-center"` or `class="align-right"` on each `th` and `td` of the column; no `style`                                                                         |
| HTML block                             | its lines as text, in `<p>…</p>` (see [Raw HTML](#raw-html))                                                                                                                                  |
| Link reference definition              | nothing; the links that use it are made with its destination                                                                                                                                  |
| Blank line                             | nothing                                                                                                                                                                                       |

- **Code blocks:** `lang` is the first word of the info string (up to the first space or tab), after backslash escapes
  and character references are resolved; for an indented code block, or a fenced one without an info string, the
  `<span class="lang">` is empty and `<code>` has no `data-lang`. The button's label is the page's language
  (`tr("selectAll")`). The code is the block's content exactly as GFM gives it, its last line end included.
- **Cells of a table** that a row lacks are written empty; cells beyond the header's count are dropped (GFM's rule).

### Inlines

| GFM                                                         | Output                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                                                        | its characters, escaped (see [Output text](#output-text))                                                                                                     |
| Code span                                                   | `<code>…</code>`                                                                                                                                              |
| Emphasis                                                    | `<em>…</em>`                                                                                                                                                  |
| Strong emphasis                                             | `<strong>…</strong>`; right inside another strong emphasis, its contents alone (as GFM's reference writes it)                                                 |
| Strikethrough                                               | `<del>…</del>`                                                                                                                                                |
| Link, autolink, extended autolink                           | `<a href="url" target="_blank" rel="noopener noreferrer">…</a>` when the URL is allowed; otherwise its text alone                                             |
| Image                                                       | a link: `<a href="url" target="_blank" rel="noopener noreferrer">alt</a>` when the URL is allowed; otherwise the alt text alone (see [Decisions](#decisions)) |
| Hard line break                                             | `<br>`                                                                                                                                                        |
| Soft line break                                             | `<br>` (see [Decisions](#decisions))                                                                                                                          |
| Raw HTML                                                    | text (see [Raw HTML](#raw-html))                                                                                                                              |
| `<suggestion-for-user-turn>text</suggestion-for-user-turn>` | `<button type="button" class="suggestion">text</button>`                                                                                                      |

- **Allowed URLs** are those whose scheme is `http`, `https` or `mailto`, after GFM has resolved the destination's
  escapes and references. The URL is written percent-encoded as GFM's reference does. A link's title is not written.
  An email autolink is `mailto:` and its address.
- **A link inside a link** is not made (GFM's rule): the inner one is its text.
- **A suggested next message** runs to its closing tag, or to the end of the line when the closing tag is missing. Its
  text is plain text, no Markdown inside, and an empty one gives nothing. Inside a code span or a code block it is
  text, as any raw HTML there is. The rest is as [LCTYSP-0005](LCTYSP-0005_page-and-elements.md) says.

### Raw HTML

GFM reads raw HTML, as HTML blocks and as inline raw HTML, and its reference passes it through. lcty-rb never does:

- **Inline raw HTML is text.** `<b>bold</b>` is shown as written, `&lt;b&gt;bold&lt;/b&gt;`.
- **An HTML block is a paragraph of its text.** Its lines are text, each line end a `<br>`, inside one `<p>`. It is
  still a block in GFM's sense: it ends where GFM ends it, and the Markdown around it is read as GFM reads it.
- **The disallowed raw HTML rule of GFM has nothing left to do**, since no raw HTML is passed through.

### Output text

- **Text is escaped:** `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;`; in an attribute value also `"` as `&quot;`.
  Character references of the input are resolved first, so `&amp;` in a text is shown as `&`.
- **The form is fixed:** element and attribute names in lowercase, attribute values in double quotes, the attributes
  in the order of the tables above, `<br>` and `<hr>` without a closing slash, no comments, no whitespace between
  blocks. The same tree is never written two ways.
- **The output parses back as itself:** an HTML parser reading it (gumbo on the server, the browser's on a page) builds
  exactly the tree that was written. No element is opened where HTML would close or move it (a block inside `<p>`, a
  `<div>` inside a `<p>`, text directly in `<table>`).
- **Characters XML cannot represent** (C0 controls other than tab, LF and CR, U+FFFE, U+FFFF) are written as they are
  in the fragment; the server, which writes the file as XML, drops them from the saved `<article>`, as it does today.
  The text in the attribute keeps them ([LCTYSP-0003](LCTYSP-0003_conversation-file.md)).

### Nothing else

The elements and attributes the tables above name are the whole output:

- Elements: `p br hr h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code div span button table thead tbody tr th td a
  strong em del`.
- Attributes: `ol[start]`, `code[data-lang]`, `th[class] td[class]` (`align-left`, `align-center`, `align-right`),
  `a[href]` (allowed URLs), `a[target=_blank]`, `a[rel="noopener noreferrer"]`, `div[class]` (`codeblock`, `codebar`,
  `table-wrap`), `span[class]` (`lang`, `task`, `task done`), `button[type=button]`, `button[class]` (`select`, `suggestion`).
- No `style`, no `id`, no event attribute, no `img`, no `input`, no form, no script.

`ConvHtml::ALLOWED` and `ATTR_OK` are this list and nothing more, and the Content Security Policy of
[LCTYSP-0016](LCTYSP-0016_hardening.md) needs no inline style for a presentation.

## A complete text

This spec says what DOM a complete text gives: the whole text is given, then its end. A reply that streams in is
given in pieces, and the DOM while it is still coming in is the subject of
[LCTYSP-0018](LCTYSP-0018_markdown-streaming.md). That spec keeps one rule of this one: **once the end is given, the
DOM is the one this spec gives for the whole text**, however the text was cut.

## Limits

- Rendering takes time linear in the text, or close to it: GFM's pathological inputs (deeply nested brackets, long runs
  of delimiters, deep block quotes and lists) must not make it quadratic.
- Block quotes and list items nest at most 32 deep: a `>` or a list marker that would open a 33rd level is not read as
  one, and stays text of the paragraph it is in. The output has a bounded depth, which an HTML parser reading it back
  keeps as it is (browsers flatten a tree past a few hundred levels).
- A link destination holds at most 32 levels of unescaped parentheses; one with more is not a destination. GFM lets an
  implementation set such a limit (it asks for at least three levels).
- The tests run every example of the GFM spec and pathological texts of 100000 repetitions
  ([LCTYSP-1025](LCTYSP-1025_gfm-parser.feature)).

## Decisions

The choices this spec makes where GFM leaves the output to the renderer, or where lcty-rb departs from GFM's HTML:

1. **Raw HTML is text.** Nothing written by a model becomes markup, as before. The one exception is the suggestion tag.
2. **Images are links.** An image is not loaded: a remote image would tell its host that a conversation was opened,
   and the Content Security Policy allows images from the server only. The alt text is the link's text.
3. **A soft line break is `<br>`.** A model writes lines to be shown as lines, as GitHub shows them in comments;
   GFM's reference writes a newline, which a browser shows as a space.
4. **Alignment is a class.** `class="align-left|align-center|align-right"` with the page's style sheet, instead of
   `style="text-align:…"`. This settles decision 1 of [LCTYSP-0016](LCTYSP-0016_hardening.md): `style-src 'self'`
   with no `style-src-attr 'unsafe-inline'`.
5. **A task box is a character.** `☐` and `☑` in a `<span class="task">`, not GFM's `<input type="checkbox">`: a box
   cannot be ticked (the text is the model's), a saved file reads the same without a style sheet, and no form element
   is let into a presentation.

## What changes

- **`markdown.js`** is replaced by a GFM parser that builds the DOM itself (no HTML string, no `innerHTML`). Today it
  reads with regular expressions a subset close to GFM: no setext headings, indented code, reference links, images,
  character references, task list items or extended autolinks with `www.`, and emphasis that does not follow GFM's
  delimiter rules. The first goal is the DOM of a complete text; its behaviour while a text streams in comes after.
- **Tests.** [LCTYSP-1014](LCTYSP-1014_markdown.feature) gets GFM's examples: each example of the GFM spec, with the
  expected HTML its reference gives, mapped to this spec's output by the tables above. The examples whose output this
  spec makes different (raw HTML, images, soft line breaks, task list items) are listed with their own expected HTML.
- **The server's allowlist** follows [Nothing else](#nothing-else): `th[class]` and `td[class]` replace `th[style]` and
  `td[style]`, and class values are checked against the list instead of any word.
- **Files already saved** keep their presentations; their text, in the attributes, is never lost, and a presentation
  of an older renderer can be made again from it (`data-generator`, [LCTYSP-0003](LCTYSP-0003_conversation-file.md)).
  Until it is, the `style` of an old table is ignored under the Content Security Policy and its columns lose their
  alignment.
