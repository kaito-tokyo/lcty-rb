// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// gfm_blocks.js: the block phase of GFM 0.29-gfm (LCTYSP-0017), and the blocks of its document tree. The implementation
// carries one-line comments only; its documentation is this file.
//
// Lines are read one at a time, as the spec's "A parsing strategy" describes. Each line first continues the open blocks
// it can, then may start new ones, and what is left of it is added to the deepest open block that takes lines. This is
// the spec's first phase: the link reference definitions are read into refmap, and a paragraph, a heading and a table
// cell keep in their view the text of their content. The parser's one operation is advance: it takes the first
// top-level block of a text once the text's lines end it, so a whole text and a streamed one are read alike, one block
// after another (converter.js).
//
// The module stands on GFM's block grammar alone. What it holds besides is what that grammar needs: the tree's nodes
// and their operations, backslash escapes and character references, link labels, destinations and titles (a link
// reference definition is a leaf block), and HTML tags (an HTML block of condition 7 begins with one).
//
// A node is a plain object of the shape below, not an instance of a class: a type is a structural one, matched by its
// fields, and the parsers make every node of a kind with the same fields in the same order. A node's type is its name
// ("document", "paragraph", …), a string written as it is. A block has the fields of every node and then the
// block parser's (open, startLine, endLine).
//
// The blocks say nothing of what a paragraph, a heading or a table cell holds: each type takes it as L, the type of
// their children, none (never) as the block parser leaves them. Another phase gives the tree with its own L.

/** The text of the named character reference &name; ("amp" → "&"), or null when HTML has no such name. */
export type DecodeName = (name: string) => string | null;

/** Any node: what every node has, whatever its type, values and children. */
export type AnyNode = NodeOf<string, unknown, unknown>;

/** What every node has. */
export interface NodeOf<T extends string, D, C> {
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
export interface BlockOf<T extends string, D, C> extends NodeOf<T, D, C> {
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

export type Document<L = never> = BlockOf<"document", null, Block<L>>;
export type BlockQuote<L = never> = BlockOf<"block_quote", null, Block<L>>;
export type List<L = never> = BlockOf<"list", ListData, Item<L>>;
export type Item<L = never> = BlockOf<"item", ItemData, Block<L>>;
export type Paragraph<L = never> = BlockOf<"paragraph", null, L>;
export type Heading<L = never> = BlockOf<"heading", HeadingData, L>;
export type CodeBlock = BlockOf<"code_block", CodeBlockData, never>;
export type HtmlBlock = BlockOf<"html_block", HtmlBlockData, never>;
export type ThematicBreak = BlockOf<"thematic_break", null, never>;
export type Table<L = never> = BlockOf<"table", TableData, TableRow<L>>;
/** The header row ("table_head") or a body row ("table_row"). */
export type TableRow<L = never> = BlockOf<
	"table_head" | "table_row",
	null,
	TableCell<L>
>;
export type TableCell<L = never> = BlockOf<"table_cell", TableCellData, L>;

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

/** Whether c is a space or a tab. */
export function isSpaceOrTab(c: string | undefined): boolean;

/** Whether line from i is a thematic break of c: three or more of it, and spaces and tabs only between. */
export function isThematicBreak(line: string, i: number, c: string): boolean;

// The tree's nodes

/** The shared empty view and child list of the nodes that have none. Frozen, so nothing is added to it by mistake. */
export const NONE: readonly never[];

/** Add child as the last child of parent, and give it back. */
export function appendChild<C extends AnyNode>(parent: AnyNode, child: C): C;

/**
 * Give node's children an array of exactly their number, once no more are added: an array grown by push holds room for
 * 17 children however few it has (a node has one to three, mostly).
 */
export function fitChildren(node: AnyNode): void;

// Escapes, character references, labels and destinations

/** The ASCII punctuation a backslash escapes, as a character class of a pattern's source. */
export const ESCAPABLE: string;

/**
 * The text of the character reference ref ("&amp;", "&#35;", "&#x22;"), or null when it is none. decodeName(name)
 * gives the text of a named one ("amp" → "&"), or null when HTML has no such name. A numeric reference to 0, to a
 * surrogate or past U+10FFFF is U+FFFD.
 */
export function decodeEntity(
	ref: string,
	decodeName: DecodeName,
): string | null;

/** A link label as it is matched: trimmed, its whitespace collapsed, case folded. */
export function normalizeLabel(label: string): string;

/**
 * A link destination percent-encoded as GFM's reference writes it: %XX already there is kept. One of only the
 * characters kept as they are is itself; any other is written in pieces and joined, so the result is one flat string.
 */
export function normalizeURI(uri: string): string;

/** The source of a pattern of an HTML open tag of the spec ("Raw HTML"). */
export const OPENTAG: string;
/** The source of a pattern of an HTML closing tag of the spec. */
export const CLOSETAG: string;

/**
 * Where the grammar of links is read: p.subject at p.pos, which a read moves past what it reads. A link reference
 * definition is read with it here, with a cursor of its own, and a link in the inline phase, whose parser is one.
 */
export interface Cursor {
	subject: string;
	pos: number;
}

/** Pass spaces and tabs, and at most one line ending among them. */
export function skipSpnl(p: Cursor): void;

/** The length of the link label at p.pos, its brackets included and at most 999 characters inside, or 0. */
export function scanLinkLabel(p: Cursor): number;

/** The link title at p.pos ("…", '…' or (…)), its escapes and character references resolved, or null. */
export function scanLinkTitle(p: Cursor, decodeName: DecodeName): string | null;

/**
 * The link destination at p.pos (<…>, or a run without spaces or controls whose parentheses balance, at most 32
 * deep), resolved and percent-encoded, or null.
 */
export function scanLinkDestination(
	p: Cursor,
	decodeName: DecodeName,
): string | null;

// The block parser

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
	 * Take the first top-level block of head, once head's lines end it; offset is where head starts in the whole text,
	 * which the nodes' offsets count from.
	 * - [rest, text, node, leaves] when they do: text is the block's, its last line ending included; rest is what
	 *   follows, where the next advance starts; node is the block, now the last child of doc (null for a paragraph of
	 *   link reference definitions only, which leaves only its definitions); leaves are its paragraphs, headings and
	 *   table cells, their view the text of their content.
	 * - ["", undefined] when head holds no block: nothing, or only blank lines.
	 * - undefined when the lines so far do not end it.
	 *
	 * A line counts once its line ending is there (a last \r may be half of \r\n), or, when end is true, head being the
	 * rest of the whole text, at the end of head too, where every block closes. The blank lines before a block are no
	 * part of it. A block ends when a later line closes it, or, a heading and a thematic break being one line each, with
	 * its line.
	 *
	 * When head is the rest the last advance gave, the parser goes on from the lines it read past that block (it carries
	 * them), so the line that ended a block is not read again; see "How it works" below.
	 */
	advance(
		head: string,
		end?: boolean,
		offset?: number,
	): Advanced | ["", undefined] | undefined;
}

// How it works (gfm_blocks.js)
//
// Nodes. A node is made with every field given (block() for a block), so that every node of a kind has one shape; open
// and startLine are given by the caller, endLine is known only when the block closes. The parser changes only the last
// or nearly the last child of a block (the block it is in), so a child is looked for among its siblings from the end
// (indexIn), which costs nothing for a long document.
//
// What each type of block does is a switch on its type: continueBlock gives 0 (the current line continues the block),
// 1 (it does not) or 2 (the line is used up); finalizeBlock runs when the block is closed; canContain says whether a
// block may hold a block of a type; acceptsLines whether the rest of a line is added to an open block of a type (the
// leaves of lines). A closing fence is a run of the opening's character, at least as long, and then only spaces and
// tabs. A fenced code block's first line is its info string; the code is the lines after it. A paragraph's text first
// gives up the link reference definitions at its start (takeReferences); a paragraph of nothing else leaves the tree.
// A task list item's box is [ ], [x] or [X] at the start of its first paragraph, and then a space or a tab.
//
// Block starts. A line that is not indented is read as a tree of few levels: a switch on the first character after the
// indentation (startBlock), then what follows it, read a character at a time. Where one line may start several blocks
// (a "-" line may be a setext underline, a table's delimiter row, a thematic break or a list item), they are tried in
// the spec's order, and one the context refuses gives way to the next. Each gives 0 (no start), 1 (a container started)
// or 2 (a leaf started).
// - An ATX heading is one to six #, then a space, a tab or the end of the line; its closing sequence is # at the end,
//   after a space or a tab, or alone.
// - A fenced code block is three or more ` or ~, and for ` no ` after them.
// - A setext heading: the line is the underline of the paragraph container, = for level 1 and - for 2. When the
//   paragraph was only link reference definitions, nothing is left to underline and the line is tried as the rest.
// - A table: the paragraph's last line is the header row, this line the delimiter row, whose cells are :?-+:?. When the
//   paragraph keeps lines before the header row, the table starts where the header row's text starts.
// - A thematic break is three or more of *, _ or -, with only spaces and tabs between.
// - A list item's marker is *, + or -, or one to nine digits and . or ), then a space, a tab or the end of the line. In
//   a paragraph, an ordered list starts only at 1, and no list item starts empty.
// - An HTML block is one pattern of the seven start conditions, one group each, which ignores case as 1, 6 and 7 want;
//   4 wants an uppercase letter and 5 CDATA as it is, which are checked after the match. Condition 7 does not
//   interrupt a paragraph. The ends of conditions 2 to 5 are looked for with indexOf, of 1 with one pattern.
// - An indented code block is a line indented four columns, out of a paragraph.
// Block quotes and list items nest at most MAX_NESTING deep; one more is not opened.
//
// Patterns. Those matched where the parser is in a line are BlockParser's own, so their lastIndex is set and changed
// freely (at): an HTML block's start conditions, the end of condition 1, and the line endings advance cuts the lines
// at. A pattern of the link grammar is sticky and its lastIndex is set at each use. The patterns that need no position
// are the module's. No pattern uses a lookaround.
//
// advance and what it carries. What lasts from one advance to the next is the definitions and the document. What one
// advance reads its lines into is a root of its own and the state of its lines, emptied at each (restart); the line
// ends it has read are kept in one array, with a base that the head's start has moved by. When the first block is
// taken (took), what was read past it, the start of the next block, is kept for the next advance if that is given the
// rest: the next block's lines keep their numbers and their ends their values, rest starts end further on, which base
// takes. It is kept only when the next block follows the first with nothing between but blank lines: a paragraph of
// definitions only between them has left the tree, and is read again as a block of its own.
