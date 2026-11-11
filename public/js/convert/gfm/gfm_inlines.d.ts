// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// gfm_inlines.js: the inline phase of GFM 0.29-gfm (LCTYSP-0017), and the inlines of its document tree. The inlines of
// a paragraph, a heading or a table cell hang from a root of their own, which the document keeps by the leaf's row
// (converter.d.ts). The implementation carries one-line comments only; its documentation is this file.
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
// An inline, like a block, is a row of a table (InlineTable), its fields typed arrays indexed by the row, linked as a
// tree as the blocks are. An inline holds no string of its own: its text is pieces, ranges of the text the document was
// parsed from, which whoever reads the tree keeps (inlineText). What is not in that text, a character reference
// resolved or a code span's line endings read as spaces, is a range of one string the table holds besides (extra).

import type {
	BlockTable,
	DecodeName,
	LinkData,
	RangeStore,
	Row,
} from "./gfm_blocks.js";

// The types of the inlines, as the codes of InlineTable's type column
/** The root of a leaf's inlines, its children. */
export const INLINE_ROOT: 0;
export const TEXT: 1;
export const CODE: 2;
export const HTML_INLINE: 3;
export const SOFTBREAK: 4;
export const LINEBREAK: 5;
export const EMPH: 6;
export const STRONG: 7;
export const DEL: 8;
export const LINK: 9;
/** An image: its children are its description. */
export const IMAGE: 10;

/** The code of a type of inline. */
export type InlineType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** The name of each type of inline, by its code: "root", "text", … "image". */
export const INLINE_NAMES: readonly string[];

/**
 * The inlines of a document, as the rows of a table: one typed array for each column, row i of each the field of
 * inline i, and their text as pieces. The arrays grow by doubling, so a reader takes them from the table each time,
 * not once.
 */
export class InlineTable {
	/** How many rows it holds. */
	length: number;
	/** How many rows its arrays have room for. */
	capacity: number;
	type: Uint8Array;
	/** Where it starts, in the content of its leaf block, its leading spaces, tabs and line endings left out. */
	offset: Uint32Array;
	parent: Int32Array;
	first: Int32Array;
	last: Int32Array;
	prev: Int32Array;
	next: Int32Array;
	/**
	 * Where its pieces start, and how many they are: the text of a text, a code span or raw HTML, one piece or more in
	 * order (a character reference resolved is one of its own). None for any other inline.
	 */
	pieceAt: Uint32Array;
	pieceCount: Uint32Array;
	/** A link's or an image's index in destinations and titles, -1 for any other inline. */
	link: Int32Array;
	/** How many pieces it holds. */
	pieces: number;
	/** How many pieces its arrays have room for. */
	pieceCapacity: number;
	/** Piece i is [span[2i], span[2i + 1]) of the parsed text when src[i] is 0, of extra when it is 1. */
	span: Uint32Array;
	src: Uint8Array;
	/** The text of the pieces that are not in the parsed text, one after another. */
	extra: string;
	/** The destination of each link and image, by its index. */
	destinations: string[];
	/** The title of each link and image, by its index ("" when it has none). */
	titles: string[];
	/** Make room for n rows (at least length), the rows there copied. */
	grow(n: number): void;
	/** Make room for n pieces (at least pieces), the pieces there copied. */
	growPieces(n: number): void;
	/** Give up the room past the last row and piece, once no more are added. */
	compact(): void;
	/** A new row, of no parent, children, pieces or link; its index. */
	add(type: InlineType, offset: number): Row;
	/** Make child the last child of parent. */
	append(parent: Row, child: Row): void;
	/** Take the last child out of parent. */
	unlinkLast(parent: Row): void;
	/** Give row a destination and a title. */
	setLink(row: Row, destination: string, title: string): void;
	/**
	 * Add [start, end) of the parsed text (src 0) or of extra (src 1) to the text of row, which must be the last row
	 * given pieces. A piece right after the row's last, in the same text, lengthens that one.
	 */
	piece(row: Row, src: 0 | 1, start: number, end: number): void;
	/** Add s, a string not in the parsed text, to the text of row, as a piece of extra. */
	literal(row: Row, s: string): void;
}

/** The text of row of t, its pieces joined, read from source, the text the inlines were parsed from. */
export function inlineText(source: string, t: InlineTable, row: Row): string;

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
	/** The inlines of every leaf parsed, one table for the document. */
	readonly table: InlineTable;
	/**
	 * Parse the content of leaf, a paragraph, a heading or a table cell of blocks, read from source by its ranges, into
	 * the table; the row of the root its inlines hang from. Its pieces are ranges of source.
	 */
	parseLeaf(
		source: string,
		blocks: BlockTable,
		ranges: RangeStore,
		leaf: Row,
	): Row;
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
// as GFM's postprocess finds it, and the node is replaced by its pieces. Only a text node with an @ is looked at: the
// next @ of the subject is looked for once ahead (nextAt), so the check costs nothing for the rest.
//
// Pieces. An item holds the range of the subject it is the text of, or a string (lit) when its text is not in the
// subject: a character reference resolved, and a code span or raw HTML across lines (the subject's line endings are
// not in the parsed text, where a container's markers come between). The subject is the leaf's content (leafText),
// trimmed, which is its ranges joined by "\n"; so a range of the subject on one line is a range of the parsed text,
// found from where the leaf's lines start in the content and in the parsed text (lineAt, lineSrc, piece). A text item
// never holds a line ending. When the content is not just its ranges joined, a NUL read as U+FFFD or a cell's \| read
// as |, the whole content is put in extra and its pieces are ranges of that. Whether a range holds a line ending, and
// whether the parsed text holds a NUL, are looked for once ahead, as the runs are (newlineIn, nulAt).
//
// Unicode whitespace of the spec is Zs, tab, LF, FF and CR; punctuation is the P* categories of 0.29 and the ASCII
// symbols. Character references and raw HTML are matched where the parser is, with sticky patterns.
