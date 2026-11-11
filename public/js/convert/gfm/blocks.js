// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The block structure of GFM 0.29-gfm (LCTYSP-0017): lines are read one at a time, as the spec's "A parsing strategy"
// describes. Each line first continues the open blocks it can, then may start new ones, and what is left of it is added
// to the deepest open block that takes lines. Leaf blocks keep their text (string_content); the inline parser reads it
// once every block is closed.

import { CLOSETAG, Node, OPENTAG, unescapeString } from "./common.js";
import { parseReference } from "./inlines.js";

const CODE_INDENT = 4;

const reNonSpace = /[^ \t\f\v\r\n]/;
const reMaybeSpecial = /^[#`~*+_=<>0-9|:-]/;
const reBulletListMarker = /^[*+-]/;
const reOrderedListMarker = /^(\d{1,9})([.)])/;
const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;
const reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;
const reThematicBreak =
	/^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const reLineEnding = /\r\n|\n|\r/;
const reTableDelimiterCell = /^:?-+:?$/;
const reTaskMarker = /^\[([ \txX])\](?=[ \t]|$)/;

const reHtmlBlockOpen = [
	null,
	/^<(?:script|pre|style)(?:\s|>|$)/i,
	/^<!--/,
	/^<[?]/,
	/^<![A-Z]/,
	/^<!\[CDATA\[/,
	/^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
	new RegExp(`^(?:${OPENTAG}|${CLOSETAG})\\s*$`, "i"),
];
const reHtmlBlockClose = [
	null,
	/<\/(?:script|pre|style)>/i,
	/-->/,
	/\?>/,
	/>/,
	/\]\]>/,
];

/** How deep block quotes and list items may nest (LCTYSP-0017, limits): one more is not opened. */
export const MAX_NESTING = 32;

/** The number of block quotes and list items that block is in, itself included. */
function nesting(block) {
	let n = 0;
	for (let b = block; b !== null; b = b.parent)
		if (b.type === "block_quote" || b.type === "item") n++;
	return n;
}

const isSpaceOrTab = (c) => c === " " || c === "\t";
const isBlank = (s) => !reNonSpace.test(s);

/** Whether a blank line separates block from the block after it. */
function endsWithBlankLine(block) {
	const next = block.next;
	return next !== null && block.endLine !== next.startLine - 1;
}

/** Take the link reference definitions at the start of a paragraph's text into the parser's map; whether any were. */
function takeReferences(parser, block) {
	let taken = false;
	while (block.string_content[0] === "[") {
		const pos = parseReference(
			block.string_content,
			parser.refmap,
			parser.decodeName,
		);
		if (pos === 0) break;
		block.string_content = block.string_content.slice(pos);
		taken = true;
	}
	return taken;
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

function parseListMarker(parser, container) {
	const ln = parser.currentLine;
	const rest = ln.slice(parser.nextNonspace);
	const data = {
		type: null,
		tight: true,
		bulletChar: null,
		start: null,
		delimiter: null,
		padding: null,
		markerOffset: parser.indent,
	};
	if (parser.indent >= 4) return null;
	let match = rest.match(reBulletListMarker);
	if (match) {
		data.type = "bullet";
		data.bulletChar = match[0][0];
	} else {
		match = rest.match(reOrderedListMarker);
		if (
			!match ||
			(container.type === "paragraph" && Number.parseInt(match[1], 10) !== 1)
		)
			return null;
		data.type = "ordered";
		data.start = Number.parseInt(match[1], 10);
		data.delimiter = match[2];
	}
	let nextc = ln[parser.nextNonspace + match[0].length];
	if (!(nextc === undefined || nextc === "\t" || nextc === " ")) return null;
	if (
		container.type === "paragraph" &&
		isBlank(ln.slice(parser.nextNonspace + match[0].length))
	)
		return null;
	parser.advanceNextNonspace();
	parser.advanceOffset(match[0].length, true);
	const spacesStartCol = parser.column;
	const spacesStartOffset = parser.offset;
	do {
		parser.advanceOffset(1, true);
		nextc = ln[parser.offset];
	} while (parser.column - spacesStartCol < 5 && isSpaceOrTab(nextc));
	const blankItem = nextc === undefined;
	const spacesAfterMarker = parser.column - spacesStartCol;
	if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
		data.padding = match[0].length + 1;
		parser.column = spacesStartCol;
		parser.offset = spacesStartOffset;
		if (isSpaceOrTab(ln[parser.offset])) parser.advanceOffset(1, true);
	} else {
		data.padding = match[0].length + spacesAfterMarker;
	}
	return data;
}

const listsMatch = (a, b) =>
	a.type === b.type &&
	a.delimiter === b.delimiter &&
	a.bulletChar === b.bulletChar;

// What each type of block does: continue(parser, block) gives 0 (the line continues it), 1 (it does not) or 2 (the
// line is used up); finalize(parser, block) runs when it is closed.
const BLOCKS = {
	document: {
		continue: () => 0,
		finalize: () => {},
		canContain: (t) => t !== "item",
		acceptsLines: false,
	},
	list: {
		continue: () => 0,
		finalize(_parser, block) {
			block.endLine = block.lastChild?.endLine ?? block.startLine;
			let tight = true;
			for (const item of block.children) {
				if (endsWithBlankLine(item)) tight = false;
				for (const sub of item.children)
					if (endsWithBlankLine(sub)) tight = false;
				if (!tight) break;
			}
			block.listData.tight = tight;
		},
		canContain: (t) => t === "item",
		acceptsLines: false,
	},
	block_quote: {
		continue(parser) {
			const ln = parser.currentLine;
			if (parser.indented || ln[parser.nextNonspace] !== ">") return 1;
			parser.advanceNextNonspace();
			parser.advanceOffset(1, false);
			if (isSpaceOrTab(ln[parser.offset])) parser.advanceOffset(1, true);
			return 0;
		},
		finalize: () => {},
		canContain: (t) => t !== "item",
		acceptsLines: false,
	},
	item: {
		continue(parser, container) {
			if (parser.blank) {
				if (container.firstChild === null) return 1;
				parser.advanceNextNonspace();
			} else if (
				parser.indent >=
				container.listData.markerOffset + container.listData.padding
			) {
				parser.advanceOffset(
					container.listData.markerOffset + container.listData.padding,
					true,
				);
			} else {
				return 1;
			}
			return 0;
		},
		finalize(_parser, block) {
			block.endLine = block.lastChild?.endLine ?? block.startLine;
		},
		canContain: (t) => t !== "item",
		acceptsLines: false,
	},
	heading: {
		continue: () => 1,
		finalize: () => {},
		canContain: () => false,
		acceptsLines: false,
	},
	thematic_break: {
		continue: () => 1,
		finalize: () => {},
		canContain: () => false,
		acceptsLines: false,
	},
	code_block: {
		continue(parser, container) {
			const ln = parser.currentLine;
			const indent = parser.indent;
			if (container.isFenced) {
				const match =
					indent <= 3 &&
					ln[parser.nextNonspace] === container.fenceChar &&
					ln.slice(parser.nextNonspace).match(reClosingCodeFence);
				if (match && match[0].length >= container.fenceLength) {
					parser.finalize(container, parser.lineNumber);
					return 2;
				}
				let i = container.fenceOffset;
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
		},
		finalize(parser, block) {
			if (block.isFenced) {
				const content = block.string_content;
				const nl = content.indexOf("\n");
				block.info = unescapeString(
					content.slice(0, nl).trim(),
					parser.decodeName,
				);
				block.literal = content.slice(nl + 1);
			} else {
				const lines = block.string_content.split("\n");
				while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1]))
					lines.pop();
				block.literal = `${lines.join("\n")}\n`;
				if (block.endLine > block.startLine) {
					const trailing =
						block.string_content.split("\n").length - 1 - lines.length;
					block.endLine -= trailing;
				}
			}
			block.string_content = null;
		},
		canContain: () => false,
		acceptsLines: true,
	},
	html_block: {
		continue: (parser, container) =>
			parser.blank &&
			(container.htmlBlockType === 6 || container.htmlBlockType === 7)
				? 1
				: 0,
		finalize(_parser, block) {
			block.literal = block.string_content.replace(/(\n *)+$/, "");
			block.string_content = null;
		},
		canContain: () => false,
		acceptsLines: true,
	},
	paragraph: {
		continue: (parser) => (parser.blank ? 1 : 0),
		finalize(parser, block) {
			const hasReferenceDefs = takeReferences(parser, block);
			if (hasReferenceDefs && isBlank(block.string_content)) {
				block.unlink();
				return;
			}
			const item = block.parent;
			if (item?.type === "item" && item.firstChild === block) {
				const m = block.string_content.match(reTaskMarker);
				if (m) {
					item.task = m[1] === " " || m[1] === "\t" ? "unchecked" : "checked";
					block.string_content = block.string_content.slice(m[0].length);
				}
			}
		},
		canContain: () => false,
		acceptsLines: true,
	},
	table: {
		continue: (parser) => (parser.blank ? 1 : 0),
		finalize: () => {},
		canContain: () => false,
		acceptsLines: true,
	},
};

// The block starts, in the order they are tried: 0 (no start), 1 (a container started), 2 (a leaf started).
const STARTS = [
	// block quote
	(parser, container) => {
		if (parser.indented || parser.currentLine[parser.nextNonspace] !== ">")
			return 0;
		if (nesting(container) >= MAX_NESTING) return 0;
		parser.advanceNextNonspace();
		parser.advanceOffset(1, false);
		if (isSpaceOrTab(parser.currentLine[parser.offset]))
			parser.advanceOffset(1, true);
		parser.closeUnmatchedBlocks();
		parser.addChild("block_quote", parser.nextNonspace);
		return 1;
	},
	// ATX heading
	(parser) => {
		if (parser.indented) return 0;
		const match = parser.currentLine
			.slice(parser.nextNonspace)
			.match(reATXHeadingMarker);
		if (!match) return 0;
		parser.advanceNextNonspace();
		parser.advanceOffset(match[0].length, false);
		parser.closeUnmatchedBlocks();
		const heading = parser.addChild("heading", parser.nextNonspace);
		heading.level = match[0].trim().length;
		heading.string_content = parser.currentLine
			.slice(parser.offset)
			.replace(/^[ \t]*#+[ \t]*$/, "")
			.replace(/[ \t]+#+[ \t]*$/, "");
		parser.advanceOffset(parser.currentLine.length - parser.offset);
		return 2;
	},
	// fenced code block
	(parser) => {
		if (parser.indented) return 0;
		const match = parser.currentLine
			.slice(parser.nextNonspace)
			.match(reCodeFence);
		if (!match) return 0;
		const fenceLength = match[0].length;
		parser.closeUnmatchedBlocks();
		const block = parser.addChild("code_block", parser.nextNonspace);
		block.isFenced = true;
		block.fenceLength = fenceLength;
		block.fenceChar = match[0][0];
		block.fenceOffset = parser.indent;
		parser.advanceNextNonspace();
		parser.advanceOffset(fenceLength, false);
		return 2;
	},
	// HTML block
	(parser, container) => {
		if (parser.indented || parser.currentLine[parser.nextNonspace] !== "<")
			return 0;
		const s = parser.currentLine.slice(parser.nextNonspace);
		for (let t = 1; t <= 7; t++) {
			if (
				reHtmlBlockOpen[t].test(s) &&
				(t < 7 ||
					(container.type !== "paragraph" &&
						!(
							!parser.allClosed &&
							!parser.blank &&
							parser.tip.type === "paragraph"
						)))
			) {
				parser.closeUnmatchedBlocks();
				const block = parser.addChild("html_block", parser.offset);
				block.htmlBlockType = t;
				return 2;
			}
		}
		return 0;
	},
	// setext heading
	(parser, container) => {
		if (parser.indented || container.type !== "paragraph") return 0;
		const match = parser.currentLine
			.slice(parser.nextNonspace)
			.match(reSetextHeadingLine);
		if (!match) return 0;
		parser.closeUnmatchedBlocks();
		takeReferences(parser, container);
		if (container.string_content.length === 0) return 0;
		const heading = new Node("heading", {
			level: match[0][0] === "=" ? 1 : 2,
			string_content: container.string_content,
			open: true,
			startLine: container.startLine,
		});
		container.insertAfter(heading);
		container.unlink();
		parser.tip = heading;
		parser.advanceOffset(parser.currentLine.length - parser.offset, false);
		return 2;
	},
	// table: the paragraph's last line is the header row, this line the delimiter row
	(parser, container) => {
		if (parser.indented || container.type !== "paragraph") return 0;
		const aligns = delimiterRow(parser.currentLine.slice(parser.nextNonspace));
		if (!aligns) return 0;
		const lines = container.string_content.replace(/\n$/, "").split("\n");
		const header = tableCells(lines[lines.length - 1]);
		if (header.length !== aligns.length) return 0;
		parser.closeUnmatchedBlocks();
		const table = new Node("table", {
			aligns,
			header,
			rows: [],
			open: true,
			startLine: parser.lineNumber - 1,
			skipLine: true,
		});
		if (lines.length > 1) {
			container.string_content = `${lines.slice(0, -1).join("\n")}\n`;
			container.insertAfter(table);
			parser.finalize(container, parser.lineNumber - 2);
		} else {
			container.insertAfter(table);
			container.unlink();
		}
		parser.tip = table;
		parser.advanceOffset(parser.currentLine.length - parser.offset, false);
		return 2;
	},
	// thematic break
	(parser) => {
		if (
			parser.indented ||
			!reThematicBreak.test(parser.currentLine.slice(parser.nextNonspace))
		)
			return 0;
		parser.closeUnmatchedBlocks();
		parser.addChild("thematic_break", parser.nextNonspace);
		parser.advanceOffset(parser.currentLine.length - parser.offset, false);
		return 2;
	},
	// list item
	(parser, container) => {
		if (parser.indented && container.type !== "list") return 0;
		if (nesting(container) >= MAX_NESTING) return 0;
		const data = parseListMarker(parser, container);
		if (!data) return 0;
		parser.closeUnmatchedBlocks();
		if (parser.tip.type !== "list" || !listsMatch(container.listData, data)) {
			const list = parser.addChild("list", parser.nextNonspace);
			list.listData = data;
		}
		const item = parser.addChild("item", parser.nextNonspace);
		item.listData = data;
		return 1;
	},
	// indented code block
	(parser) => {
		if (!parser.indented || parser.tip.type === "paragraph" || parser.blank)
			return 0;
		parser.advanceOffset(CODE_INDENT, true);
		parser.closeUnmatchedBlocks();
		parser.addChild("code_block", parser.offset);
		return 2;
	},
];

export class BlockParser {
	/** decodeName(name) is the text of the named character reference &name;, or null (LCTYSP-0017). */
	constructor(decodeName) {
		this.decodeName = decodeName;
		this.doc = new Node("document", { open: true, startLine: 1 });
		this.tip = this.doc;
		this.oldtip = this.doc;
		this.refmap = new Map();
		this.lineNumber = 0;
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
	}

	/** Every line of text, then the end: the document, its blocks closed and their text kept. */
	parse(text) {
		const lines = text.split(reLineEnding);
		let len = lines.length;
		if (/[\r\n]$/.test(text)) len -= 1;
		for (let i = 0; i < len; i++) this.incorporateLine(lines[i]);
		while (this.tip) this.finalize(this.tip, len);
		return this.doc;
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

	addLine() {
		if (this.partiallyConsumedTab) {
			this.offset += 1;
			const charsToTab = 4 - (this.column % 4);
			this.tip.string_content += " ".repeat(charsToTab);
		}
		this.tip.string_content += `${this.currentLine.slice(this.offset)}\n`;
	}

	addChild(type, _offset) {
		while (!BLOCKS[this.tip.type].canContain(type))
			this.finalize(this.tip, this.lineNumber - 1);
		const block = new Node(type, {
			open: true,
			startLine: this.lineNumber,
			string_content: "",
		});
		this.tip.append(block);
		this.tip = block;
		return block;
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
		BLOCKS[block.type].finalize(this, block);
		this.tip = above;
	}

	incorporateLine(line) {
		let container = this.doc;
		this.oldtip = this.tip;
		this.offset = 0;
		this.column = 0;
		this.blank = false;
		this.partiallyConsumedTab = false;
		this.lineNumber += 1;
		this.currentLine = line.includes("\0") ? line.replace(/\0/g, "�") : line;

		let last = container.lastChild;
		while (last?.open) {
			container = last;
			this.findNextNonspace();
			const r = BLOCKS[container.type].continue(this, container);
			if (r === 2) return;
			if (r === 1) {
				container = container.parent;
				break;
			}
			last = container.lastChild;
		}

		this.allClosed = container === this.oldtip;
		this.lastMatchedContainer = container;

		let matchedLeaf =
			container.type !== "paragraph" &&
			container.type !== "table" &&
			BLOCKS[container.type].acceptsLines;

		while (!matchedLeaf) {
			this.findNextNonspace();
			if (
				!this.indented &&
				!reMaybeSpecial.test(this.currentLine.slice(this.nextNonspace))
			) {
				this.advanceNextNonspace();
				break;
			}
			let i = 0;
			for (; i < STARTS.length; i++) {
				const r = STARTS[i](this, container);
				if (r === 1) {
					container = this.tip;
					break;
				}
				if (r === 2) {
					container = this.tip;
					matchedLeaf = true;
					break;
				}
			}
			if (i === STARTS.length) {
				this.advanceNextNonspace();
				break;
			}
		}

		if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
			// a lazy continuation line
			this.addLine();
			return;
		}
		this.closeUnmatchedBlocks();
		const type = container.type;
		if (type === "table") {
			if (container.skipLine) container.skipLine = false;
			else container.rows.push(tableCells(this.currentLine.slice(this.offset)));
		} else if (BLOCKS[type].acceptsLines) {
			this.addLine();
			if (
				type === "html_block" &&
				container.htmlBlockType >= 1 &&
				container.htmlBlockType <= 5 &&
				reHtmlBlockClose[container.htmlBlockType].test(
					this.currentLine.slice(this.offset),
				)
			)
				this.finalize(container, this.lineNumber);
		} else if (this.offset < this.currentLine.length && !this.blank) {
			this.addChild("paragraph", this.offset);
			this.advanceNextNonspace();
			this.addLine();
		}
	}
}
