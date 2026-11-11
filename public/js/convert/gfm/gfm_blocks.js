// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The block structure of GFM 0.29-gfm (LCTYSP-0017): lines are read one at a time, as the spec's "A parsing strategy"
// describes. Each line first continues the open blocks it can, then may start new ones, and what is left of it is added
// to the deepest open block that takes lines. This is the spec's first phase: the link reference definitions are read
// into refmap, and a paragraph, a heading and a table cell keep in their view the text of their content. The parser's
// one operation is advance: it takes the first top-level block of a text once the text's lines end it, so a whole text
// and a streamed one are read alike, one block after another (converter.js).
//
// The module stands on GFM's block grammar alone. What it holds besides is what that grammar needs: the tree's nodes
// and their operations, backslash escapes and character references, link labels, destinations and titles (a link
// reference definition is a leaf block), and HTML tags (an HTML block of condition 7 begins with one).

/** The shared empty view and child list of the nodes that have none. Frozen, so nothing is added to it by mistake. */
export const NONE = Object.freeze([]);

/** Add child as the last child of parent. */
export function appendChild(parent, child) {
	if (parent.children === NONE) parent.children = [];
	child.parent = parent;
	parent.children.push(child);
	return child;
}

/**
 * Give node's children an array of exactly their number, once no more are added: an array grown by push holds room for
 * 17 children however few it has (a node has one to three, mostly).
 */
export function fitChildren(node) {
	if (node.children.length !== 0) node.children = node.children.slice();
}

/** The last child of node, or null. */
export function lastChild(node) {
	const c = node.children;
	return c.length > 0 ? c[c.length - 1] : null;
}

/** Put node where old is, taking old out. */
export function replaceNode(old, node) {
	const siblings = old.parent.children;
	siblings[indexIn(siblings, old)] = node;
	node.parent = old.parent;
	old.parent = null;
}

/** Put node right after ref. */
export function insertAfter(ref, node) {
	const siblings = ref.parent.children;
	const i = indexIn(siblings, ref);
	if (i === siblings.length - 1) siblings.push(node);
	else siblings.splice(i + 1, 0, node);
	node.parent = ref.parent;
}

/** Take node out of its parent. */
export function removeNode(node) {
	const siblings = node.parent.children;
	const i = indexIn(siblings, node);
	if (i === siblings.length - 1) siblings.pop();
	else siblings.splice(i, 1);
	node.parent = null;
}

/**
 * Where node is in siblings. The parser changes only the last or nearly the last child (the block it is in), so the
 * search starts from the end and costs nothing for a long document.
 */
function indexIn(siblings, node) {
	for (let i = siblings.length - 1; i >= 0; i--)
		if (siblings[i] === node) return i;
	return -1;
}

/**
 * Call f on each node of root's subtree, parents before their children (a loop, so any depth).
 * @param {Node} root
 * @param {(node: Node) => void} f
 */
export function eachNode(root, f) {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		f(node);
		const c = node.children;
		for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
	}
}

export const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";
const reBackslashOrAmp = /[\\&]/;
const reEntityOrEscape = new RegExp(
	`\\\\${ESCAPABLE}|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});`,
	"g",
);
/** The text of a numeric character reference: U+FFFD for 0, a surrogate or a code point past U+10FFFF. */
function numeric(code) {
	if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
		return "�";
	return String.fromCodePoint(code);
}

/**
 * The text of the character reference ref ("&amp;", "&#35;", "&#x22;"), or null when it is none.
 * decodeName(name) gives the text of a named one ("amp" → "&"), or null when HTML has no such name.
 */
export function decodeEntity(ref, decodeName) {
	if (ref[1] === "#") {
		const hex = ref[2] === "x" || ref[2] === "X";
		return numeric(Number.parseInt(ref.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
	}
	return decodeName(ref.slice(1, -1));
}

/** s with its backslash escapes and character references resolved. */
export function unescapeString(s, decodeName) {
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

/**
 * A link destination percent-encoded as GFM's reference writes it: %XX already there is kept. One of only the characters
 * kept as they are is itself; any other is written in pieces and joined, so the result is one flat string.
 */
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

// The grammar of a link reference definition's label, destination and title, read from p.subject at p.pos, which they
// move past what they read: p is any object with the two, the cursor of parseReference here. The patterns are sticky,
// their lastIndex set at each use.
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

/**
 * Read a link reference definition at the start of s into refmap; the number of characters it takes, or 0 when s does
 * not start with one.
 */
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

// The patterns that need no position. Those matched where the parser is in the line are the parser's own (BlockParser).
const reNonSpace = /[^ \t\f\v\r\n]/;
const reTableDelimiterCell = /^:?-+:?$/;
const reBlankLine = /^[ \t]*$/;

/** @import { Block, Node } from "./gfm_blocks.js" */

/**
 * A new block, of no view and no children: the fields of every node and then the block parser's (gfm_blocks.d.ts). Every field is
 * given here, so every block has one shape; open and startLine are the caller's, endLine is known only when it closes.
 * @returns {Block}
 */
function block(type, offset, data, open, startLine) {
	return {
		type,
		offset,
		view: NONE,
		parent: null,
		children: NONE,
		data,
		open,
		startLine,
		endLine: 0,
	};
}

/** How deep block quotes and list items may nest (LCTYSP-0017, limits): one more is not opened. */
export const MAX_NESTING = 32;

/** The number of block quotes and list items that block is in, itself included. */
function nesting(block) {
	let n = 0;
	for (let b = block; b !== null; b = b.parent)
		if (b.type === "block_quote" || b.type === "item") n++;
	return n;
}

export const isSpaceOrTab = (c) => c === " " || c === "\t";
const isBlank = (s) => !reNonSpace.test(s);

/** Whether line holds only spaces and tabs from i to its end: from 0, a blank line of GFM. */
export function spacesToEnd(line, i) {
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

/** Whether s from i to end holds only spaces, tabs and line endings: blank lines. */
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

/** Whether a blank line separates children[i] from the child after it. */
function blankAfter(children, i) {
	const next = children[i + 1];
	return next !== undefined && children[i].endLine !== next.startLine - 1;
}

/** The cells of a table row: between its unescaped pipes, trimmed, \| read as |. */
export function tableCells(line) {
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

/** The alignments of a delimiter row (null, "left", "center", "right"), or null when line is not one. */
function delimiterRow(line) {
	const s = line.trim();
	if (!s.includes("-")) return null;
	if (!s.includes("|") && !s.includes(":")) return null;
	const cells = tableCells(s);
	if (!cells.every((c) => reTableDelimiterCell.test(c))) return null;
	return cells.map((c) => {
		const l = c.startsWith(":");
		const r = c.endsWith(":");
		return l && r ? "center" : l ? "left" : r ? "right" : null;
	});
}

// What each type of block does, as a switch on its type: continueBlock, finalizeBlock, canContain and acceptsLines.

/** Whether the current line continues block: 0 (it does), 1 (it does not) or 2 (the line is used up). */
function continueBlock(parser, block) {
	switch (block.type) {
		case "document":
		case "list":
			return 0;
		case "block_quote": {
			const ln = parser.currentLine;
			if (parser.indented || ln[parser.nextNonspace] !== ">") return 1;
			parser.advanceNextNonspace();
			parser.advanceOffset(1, false);
			if (isSpaceOrTab(ln[parser.offset])) parser.advanceOffset(1, true);
			return 0;
		}
		case "item": {
			const width = block.data.markerOffset + block.data.padding;
			if (parser.blank) {
				if (block.children.length === 0) return 1;
				parser.advanceNextNonspace();
			} else if (parser.indent >= width) {
				parser.advanceOffset(width, true);
			} else {
				return 1;
			}
			return 0;
		}
		case "code_block":
			return continueCodeBlock(parser, block);
		case "html_block":
			return parser.blank &&
				(block.data.htmlType === 6 || block.data.htmlType === 7)
				? 1
				: 0;
		case "paragraph":
		case "table":
			return parser.blank ? 1 : 0;
		default:
			// heading, thematic_break: one line each
			return 1;
	}
}

function continueCodeBlock(parser, block) {
	const ln = parser.currentLine;
	const indent = parser.indent;
	const fence = block.data;
	if (fence.fenced) {
		// a closing fence: a run of the opening's character, as long at least, and then only spaces and tabs
		const at = parser.nextNonspace;
		const end = indent <= 3 ? runEnd(ln, at, fence.fenceChar) : at;
		if (
			end - at >= 3 &&
			end - at >= fence.fenceLength &&
			spacesToEnd(ln, end)
		) {
			parser.finalize(block, parser.lineNumber);
			return 2;
		}
		let i = fence.fenceOffset;
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
	switch (block.type) {
		case "list": {
			block.endLine = lastChild(block)?.endLine ?? block.startLine;
			const items = block.children;
			let tight = true;
			for (let i = 0; tight && i < items.length; i++) {
				if (blankAfter(items, i)) tight = false;
				const subs = items[i].children;
				for (let j = 0; tight && j < subs.length; j++)
					if (blankAfter(subs, j)) tight = false;
			}
			block.data.tight = tight;
			break;
		}
		case "item":
			block.endLine = lastChild(block)?.endLine ?? block.startLine;
			break;
		case "code_block": {
			const lines = block.view;
			if (block.data.fenced) {
				// the first line is the info string; the code is the lines after it
				block.data.info = unescapeString(lines[0].trim(), parser.decodeName);
				block.view = lines.slice(1);
			} else {
				let n = lines.length;
				while (n > 0 && reBlankLine.test(lines[n - 1])) n--;
				block.endLine -= lines.length - n;
				block.view = lines.slice(0, n);
			}
			break;
		}
		case "html_block": {
			const lines = block.view;
			let n = lines.length;
			while (n > 1 && /^ *$/.test(lines[n - 1])) n--;
			if (n < lines.length) block.view = lines.slice(0, n);
			break;
		}
		case "paragraph":
			finalizeParagraph(parser, block);
			break;
	}
}

function finalizeParagraph(parser, block) {
	let content = block.view.join("\n");
	const refs = takeReferences(parser, content);
	if (refs > 0) {
		content = content.slice(refs);
		if (isBlank(content)) {
			removeNode(block);
			return;
		}
	}
	const item = block.parent;
	if (item.type === "item" && item.children[0] === block) {
		// a task list item's box: [ ], [x] or [X], and then a space or a tab
		const x = content[1];
		if (
			content[0] === "[" &&
			content[2] === "]" &&
			isSpaceOrTab(content[3]) &&
			(isSpaceOrTab(x) || x === "x" || x === "X")
		) {
			item.data.task = isSpaceOrTab(x) ? "unchecked" : "checked";
			content = content.slice(3);
		}
	}
	block.view = [content];
}

/** Whether a block of type parent may hold a block of type child. */
function canContain(parent, child) {
	switch (parent) {
		case "document":
		case "block_quote":
		case "item":
			return child !== "item";
		case "list":
			return child === "item";
		default:
			return false;
	}
}

/** Whether the rest of a line is added to an open block of type: the leaves of lines. */
function acceptsLines(type) {
	return (
		type === "code_block" ||
		type === "html_block" ||
		type === "paragraph" ||
		type === "table"
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

/** Read the link reference definitions at the start of a paragraph's text into the parser's map; the characters taken. */
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

/** The lines of a paragraph's text, as its view holds them. */
const linesOf = (content) => content.replace(/\n$/, "").split("\n");

// The block starts of a line that is not indented, as a tree of few levels: a switch on the first character after the
// indentation, then what follows it, read a character at a time. Where one line may start several blocks (a "-" line
// may be a setext underline, a table's delimiter row, a thematic break or a list item), they are tried in the spec's
// order, and one the context refuses gives way to the next. Each gives 0 (no start), 1 (a container started) or 2 (a
// leaf started).

/** The block the current line starts where its indentation ends. */
function startBlock(parser, container) {
	const ln = parser.currentLine;
	const i = parser.nextNonspace;
	const c = ln[i];
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
			return container.type === "paragraph" && spacesToEnd(ln, runEnd(ln, i, c))
				? startSetextHeading(parser, container, 1)
				: 0;
		case "-":
			if (container.type === "paragraph") {
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
			return container.type === "paragraph" ? startTable(parser, container) : 0;
		default:
			return c >= "0" && c <= "9" ? startOrderedItem(parser, container) : 0;
	}
}

/** Whether line from i is a thematic break of c: three or more of it, and spaces and tabs only between. */
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
	if (nesting(container) >= MAX_NESTING) return 0;
	parser.advanceNextNonspace();
	parser.advanceOffset(1, false);
	if (isSpaceOrTab(parser.currentLine[parser.offset]))
		parser.advanceOffset(1, true);
	parser.closeUnmatchedBlocks();
	parser.addChild("block_quote", parser.nextNonspace, null);
	return 1;
}

/** An ATX heading: one to six #, then a space, a tab or the end of the line. */
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
	const heading = parser.addChild("heading", parser.nextNonspace, { level });
	heading.view = [withoutClosingSequence(ln.slice(parser.offset))];
	parser.advanceOffset(ln.length - parser.offset);
	return 2;
}

/** The text of an ATX heading without its closing sequence: # at the end, after a space or a tab, or alone. */
function withoutClosingSequence(s) {
	let end = s.length;
	while (end > 0 && isSpaceOrTab(s[end - 1])) end--;
	let hashes = end;
	while (hashes > 0 && s[hashes - 1] === "#") hashes--;
	if (hashes === end) return s;
	if (hashes === 0) return "";
	if (!isSpaceOrTab(s[hashes - 1])) return s;
	while (hashes > 0 && isSpaceOrTab(s[hashes - 1])) hashes--;
	return s.slice(0, hashes);
}

/** A fenced code block: three or more ` or ~, and for ` no ` after them. */
function startFencedCode(parser, c) {
	const ln = parser.currentLine;
	const i = parser.nextNonspace;
	const end = runEnd(ln, i, c);
	const length = end - i;
	if (length < 3 || (c === "`" && ln.indexOf("`", end) !== -1)) return 0;
	parser.closeUnmatchedBlocks();
	parser.addChild("code_block", i, {
		fenced: true,
		fenceChar: c,
		fenceLength: length,
		fenceOffset: parser.indent,
		info: "",
	});
	parser.advanceNextNonspace();
	parser.advanceOffset(length, false);
	return 2;
}

/** An HTML block, of the first of the seven start conditions the line meets. */
function startHtmlBlock(parser, container) {
	const m = parser.at(parser.reHtmlBlockStart, parser.nextNonspace);
	if (m === null) return 0;
	let t = 1;
	while (m[t] === undefined) t++;
	// reHtmlBlockStart ignores case, which 1, 6 and 7 want; 4 wants an uppercase letter, 5 CDATA as it is
	if (t === 4 && !(m[4][2] >= "A" && m[4][2] <= "Z")) return 0;
	if (t === 5 && m[5] !== "<![CDATA[") return 0;
	if (
		t === 7 &&
		(container.type === "paragraph" ||
			(!parser.allClosed && !parser.blank && parser.tip.type === "paragraph"))
	)
		return 0;
	parser.closeUnmatchedBlocks();
	parser.addChild("html_block", parser.offset, { htmlType: t });
	return 2;
}

/** A setext heading of level: the line is the underline of the paragraph container. */
function startSetextHeading(parser, container, level) {
	parser.closeUnmatchedBlocks();
	const content = container.view.join("\n");
	const rest = content.slice(takeReferences(parser, content));
	if (rest.length === 0) {
		container.view = [];
		return 0;
	}
	const heading = block(
		"heading",
		container.offset,
		{ level },
		true,
		container.startLine,
	);
	heading.view = linesOf(rest);
	replaceNode(container, heading);
	parser.tip = heading;
	parser.advanceOffset(parser.currentLine.length - parser.offset, false);
	return 2;
}

/** A table: the paragraph's last line is the header row, this line the delimiter row. */
function startTable(parser, container) {
	const aligns = delimiterRow(parser.currentLine.slice(parser.nextNonspace));
	if (!aligns) return 0;
	const lines = container.view;
	const header = tableCells(lines[lines.length - 1]);
	if (header.length !== aligns.length) return 0;
	parser.closeUnmatchedBlocks();
	// the header row is the paragraph's last line: where its text starts, when the paragraph keeps lines before it
	const table = block(
		"table",
		lines.length > 1 ? parser.lastLineAt : container.offset,
		{
			aligns,
			skipLine: true,
		},
		true,
		parser.lineNumber - 1,
	);
	if (lines.length > 1) {
		container.view = lines.slice(0, -1);
		insertAfter(container, table);
		parser.finalize(container, parser.lineNumber - 2);
	} else {
		replaceNode(container, table);
	}
	parser.addTableRow(table, header, "table_head");
	parser.tip = table;
	parser.advanceOffset(parser.currentLine.length - parser.offset, false);
	return 2;
}

function startThematicBreak(parser) {
	parser.closeUnmatchedBlocks();
	parser.addChild("thematic_break", parser.nextNonspace, null);
	parser.advanceOffset(parser.currentLine.length - parser.offset, false);
	return 2;
}

/** A bullet list item: *, + or -, then a space, a tab or the end of the line. */
function startBulletItem(parser, container, c) {
	const next = parser.currentLine[parser.nextNonspace + 1];
	if (next !== undefined && !isSpaceOrTab(next)) return 0;
	return startListItem(parser, container, 1, "bullet", c, 1, "");
}

/** An ordered list item: one to nine digits, . or ), then a space, a tab or the end of the line. */
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
	if (container.type === "paragraph" && start !== 1) return 0;
	return startListItem(
		parser,
		container,
		j + 1 - i,
		"ordered",
		"",
		start,
		delimiter,
	);
}

/** A list item whose marker is length characters, the parser moved past it and the spaces after it. */
function startListItem(
	parser,
	container,
	length,
	type,
	bulletChar,
	start,
	delimiter,
) {
	if (nesting(container) >= MAX_NESTING) return 0;
	const ln = parser.currentLine;
	// in a paragraph, a list item may not start empty
	if (
		container.type === "paragraph" &&
		blankToEnd(ln, parser.nextNonspace + length)
	)
		return 0;
	const marker = {
		type,
		bulletChar,
		start,
		delimiter,
		markerOffset: parser.indent,
		padding: 0,
	};
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
		marker.padding = length + 1;
		parser.column = spacesStartCol;
		parser.offset = spacesStartOffset;
		if (isSpaceOrTab(ln[parser.offset])) parser.advanceOffset(1, true);
	} else {
		marker.padding = length + spacesAfterMarker;
	}
	parser.closeUnmatchedBlocks();
	const list = parser.tip;
	if (
		list.type !== "list" ||
		list.data.type !== marker.type ||
		list.data.delimiter !== marker.delimiter ||
		list.data.bulletChar !== marker.bulletChar
	) {
		parser.addChild("list", parser.nextNonspace, {
			type: marker.type,
			bulletChar: marker.bulletChar,
			delimiter: marker.delimiter,
			start: marker.start,
			tight: true,
		});
	}
	parser.addChild("item", parser.nextNonspace, {
		markerOffset: marker.markerOffset,
		padding: marker.padding,
		task: null,
	});
	return 1;
}

/** An indented code block. */
function startIndentedCode(parser) {
	if (parser.tip.type === "paragraph" || parser.blank) return 0;
	parser.advanceOffset(CODE_INDENT, true);
	parser.closeUnmatchedBlocks();
	parser.addChild("code_block", parser.offset, {
		fenced: false,
		fenceChar: "",
		fenceLength: 0,
		fenceOffset: 0,
		info: "",
	});
	return 2;
}

export class BlockParser {
	/** decodeName(name) is the text of the named character reference &name;, or null (LCTYSP-0017). */
	constructor(decodeName) {
		this.decodeName = decodeName;
		// What lasts from one advance to the next: the link reference definitions, by normalized label ({ destination,
		// title }), and the document of the blocks advanced, one child each.
		this.refmap = new Map();
		this.doc = block("document", 0, null, true, 1);
		// the lines read past the last block taken, for an advance given carryRest: their base, where reading goes on,
		// and where the next block starts
		this.carryRest = null;
		this.carryBase = 0;
		this.carryPos = 0;
		this.carryStart = 0;
		this.ends = [];
		this.base = 0;
		// What one advance reads its lines into, emptied at each: a root of its own and the state of its lines.
		this.root = block("document", 0, null, true, 1);
		this.tip = this.doc;
		this.oldtip = this.doc;
		this.lineNumber = 0;
		this.lineStart = 0;
		// where the text addLine last added starts
		this.lastLineAt = 0;
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
		this.lastMatchedContainer = this.doc;

		// The three patterns matched where the parser is, the parser's own, so their lastIndex is set and changed freely
		// (at): an HTML block's start conditions, one group each, tried in order, the end of condition 1, and the line
		// endings advance cuts the lines at. Every other start and end of a block is read a character at a time.
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

	/** The match of re (one of the parser's sticky or global patterns) in the current line from position i, or null. */
	at(re, i) {
		re.lastIndex = i;
		return re.exec(this.currentLine);
	}

	/**
	 * Take the first top-level block of head, once head's lines end it; offset is where head starts in the whole text,
	 * which the nodes' offsets count from.
	 * - [rest, text, node, leaves] when they do: text is the block's, its last line ending included; rest is what
	 *   follows, where the next advance starts; node is the block, now the last child of doc (null for a paragraph of
	 *   link reference definitions only, which leaves only its definitions); leaves are its paragraphs, headings and
	 *   table cells, their view the text of their content.
	 * - ["", undefined] when head holds no block: nothing, or only blank lines.
	 * - undefined when the lines so far do not end it.
	 * A line counts once its line ending is there (a last \r may be half of \r\n), or, when end is true, head being the
	 * rest of the whole text, at the end of head too, where every block closes. The blank lines before a block are no
	 * part of it. A block ends when a later line closes it, or, a heading and a thematic break being one line each, with
	 * its line.
	 */
	advance(head, end = false, offset = 0) {
		// the lines after the last block taken, read already, when head is the rest that advance gave
		const carried = this.carryRest === head;
		this.carryRest = null;
		let blockStart;
		let first;
		let pos;
		if (carried) {
			this.base = this.carryBase;
			pos = this.carryPos;
			first = this.root.children[0] ?? null;
			blockStart = first === null ? -1 : this.carryStart;
			if (first !== null) {
				const taken = this.ended(head, blockStart, first, pos);
				if (taken !== null) return taken;
			}
		} else {
			this.restart();
			blockStart = -1;
			first = null;
			pos = 0;
		}
		const ends = this.ends;
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
			this.incorporateLine(line);
			ends.push(base + next);
			pos = next;
			// the first block, again when a setext heading or a table has taken its place
			if (first === null || (first.parent === null && first.open))
				first = this.root.children[0] ?? null;
			if (first === null) continue;
			const taken = this.ended(head, blockStart, first, pos);
			if (taken !== null) return taken;
		}
		if (blockStart === -1)
			return pos === head.length ? ["", undefined] : undefined;
		if (!end) return undefined;
		while (this.tip) this.finalize(this.tip, this.lineNumber);
		if (first === null || (first.parent === null && first.open))
			first = this.root.children[0] ?? null;
		return this.took(
			head,
			blockStart,
			this.lineEndAt(first.endLine),
			first,
			pos,
		);
	}

	/** Where line n of the parser's lines ends in the head, its line ending included. */
	lineEndAt(n) {
		return this.ends[n - 1] - this.base;
	}

	/** What advance gives when the lines read end first, or null when they do not yet. */
	ended(head, blockStart, first, pos) {
		if (!first.open)
			return this.took(
				head,
				blockStart,
				this.lineEndAt(first.endLine),
				first,
				pos,
			);
		if (first.type === "heading" || first.type === "thematic_break") {
			this.finalize(first, this.lineNumber);
			return this.took(head, blockStart, pos, first, pos);
		}
		return null;
	}

	/** An empty root and line state for the next advance (the root and the array of line ends used again). */
	restart() {
		const root = this.root;
		root.children = NONE;
		root.open = true;
		root.parent = null;
		this.tip = root;
		this.oldtip = root;
		this.lastMatchedContainer = root;
		this.lineNumber = 0;
		this.allClosed = true;
		// ends[k] - base is where line k + 1 of the parser's lines, its line ending included, ends in the head
		this.ends.length = 0;
		this.base = 0;
	}

	/**
	 * The result of advance for first, the block head held from start to end, the parser's lines read to pos. What it
	 * read past the block, the start of the next one, is kept for the next advance, if that is given the rest.
	 */
	took(head, start, end, first, pos) {
		const text = head.slice(start, end);
		const rest = head.slice(end);
		const root = this.root;
		if (root.children[0] === first) root.children.shift();
		const next = root.children[0];
		// where the next block starts in rest; it is kept only when it follows first with nothing between but blank
		// lines (a paragraph of definitions only between them has left the tree, and is read again as a block of its
		// own). Its lines keep their numbers, the ends their values: rest starts end further on, which base takes.
		const nextStart =
			next === undefined ? -1 : this.lineEndAt(next.startLine - 1) - end;
		if (nextStart >= 0 && blankBetween(rest, 0, nextStart)) {
			this.carryRest = rest;
			this.carryBase = this.base + end;
			this.carryPos = pos - end;
			this.carryStart = nextStart;
		}
		// a paragraph of link reference definitions only is taken out of the tree
		if (first.parent === null) return [rest, text, null, []];
		appendChild(this.doc, first);
		const type = first.type;
		if (type === "paragraph" || type === "heading")
			return [rest, text, first, [first]];
		// its leaves in the order of the text (a loop over its blocks, any depth)
		const leaves = [];
		const stack = [first];
		while (stack.length > 0) {
			const node = stack.pop();
			const t = node.type;
			if (t === "paragraph" || t === "heading" || t === "table_cell")
				leaves.push(node);
			else
				for (let i = node.children.length - 1; i >= 0; i--)
					stack.push(node.children[i]);
		}
		return [rest, text, first, leaves];
	}

	/** A row of a table: each cell is on the row's one line, its text kept as its content. */
	addTableRow(table, cells, type) {
		const row = appendChild(table, block(type, this.lineStart, null, false, 0));
		const aligns = table.data.aligns;
		for (let i = 0; i < aligns.length; i++) {
			const cell = appendChild(
				row,
				block("table_cell", this.lineStart, { align: aligns[i] }, false, 0),
			);
			cell.view = [cells[i] ?? ""];
		}
		fitChildren(row);
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

	/** Add the rest of the line to the open leaf's view. */
	addLine() {
		let rest = this.currentLine.slice(this.offset);
		if (this.partiallyConsumedTab) {
			const charsToTab = 4 - (this.column % 4);
			rest = " ".repeat(charsToTab) + this.currentLine.slice(this.offset + 1);
		}
		if (this.tip.view === NONE) this.tip.view = [];
		this.tip.view.push(rest);
		this.lastLineAt = this.lineStart + this.offset;
	}

	addChild(type, offset, data) {
		while (!canContain(this.tip.type, type))
			this.finalize(this.tip, this.lineNumber - 1);
		const node = block(
			type,
			this.lineStart + offset,
			data,
			true,
			this.lineNumber,
		);
		appendChild(this.tip, node);
		this.tip = node;
		return node;
	}

	closeUnmatchedBlocks() {
		if (this.allClosed) return;
		while (this.oldtip !== this.lastMatchedContainer) {
			const parent = this.oldtip.parent;
			this.finalize(this.oldtip, this.lineNumber - 1);
			this.oldtip = parent;
		}
		this.allClosed = true;
	}

	finalize(block, lineNumber) {
		const above = block.parent;
		block.open = false;
		block.endLine = lineNumber;
		finalizeBlock(this, block);
		fitChildren(block);
		this.tip = above;
	}

	incorporateLine(line) {
		let container = this.root;
		this.oldtip = this.tip;
		this.offset = 0;
		this.column = 0;
		this.blank = false;
		this.partiallyConsumedTab = false;
		this.lineNumber += 1;
		this.currentLine = line.includes("\0") ? line.replace(/\0/g, "�") : line;

		let last = lastChild(container);
		while (last?.open) {
			container = last;
			this.findNextNonspace();
			const r = continueBlock(this, container);
			if (r === 2) return;
			if (r === 1) {
				container = container.parent;
				break;
			}
			last = lastChild(container);
		}

		this.allClosed = container === this.oldtip;
		this.lastMatchedContainer = container;

		let matchedLeaf =
			container.type !== "paragraph" &&
			container.type !== "table" &&
			acceptsLines(container.type);

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

		if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
			// a lazy continuation line
			this.addLine();
			return;
		}
		this.closeUnmatchedBlocks();
		const type = container.type;
		if (type === "table") {
			if (container.data.skipLine) container.data.skipLine = false;
			else
				this.addTableRow(
					container,
					tableCells(this.currentLine.slice(this.offset)),
					"table_row",
				);
		} else if (acceptsLines(type)) {
			this.addLine();
			if (
				type === "html_block" &&
				container.data.htmlType <= 5 &&
				htmlBlockEnds(this, container.data.htmlType)
			)
				this.finalize(container, this.lineNumber);
		} else if (this.offset < this.currentLine.length && !this.blank) {
			this.addChild("paragraph", this.offset, null);
			this.advanceNextNonspace();
			this.addLine();
		}
	}
}
