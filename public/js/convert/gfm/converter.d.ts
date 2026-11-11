// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// converter.js: what runs the parts of GFM 0.29-gfm (LCTYSP-0017); the document tree's types are gfm_blocks.d.ts's and
// gfm_inlines.d.ts's. The implementation carries one-line comments only; its documentation is this file.
//
// A whole text is read as a streamed one is, a top-level block at a time (BlockParser's advance), and then the inlines
// of each paragraph, heading and table cell, with every link reference definition known: the two phases of the spec's
// "A parsing strategy". BlockWatch is this module's own guess, no part of GFM, of when a streamed head may have ended
// its block: it decides only how often advance is tried.

import type {
	BlockTable,
	DecodeName,
	LinkData,
	RangeStore,
	Row,
} from "./gfm_blocks.js";
import type { InlineOptions, InlineTable } from "./gfm_inlines.js";

export type ParseOptions = InlineOptions;

/** The blocks of a document and their ranges in its text, row 0 the document. */
export interface BlockDocument {
	blocks: BlockTable;
	ranges: RangeStore;
}

/** A parsed document: its blocks, and its inlines. */
export interface Document extends BlockDocument {
	inlines: InlineTable;
	/** The row in inlines of the root of each leaf's inlines, by the leaf's row in blocks (-1 for any other block). */
	roots: Int32Array;
}

/**
 * The first phase of text, advanced to its end: the blocks and their ranges, the definitions, and the rows of the
 * leaves to parse, in the order of the text. The tables keep no room for more rows or ranges.
 */
export function parseBlocks(
	text: string,
	decodeName: DecodeName,
): BlockDocument & {
	refmap: ReadonlyMap<string, LinkData>;
	leaves: Row[];
};

/**
 * The document tree of text, in both phases: its blocks, and the inlines of each paragraph, heading and table cell. Its
 * ranges and its inlines' pieces are offsets in text, which a reader keeps to read their text (leafText, blockLines,
 * inlineText). The tables keep no room for more.
 */
export function parseGfm(
	text: string,
	decodeName: DecodeName,
	options?: ParseOptions,
): Document;

/**
 * The weak half of reading a stream: whether the head may have ended its first block, so that BlockParser's advance,
 * the strong half, is worth a try. It reads each complete line of the head once, a few characters of it, and says yes
 * too often rather than too seldom: a yes advance refuses costs one try, and a no where the block had ended only waits
 * for the next yes or for the end of the stream, when the client advances with end. After advance gives a block, the
 * client calls reset, as the rest is a new head.
 *
 * It takes the first block to be of the kind its first line begins: a fenced code block (its character and length),
 * an HTML block, a block quote, a list (its marker and the column its items' content starts at), an indented code
 * block, or anything else. On the first line it always says yes, so a heading or a thematic break is taken at once.
 * After that, the lines it says yes to are those that may end that kind of block:
 * - a fence: a run of the opening's character at least as long;
 * - an HTML block: a blank line, a line with >, or a line that may start a block;
 * - a block quote: a blank line, or a line that does not start with >;
 * - a list: a line shallower than the items' content that is not an item of the same marker (a thematic break is);
 * - an indented code block: a line indented less than four columns;
 * - anything else: a blank line, or a line that may start a block (# ` ~ > * + - = _ < | or a digit).
 */
export class BlockWatch {
	constructor();
	/** Look at a new head. */
	reset(): void;
	/**
	 * Whether a line of head not read yet may end its first block: true at the first such line, read up to it, so the
	 * client tries advance and then asks again; false once every complete line is read (a last \r may be half of \r\n).
	 */
	mayEnd(head: string): boolean;
}
