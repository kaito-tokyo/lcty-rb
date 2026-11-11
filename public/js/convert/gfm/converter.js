// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Runs the GFM parts: a text, whole or streamed, block by block, then the inlines (converter.d.ts).

import { HtmlSink, writeCommitted } from "./committed.js";
import { BlockParser, isSpaceOrTab, isThematicBreak } from "./gfm_blocks.js";
import { InlineParser } from "./gfm_inlines.js";

/** The first phase of text, each top-level block advanced in turn to the end. */
export function parseBlocks(text, decodeName) {
	const parser = new BlockParser(decodeName);
	const leaves = [];
	let head = text;
	for (;;) {
		const step = parser.advance(head, true, text.length - head.length);
		if (step[1] === undefined) break;
		head = step[0];
		for (const leaf of step[3]) leaves.push(leaf);
	}
	return {
		nodes: parser.nodes,
		spans: parser.spans,
		refmap: parser.refmap,
		leaves,
	};
}

/** The document tree of text, in both phases. */
export function parseGfm(text, decodeName, options = {}) {
	const { nodes, spans, refmap, leaves } = parseBlocks(text, decodeName);
	const parser = new InlineParser(decodeName, refmap, options);
	for (const leaf of leaves) parser.parseLeaf(text, nodes, spans, leaf);
	// the whole text read, the tables need no room for more
	nodes.compact();
	spans.compact();
	return { nodes, spans };
}

/** The whole of text as LCTYSP-0017's output, an HTML string. */
export function gfmHtml(text, decodeName, { selectAll, ...options } = {}) {
	const { nodes, spans } = parseGfm(text, decodeName, options);
	const sink = new HtmlSink();
	writeCommitted({ source: text, nodes, spans, selectAll }, 0, sink);
	return sink.html;
}

// What BlockWatch takes the first block of a head to be, from its first line
const W_PARAGRAPH = 0; // a paragraph, a table, a setext heading, or anything else
const W_FENCE = 1;
const W_HTML = 2;
const W_QUOTE = 3;
const W_LIST = 4;
const W_INDENTED = 5;

/** The characters a block other than a paragraph may start with. */
const START_CHARS = "#`~>*+-=_<|0123456789";

/** The weak half of reading a stream: whether advance is worth a try (converter.d.ts). */
export class BlockWatch {
	constructor() {
		this.reset();
	}

	/** Look at a new head. */
	reset() {
		// where the next line to read starts, and whether the first line of the block is read
		this.pos = 0;
		this.seen = false;
		this.kind = W_PARAGRAPH;
		// a fence's character and length; a list's marker and the column of its content
		this.char = "";
		this.length = 0;
		this.content = 0;
	}

	/** Whether a line of head not read yet may end its first block. */
	mayEnd(head) {
		for (;;) {
			let end = head.indexOf("\n", this.pos);
			const cr = head.indexOf("\r", this.pos);
			if (cr !== -1 && (end === -1 || cr < end)) {
				if (cr === head.length - 1) return false; // maybe half of \r\n
				end = cr;
			}
			if (end === -1) return false;
			const start = this.pos;
			this.pos = end + (head[end] === "\r" && head[end + 1] === "\n" ? 2 : 1);
			if (this.mayEndAt(head, start, end)) return true;
		}
	}

	/** Whether the line of head from start to end may end the first block. */
	mayEndAt(head, start, end) {
		let j = start;
		let indent = 0;
		for (; j < end; j++) {
			const c = head[j];
			if (c === " ") indent++;
			else if (c === "\t") indent += 4 - (indent % 4);
			else break;
		}
		const blank = j === end;
		const c = head[j];
		if (!this.seen) {
			if (blank) return false; // the blank lines before a block are no part of it
			this.seen = true;
			this.classify(head, j, end, indent, c);
			return true;
		}
		const starts = indent < 4 && !blank && START_CHARS.includes(c);
		switch (this.kind) {
			case W_FENCE: {
				if (indent >= 4 || c !== this.char) return false;
				let k = j;
				while (head[k] === c) k++;
				return k - j >= this.length;
			}
			case W_HTML:
				return blank || starts || hasCharIn(head, ">", j, end);
			case W_QUOTE:
				return blank || indent >= 4 || c !== ">";
			case W_LIST:
				if (blank || indent >= this.content) return false;
				return !this.isItem(head, j, end, c);
			case W_INDENTED:
				return !blank && indent < 4;
			default:
				return blank || starts;
		}
	}

	/** Take the first block to be of the kind its first line, at j after indent columns, begins. */
	classify(head, j, end, indent, c) {
		if (indent >= 4) {
			this.kind = W_INDENTED;
			return;
		}
		if (c === "`" || c === "~") {
			let k = j;
			while (head[k] === c) k++;
			if (k - j >= 3) {
				this.kind = W_FENCE;
				this.char = c;
				this.length = k - j;
			}
			return;
		}
		if (c === ">") this.kind = W_QUOTE;
		else if (c === "<") this.kind = W_HTML;
		else {
			const marker = markerLength(head, j, end, c);
			if (marker > 0) {
				let k = j + marker;
				while (k < end && k - j - marker < 5 && isSpaceOrTab(head[k])) k++;
				const spaces = k - j - marker;
				this.kind = W_LIST;
				this.char = c >= "0" && c <= "9" ? head[j + marker - 1] : c;
				this.content =
					indent +
					marker +
					(spaces >= 1 && spaces <= 4 && k < end ? spaces : 1);
			}
		}
	}

	/** Whether the line at j is an item of the first block's list. */
	isItem(head, j, end, c) {
		const marker = markerLength(head, j, end, c);
		if (marker === 0) return false;
		const same = c >= "0" && c <= "9" ? head[j + marker - 1] : c;
		if (same !== this.char) return false;
		return !(
			(c === "-" || c === "*") &&
			isThematicBreak(head.slice(j, end), 0, c)
		);
	}
}

/** Whether c is in head from i to end (a loop, so a line without it is read only to its end). */
function hasCharIn(head, c, i, end) {
	for (; i < end; i++) if (head[i] === c) return true;
	return false;
}

/** The length of the list marker at j of head, or 0. */
function markerLength(head, j, end, c) {
	let k = j;
	if (c === "*" || c === "+" || c === "-") k++;
	else {
		while (k - j < 9 && head[k] >= "0" && head[k] <= "9") k++;
		if (k === j || (head[k] !== "." && head[k] !== ")")) return 0;
		k++;
	}
	return k === end || isSpaceOrTab(head[k]) ? k - j : 0;
}
