// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// gfm_inlines.js: the inline phase of GFM 0.29-gfm (LCTYSP-0017), and the inlines of its document tree. The inlines of
// a paragraph, a heading or a table cell are the leaf's children, rows of the document's NodeTable as the blocks are
// (gfm_blocks.d.ts). The implementation carries one-line comments only; its documentation is this file.
//
// The text of a leaf block becomes text, code spans, emphasis, strikethrough, links, images, autolinks, raw HTML and
// line breaks. It is done in three steps, so the tree is built once and never rearranged:
// 1. The text is read into a flat array of items: runs of text, delimiter runs (* _ ~), brackets, code spans, raw
//    HTML, autolinks and line breaks.
// 2. Emphasis and links are found with the delimiter and bracket stacks of the spec's "An algorithm for parsing nested
//    emphasis and links". A match does not move nodes: it marks the items, an opening run with the elements it opens
//    and a closing run with how many it closes, and a bracket as the start of a link.
// 3. The items are read once, in order, into the rows of the leaf's inlines (build). Adjacent pieces of text are one
//    text node.
//
// The extended autolinks are found as GFM's reference finds them: www. and scheme:// while the text is read, email
// addresses in each text node, outside links, as it is built.
//
// An inline holds no string of its own: its text is pieces, spans of the text the document was parsed from (flag 0),
// which whoever reads the tree keeps (inlineText). What is not in that text, a character reference resolved or a code
// span's line endings read as spaces, is a span of one string the SpanStore holds besides (extra; flag 1). A link or
// an image has no pieces, its text being its children: its destination is the document's strings[F_AT], and its title
// the string after it. An inline has only the fields of every node (NodeTable's i32): no row in b32, and no B_PREV.

import type {
	DecodeName,
	LinkData,
	NodeTable,
	Row,
	SpanStore,
} from "./gfm_blocks.js";

// The types of the inlines, as the codes in slot F_TYPE, after the blocks'
export const TEXT: 16;
export const CODE: 17;
export const HTML_INLINE: 18;
export const SOFTBREAK: 19;
export const LINEBREAK: 20;
export const EMPH: 21;
export const STRONG: 22;
export const DEL: 23;
export const LINK: 24;
/** An image: its children are its description. */
export const IMAGE: 25;

/** The code of a type of inline. */
export type InlineType = 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25;

/** The name of each type of inline, by its code less TEXT: "text", "code", … "image". */
export const INLINE_NAMES: readonly string[];

/** The text of row of nodes, its pieces in spans joined, read from source, the text the inlines were parsed from. */
export function inlineText(
	source: string,
	nodes: NodeTable,
	spans: SpanStore,
	row: Row,
): string;

export interface InlineOptions {
	/** Whether the extended autolinks are made (true by default). */
	autolink?: boolean;
}

/** The second phase of GFM's parsing: a leaf block's content as its inlines. */
export class InlineParser {
	/**
	 * refmap holds the link reference definitions of the whole text, read by the block phase. options.autolink: whether
	 * the extended autolinks of GFM are made (true by default; the spec's examples without the extension turn it off).
	 */
	constructor(
		decodeName: DecodeName,
		refmap: ReadonlyMap<string, LinkData>,
		options?: InlineOptions,
	);
	/**
	 * Parse the content of leaf, a paragraph, a heading or a table cell of nodes, read from source by its spans, as the
	 * leaf's children: rows added to nodes, their pieces to spans.
	 */
	parseLeaf(
		source: string,
		nodes: NodeTable,
		spans: SpanStore,
		leaf: Row,
	): void;
}

// How it works (gfm_inlines.js)
//
// A run of plain text goes up to the next character that may start something else, cut before the next place an
// extended autolink may start ("www." or "://"). Each of those places is looked for once, ahead of the position, and
// kept (nextSpecial, nextWww, nextScheme; -1 when there is none), so the runs cost their own length.
//
// An extended autolink starting at i of a text must have ended just past the first whitespace or < after it (runEnd).
// The autolink is looked for in the text up to there only, so each look costs its own length, not the rest of the text.
// Its domain is checked as GFM's check_domain checks it, and its end as autolink_delim finds it: trailing punctuation
// and an unmatched ) are taken off. An email address is found in each text node outside links once the node is built,
// as GFM's postprocess finds it, and the node, the last row, is replaced by its pieces: the table and the store are cut
// back to where the node and its pieces began, and the sibling before it, found from the parent's first child, ends
// the parent's children. Only a text node with an @ is looked at: the next @ of the subject is
// looked for once ahead (nextAt), so the check costs nothing for the rest.
//
// Pieces. An item holds the range of the subject it is the text of, or a string (lit) when its text is not in the
// subject: a character reference resolved, and a code span or raw HTML across lines (the subject's line endings are
// not in the parsed text, where a container's markers come between). The subject is the leaf's content (leafText),
// trimmed, which is its spans joined by "\n"; so a range of the subject on one line is a span of the parsed text, found
// from where the leaf's lines start in the content and in the parsed text (lineAt, lineSrc, piece). A text item never
// holds a line ending. A piece right after the row's last, in the same text, lengthens that one (addPiece). When the
// content is not just its spans joined, a NUL read as U+FFFD or a cell's \| read as |, the whole content is put in
// extra and its pieces are spans of that. Whether a range holds a line ending, and whether the parsed text holds a NUL,
// are looked for once ahead, as the runs are (newlineIn, nulAt).
//
// Unicode whitespace of the spec is Zs, tab, LF, FF and CR; punctuation is the P* categories of 0.29 and the ASCII
// symbols. Character references and raw HTML are matched where the parser is, with sticky patterns.
