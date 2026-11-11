// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// gfm_blocks.js: the block phase of GFM 0.29-gfm (LCTYSP-0017), and the blocks of its document tree. The implementation
// carries one-line comments only; its documentation is this file.
//
// Lines are read one at a time, as the spec's "A parsing strategy" describes. Each line first continues the open blocks
// it can, then may start new ones, and what is left of it is added to the deepest open block that takes lines. This is
// the spec's first phase: the link reference definitions are read into refmap, and a paragraph, a heading and a table
// cell keep the spans of where the text of their content is. The parser's one operation is advance: it takes the first
// top-level block of a text once the text's lines end it, so a whole text and a streamed one are read alike, one block
// after another (converter.js).
//
// The module stands on GFM's block grammar alone. What it holds besides is what that grammar needs: backslash escapes
// and character references, link labels, destinations and titles (a link reference definition is a leaf block), and
// HTML tags (an HTML block of condition 7 begins with one).
//
// The document is kept as C keeps struct arrays, in linear memory the parsers share: the block phase, the inline phase
// (gfm_inlines.d.ts) and what runs them (converter.d.ts). A node, a block or an inline, is a row of NodeTable, in two
// Int32Arrays of their own: what every node has (8 slots, 32 bytes: F_TYPE, F_PARENT, …) in i32, and what only a block
// has (8 more: B_PREV, B_START_LINE, the values of its type, …) in b32, both by the row. The tree is integers only, a
// node costs no object of its own, and a node's fields are next to each other in memory. The two arrays never alias, so
// a write to one leaves what was read of the other as it is. The rows are linked as a tree, a parent with its first and
// last child and each child with the next (-1 when there is none), and a block with the one before it too: the
// document's children are its blocks, and a paragraph's, a heading's or a table cell's are its inlines.
//
// A node holds no text of its own. Its spans say where its text is in the text it was parsed from, which whoever reads
// the tree keeps (leafText, blockLines, inlineText), and they are kept apart from the rows, in one linear store for the
// whole document (SpanStore): a node holds only where its spans start in the store and how many they are. So parsing
// makes no string but a line at a time and what a definition or a table row is read from. The few strings a node has
// (a code block's info string, a link's destination and title) are in one array, strings.

/** The text of the named character reference &name; ("amp" → "&"), or null when HTML has no such name. */
export type DecodeName = (name: string) => string | null;

/** A link reference definition's destination and title, and a link's. */
export interface LinkData {
	destination: string;
	/** "" when it has none. */
	title: string;
}

// The types of the blocks, as the codes in slot F_TYPE; the inlines' follow them, from 16 (gfm_inlines.d.ts)
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
/** The header row of a table. */
export const TABLE_HEAD: 10;
/** A body row of a table. */
export const TABLE_ROW: 11;
export const TABLE_CELL: 12;

/** The code of a type of block. */
export type BlockType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** The name of each type of block, by its code: "document", "block_quote", … "table_cell". */
export const BLOCK_NAMES: readonly string[];

export type Align = "left" | "center" | "right" | null;

/** A table cell's alignment, by its code in slot B_A: 0 none, 1 left, 2 center, 3 right. */
export const ALIGNS: readonly Align[];

/** A node: its row in its document's NodeTable. */
export type Row = number;

// The slots of a row in i32, every node's: row i's field f is i32[(i << 3) + f]
/** How many slots a row has in i32, and a block's in b32: 8, 32 bytes. */
export const ROW: 8;
/** The type's code in bits 0 to 7 (i32[i << 3] & 0xff), and OPEN. */
export const F_TYPE: 0;
/**
 * Where the node starts: a block in the whole text; an inline in the content of its leaf block, its leading spaces,
 * tabs and line endings left out.
 */
export const F_OFFSET: 1;
export const F_PARENT: 2;
export const F_FIRST: 3;
export const F_LAST: 4;
export const F_NEXT: 5;
/**
 * Where its spans start in the document's SpanStore, and how many they are (F_COUNT): of a block, one span for each
 * line of a code block or an HTML block; of a paragraph or a heading, its content's lines, a container's markers and
 * the line's leading spaces left out (and the definitions, the task list item's box or the closing sequence it gave
 * up); of a table cell, its content, trimmed, between the row's pipes (one span; a \| in it is a | of the content).
 * The line endings between them are not in them: a paragraph's content is its spans' text joined by "\n". Of an
 * inline, the pieces of the text of a text, a code span or raw HTML (gfm_inlines.d.ts). None for any other node, but
 * a link or an image, whose F_AT is the index of its destination in strings (gfm_inlines.d.ts).
 */
export const F_AT: 6;
export const F_COUNT: 7;
/** The bit of slot F_TYPE set while lines may still be added to a block. */
export const OPEN: 0x100;

// The slots of a block's row in b32: block i's field f is b32[(i << 3) + f]
/** The block before it, -1 when it is the first. */
export const B_PREV: 0;
/** The lines a block begins and ends on, 1-based (a list's tightness is read from them). */
export const B_START_LINE: 1;
export const B_END_LINE: 2;
/**
 * The values of each type of block (0 where a type has none):
 * - list: B_A 1 when ordered; B_B the character code of its bullet (* + -) or delimiter (. or )); B_C its start; B_D 1
 *   when tight.
 * - item: B_A the marker's offset; B_B its padding; B_C its task box, 0 for no task, 1 unchecked, 2 checked.
 * - heading: B_A its level, 1 to 6.
 * - code_block: B_A 1 when fenced; B_B the fence's character code (` or ~, 0 when indented); B_C its length; B_D its
 *   offset.
 * - html_block: B_A which of the seven start conditions of the spec opened it.
 * - table: B_A 1 while the next line is the delimiter row, which adds no row.
 * - table_cell: B_A its alignment's code (ALIGNS).
 */
export const B_A: 3;
export const B_B: 4;
export const B_C: 5;
export const B_D: 6;
/** A code block's info string, its escapes and character references resolved: its index in strings, -1 when none. */
export const B_STR: 7;

/**
 * The nodes of a document, blocks and inlines, row 0 the document: every node's fields in i32, a block's own in b32,
 * both ROW slots a row and by the same row. b32 has room up to the last block's row only; an inline's row there holds
 * nothing. The arrays grow by doubling, so a reader takes them from the table each time, not once, and a row past
 * length holds nothing.
 */
export class NodeTable {
	/** How many rows it holds. */
	length: number;
	/** How many rows i32 has room for. */
	capacity: number;
	/** How many rows b32 has room for, and one past the last block's row. */
	blockCapacity: number;
	blockEnd: number;
	i32: Int32Array;
	b32: Int32Array;
	/** The strings of the rows: a code block's info string by B_STR, a link's destination and title by F_AT. */
	strings: string[];
	/** Make room for n rows (at least length) in i32, the rows there copied. */
	grow(n: number): void;
	/** Make room for n rows (at least blockEnd) in b32, the rows there copied. */
	growBlocks(n: number): void;
	/** Give up the room past the last row and the last block's, once no more rows are added. */
	compact(): void;
	/** A new inline's row, of no parent, children or spans; its index. */
	add(type: number, offset: number): Row;
	/** A new block's row, its fields in b32 too, its values 0 and no string; its index. */
	addBlock(
		type: BlockType,
		offset: number,
		open: 0 | 1,
		startLine: number,
	): Row;
	/** Add s to strings; its index. */
	addString(s: string): number;
	/** Make child, a block, the last child of parent. */
	append(parent: Row, child: Row): void;
	/** Make child, an inline, the last child of parent; an inline has no B_PREV. */
	appendInline(parent: Row, child: Row): void;
	/** Take node, a block, out of its parent. */
	unlink(node: Row): void;
	/** Put node, a block, where old is, taking old out. */
	replace(old: Row, node: Row): void;
	/** Put node, a block, right after ref. */
	insertAfter(ref: Row, node: Row): void;
}

/** How many slots a span has: 3. */
export const SPAN: 3;

/**
 * The spans of a document, as SPAN slots of one Int32Array: span i is [i32[3i], i32[3i + 1]), offsets of UTF-16 code
 * units, and i32[3i + 2] its flag. A block's line is a span of the whole text, and its flag the spaces before it that a
 * tab only partly taken by the indentation leaves (one to three, for a line of a code block or an HTML block; a span
 * cannot hold them, as they are not in the text). An inline's piece is a span of the whole text when its flag is 0,
 * of extra when it is 1. The array grows by doubling, so a reader takes i32 from the store each time, not once.
 */
export class SpanStore {
	i32: Int32Array;
	/** How many spans it holds. */
	length: number;
	/** The text of the pieces that are not in the parsed text, one after another (gfm_inlines.d.ts). */
	extra: string;
	/** Add a span and its flag; its index. */
	push(start: number, end: number, flag: number): number;
	/** Give up the room past the last span, once no more spans are added. */
	compact(): void;
}

/** How deep block quotes and list items may nest (LCTYSP-0017, limits): one more is not opened. */
export const MAX_NESTING: number;

/** Whether c is a space or a tab. */
export function isSpaceOrTab(c: string | undefined): boolean;

/** Whether line from i is a thematic break of c: three or more of it, and spaces and tabs only between. */
export function isThematicBreak(line: string, i: number, c: string): boolean;

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

/**
 * The text of the content of leaf, a paragraph, a heading or a table cell of nodes, read from source, the text it was
 * parsed from, by its spans in spans, its document's: joined by "\n", NUL read as U+FFFD, and in a table cell \| read
 * as |.
 */
export function leafText(
	source: string,
	nodes: NodeTable,
	spans: SpanStore,
	leaf: Row,
): string;

/**
 * The lines of block, a code block or an HTML block of nodes, read from source by its spans, padded, NUL read as
 * U+FFFD.
 */
export function blockLines(
	source: string,
	nodes: NodeTable,
	spans: SpanStore,
	block: Row,
): string[];

/** What BlockParser's advance gives when its head's lines end the first block. */
export type Advanced = [
	rest: string,
	text: string,
	node: Row | -1,
	leaves: Row[],
];

/**
 * The first phase of GFM's parsing: the block structure and the link reference definitions, a top-level block at a
 * time. A whole text is advanced to its end in turn, a streamed one as its lines come (converter.js).
 */
export class BlockParser {
	constructor(decodeName: DecodeName);
	/** The document's row in nodes (0), the blocks advanced so far its children, one each. */
	readonly doc: Row;
	/**
	 * The nodes of the document. Rows past those of the blocks taken are an advance's own, cut back by the next; what
	 * the client adds between two advances (the inlines of the leaves taken) is kept.
	 */
	readonly nodes: NodeTable;
	/** The spans of every block advanced, and of what the client adds. */
	readonly spans: SpanStore;
	/** The link reference definitions read so far, by normalized label. */
	readonly refmap: ReadonlyMap<string, LinkData>;
	/**
	 * Take the first top-level block of head, once head's lines end it; offset is where head starts in the whole text,
	 * which the nodes' offsets count from.
	 * - [rest, text, node, leaves] when they do: text is the block's, its last line ending included; rest is what
	 *   follows, where the next advance starts (after a paragraph that a table split, where the table's header row's
	 *   text starts, as an indented header row was the paragraph's); node is the block's row, now the last child of doc
	 *   (-1 for a paragraph of link reference definitions only, which leaves only its definitions); leaves are the rows
	 *   of its paragraphs, headings and table cells in the order of the text, their spans where the text of their
	 *   content is (leafText reads it).
	 * - ["", undefined] when head holds no block: nothing, or only blank lines.
	 * - undefined when the lines so far do not end it.
	 *
	 * A line counts once its line ending is there (a last \r may be half of \r\n), or, when end is true, head being the
	 * rest of the whole text, at the end of head too, where every block closes. The blank lines before a block are no
	 * part of it. A block ends when a later line closes it, or, a heading and a thematic break being one line each, with
	 * its line.
	 *
	 * The nodes' spans and offsets count from the start of the whole text, so offset must be where head starts in it
	 * for them to be right: the client passes how much of its text the blocks taken so far, and the blank lines before
	 * them, have used up. When head is the rest the last advance gave and offset where that rest starts, the parser goes
	 * on from the lines it read past that block (it carries them), so the line that ended a block is not read again,
	 * unless the client has added to nodes or spans since; see "How it works" below.
	 */
	advance(
		head: string,
		end?: boolean,
		offset?: number,
	): Advanced | ["", undefined] | undefined;
}

// How it works (gfm_blocks.js)
//
// Rows. A block is a row made with every slot given (NodeTable's addBlock), its type, offset, open and startLine by the
// caller; endLine is known only when the block closes. The tree is changed only by linking rows (append, unlink,
// replace, insertAfter), each a few writes to the link slots, so no child is looked for among its siblings. A slot is
// read as i32[(i << 3) + F_X] or b32[(i << 3) + B_X], the row's start shifted once and kept where it is used again.
// The arrays start at 1024 rows and double; parseGfm gives up the room left once the whole text is read (compact).
// Row 0 is the document, which the blocks taken are linked to, and row 1 the root of one advance's lines. In a whole
// text the blocks' rows come first and the inlines' after them, so b32 holds the blocks' rows and no more.
//
// What each type of block does is a switch on its type: continueBlock gives 0 (the current line continues the block),
// 1 (it does not) or 2 (the line is used up); finalizeBlock runs when the block is closed; canContain says whether a
// block may hold a block of a type; acceptsLines whether the rest of a line is added to an open block of a type (the
// leaves of lines). A closing fence is a run of the opening's character, at least as long, and then only spaces and
// tabs. A fenced code block's first line is its info string; the code is the lines after it. A paragraph's text first
// gives up the link reference definitions at its start (takeReferences); a paragraph of nothing else leaves the tree.
// A task list item's box is [ ], [x] or [X] at the start of its first paragraph, and then a space or a tab.
//
// Spans. A leaf's line is pushed to the store as the span of the rest of the line (addLine), the spaces a tab only
// partly taken leaves as its pad. Only the open leaf takes lines, so a leaf's spans are next to each other in the
// store, and a table row's cells are pushed together. What the parser must read of a leaf's text, it reads from the
// head being advanced (textOf, joined): a paragraph's, only when it starts with [, which a definition and a task list
// item's box do; the header row of a table; a code block's info string and blank last lines; an HTML block's blank
// last lines. A block gives up what it reads (definitions, a box, an info string, blank lines) by moving where its
// spans start in the store, or the start of its first one, and by counting fewer (dropFront). A table row is cut into
// the spans of its cells as tableCells cuts it (cellRanges). An advance that starts afresh reads lines again that one
// before it read; so that their spans do not pile up in the store, the store is cut back at each fresh advance to the
// length the blocks taken use (committed: the store's length before the line after the last block taken, kept for each
// line in marks), and the table to the rows they use alike (committedRows, from rowMarks). A block's string is made
// when the block closes, which may be on a line after its last, so strings keeps every string made up to the last
// block taken (committedStrings). The marks and the line ends are typed arrays indexed by the line's number, written
// once a line and never emptied, so a fresh advance costs nothing for the lines it does not read again.
//
// What the client adds. The inline phase writes into the same tables, between two advances, past what the last advance
// left: advance sees that the lengths have changed since it returned (afterRows, afterSpans, afterStrings), and from
// then on never cuts the tables below them (floorRows, floor, floorStrings). The rows and spans an advance had read
// past the block it took are left below them, unused. The lines it carried are read again, as a block's spans must be
// next to each other and the next block's would come after the client's. In a whole text the inlines are parsed after
// every block, so nothing of this happens there.
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
// definitions only between them has left the tree, and is read again as a block of its own. Nor is it kept for a table
// that split a paragraph: its rest starts at the header row's text, past the line's indentation, and is read afresh.
