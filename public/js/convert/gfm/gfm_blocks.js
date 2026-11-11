// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The block phase of GFM 0.29-gfm: BlockParser and the grammar it needs (gfm_blocks.d.ts).

export const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";
const reBackslashOrAmp = /[\\&]/;
const reEntityOrEscape = new RegExp(
	`\\\\${ESCAPABLE}|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});`,
	"g",
);
/** The text of a numeric character reference, U+FFFD when it names none. */
function numeric(code) {
	if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
		return "�";
	return String.fromCodePoint(code);
}

/** The text of the character reference ref, or null when it is none. */
export function decodeEntity(ref, decodeName) {
	if (ref[1] === "#") {
		const hex = ref[2] === "x" || ref[2] === "X";
		return numeric(Number.parseInt(ref.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
	}
	return decodeName(ref.slice(1, -1));
}

/** s with its backslash escapes and character references resolved. */
function unescapeString(s, decodeName) {
	if (!reBackslashOrAmp.test(s)) return s;
	return s.replace(reEntityOrEscape, (m) =>
		m[0] === "\\" ? m[1] : (decodeEntity(m, decodeName) ?? m),
	);
}

/** A link label as it is matched: trimmed, its whitespace collapsed, case folded. */
export function normalizeLabel(s) {
	return s
		.slice(1, -1)
		.trim()
		.replace(/[ \t\r\n]+/g, " ")
		.toLowerCase()
		.toUpperCase();
}

const reURIKept = /^[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]*$/;
const URL_SAFE = /[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]/;

/** A link destination percent-encoded as GFM's reference writes it. */
export function normalizeURI(uri) {
	if (reURIKept.test(uri)) return uri;
	const out = [];
	for (let i = 0; i < uri.length; i++) {
		const c = uri[i];
		if (c === "%" && /^[0-9a-fA-F]{2}$/.test(uri.slice(i + 1, i + 3))) {
			out.push(uri.slice(i, i + 3));
			i += 2;
		} else if (URL_SAFE.test(c)) {
			out.push(c);
		} else {
			const code = uri.codePointAt(i);
			if (code > 0xffff) {
				out.push(encodeURIComponent(String.fromCodePoint(code)));
				i++;
			} else if (code >= 0xd800 && code <= 0xdfff) {
				out.push("%EF%BF%BD");
			} else {
				out.push(encodeURIComponent(c));
			}
		}
	}
	return out.join("");
}

// The grammar of HTML tags (the spec's "Raw HTML"), which an HTML block of condition 7 begins with too
const TAGNAME = "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
const ATTRIBUTEVALUE = `(?:${UNQUOTEDVALUE}|'[^']*'|"[^"]*")`;
const ATTRIBUTEVALUESPEC = `(?:\\s*=\\s*${ATTRIBUTEVALUE})`;
const ATTRIBUTE = `(?:\\s+${ATTRIBUTENAME}${ATTRIBUTEVALUESPEC}?)`;
export const OPENTAG = `<${TAGNAME}${ATTRIBUTE}*\\s*/?>`;
export const CLOSETAG = `</${TAGNAME}\\s*[>]`;

// The grammar of link labels, destinations and titles, read at p.pos of p.subject.
const reEscapableHere = new RegExp(`^${ESCAPABLE}`);
const reLinkLabel = /\[(?:[^\\[\]]|\\.){0,1000}\]/sy;
// biome-ignore lint/suspicious/noControlCharactersInRegex: GFM's grammar excludes NUL here
const reLinkDestinationBraces = /<(?:[^<>\n\\\x00]|\\.)*>/y;
const reLinkTitle = new RegExp(
	`"(?:\\\\${ESCAPABLE}|\\\\[^\\\\]|[^\\\\"\\x00])*"|'(?:\\\\${ESCAPABLE}|\\\\[^\\\\]|[^\\\\'\\x00])*'|\\((?:\\\\${ESCAPABLE}|\\\\[^\\\\]|[^\\\\()\\x00])*\\)`,
	"y",
);
const reSpnl = /[ \t]*(?:\n[ \t]*)?/y;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a link destination ends at a control or a space
const reControlOrSpace = /^[\x00-\x20]$/;
const reSpaceAtEndOfLine = / *(?:\n|$)/y;

/** The match of the sticky re at p.pos, p.pos moved past it, or null. */
function matchAt(p, re) {
	re.lastIndex = p.pos;
	const m = re.exec(p.subject);
	if (m === null) return null;
	p.pos = re.lastIndex;
	return m[0];
}

/** Spaces and tabs, and at most one line ending among them. */
export function skipSpnl(p) {
	matchAt(p, reSpnl);
}

/** The length of the link label at p.pos (its brackets included), p.pos past it, or 0 when there is none. */
export function scanLinkLabel(p) {
	const m = matchAt(p, reLinkLabel);
	return m === null || m.length > 1001 ? 0 : m.length;
}

/** The link title at p.pos, unescaped, p.pos past it, or null. */
export function scanLinkTitle(p, decodeName) {
	const title = matchAt(p, reLinkTitle);
	if (title === null) return null;
	return unescapeString(title.slice(1, -1), decodeName);
}

/** The link destination at p.pos, unescaped and percent-encoded, p.pos past it, or null. */
export function scanLinkDestination(p, decodeName) {
	const braced = matchAt(p, reLinkDestinationBraces);
	if (braced !== null)
		return normalizeURI(unescapeString(braced.slice(1, -1), decodeName));
	const s = p.subject;
	if (s[p.pos] === "<") return null;
	const savepos = p.pos;
	let openparens = 0;
	let c = s[p.pos];
	for (; c !== undefined; c = s[p.pos]) {
		if (c === "\\" && reEscapableHere.test(s[p.pos + 1] ?? "")) {
			p.pos += 2;
		} else if (c === "(") {
			// the spec lets an implementation limit the nesting (at least 3); 32 keeps this linear
			if (openparens === 32) return null;
			p.pos += 1;
			openparens += 1;
		} else if (c === ")") {
			if (openparens < 1) break;
			p.pos += 1;
			openparens -= 1;
		} else if (reControlOrSpace.test(c)) {
			break;
		} else {
			p.pos += 1;
		}
	}
	if (p.pos === savepos && c !== ")") return null;
	if (openparens !== 0) return null;
	return normalizeURI(unescapeString(s.slice(savepos, p.pos), decodeName));
}

/** Read a link reference definition at the start of s into refmap; the length taken, or 0. */
function parseReference(s, refmap, decodeName) {
	const p = { subject: s, pos: 0 };
	const n = scanLinkLabel(p);
	if (n === 0) return 0;
	const rawlabel = s.slice(0, n);
	if (s[p.pos] !== ":") return 0;
	p.pos += 1;
	skipSpnl(p);
	const dest = scanLinkDestination(p, decodeName);
	if (dest === null) return 0;
	const beforeTitle = p.pos;
	skipSpnl(p);
	let title = null;
	if (p.pos !== beforeTitle) title = scanLinkTitle(p, decodeName);
	if (title === null) {
		title = "";
		p.pos = beforeTitle;
	}
	let atLineEnd = true;
	if (matchAt(p, reSpaceAtEndOfLine) === null) {
		if (title === "") atLineEnd = false;
		else {
			title = "";
			p.pos = beforeTitle;
			atLineEnd = matchAt(p, reSpaceAtEndOfLine) !== null;
		}
	}
	if (!atLineEnd) return 0;
	const label = normalizeLabel(rawlabel);
	if (label === "") return 0;
	if (!refmap.has(label)) refmap.set(label, { destination: dest, title });
	return p.pos;
}

const CODE_INDENT = 4;

// The patterns that need no position.
const reNonSpace = /[^ \t\f\v\r\n]/;
const reTableDelimiterCell = /^:?-+:?$/;
const reBlankLine = /^[ \t]*$/;

// The types of the blocks, as the codes of the table's type column
export const DOCUMENT = 0;
export const BLOCK_QUOTE = 1;
export const LIST = 2;
export const ITEM = 3;
export const PARAGRAPH = 4;
export const HEADING = 5;
export const CODE_BLOCK = 6;
export const HTML_BLOCK = 7;
export const THEMATIC_BREAK = 8;
export const TABLE = 9;
export const TABLE_HEAD = 10;
export const TABLE_ROW = 11;
export const TABLE_CELL = 12;
/** The name of each type of block, by its code. */
export const BLOCK_NAMES = Object.freeze([
	"document",
	"block_quote",
	"list",
	"item",
	"paragraph",
	"heading",
	"code_block",
	"html_block",
	"thematic_break",
	"table",
	"table_head",
	"table_row",
	"table_cell",
]);

/** A table cell's alignment, by its code in slot B_A: none, left, center, right. */
export const ALIGNS = Object.freeze([null, "left", "center", "right"]);

// The slots of a row of NodeTable's core, every node's: 8 of an Int32Array, 32 bytes
export const ROW = 8;
export const F_TYPE = 0; // the type's code, and OPEN
export const F_OFFSET = 1;
export const F_PARENT = 2;
export const F_FIRST = 3;
export const F_LAST = 4;
export const F_NEXT = 5;
export const F_AT = 6;
export const F_COUNT = 7;
/** The bit of slot F_TYPE set while a block is open. */
export const OPEN = 0x100;
// The slots of a block's row of NodeTable's b32, the blocks' own: 8 of another Int32Array
export const B_PREV = 0;
export const B_START_LINE = 1;
export const B_END_LINE = 2;
export const B_A = 3;
export const B_B = 4;
export const B_C = 5;
export const B_D = 6;
export const B_STR = 7;

/** The nodes of a document: every node's core in i32, a block's own fields in b32, by the row (gfm_blocks.d.ts). */
export class NodeTable {
	constructor() {
		this.length = 0;
		this.capacity = 0;
		// the rows b32 has room for, and one past the last block's
		this.blockCapacity = 0;
		this.blockEnd = 0;
		// the strings of the rows: a code block's by B_STR, a link's by F_AT
		this.strings = [];
		this.grow(1024);
		this.growBlocks(1024);
	}

	/** Make room for n rows (at least length) in i32, the rows there copied. */
	grow(n) {
		const i32 = new Int32Array(n * ROW);
		if (this.i32 !== undefined)
			i32.set(this.i32.subarray(0, Math.min(this.i32.length, n * ROW)));
		this.i32 = i32;
		this.capacity = n;
	}

	/** Make room for n rows (at least blockEnd) in b32, the rows there copied. */
	growBlocks(n) {
		const b32 = new Int32Array(n * ROW);
		if (this.b32 !== undefined)
			b32.set(this.b32.subarray(0, Math.min(this.b32.length, n * ROW)));
		this.b32 = b32;
		this.blockCapacity = n;
	}

	/** Give up the room past the last row and the last block's, once no more rows are added. */
	compact() {
		if (this.capacity > this.length) this.grow(this.length);
		if (this.blockCapacity > this.blockEnd) this.growBlocks(this.blockEnd);
	}

	/** A new inline's row, of no parent, children or spans; its index. */
	add(type, offset) {
		const i = this.length;
		if (i === this.capacity) this.grow(2 * i);
		const n = this.i32;
		const I = i << 3;
		n[I] = type;
		n[I + F_OFFSET] = offset;
		n[I + F_PARENT] = -1;
		n[I + F_FIRST] = -1;
		n[I + F_LAST] = -1;
		n[I + F_NEXT] = -1;
		n[I + F_AT] = 0;
		n[I + F_COUNT] = 0;
		this.length = i + 1;
		return i;
	}

	/** A new block's row, its own fields too, its values 0 and no string; its index. */
	addBlock(type, offset, open, startLine) {
		const i = this.add(open === 0 ? type : type | OPEN, offset);
		if (i >= this.blockCapacity) {
			let n = this.blockCapacity;
			while (n <= i) n *= 2;
			this.growBlocks(n);
		}
		const b = this.b32;
		const I = i << 3;
		b[I + B_PREV] = -1;
		b[I + B_START_LINE] = startLine;
		b[I + B_END_LINE] = 0;
		b[I + B_A] = 0;
		b[I + B_B] = 0;
		b[I + B_C] = 0;
		b[I + B_D] = 0;
		b[I + B_STR] = -1;
		this.blockEnd = i + 1;
		return i;
	}

	/** Add s to strings; its index. */
	addString(s) {
		this.strings.push(s);
		return this.strings.length - 1;
	}

	/** Make child, a block, the last child of parent. */
	append(parent, child) {
		const n = this.i32;
		const P = parent << 3;
		const C = child << 3;
		const last = n[P + F_LAST];
		n[C + F_PARENT] = parent;
		this.b32[C + B_PREV] = last;
		n[C + F_NEXT] = -1;
		if (last === -1) n[P + F_FIRST] = child;
		else n[(last << 3) + F_NEXT] = child;
		n[P + F_LAST] = child;
	}

	/** Make child, an inline, the last child of parent; an inline has no prev. */
	appendInline(parent, child) {
		const n = this.i32;
		const P = parent << 3;
		const last = n[P + F_LAST];
		n[(child << 3) + F_PARENT] = parent;
		if (last === -1) n[P + F_FIRST] = child;
		else n[(last << 3) + F_NEXT] = child;
		n[P + F_LAST] = child;
	}

	/** Take node, a block, out of its parent. */
	unlink(node) {
		const n = this.i32;
		const b = this.b32;
		const N = node << 3;
		const P = n[N + F_PARENT] << 3;
		const prev = b[N + B_PREV];
		const next = n[N + F_NEXT];
		if (prev === -1) n[P + F_FIRST] = next;
		else n[(prev << 3) + F_NEXT] = next;
		if (next === -1) n[P + F_LAST] = prev;
		else b[(next << 3) + B_PREV] = prev;
		n[N + F_PARENT] = -1;
		b[N + B_PREV] = -1;
		n[N + F_NEXT] = -1;
	}

	/** Put node where old is, taking old out (blocks). */
	replace(old, node) {
		const n = this.i32;
		const b = this.b32;
		const O = old << 3;
		const N = node << 3;
		const parent = n[O + F_PARENT];
		const prev = b[O + B_PREV];
		const next = n[O + F_NEXT];
		n[N + F_PARENT] = parent;
		b[N + B_PREV] = prev;
		n[N + F_NEXT] = next;
		if (prev === -1) n[(parent << 3) + F_FIRST] = node;
		else n[(prev << 3) + F_NEXT] = node;
		if (next === -1) n[(parent << 3) + F_LAST] = node;
		else b[(next << 3) + B_PREV] = node;
		n[O + F_PARENT] = -1;
		b[O + B_PREV] = -1;
		n[O + F_NEXT] = -1;
	}

	/** Put node right after ref (blocks). */
	insertAfter(ref, node) {
		const n = this.i32;
		const b = this.b32;
		const R = ref << 3;
		const N = node << 3;
		const parent = n[R + F_PARENT];
		const next = n[R + F_NEXT];
		n[N + F_PARENT] = parent;
		b[N + B_PREV] = ref;
		n[N + F_NEXT] = next;
		n[R + F_NEXT] = node;
		if (next === -1) n[(parent << 3) + F_LAST] = node;
		else b[(next << 3) + B_PREV] = node;
	}
}

// The slots of a span of SpanStore: start, end, and its pad (a block's line) or src (an inline's piece)
export const SPAN = 3;

/** The ranges of a document's text, as spans of 3 slots of one Int32Array (gfm_blocks.d.ts). */
export class SpanStore {
	constructor() {
		this.i32 = new Int32Array(1024 * SPAN);
		this.length = 0;
		// the text of the spans that are not in the parsed text, one after another
		this.extra = "";
	}

	/** Add a span; its index. */
	push(start, end, flag) {
		const i = this.length;
		let s = this.i32;
		if ((i + 1) * SPAN > s.length) {
			const grown = new Int32Array(s.length * 2);
			grown.set(s);
			this.i32 = s = grown;
		}
		const I = i * SPAN;
		s[I] = start;
		s[I + 1] = end;
		s[I + 2] = flag;
		this.length = i + 1;
		return i;
	}

	/** Give up the room past the last span, once no more spans are added. */
	compact() {
		if (this.i32.length > this.length * SPAN)
			this.i32 = this.i32.slice(0, this.length * SPAN);
	}
}

/** The text of the content of leaf, a paragraph, a heading or a table cell of nodes, read from source by its spans. */
export function leafText(source, nodes, spans, leaf) {
	const s32 = spans.i32;
	const L = leaf << 3;
	const at = nodes.i32[L + F_AT];
	const end = at + nodes.i32[L + F_COUNT];
	let s = "";
	for (let i = at; i < end; i++) {
		if (i > at) s += "\n";
		s += source.slice(s32[i * SPAN], s32[i * SPAN + 1]);
	}
	if (s.includes("\0")) s = s.replace(/\0/g, "�");
	// in a table cell, \| is a | of the content
	if ((nodes.i32[L] & 0xff) === TABLE_CELL && s.includes("\\"))
		s = s.replace(/\\([\s\S])/g, (m, c) => (c === "|" ? "|" : m));
	return s;
}

/** The lines of block, a code block or an HTML block of nodes, read from source by its spans and their pads. */
export function blockLines(source, nodes, spans, block) {
	const lines = [];
	const s32 = spans.i32;
	const at = nodes.i32[(block << 3) + F_AT];
	const end = at + nodes.i32[(block << 3) + F_COUNT];
	for (let i = at; i < end; i++) {
		const line = source.slice(s32[i * SPAN], s32[i * SPAN + 1]);
		const pad = s32[i * SPAN + 2];
		const padded = pad === 0 ? line : " ".repeat(pad) + line;
		lines.push(padded.includes("\0") ? padded.replace(/\0/g, "�") : padded);
	}
	return lines;
}

/** How deep block quotes and list items may nest (LCTYSP-0017). */
export const MAX_NESTING = 32;

/** The number of block quotes and list items that block of t is in, itself included. */
function nesting(t, block) {
	let n = 0;
	for (let b = block; b !== -1; b = t.i32[(b << 3) + F_PARENT]) {
		const type = t.i32[b << 3] & 0xff;
		if (type === BLOCK_QUOTE || type === ITEM) n++;
	}
	return n;
}

export const isSpaceOrTab = (c) => c === " " || c === "\t";
const isBlank = (s) => !reNonSpace.test(s);

/** Whether line holds only spaces and tabs from i to its end. */
function spacesToEnd(line, i) {
	for (; i < line.length; i++) if (!isSpaceOrTab(line[i])) return false;
	return true;
}

/** Whether line, from i to its end, is blank as isBlank reads it. */
function blankToEnd(line, i) {
	for (; i < line.length; i++) {
		const c = line[i];
		if (c !== " " && c !== "\t" && c !== "\f" && c !== "\v") return false;
	}
	return true;
}

/** Whether s from i to end holds only blank lines. */
function blankBetween(s, i, end) {
	for (; i < end; i++) {
		const c = s[i];
		if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return false;
	}
	return true;
}

/** The index after the run of c that starts at i of line. */
function runEnd(line, i, c) {
	while (line[i] === c) i++;
	return i;
}

/** Whether a blank line separates child from its next sibling in t. */
function blankAfter(t, child) {
	const next = t.i32[(child << 3) + F_NEXT];
	return (
		next !== -1 &&
		t.b32[(child << 3) + B_END_LINE] !== t.b32[(next << 3) + B_START_LINE] - 1
	);
}

/** The cells of a table row. */
function tableCells(line) {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells = [];
	let cell = "";
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "\\" && s[i + 1] === "|") {
			cell += "|";
			i++;
		} else if (c === "\\" && i + 1 < s.length) {
			cell += c + s[i + 1];
			i++;
		} else if (c === "|") {
			cells.push(cell.trim());
			cell = "";
		} else {
			cell += c;
		}
	}
	cells.push(cell.trim());
	return cells;
}

/** The alignment codes of a delimiter row (ALIGNS), or null when line is not one. */
function delimiterRow(line) {
	const s = line.trim();
	if (!s.includes("-")) return null;
	if (!s.includes("|") && !s.includes(":")) return null;
	const cells = tableCells(s);
	if (!cells.every((c) => reTableDelimiterCell.test(c))) return null;
	return Uint8Array.from(cells, (c) => {
		const l = c.startsWith(":");
		const r = c.endsWith(":");
		return l && r ? 2 : l ? 1 : r ? 3 : 0;
	});
}

/** The ranges of the cells of a row, line from i, as tableCells cuts them; line starts at abs in the text. */
function cellRanges(line, i, abs) {
	let a = i;
	let b = line.length;
	while (a < b && /\s/.test(line[a])) a++;
	while (b > a && /\s/.test(line[b - 1])) b--;
	if (line[a] === "|") a++;
	if (b > a && line[b - 1] === "|" && line[b - 2] !== "\\") b--;
	const ranges = [];
	let start = a;
	const cut = (end) => {
		let x = start;
		let y = end;
		while (x < y && /\s/.test(line[x])) x++;
		while (y > x && /\s/.test(line[y - 1])) y--;
		ranges.push(abs + x, abs + y);
	};
	for (let k = a; k < b; k++) {
		const c = line[k];
		if (c === "\\" && k + 1 < b) k++;
		else if (c === "|") {
			cut(k);
			start = k + 1;
		}
	}
	cut(b);
	return ranges;
}

/** Drop the first n characters of node's text, its ranges joined by line endings, from its ranges. */
function dropFront(parser, node, n) {
	const t = parser.nodes;
	const u32 = parser.spans.i32;
	while (t.i32[(node << 3) + F_COUNT] > 0) {
		const i = t.i32[(node << 3) + F_AT];
		const length = u32[3 * i + 1] - u32[3 * i];
		if (n <= length) {
			u32[3 * i] += n;
			return;
		}
		n -= length + 1;
		t.i32[(node << 3) + F_AT] = i + 1;
		t.i32[(node << 3) + F_COUNT]--;
	}
}

// What each type of block does, as switches on its type.

/** Whether the current line continues block: 0 (it does), 1 (it does not) or 2 (the line is used up). */
function continueBlock(parser, block) {
	const t = parser.nodes;
	switch (t.i32[block << 3] & 0xff) {
		case DOCUMENT:
		case LIST:
			return 0;
		case BLOCK_QUOTE: {
			const ln = parser.currentLine;
			if (parser.indented || ln[parser.nextNonspace] !== ">") return 1;
			parser.advanceNextNonspace();
			parser.advanceOffset(1, false);
			if (isSpaceOrTab(ln[parser.offset])) parser.advanceOffset(1, true);
			return 0;
		}
		case ITEM: {
			const width = t.b32[(block << 3) + B_A] + t.b32[(block << 3) + B_B];
			if (parser.blank) {
				if (t.i32[(block << 3) + F_FIRST] === -1) return 1;
				parser.advanceNextNonspace();
			} else if (parser.indent >= width) {
				parser.advanceOffset(width, true);
			} else {
				return 1;
			}
			return 0;
		}
		case CODE_BLOCK:
			return continueCodeBlock(parser, block);
		case HTML_BLOCK:
			return parser.blank &&
				(t.b32[(block << 3) + B_A] === 6 || t.b32[(block << 3) + B_A] === 7)
				? 1
				: 0;
		case PARAGRAPH:
		case TABLE:
			return parser.blank ? 1 : 0;
		default:
			// heading, thematic_break: one line each
			return 1;
	}
}

function continueCodeBlock(parser, block) {
	const t = parser.nodes;
	const ln = parser.currentLine;
	const indent = parser.indent;
	if (t.b32[(block << 3) + B_A] === 1) {
		// a closing fence, at least as long as the opening
		const at = parser.nextNonspace;
		const end =
			indent <= 3
				? runEnd(ln, at, String.fromCharCode(t.b32[(block << 3) + B_B]))
				: at;
		if (
			end - at >= 3 &&
			end - at >= t.b32[(block << 3) + B_C] &&
			spacesToEnd(ln, end)
		) {
			parser.finalize(block, parser.lineNumber);
			return 2;
		}
		let i = t.b32[(block << 3) + B_D];
		while (i > 0 && isSpaceOrTab(ln[parser.offset])) {
			parser.advanceOffset(1, true);
			i--;
		}
	} else if (indent >= CODE_INDENT) {
		parser.advanceOffset(CODE_INDENT, true);
	} else if (parser.blank) {
		parser.advanceNextNonspace();
	} else {
		return 1;
	}
	return 0;
}

/** What is done to block when it is closed. */
function finalizeBlock(parser, block) {
	const t = parser.nodes;
	switch (t.i32[block << 3] & 0xff) {
		case LIST: {
			const last = t.i32[(block << 3) + F_LAST];
			t.b32[(block << 3) + B_END_LINE] =
				last === -1
					? t.b32[(block << 3) + B_START_LINE]
					: t.b32[(last << 3) + B_END_LINE];
			let tight = true;
			for (
				let item = t.i32[(block << 3) + F_FIRST];
				tight && item !== -1;
				item = t.i32[(item << 3) + F_NEXT]
			) {
				if (blankAfter(t, item)) tight = false;
				for (
					let sub = t.i32[(item << 3) + F_FIRST];
					tight && sub !== -1;
					sub = t.i32[(sub << 3) + F_NEXT]
				)
					if (blankAfter(t, sub)) tight = false;
			}
			t.b32[(block << 3) + B_D] = tight ? 1 : 0;
			break;
		}
		case ITEM: {
			const last = t.i32[(block << 3) + F_LAST];
			t.b32[(block << 3) + B_END_LINE] =
				last === -1
					? t.b32[(block << 3) + B_START_LINE]
					: t.b32[(last << 3) + B_END_LINE];
			break;
		}
		case CODE_BLOCK: {
			if (t.b32[(block << 3) + B_A] === 1) {
				// the first line is the info string, NUL read as U+FFFD as the lines were
				const line = parser.textOf(t.i32[(block << 3) + F_AT]).trim();
				t.b32[(block << 3) + B_STR] = t.addString(
					unescapeString(
						line.includes("\0") ? line.replace(/\0/g, "�") : line,
						parser.decodeName,
					),
				);
				t.i32[(block << 3) + F_AT]++;
				t.i32[(block << 3) + F_COUNT]--;
			} else {
				const n = t.i32[(block << 3) + F_COUNT];
				while (
					t.i32[(block << 3) + F_COUNT] > 0 &&
					reBlankLine.test(
						parser.textOf(
							t.i32[(block << 3) + F_AT] + t.i32[(block << 3) + F_COUNT] - 1,
						),
					)
				)
					t.i32[(block << 3) + F_COUNT]--;
				t.b32[(block << 3) + B_END_LINE] -= n - t.i32[(block << 3) + F_COUNT];
			}
			break;
		}
		case HTML_BLOCK:
			while (
				t.i32[(block << 3) + F_COUNT] > 1 &&
				/^ *$/.test(
					parser.textOf(
						t.i32[(block << 3) + F_AT] + t.i32[(block << 3) + F_COUNT] - 1,
					),
				)
			)
				t.i32[(block << 3) + F_COUNT]--;
			break;
		case PARAGRAPH:
			finalizeParagraph(parser, block);
			break;
	}
}

function finalizeParagraph(parser, block) {
	const t = parser.nodes;
	// only one starting with [ may hold a definition or a task box; one a setext underline emptied stays empty
	if (
		t.i32[(block << 3) + F_COUNT] === 0 ||
		parser.charAt(parser.spans.i32[3 * t.i32[(block << 3) + F_AT]]) !== "["
	)
		return;
	let content = parser.joined(block);
	const refs = takeReferences(parser, content);
	if (refs > 0) {
		content = content.slice(refs);
		if (isBlank(content)) {
			t.unlink(block);
			return;
		}
		dropFront(parser, block, refs);
	}
	const item = t.i32[(block << 3) + F_PARENT];
	if (
		(t.i32[item << 3] & 0xff) === ITEM &&
		t.i32[(item << 3) + F_FIRST] === block
	) {
		// a task list item's box
		const x = content[1];
		if (
			content[0] === "[" &&
			content[2] === "]" &&
			isSpaceOrTab(content[3]) &&
			(isSpaceOrTab(x) || x === "x" || x === "X")
		) {
			t.b32[(item << 3) + B_C] = isSpaceOrTab(x) ? 1 : 2;
			dropFront(parser, block, 3);
		}
	}
}

/** Whether a block of type parent may hold a block of type child. */
function canContain(parent, child) {
	switch (parent) {
		case DOCUMENT:
		case BLOCK_QUOTE:
		case ITEM:
			return child !== ITEM;
		case LIST:
			return child === ITEM;
		default:
			return false;
	}
}

/** Whether the rest of a line is added to an open block of type. */
function acceptsLines(type) {
	return (
		type === CODE_BLOCK ||
		type === HTML_BLOCK ||
		type === PARAGRAPH ||
		type === TABLE
	);
}

/** Whether the current line, from the parser's offset, holds the end of an HTML block of type 1 to 5. */
function htmlBlockEnds(parser, type) {
	const ln = parser.currentLine;
	const i = parser.offset;
	switch (type) {
		case 1:
			return parser.at(parser.reHtmlBlockEnd1, i) !== null;
		case 2:
			return ln.indexOf("-->", i) !== -1;
		case 3:
			return ln.indexOf("?>", i) !== -1;
		case 4:
			return ln.indexOf(">", i) !== -1;
		default:
			return ln.indexOf("]]>", i) !== -1;
	}
}

/** Read the definitions at the start of a paragraph's text; the characters taken. */
function takeReferences(parser, content) {
	let taken = 0;
	while (content[taken] === "[") {
		const n = parseReference(
			content.slice(taken),
			parser.refmap,
			parser.decodeName,
		);
		if (n === 0) break;
		taken += n;
	}
	return taken;
}

// The block starts: a switch on the line's first character, then a character at a time.

/** The block the current line starts where its indentation ends. */
function startBlock(parser, container) {
	const ln = parser.currentLine;
	const i = parser.nextNonspace;
	const c = ln[i];
	const inParagraph = (parser.nodes.i32[container << 3] & 0xff) === PARAGRAPH;
	switch (c) {
		case ">":
			return startBlockQuote(parser, container);
		case "#":
			return startATXHeading(parser);
		case "`":
		case "~":
			return startFencedCode(parser, c);
		case "<":
			return startHtmlBlock(parser, container);
		case "=":
			return inParagraph && spacesToEnd(ln, runEnd(ln, i, c))
				? startSetextHeading(parser, container, 1)
				: 0;
		case "-":
			if (inParagraph) {
				if (spacesToEnd(ln, runEnd(ln, i, c))) {
					const r = startSetextHeading(parser, container, 2);
					if (r !== 0) return r;
				}
				const r = startTable(parser, container);
				if (r !== 0) return r;
			}
			return isThematicBreak(ln, i, c)
				? startThematicBreak(parser)
				: startBulletItem(parser, container, c);
		case "*":
			return isThematicBreak(ln, i, c)
				? startThematicBreak(parser)
				: startBulletItem(parser, container, c);
		case "_":
			return isThematicBreak(ln, i, c) ? startThematicBreak(parser) : 0;
		case "+":
			return startBulletItem(parser, container, c);
		case "|":
		case ":":
			return inParagraph ? startTable(parser, container) : 0;
		default:
			return c >= "0" && c <= "9" ? startOrderedItem(parser, container) : 0;
	}
}

/** Whether line from i is a thematic break of c. */
export function isThematicBreak(line, i, c) {
	let n = 0;
	for (; i < line.length; i++) {
		const d = line[i];
		if (d === c) n++;
		else if (!isSpaceOrTab(d)) return false;
	}
	return n >= 3;
}

function startBlockQuote(parser, container) {
	if (nesting(parser.nodes, container) >= MAX_NESTING) return 0;
	parser.advanceNextNonspace();
	parser.advanceOffset(1, false);
	if (isSpaceOrTab(parser.currentLine[parser.offset]))
		parser.advanceOffset(1, true);
	parser.closeUnmatchedBlocks();
	parser.addChild(BLOCK_QUOTE, parser.nextNonspace);
	return 1;
}

/** An ATX heading. */
function startATXHeading(parser) {
	const ln = parser.currentLine;
	const i = parser.nextNonspace;
	const hashes = runEnd(ln, i, "#");
	const level = hashes - i;
	if (level > 6 || !(hashes === ln.length || isSpaceOrTab(ln[hashes])))
		return 0;
	let j = hashes;
	while (isSpaceOrTab(ln[j])) j++;
	parser.advanceNextNonspace();
	parser.advanceOffset(j - i, false);
	parser.closeUnmatchedBlocks();
	const t = parser.nodes;
	const heading = parser.addChild(HEADING, parser.nextNonspace);
	t.b32[(heading << 3) + B_A] = level;
	t.i32[(heading << 3) + F_AT] = parser.spans.push(
		parser.lineStart + parser.offset,
		parser.lineStart + closingSequenceAt(ln, parser.offset),
		0,
	);
	t.i32[(heading << 3) + F_COUNT] = 1;
	parser.advanceOffset(ln.length - parser.offset);
	return 2;
}

/** Where the text of an ATX heading from i of line ends, before its closing sequence. */
function closingSequenceAt(line, i) {
	let end = line.length;
	while (end > i && isSpaceOrTab(line[end - 1])) end--;
	let hashes = end;
	while (hashes > i && line[hashes - 1] === "#") hashes--;
	if (hashes === end) return line.length;
	if (hashes === i) return i;
	if (!isSpaceOrTab(line[hashes - 1])) return line.length;
	while (hashes > i && isSpaceOrTab(line[hashes - 1])) hashes--;
	return hashes;
}

/** A fenced code block. */
function startFencedCode(parser, c) {
	const ln = parser.currentLine;
	const i = parser.nextNonspace;
	const end = runEnd(ln, i, c);
	const length = end - i;
	if (length < 3 || (c === "`" && ln.indexOf("`", end) !== -1)) return 0;
	parser.closeUnmatchedBlocks();
	const t = parser.nodes;
	const code = parser.addChild(CODE_BLOCK, i);
	t.b32[(code << 3) + B_A] = 1;
	t.b32[(code << 3) + B_B] = c.charCodeAt(0);
	t.b32[(code << 3) + B_C] = length;
	t.b32[(code << 3) + B_D] = parser.indent;
	parser.advanceNextNonspace();
	parser.advanceOffset(length, false);
	return 2;
}

/** An HTML block, of the first of the seven start conditions the line meets. */
function startHtmlBlock(parser, container) {
	const m = parser.at(parser.reHtmlBlockStart, parser.nextNonspace);
	if (m === null) return 0;
	let n = 1;
	while (m[n] === undefined) n++;
	// reHtmlBlockStart ignores case, which 1, 6 and 7 want; 4 wants an uppercase letter, 5 CDATA as it is
	if (n === 4 && !(m[4][2] >= "A" && m[4][2] <= "Z")) return 0;
	if (n === 5 && m[5] !== "<![CDATA[") return 0;
	const t = parser.nodes;
	if (
		n === 7 &&
		((t.i32[container << 3] & 0xff) === PARAGRAPH ||
			(!parser.allClosed &&
				!parser.blank &&
				(t.i32[parser.tip << 3] & 0xff) === PARAGRAPH))
	)
		return 0;
	parser.closeUnmatchedBlocks();
	const html = parser.addChild(HTML_BLOCK, parser.offset);
	t.b32[(html << 3) + B_A] = n;
	return 2;
}

/** A setext heading: the line underlines the paragraph container. */
function startSetextHeading(parser, container, level) {
	parser.closeUnmatchedBlocks();
	const t = parser.nodes;
	const content = parser.joined(container);
	const taken = takeReferences(parser, content);
	if (taken === content.length) {
		t.i32[(container << 3) + F_COUNT] = 0;
		return 0;
	}
	const heading = t.addBlock(
		HEADING,
		t.i32[(container << 3) + F_OFFSET],
		1,
		t.b32[(container << 3) + B_START_LINE],
	);
	t.b32[(heading << 3) + B_A] = level;
	t.i32[(heading << 3) + F_AT] = t.i32[(container << 3) + F_AT];
	t.i32[(heading << 3) + F_COUNT] = t.i32[(container << 3) + F_COUNT];
	dropFront(parser, heading, taken);
	t.replace(container, heading);
	parser.tip = heading;
	parser.advanceOffset(parser.currentLine.length - parser.offset, false);
	return 2;
}

/** A table: the paragraph's last line is the header row, this line the delimiter row. */
function startTable(parser, container) {
	const aligns = delimiterRow(parser.currentLine.slice(parser.nextNonspace));
	if (!aligns) return 0;
	const t = parser.nodes;
	const last =
		t.i32[(container << 3) + F_AT] + t.i32[(container << 3) + F_COUNT] - 1;
	const lastAt = parser.spans.i32[3 * last];
	const header = cellRanges(parser.textOf(last), 0, lastAt);
	if (header.length !== 2 * aligns.length) return 0;
	parser.closeUnmatchedBlocks();
	const keeps = t.i32[(container << 3) + F_COUNT] > 1;
	// where the header row's text starts, when the paragraph keeps lines before it
	const table = t.addBlock(
		TABLE,
		keeps ? lastAt : t.i32[(container << 3) + F_OFFSET],
		1,
		parser.lineNumber - 1,
	);
	t.b32[(table << 3) + B_A] = 1;
	if (keeps) {
		t.i32[(container << 3) + F_COUNT]--;
		t.insertAfter(container, table);
		parser.finalize(container, parser.lineNumber - 2);
	} else {
		t.replace(container, table);
	}
	parser.addTableRow(table, header, TABLE_HEAD, aligns);
	parser.tip = table;
	parser.advanceOffset(parser.currentLine.length - parser.offset, false);
	return 2;
}

function startThematicBreak(parser) {
	parser.closeUnmatchedBlocks();
	parser.addChild(THEMATIC_BREAK, parser.nextNonspace);
	parser.advanceOffset(parser.currentLine.length - parser.offset, false);
	return 2;
}

/** A bullet list item: *, + or -, then a space, a tab or the end of the line. */
function startBulletItem(parser, container, c) {
	const next = parser.currentLine[parser.nextNonspace + 1];
	if (next !== undefined && !isSpaceOrTab(next)) return 0;
	return startListItem(parser, container, 1, 0, c.charCodeAt(0), 1);
}

/** An ordered list item. */
function startOrderedItem(parser, container) {
	const ln = parser.currentLine;
	const i = parser.nextNonspace;
	let j = i;
	while (j - i < 9 && ln[j] >= "0" && ln[j] <= "9") j++;
	const delimiter = ln[j];
	if (delimiter !== "." && delimiter !== ")") return 0;
	const next = ln[j + 1];
	if (next !== undefined && !isSpaceOrTab(next)) return 0;
	const start = Number.parseInt(ln.slice(i, j), 10);
	// in a paragraph, an ordered list starts only at 1
	if ((parser.nodes.i32[container << 3] & 0xff) === PARAGRAPH && start !== 1)
		return 0;
	return startListItem(
		parser,
		container,
		j + 1 - i,
		1,
		delimiter.charCodeAt(0),
		start,
	);
}

/** A list item whose marker is length characters (ordered, its character's code, start), the parser moved past it. */
function startListItem(parser, container, length, ordered, char, start) {
	const t = parser.nodes;
	if (nesting(t, container) >= MAX_NESTING) return 0;
	const ln = parser.currentLine;
	// in a paragraph, a list item may not start empty
	if (
		(t.i32[container << 3] & 0xff) === PARAGRAPH &&
		blankToEnd(ln, parser.nextNonspace + length)
	)
		return 0;
	const markerOffset = parser.indent;
	let padding;
	parser.advanceNextNonspace();
	parser.advanceOffset(length, true);
	const spacesStartCol = parser.column;
	const spacesStartOffset = parser.offset;
	let nextc;
	do {
		parser.advanceOffset(1, true);
		nextc = ln[parser.offset];
	} while (parser.column - spacesStartCol < 5 && isSpaceOrTab(nextc));
	const blankItem = nextc === undefined;
	const spacesAfterMarker = parser.column - spacesStartCol;
	if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
		padding = length + 1;
		parser.column = spacesStartCol;
		parser.offset = spacesStartOffset;
		if (isSpaceOrTab(ln[parser.offset])) parser.advanceOffset(1, true);
	} else {
		padding = length + spacesAfterMarker;
	}
	parser.closeUnmatchedBlocks();
	const tip = parser.tip;
	if (
		(t.i32[tip << 3] & 0xff) !== LIST ||
		t.b32[(tip << 3) + B_A] !== ordered ||
		t.b32[(tip << 3) + B_B] !== char
	) {
		const list = parser.addChild(LIST, parser.nextNonspace);
		t.b32[(list << 3) + B_A] = ordered;
		t.b32[(list << 3) + B_B] = char;
		t.b32[(list << 3) + B_C] = start;
		t.b32[(list << 3) + B_D] = 1;
	}
	const item = parser.addChild(ITEM, parser.nextNonspace);
	t.b32[(item << 3) + B_A] = markerOffset;
	t.b32[(item << 3) + B_B] = padding;
	return 1;
}

/** An indented code block. */
function startIndentedCode(parser) {
	if ((parser.nodes.i32[parser.tip << 3] & 0xff) === PARAGRAPH || parser.blank)
		return 0;
	parser.advanceOffset(CODE_INDENT, true);
	parser.closeUnmatchedBlocks();
	parser.addChild(CODE_BLOCK, parser.offset);
	return 2;
}

// the document's row and the row one advance reads its lines into, both fixed
const DOC = 0;
const ROOT = 1;

export class BlockParser {
	/** decodeName(name) is the text of the named character reference &name;, or null (LCTYSP-0017). */
	constructor(decodeName) {
		this.decodeName = decodeName;
		// what lasts from one advance to the next: the definitions, the blocks and their ranges
		this.refmap = new Map();
		this.nodes = new NodeTable();
		this.spans = new SpanStore();
		this.nodes.addBlock(DOCUMENT, 0, 1, 1);
		this.nodes.addBlock(DOCUMENT, 0, 1, 1);
		// how many spans, rows and strings the blocks taken use; a fresh advance cuts them back to that
		this.committed = 0;
		this.committedRows = 2;
		this.committedStrings = 0;
		// how many the client added past them since (an inline phase), which no advance cuts
		this.floor = 0;
		this.floorRows = 2;
		this.floorStrings = 0;
		// how many there were when the last advance returned
		this.afterSpans = 0;
		this.afterRows = 2;
		this.afterStrings = 0;
		// for line k + 1 of the parser's lines: the lengths of spans and rows before it, and where it ends
		this.marks = new Uint32Array(256);
		this.rowMarks = new Uint32Array(256);
		this.ends = new Uint32Array(256);
		// the lines read past the last block taken (took)
		this.carryRest = null;
		this.carryBase = 0;
		this.carryPos = 0;
		this.carryStart = 0;
		this.carryAt = 0;
		this.base = 0;
		this.tip = ROOT;
		this.oldtip = ROOT;
		this.lineNumber = 0;
		this.lineStart = 0;
		// the head being advanced, and where it starts in the text
		this.head = "";
		this.headAt = 0;
		this.currentLine = "";
		this.offset = 0;
		this.column = 0;
		this.nextNonspace = 0;
		this.nextNonspaceColumn = 0;
		this.indent = 0;
		this.indented = false;
		this.blank = false;
		this.partiallyConsumedTab = false;
		this.allClosed = true;
		this.lastMatchedContainer = ROOT;

		// the parser's own patterns, their lastIndex set freely (at)
		this.reLineEnding = /\r\n|\n|\r/g;
		this.reHtmlBlockStart = new RegExp(
			[
				"(<(?:script|pre|style)(?:\\s|>|$))",
				"(<!--)",
				"(<\\?)",
				"(<![A-Z])",
				"(<!\\[CDATA\\[)",
				"(<\\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\\s|\\/?>|$))",
				`((?:${OPENTAG}|${CLOSETAG})\\s*$)`,
			].join("|"),
			"iy",
		);
		this.reHtmlBlockEnd1 = /<\/(?:script|pre|style)>/gi;
	}

	/** The document's row. */
	get doc() {
		return DOC;
	}

	/** The match of re (one of the parser's sticky or global patterns) in the current line from position i, or null. */
	at(re, i) {
		re.lastIndex = i;
		return re.exec(this.currentLine);
	}

	/** Take the first top-level block of head once its lines end it (gfm_blocks.d.ts). */
	advance(head, end = false, offset = 0) {
		const t = this.nodes;
		// what the client added since the last advance is kept, and the lines carried are read again (gfm_blocks.d.ts)
		if (
			t.length !== this.afterRows ||
			this.spans.length !== this.afterSpans ||
			t.strings.length !== this.afterStrings
		) {
			this.floor = this.spans.length;
			this.floorRows = t.length;
			this.floorStrings = t.strings.length;
			this.carryRest = null;
		}
		const r = this.read(head, end, offset);
		this.afterSpans = this.spans.length;
		this.afterRows = t.length;
		this.afterStrings = t.strings.length;
		return r;
	}

	/** advance, what the client added kept. */
	read(head, end, offset) {
		const t = this.nodes;
		// the lines after the last block taken, read already, when head is the rest that advance gave
		const carried = this.carryRest === head && this.carryAt === offset;
		this.carryRest = null;
		this.head = head;
		this.headAt = offset;
		let blockStart;
		let first;
		let pos;
		if (carried) {
			this.base = this.carryBase;
			pos = this.carryPos;
			first = t.i32[(ROOT << 3) + F_FIRST];
			blockStart = first === -1 ? -1 : this.carryStart;
			if (first !== -1) {
				const taken = this.ended(head, blockStart, first, pos);
				if (taken !== null) return taken;
			}
		} else {
			this.restart();
			blockStart = -1;
			first = -1;
			pos = 0;
		}
		const base = this.base;
		const re = this.reLineEnding;
		re.lastIndex = pos;
		while (pos < head.length) {
			const m = re.exec(head);
			let lineEnd;
			let next;
			if (
				m === null ||
				(m[0] === "\r" && re.lastIndex === head.length && !end)
			) {
				if (!end) break;
				lineEnd = head.length;
				next = head.length;
			} else {
				lineEnd = m.index;
				next = re.lastIndex;
			}
			const line = head.slice(pos, lineEnd);
			if (blockStart === -1) {
				// a blank line of GFM: spaces and tabs only
				if (spacesToEnd(line, 0)) {
					pos = next;
					continue;
				}
				blockStart = pos;
			}
			this.lineStart = offset + pos;
			const k = this.lineNumber;
			if (k === this.ends.length) this.growLines();
			this.marks[k] = this.spans.length;
			this.rowMarks[k] = t.length;
			this.incorporateLine(line);
			this.ends[k] = base + next;
			pos = next;
			// the first block, again when a setext heading or a table has taken its place
			if (
				first === -1 ||
				(t.i32[(first << 3) + F_PARENT] === -1 && t.i32[first << 3] >> 8 === 1)
			)
				first = t.i32[(ROOT << 3) + F_FIRST];
			if (first === -1) continue;
			const taken = this.ended(head, blockStart, first, pos);
			if (taken !== null) return taken;
		}
		if (blockStart === -1)
			return pos === head.length ? ["", undefined] : undefined;
		if (!end) return undefined;
		while (this.tip !== -1) this.finalize(this.tip, this.lineNumber);
		if (
			first === -1 ||
			(t.i32[(first << 3) + F_PARENT] === -1 && t.i32[first << 3] >> 8 === 1)
		)
			first = t.i32[(ROOT << 3) + F_FIRST];
		return this.took(
			head,
			blockStart,
			this.lineEndAt(t.b32[(first << 3) + B_END_LINE]),
			first,
			pos,
		);
	}

	/** Make room for twice as many lines in marks, rowMarks and ends. */
	growLines() {
		const grow = (a) => {
			const b = new Uint32Array(2 * a.length);
			b.set(a);
			return b;
		};
		this.marks = grow(this.marks);
		this.rowMarks = grow(this.rowMarks);
		this.ends = grow(this.ends);
	}

	/** Where line n of the parser's lines ends in the head, its line ending included. */
	lineEndAt(n) {
		return this.ends[n - 1] - this.base;
	}

	/** What advance gives when the lines read end first, or null when they do not yet. */
	ended(head, blockStart, first, pos) {
		const t = this.nodes;
		if (t.i32[first << 3] >> 8 === 0)
			return this.took(
				head,
				blockStart,
				this.lineEndAt(t.b32[(first << 3) + B_END_LINE]),
				first,
				pos,
			);
		const type = t.i32[first << 3] & 0xff;
		if (type === HEADING || type === THEMATIC_BREAK) {
			this.finalize(first, this.lineNumber);
			return this.took(head, blockStart, pos, first, pos);
		}
		return null;
	}

	/** An empty root and line state for the next advance, the store and the table cut back to what is taken. */
	restart() {
		const t = this.nodes;
		t.i32[(ROOT << 3) + F_FIRST] = -1;
		t.i32[(ROOT << 3) + F_LAST] = -1;
		t.i32[ROOT << 3] |= OPEN;
		t.i32[(ROOT << 3) + F_PARENT] = -1;
		this.tip = ROOT;
		this.oldtip = ROOT;
		this.lastMatchedContainer = ROOT;
		this.lineNumber = 0;
		this.allClosed = true;
		// ends[k] - base is where line k + 1 of the parser's lines, its line ending included, ends in the head
		this.spans.length = Math.max(this.committed, this.floor);
		t.length = Math.max(this.committedRows, this.floorRows);
		t.strings.length = Math.max(this.committedStrings, this.floorStrings);
		this.base = 0;
	}

	/** What advance gives for first, what was read past it kept for the next advance. */
	took(head, start, end, first, pos) {
		const t = this.nodes;
		// the store's ranges and the table's rows up to the line after first are the blocks taken, garbage included
		const after = t.b32[(first << 3) + B_END_LINE];
		this.committed =
			after < this.lineNumber ? this.marks[after] : this.spans.length;
		this.committedRows =
			after < this.lineNumber ? this.rowMarks[after] : t.length;
		// a block's string is made when it closes, which may be on a later line: every string so far is kept
		this.committedStrings = t.strings.length;
		const text = head.slice(start, end);
		let rest = head.slice(end);
		const removed = t.i32[(first << 3) + F_PARENT] === -1;
		if (!removed) t.unlink(first);
		const next = t.i32[(ROOT << 3) + F_FIRST];
		// a table that split a paragraph starts where its header row's text does, the line's indentation no part of it
		const tableAt =
			next !== -1 && (t.i32[next << 3] & 0xff) === TABLE
				? t.i32[(next << 3) + F_OFFSET] - this.headAt
				: -1;
		if (tableAt > end) rest = head.slice(tableAt);
		// where the next block starts in rest, carried only when blank lines alone come between
		const nextStart =
			next === -1
				? -1
				: this.lineEndAt(t.b32[(next << 3) + B_START_LINE] - 1) - end;
		if (tableAt <= end && nextStart >= 0 && blankBetween(rest, 0, nextStart)) {
			this.carryRest = rest;
			this.carryBase = this.base + end;
			this.carryPos = pos - end;
			this.carryStart = nextStart;
			this.carryAt = this.headAt + end;
		}
		// a paragraph of link reference definitions only is taken out of the tree
		if (removed) return [rest, text, -1, []];
		t.append(DOC, first);
		const type = t.i32[first << 3] & 0xff;
		if (type === PARAGRAPH || type === HEADING)
			return [rest, text, first, [first]];
		// its leaves in the order of the text (a loop over its blocks, any depth)
		const leaves = [];
		const stack = [first];
		while (stack.length > 0) {
			const node = stack.pop();
			const ty = t.i32[node << 3] & 0xff;
			if (ty === PARAGRAPH || ty === HEADING || ty === TABLE_CELL)
				leaves.push(node);
			else
				for (
					let c = t.i32[(node << 3) + F_LAST];
					c !== -1;
					c = t.b32[(c << 3) + B_PREV]
				)
					stack.push(c);
		}
		return [rest, text, first, leaves];
	}

	/** A row of a table: each cell is on the row's one line; its alignments those of the header row, or aligns. */
	addTableRow(table, cells, type, aligns = null) {
		const t = this.nodes;
		const row = t.addBlock(type, this.lineStart, 0, 0);
		t.append(table, row);
		// a body row's cells as many as the header row's, aligned alike
		let head =
			aligns === null
				? t.i32[(t.i32[(table << 3) + F_FIRST] << 3) + F_FIRST]
				: -1;
		for (let i = 0; aligns === null ? head !== -1 : i < aligns.length; i++) {
			const cell = t.addBlock(TABLE_CELL, this.lineStart, 0, 0);
			t.append(row, cell);
			if (aligns === null) {
				t.b32[(cell << 3) + B_A] = t.b32[(head << 3) + B_A];
				head = t.i32[(head << 3) + F_NEXT];
			} else t.b32[(cell << 3) + B_A] = aligns[i];
			const start = 2 * i < cells.length ? cells[2 * i] : this.lineStart;
			const stop = 2 * i < cells.length ? cells[2 * i + 1] : this.lineStart;
			t.i32[(cell << 3) + F_AT] = this.spans.push(start, stop, 0);
			t.i32[(cell << 3) + F_COUNT] = 1;
		}
	}

	findNextNonspace() {
		const line = this.currentLine;
		let i = this.offset;
		let cols = this.column;
		for (; i < line.length; i++) {
			if (line[i] === " ") cols++;
			else if (line[i] === "\t") cols += 4 - (cols % 4);
			else break;
		}
		const c = line[i];
		this.blank = c === undefined || c === "\n" || c === "\r";
		this.nextNonspace = i;
		this.nextNonspaceColumn = cols;
		this.indent = this.nextNonspaceColumn - this.column;
		this.indented = this.indent >= CODE_INDENT;
	}

	advanceNextNonspace() {
		this.offset = this.nextNonspace;
		this.column = this.nextNonspaceColumn;
		this.partiallyConsumedTab = false;
	}

	advanceOffset(count, columns = false) {
		const line = this.currentLine;
		while (count > 0 && this.offset < line.length) {
			if (line[this.offset] === "\t") {
				const charsToTab = 4 - (this.column % 4);
				if (columns) {
					this.partiallyConsumedTab = charsToTab > count;
					const charsToAdvance = Math.min(charsToTab, count);
					this.column += charsToAdvance;
					this.offset += this.partiallyConsumedTab ? 0 : 1;
					count -= charsToAdvance;
				} else {
					this.partiallyConsumedTab = false;
					this.column += charsToTab;
					this.offset += 1;
					count -= 1;
				}
			} else {
				this.partiallyConsumedTab = false;
				this.offset += 1;
				this.column += 1;
				count -= 1;
			}
		}
	}

	/** Add the rest of the line to the open leaf's ranges in the store, the spaces of a tab begun as its pad. */
	addLine() {
		const t = this.nodes;
		const tip = this.tip;
		const pad = this.partiallyConsumedTab ? 4 - (this.column % 4) : 0;
		const i = this.spans.push(
			this.lineStart + this.offset + (pad > 0 ? 1 : 0),
			this.lineStart + this.currentLine.length,
			pad,
		);
		if (t.i32[(tip << 3) + F_COUNT] === 0) t.i32[(tip << 3) + F_AT] = i;
		t.i32[(tip << 3) + F_COUNT]++;
	}

	/** The text of range i of the store, read from the head being advanced. */
	textOf(i) {
		const u32 = this.spans.i32;
		return this.head.slice(
			u32[3 * i] - this.headAt,
			u32[3 * i + 1] - this.headAt,
		);
	}

	/** The character at p of the text, read from the head being advanced. */
	charAt(p) {
		return this.head[p - this.headAt];
	}

	/** The text of node's ranges joined by line endings, NUL read as U+FFFD as the lines were. */
	joined(node) {
		const t = this.nodes;
		const at = t.i32[(node << 3) + F_AT];
		let s = this.textOf(at);
		for (let i = 1; i < t.i32[(node << 3) + F_COUNT]; i++)
			s += `\n${this.textOf(at + i)}`;
		return s.includes("\0") ? s.replace(/\0/g, "�") : s;
	}

	addChild(type, offset) {
		const t = this.nodes;
		while (!canContain(t.i32[this.tip << 3] & 0xff, type))
			this.finalize(this.tip, this.lineNumber - 1);
		const node = t.addBlock(type, this.lineStart + offset, 1, this.lineNumber);
		t.append(this.tip, node);
		this.tip = node;
		return node;
	}

	closeUnmatchedBlocks() {
		if (this.allClosed) return;
		const t = this.nodes;
		while (this.oldtip !== this.lastMatchedContainer) {
			const parent = t.i32[(this.oldtip << 3) + F_PARENT];
			this.finalize(this.oldtip, this.lineNumber - 1);
			this.oldtip = parent;
		}
		this.allClosed = true;
	}

	finalize(block, lineNumber) {
		const t = this.nodes;
		const above = t.i32[(block << 3) + F_PARENT];
		t.i32[block << 3] &= ~OPEN;
		t.b32[(block << 3) + B_END_LINE] = lineNumber;
		finalizeBlock(this, block);
		this.tip = above;
	}

	incorporateLine(line) {
		const t = this.nodes;
		let container = ROOT;
		this.oldtip = this.tip;
		this.offset = 0;
		this.column = 0;
		this.blank = false;
		this.partiallyConsumedTab = false;
		this.lineNumber += 1;
		this.currentLine = line.includes("\0") ? line.replace(/\0/g, "�") : line;

		let last = t.i32[(container << 3) + F_LAST];
		while (last !== -1 && t.i32[last << 3] >> 8 === 1) {
			container = last;
			this.findNextNonspace();
			const r = continueBlock(this, container);
			if (r === 2) return;
			if (r === 1) {
				container = t.i32[(container << 3) + F_PARENT];
				break;
			}
			last = t.i32[(container << 3) + F_LAST];
		}

		this.allClosed = container === this.oldtip;
		this.lastMatchedContainer = container;

		const containerType = t.i32[container << 3] & 0xff;
		let matchedLeaf =
			containerType !== PARAGRAPH &&
			containerType !== TABLE &&
			acceptsLines(containerType);

		while (!matchedLeaf) {
			this.findNextNonspace();
			const r = this.indented
				? startIndentedCode(this)
				: startBlock(this, container);
			if (r === 0) {
				this.advanceNextNonspace();
				break;
			}
			container = this.tip;
			if (r === 2) matchedLeaf = true;
		}

		if (
			!this.allClosed &&
			!this.blank &&
			(t.i32[this.tip << 3] & 0xff) === PARAGRAPH
		) {
			// a lazy continuation line
			this.addLine();
			return;
		}
		this.closeUnmatchedBlocks();
		const type = t.i32[container << 3] & 0xff;
		if (type === TABLE) {
			if (t.b32[(container << 3) + B_A] === 1)
				t.b32[(container << 3) + B_A] = 0;
			else
				this.addTableRow(
					container,
					cellRanges(this.currentLine, this.offset, this.lineStart),
					TABLE_ROW,
				);
		} else if (acceptsLines(type)) {
			this.addLine();
			if (
				type === HTML_BLOCK &&
				t.b32[(container << 3) + B_A] <= 5 &&
				htmlBlockEnds(this, t.b32[(container << 3) + B_A])
			)
				this.finalize(container, this.lineNumber);
		} else if (this.offset < this.currentLine.length && !this.blank) {
			this.addChild(PARAGRAPH, this.offset);
			this.advanceNextNonspace();
			this.addLine();
		}
	}
}
