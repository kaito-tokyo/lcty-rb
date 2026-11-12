// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// tail.js: the tail converter of LCTYSP-0018. While a reply streams in, the text after its last committed block, the
// tail, is shown by this module until it is committed, and then written again by the committed converter. It is a
// heuristic of its own: it imports nothing, shares nothing with convert/gfm/, and only has to look right for a moment.
// The implementation carries one-line comments only; its documentation is this file.

/** A node to show: text, or an element as its tag, its attributes as name, value, … (or null) and its children. */
export type TailNode =
	| string
	| [tag: string, attrs: string[] | null, children: TailNode[]];

/** What tailNodes takes besides the text. */
export interface TailOptions {
	/** The label of a code block's button ("Select all" when not given; the page gives tr("selectAll")). */
	selectAll?: string;
	/** The text of a named character reference, or null (convert/reply.js's in the page; none when not given). */
	decodeName?: (name: string) => string | null;
}

/**
 * The nodes that show text, the tail of a reply, as LCTYSP-0017's elements and attributes and nothing else. text is
 * the tail as it is now: when it does not end with a line end, its last line may still grow.
 */
export function tailNodes(text: string, options?: TailOptions): TailNode[];

/**
 * Make parent's children the nodes. A node drawn already is kept where it is the same, an element of the same tag and
 * attributes (its children are drawn in turn) or a text node; a text that grows at its end is appended to its text
 * node; anything else is replaced, and what is left over is removed. Made with createElement, setAttribute and
 * append, with no innerHTML.
 */
export function drawTail(parent: Element, nodes: readonly TailNode[]): void;

// How it reads (tail.js)
//
// Blocks are read line by line, as GFM reads them where that is simple: ATX and setext headings, thematic breaks,
// fenced code blocks, block quotes (with lazy lines), lists (bullet and ordered, a list being its items of one kind of
// marker, an item its lines indented as far as its content and the lazy lines of its paragraph, loose when a blank
// line is between two items or two of an item's own blocks), tables, and paragraphs (a paragraph's link reference
// definitions left out). Block quotes and list items nest at most 32 deep, as in LCTYSP-0017. Not read: indented code
// blocks (their lines are text), HTML blocks (their lines are a paragraph's), and a definition over several lines.
//
// Inlines are read in one pass, then the delimiter runs are matched as GFM matches them, more or less: backslash
// escapes, code spans, character references, autolinks, extended autolinks (www., http:// and https://, email
// addresses), suggested next messages, emphasis, strong emphasis, strikethrough, inline links and images. Raw HTML is
// text; a reference link is its text as written. A link or an image is <a> when its destination's scheme is http,
// https or mailto and it is not inside another link, else only its text (an image's: its alt text); a link's text is
// looked for 1,000 characters at most.
//
// A guess the next characters often undo is not made. What is unclosed is text: ** or ` without their closer, a link
// without its ), a suggestion's text runs to the end of its line. A line that may still grow (the last, when the text
// does not end with a line end) does not make the lines above a table, nor a setext heading when it is - or = alone or
// doubled. A table is a table only from its delimiter row, and a list's trailing blank lines do not make it loose.
//
// A code block that is still open writes its last line without a line end, so that the next frame's code begins with
// this one's and drawTail appends to its text node.
