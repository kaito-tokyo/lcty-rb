// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The types of gfm_blocks.js: the blocks of the document tree of GFM 0.29-gfm (LCTYSP-0017).
//
// A node is a plain object of the shape below, not an instance of a class: a type is a structural one, matched by its
// fields, and the parsers make every node of a kind with the same fields in the same order. A node's type is one of the
// small integers below (DOCUMENT, PARAGRAPH, …), not a name; BLOCK_NAMES gives the names. A block has the fields of
// every node and then the block parser's (open, startLine, endLine).
//
// The blocks say nothing of what a paragraph, a heading or a table cell holds: each type takes it as L, the type of
// their children, none (never) as the block parser leaves them. Another phase gives the tree with its own L.

/** The text of the named character reference &name; ("amp" → "&"), or null when HTML has no such name. */
export type DecodeName = (name: string) => string | null;

// The types of the blocks, in this order
export const DOCUMENT: 0;
export const BLOCK_QUOTE: 1;
export const LIST: 2;
export const ITEM: 3;
export const PARAGRAPH: 4;
export const HEADING: 5;
export const CODE_BLOCK: 6;
export const HTML_BLOCK: 7;
export const THEMATIC_BREAK: 8;
export const TABLE: 9;
export const TABLE_HEAD: 10;
export const TABLE_ROW: 11;
export const TABLE_CELL: 12;
/** The name of each type of block, by its number ("document", "block_quote", …). */
export const BLOCK_NAMES: readonly string[];

/** Any node: what every node has, whatever its type, values and children. */
export type AnyNode = NodeOf<number, unknown, unknown>;

/** What every node has. */
export interface NodeOf<T extends number, D, C> {
	readonly type: T;
	/** Where it starts, in the text its parser read. */
	offset: number;
	/**
	 * Its text as pieces in order, joined only when written: the lines of a code block or HTML block, and the text of a
	 * paragraph's, a heading's or a table cell's content as the block parser leaves it. Empty otherwise.
	 */
	view: readonly string[];
	parent: AnyNode | null;
	children: readonly C[];
	/** The values of its type, or null when it has none. */
	data: D;
}

/** What every block has besides: the block parser's state. */
export interface BlockOf<T extends number, D, C> extends NodeOf<T, D, C> {
	/** Whether lines may still be added to it. */
	open: boolean;
	/** The lines it begins and ends on, 1-based (a list's tightness is read from them). */
	startLine: number;
	endLine: number;
}

export type Align = "left" | "center" | "right" | null;

export interface ListData {
	type: "bullet" | "ordered";
	/** "*", "+" or "-" of a bullet list, "" of an ordered one. */
	bulletChar: string;
	/** "." or ")" of an ordered list, "" of a bullet one. */
	delimiter: string;
	start: number;
	tight: boolean;
}

export interface ItemData {
	markerOffset: number;
	padding: number;
	/** The task list item's box, or null when it is no task. */
	task: "checked" | "unchecked" | null;
}

export interface HeadingData {
	level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface CodeBlockData {
	fenced: boolean;
	fenceChar: "" | "`" | "~";
	fenceLength: number;
	fenceOffset: number;
	/** The info string, its escapes and character references resolved ("" when none). */
	info: string;
}

export interface HtmlBlockData {
	/** Which of the seven start conditions of the spec opened it. */
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface TableData {
	aligns: Align[];
	/** Whether the next line is the delimiter row, which adds no row. */
	skipLine: boolean;
}

export interface TableCellData {
	align: Align;
}

/** A link reference definition's destination and title, and a link's. */
export interface LinkData {
	destination: string;
	/** "" when it has none. */
	title: string;
}

export type Document<L = never> = BlockOf<typeof DOCUMENT, null, Block<L>>;
export type BlockQuote<L = never> = BlockOf<typeof BLOCK_QUOTE, null, Block<L>>;
export type List<L = never> = BlockOf<typeof LIST, ListData, Item<L>>;
export type Item<L = never> = BlockOf<typeof ITEM, ItemData, Block<L>>;
export type Paragraph<L = never> = BlockOf<typeof PARAGRAPH, null, L>;
export type Heading<L = never> = BlockOf<typeof HEADING, HeadingData, L>;
export type CodeBlock = BlockOf<typeof CODE_BLOCK, CodeBlockData, never>;
export type HtmlBlock = BlockOf<typeof HTML_BLOCK, HtmlBlockData, never>;
export type ThematicBreak = BlockOf<typeof THEMATIC_BREAK, null, never>;
export type Table<L = never> = BlockOf<typeof TABLE, TableData, TableRow<L>>;
/** The header row (TABLE_HEAD) or a body row (TABLE_ROW). */
export type TableRow<L = never> = BlockOf<
	typeof TABLE_HEAD | typeof TABLE_ROW,
	null,
	TableCell<L>
>;
export type TableCell<L = never> = BlockOf<typeof TABLE_CELL, TableCellData, L>;

export type Block<L = never> =
	| Document<L>
	| BlockQuote<L>
	| List<L>
	| Item<L>
	| Paragraph<L>
	| Heading<L>
	| CodeBlock
	| HtmlBlock
	| ThematicBreak
	| Table<L>
	| TableRow<L>
	| TableCell<L>;

/** How deep block quotes and list items may nest (LCTYSP-0017, limits): one more is not opened. */
export const MAX_NESTING: number;

/** The cells of a table row: between its unescaped pipes, trimmed, \| read as |. */
export function tableCells(line: string): string[];

/** Whether c is a space or a tab. */
export function isSpaceOrTab(c: string | undefined): boolean;

/** Whether line holds only spaces and tabs from i to its end: from 0, a blank line of GFM. */
export function spacesToEnd(line: string, i: number): boolean;

/** Whether line from i is a thematic break of c: three or more of it, and spaces and tabs only between. */
export function isThematicBreak(line: string, i: number, c: string): boolean;

/** What BlockParser's advance gives when its head's lines end the first block. */
export type Advanced = [
	rest: string,
	text: string,
	node: Block | null,
	leaves: (Paragraph | Heading | TableCell)[],
];

/**
 * The first phase of GFM's parsing: the block structure and the link reference definitions, a top-level block at a
 * time. A whole text is advanced to its end in turn, a streamed one as its lines come (converter.js).
 */
export class BlockParser {
	constructor(decodeName: DecodeName);
	/** The document of the blocks advanced so far, one child each. */
	readonly doc: Document;
	/** The link reference definitions read so far, by normalized label. */
	readonly refmap: ReadonlyMap<string, LinkData>;
	/**
	 * The first top-level block of head, once head's lines end it: Advanced when they do (node null for a paragraph of
	 * definitions only), ["", undefined] when head holds no block, undefined when more is needed. With end, head is the
	 * rest of the whole text, and its end ends the block. offset is where head starts in the whole text.
	 */
	advance(
		head: string,
		end?: boolean,
		offset?: number,
	): Advanced | ["", undefined] | undefined;
}
