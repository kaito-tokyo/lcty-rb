// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The inline phase of GFM 0.29-gfm: items, marks, then the tree at once (gfm_inlines.d.ts).

import {
	CLOSETAG,
	decodeEntity,
	ESCAPABLE,
	F_AT,
	F_COUNT,
	F_FIRST,
	F_LAST,
	F_NEXT,
	F_OFFSET,
	F_PARENT,
	leafText,
	normalizeLabel,
	normalizeURI,
	OPENTAG,
	SPAN,
	scanLinkDestination,
	scanLinkLabel,
	scanLinkTitle,
	skipSpnl,
} from "./gfm_blocks.js";

// The types of the inlines, as the codes of a row's type, after the blocks'
export const TEXT = 16;
export const CODE = 17;
export const HTML_INLINE = 18;
export const SOFTBREAK = 19;
export const LINEBREAK = 20;
export const EMPH = 21;
export const STRONG = 22;
export const DEL = 23;
export const LINK = 24;
export const IMAGE = 25;
/** The name of each type of inline, by its code less TEXT. */
export const INLINE_NAMES = Object.freeze([
	"text",
	"code",
	"html_inline",
	"softbreak",
	"linebreak",
	"emph",
	"strong",
	"del",
	"link",
	"image",
]);

/** Add [start, end) of the parsed text (src 0) or of spans.extra (src 1) to the text of row, the last row with spans. */
function addPiece(nodes, spans, row, src, start, end) {
	const n = nodes.i32;
	const R = row << 3;
	const s = spans.i32;
	const k = spans.length;
	// a piece right after the row's last, in the same text, lengthens it
	if (
		n[R + F_COUNT] > 0 &&
		s[(k - 1) * SPAN + 2] === src &&
		s[(k - 1) * SPAN + 1] === start
	) {
		s[(k - 1) * SPAN + 1] = end;
		return;
	}
	const i = spans.push(start, end, src);
	if (n[R + F_COUNT] === 0) n[R + F_AT] = i;
	n[R + F_COUNT]++;
}

/** Add s, a string not in the parsed text, to the text of row. */
function addLiteral(nodes, spans, row, s) {
	const start = spans.extra.length;
	spans.extra += s;
	addPiece(nodes, spans, row, 1, start, spans.extra.length);
}

/** Give row, a link or an image, its destination and title: strings[F_AT] and the one after (a link has no pieces). */
function setLink(nodes, row, destination, title) {
	nodes.i32[(row << 3) + F_AT] = nodes.addString(destination);
	nodes.strings.push(title);
}

/** The text of row of nodes, its pieces joined, read from source, the text the inlines were parsed from. */
export function inlineText(source, nodes, spans, row) {
	const at = nodes.i32[(row << 3) + F_AT];
	const end = at + nodes.i32[(row << 3) + F_COUNT];
	const s = spans.i32;
	let text = "";
	for (let i = at; i < end; i++)
		text += (s[i * SPAN + 2] === 0 ? source : spans.extra).slice(
			s[i * SPAN],
			s[i * SPAN + 1],
		);
	return text;
}

/** A character reference, matched where the parser is (sticky). */
const reEntityHere =
	/&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;

const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->";
const PROCESSINGINSTRUCTION = "[<][?][\\s\\S]*?[?][>]";
const DECLARATION = "<![A-Z]+\\s+[^>]*>";
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
/** An HTML tag of the spec (raw HTML), matched where the parser is (sticky). */
const reHtmlTag = new RegExp(
	`(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSINGINSTRUCTION}|${DECLARATION}|${CDATA})`,
	"y",
);

/** Unicode whitespace of the spec: Zs, tab, LF, FF, CR. */
const reUnicodeWhitespaceChar = /^[\t\n\f\r\p{Zs}]/u;
/** ASCII or Unicode punctuation of the spec (0.29: P* categories, plus the ASCII symbols). */
const rePunctuation = /^[\p{P}!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/u;

const reEscapable = new RegExp(`^${ESCAPABLE}`);
const reTicksHere = /`+/y;
const reTicks = /`+/g;
const reEmailAutolink =
	/<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
// biome-ignore lint/suspicious/noControlCharactersInRegex: GFM's grammar excludes controls and spaces from a URI
const reAutolink = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/y;
const reWhitespaceChar = /^[ \t\n\v\f\r]/;
const reInitialSpace = / */y;
const reSpecial = /[\n`[\]\\!<&*_~]/g;
const reFinalSpace = / *$/;

const isAsciiAlnum = (c) => c !== undefined && /^[A-Za-z0-9]$/.test(c);
const isAsciiAlpha = (c) => c !== undefined && /^[A-Za-z]$/.test(c);
const isSpace = (c) => c !== undefined && /^[ \t\n\r\f\v]$/.test(c);

// The kinds of the items of step 1
const K_TEXT = 0;
const K_DELIM = 1;
const K_BRACKET = 2;
const K_CODE = 3;
const K_HTML = 4;
const K_SOFTBREAK = 5;
const K_LINEBREAK = 6;
const K_AUTOLINK = 7;
const K_LINK_OPEN = 8;
const K_LINK_CLOSE = 9;

/** An item of step 1, always of this shape: its text [start, end) of the subject, or lit when not in it. */
class Item {
	constructor(kind, start, end, lit, offset) {
		this.kind = kind;
		this.start = start;
		this.end = end;
		this.lit = lit;
		this.offset = offset;
		this.data = null; // a link's { destination, title, image }, an autolink's destination
		this.opens = null; // the elements this run opens, outermost first
		this.closes = 0; // how many elements this run closes
		this.left = 0; // characters of the run used to close
		this.right = 0; // characters of the run used to open
	}
}

/** The characters before a valid domain of an extended autolink ends, from data[0] (GFM's check_domain). */
function checkDomain(data, allowShort) {
	let np = 0;
	let uscore1 = 0;
	let uscore2 = 0;
	let i = 1;
	for (; i < data.length - 1; i++) {
		const c = data[i];
		if (c === "\\" && i < data.length - 2) i++;
		if (data[i] === "_") uscore2++;
		else if (data[i] === ".") {
			uscore1 = uscore2;
			uscore2 = 0;
			np++;
		} else if (
			data[i] !== "-" &&
			(reUnicodeWhitespaceChar.test(data[i]) || rePunctuation.test(data[i]))
		)
			break;
	}
	if (uscore1 > 0 || uscore2 > 0) return 0;
	if (allowShort) return i;
	return np ? i : 0;
}

/** Where an extended autolink of data ends, its trailing punctuation and unmatched ) taken off (autolink_delim). */
function autolinkDelim(data, end) {
	const lt = data.indexOf("<");
	if (lt !== -1 && lt < end) end = lt;
	while (end > 0) {
		const c = data[end - 1];
		if ("?!.,:*_~'\"".includes(c)) {
			end--;
		} else if (c === ";") {
			let n = end - 2;
			while (n > 0 && isAsciiAlpha(data[n])) n--;
			if (n < end - 2 && data[n] === "&") end = n;
			else end--;
		} else if (c === ")") {
			let opening = 0;
			let closing = 0;
			for (let i = 0; i < end; i++) {
				if (data[i] === "(") opening++;
				else if (data[i] === ")") closing++;
			}
			if (closing <= opening) break;
			end--;
		} else {
			break;
		}
	}
	return end;
}

const reRunEnd = /[ \t\n\r\f\v<]/g;

/** Where an extended autolink starting at i of s must have ended. */
function runEnd(s, i) {
	reRunEnd.lastIndex = i;
	const m = reRunEnd.exec(s);
	return m === null ? s.length : m.index + 1;
}

/** The end of the path of an extended autolink whose domain ends at from. */
function autolinkEnd(data, from) {
	let end = from;
	while (end < data.length && !isSpace(data[end]) && data[end] !== "<") end++;
	return autolinkDelim(data, end);
}

/** The character (code point) just before index i of s. */
function charBefore(s, i) {
	const c = s.charCodeAt(i - 1);
	if (c >= 0xdc00 && c <= 0xdfff && i >= 2) return s.slice(i - 2, i);
	return s[i - 1];
}

/** The character (code point) at index i of s. */
function charAt(s, i) {
	return String.fromCodePoint(s.codePointAt(i));
}

export class InlineParser {
	/** refmap: the definitions of the whole text; autolink: whether extended autolinks are made. */
	constructor(decodeName, refmap, { autolink = true } = {}) {
		this.decodeName = decodeName;
		this.autolink = autolink;
		this.refmap = refmap;
		// the tables the leaf being parsed writes its inlines into, the document's
		this.nodes = null;
		this.spans = null;
		this.source = "";
		// the leaf's lines: where each starts in its content (lineAt) and in the text of its pieces (lineSrc)
		this.lineAt = new Uint32Array(64);
		this.lineSrc = new Uint32Array(64);
		this.lines = 0;
		this.line = 0;
		// where the subject starts in the content; 0 when the pieces are in source, 1 when in extra
		this.shift = 0;
		this.src = 0;
		this.subject = "";
		this.pos = 0;
		this.items = [];
		this.delimiters = null;
		this.brackets = null;
		// the next places a run of text may end: a special character, "www.", "://" (-1: none)
		this.nextSpecial = -1;
		this.nextWww = -1;
		this.nextScheme = -1;
		// the next "\n" and "@" of the subject at or after a position (its length: none)
		this.nextNewline = -1;
		this.nextAt = -1;
		// the NUL that nulAt last found in nulSource, looking from nulFrom
		this.nulSource = "";
		this.nulFrom = 0;
		this.nul = -1;
	}

	/** The match of the sticky re where the parser is, the position moved past it, or null. */
	match(re) {
		re.lastIndex = this.pos;
		const m = re.exec(this.subject);
		if (m === null) return null;
		this.pos = re.lastIndex;
		return m[0];
	}

	peek() {
		return this.subject[this.pos];
	}

	spnl() {
		skipSpnl(this);
	}

	/** An item of [start, end) of the subject. */
	push(kind, start, end) {
		const item = new Item(kind, start, end, null, this.pos);
		this.items.push(item);
		return item;
	}

	/** An item of lit, a text not in the subject. */
	pushLit(kind, lit) {
		const item = new Item(kind, 0, 0, lit, this.pos);
		this.items.push(item);
		return item;
	}

	/** Whether the subject has a line ending in [start, end). */
	newlineIn(start, end) {
		if (this.nextNewline < start) {
			const i = this.subject.indexOf("\n", start);
			this.nextNewline = i === -1 ? this.subject.length : i;
		}
		return this.nextNewline < end;
	}

	/** Parse the content of leaf, a paragraph, a heading or a table cell of nodes, read from source, as its children. */
	parseLeaf(source, nodes, spans, leaf) {
		const content = leafText(source, nodes, spans, leaf);
		const n = nodes.i32[(leaf << 3) + F_COUNT];
		if (n > this.lineAt.length) {
			this.lineAt = new Uint32Array(2 * n);
			this.lineSrc = new Uint32Array(2 * n);
		}
		const at = nodes.i32[(leaf << 3) + F_AT];
		const s32 = spans.i32;
		let pos = 0;
		let nul = false;
		for (let k = 0; k < n; k++) {
			const a = s32[(at + k) * SPAN];
			const b = s32[(at + k) * SPAN + 1];
			this.lineAt[k] = pos;
			this.lineSrc[k] = a;
			pos += b - a + 1;
			if (!nul && this.nulAt(source, a) < b) nul = true;
		}
		this.source = source;
		this.nodes = nodes;
		this.spans = spans;
		this.lines = n;
		this.src = 0;
		// a content not just its ranges joined (a NUL, a \| of a cell) is put in extra whole
		if (nul || (n > 0 && pos - 1 !== content.length)) {
			this.lines = 1;
			this.lineAt[0] = 0;
			this.lineSrc[0] = spans.extra.length;
			spans.extra += content;
			this.src = 1;
		}
		this.parse(leaf, content);
	}

	/** The first NUL of source at or after i (its length: none), looked for once ahead. */
	nulAt(source, i) {
		if (source !== this.nulSource || i < this.nulFrom || this.nul < i) {
			const j = source.indexOf("\0", i);
			this.nulSource = source;
			this.nulFrom = i;
			this.nul = j === -1 ? source.length : j;
		}
		return this.nul;
	}

	/** Add [start, end) of the subject to the text of row. */
	piece(row, start, end) {
		const c = start + this.shift;
		let k = this.line;
		while (k + 1 < this.lines && this.lineAt[k + 1] <= c) k++;
		while (k > 0 && this.lineAt[k] > c) k--;
		this.line = k;
		const from = this.lineSrc[k] + (c - this.lineAt[k]);
		addPiece(this.nodes, this.spans, row, this.src, from, from + (end - start));
	}

	/** Parse content as the inlines of root. */
	parse(root, content) {
		// the text without its leading and trailing spaces, tabs and line ends
		const edge = (c) => c === " " || c === "\t" || c === "\n";
		let a = 0;
		let b = content.length;
		while (a < b && edge(content[a])) a++;
		while (b > a && edge(content[b - 1])) b--;
		this.subject =
			a === 0 && b === content.length ? content : content.slice(a, b);
		this.shift = a;
		this.line = 0;
		this.nextNewline = -1;
		this.nextAt = -1;
		this.pos = 0;
		this.items = [];
		this.delimiters = null;
		this.brackets = null;
		this.nextSpecial = -1;
		this.nextWww = this.autolink ? this.subject.indexOf("www.") : -1;
		this.nextScheme = this.autolink ? this.subject.indexOf("://") : -1;
		while (this.pos < this.subject.length) this.parseInline();
		this.processEmphasis(null);
		this.build(root);
		this.items = [];
	}

	parseInline() {
		const c = this.peek();
		let res;
		switch (c) {
			case "\n":
				res = this.parseNewline();
				break;
			case "\\":
				res = this.parseBackslash();
				break;
			case "`":
				res = this.parseBackticks();
				break;
			case "*":
			case "_":
			case "~":
				res = this.handleDelim(c);
				break;
			case "[":
				this.addBracket(
					this.push(K_BRACKET, this.pos, this.pos + 1),
					this.pos,
					false,
				);
				this.pos += 1;
				res = true;
				break;
			case "!":
				res = this.parseBang();
				break;
			case "]":
				res = this.parseCloseBracket();
				break;
			case "<":
				res = this.parseAutolink() || this.parseHtmlTag();
				break;
			case "&":
				res = this.parseEntity();
				break;
			case "w":
				res = this.parseWww() || this.parseString();
				break;
			case ":":
				res = this.parseUrl() || this.parseString();
				break;
			default:
				res = this.parseString();
		}
		if (!res) {
			this.push(K_TEXT, this.pos, this.pos + 1);
			this.pos += 1;
		}
	}

	parseNewline() {
		this.pos += 1;
		const last = this.items[this.items.length - 1];
		const s = this.subject;
		if (
			last?.kind === K_TEXT &&
			(last.lit === null
				? last.end > last.start && s[last.end - 1] === " "
				: last.lit.endsWith(" "))
		) {
			let hard;
			if (last.lit === null) {
				hard = last.end - last.start >= 2 && s[last.end - 2] === " ";
				while (last.end > last.start && s[last.end - 1] === " ") last.end--;
			} else {
				hard = last.lit.endsWith("  ");
				last.lit = last.lit.replace(reFinalSpace, "");
			}
			this.push(hard ? K_LINEBREAK : K_SOFTBREAK, 0, 0);
		} else {
			this.push(K_SOFTBREAK, 0, 0);
		}
		this.match(reInitialSpace);
		return true;
	}

	parseBackslash() {
		this.pos += 1;
		const c = this.peek();
		if (c === "\n") {
			this.push(K_LINEBREAK, 0, 0);
			this.pos += 1;
		} else if (c !== undefined && reEscapable.test(c)) {
			this.push(K_TEXT, this.pos, this.pos + 1);
			this.pos += 1;
		} else {
			this.push(K_TEXT, this.pos - 1, this.pos);
		}
		return true;
	}

	parseBackticks() {
		const start = this.pos;
		const ticks = this.match(reTicksHere);
		const afterOpenTicks = this.pos;
		reTicks.lastIndex = this.pos;
		for (
			let m = reTicks.exec(this.subject);
			m;
			m = reTicks.exec(this.subject)
		) {
			if (m[0] === ticks) {
				const s = this.subject;
				let a = afterOpenTicks;
				let b = m.index;
				// one space off each end, when both are spaces and not all is (a line ending is a space)
				const sp = (i) => s[i] === " " || s[i] === "\n";
				let blank = true;
				for (let i = a; i < b && blank; i++) if (!sp(i)) blank = false;
				if (b > a && !blank && sp(a) && sp(b - 1)) {
					a++;
					b--;
				}
				this.pos = start;
				if (this.newlineIn(a, b))
					this.pushLit(K_CODE, s.slice(a, b).replace(/\n/g, " "));
				else this.push(K_CODE, a, b);
				this.pos = reTicks.lastIndex;
				return true;
			}
		}
		this.pos = start;
		this.push(K_TEXT, start, afterOpenTicks);
		this.pos = afterOpenTicks;
		return true;
	}

	scanDelims(c) {
		const start = this.pos;
		let n = 0;
		while (this.subject[this.pos] === c) {
			n++;
			this.pos++;
		}
		const before = start === 0 ? "\n" : charBefore(this.subject, start);
		const after =
			this.pos >= this.subject.length ? "\n" : charAt(this.subject, this.pos);
		this.pos = start;
		const afterIsWhitespace = reUnicodeWhitespaceChar.test(after);
		const afterIsPunctuation = rePunctuation.test(after);
		const beforeIsWhitespace = reUnicodeWhitespaceChar.test(before);
		const beforeIsPunctuation = rePunctuation.test(before);
		const left =
			!afterIsWhitespace &&
			(!afterIsPunctuation || beforeIsWhitespace || beforeIsPunctuation);
		const right =
			!beforeIsWhitespace &&
			(!beforeIsPunctuation || afterIsWhitespace || afterIsPunctuation);
		if (c === "_")
			return {
				n,
				canOpen: left && (!right || beforeIsPunctuation),
				canClose: right && (!left || afterIsPunctuation),
			};
		return { n, canOpen: left, canClose: right };
	}

	handleDelim(c) {
		const res = this.scanDelims(c);
		const item = this.push(K_DELIM, this.pos, this.pos + res.n);
		this.pos += res.n;
		if ((res.canOpen || res.canClose) && (c !== "~" || res.n <= 2)) {
			this.delimiters = {
				cc: c,
				numdelims: res.n,
				origdelims: res.n,
				item,
				previous: this.delimiters,
				next: null,
				canOpen: res.canOpen,
				canClose: res.canClose,
			};
			if (this.delimiters.previous)
				this.delimiters.previous.next = this.delimiters;
		}
		return true;
	}

	removeDelimiter(delim) {
		if (delim.previous !== null) delim.previous.next = delim.next;
		if (delim.next === null) this.delimiters = delim.previous;
		else delim.next.previous = delim.previous;
	}

	/** Match the delimiter runs above stackBottom into emphasis and strikethrough, marking their items. */
	processEmphasis(stackBottom) {
		const openersBottom = new Map();
		// the lowest run above stackBottom; none when stackBottom is the top, so the walk never goes below it
		let closer = this.delimiters === stackBottom ? null : this.delimiters;
		while (closer !== null && closer.previous !== stackBottom)
			closer = closer.previous;
		while (closer !== null) {
			if (!closer.canClose) {
				closer = closer.next;
				continue;
			}
			const cc = closer.cc;
			const key = `${cc}${closer.canOpen ? 1 : 0}${closer.origdelims % 3}`;
			const bottom = openersBottom.has(key)
				? openersBottom.get(key)
				: stackBottom;
			let opener = closer.previous;
			let found = false;
			while (opener !== null && opener !== stackBottom && opener !== bottom) {
				const oddMatch =
					cc !== "~" &&
					(closer.canOpen || opener.canClose) &&
					closer.origdelims % 3 !== 0 &&
					(opener.origdelims + closer.origdelims) % 3 === 0;
				if (
					opener.cc === cc &&
					opener.canOpen &&
					!oddMatch &&
					(cc !== "~" || opener.numdelims === closer.numdelims)
				) {
					found = true;
					break;
				}
				opener = opener.previous;
			}
			if (!found) {
				const old = closer;
				closer = closer.next;
				openersBottom.set(key, old.previous);
				if (!old.canOpen) this.removeDelimiter(old);
				continue;
			}
			const use =
				cc === "~"
					? closer.numdelims
					: closer.numdelims >= 2 && opener.numdelims >= 2
						? 2
						: 1;
			opener.numdelims -= use;
			closer.numdelims -= use;
			opener.item.right += use;
			closer.item.left += use;
			const type = cc === "~" ? DEL : use === 1 ? EMPH : STRONG;
			if (opener.item.opens === null) opener.item.opens = [type];
			else opener.item.opens.unshift(type);
			closer.item.closes += 1;
			if (opener.next !== closer) {
				opener.next = closer;
				closer.previous = opener;
			}
			if (opener.numdelims === 0) this.removeDelimiter(opener);
			if (closer.numdelims === 0) {
				const next = closer.next;
				this.removeDelimiter(closer);
				closer = next;
			}
		}
		while (this.delimiters !== null && this.delimiters !== stackBottom)
			this.removeDelimiter(this.delimiters);
	}

	addBracket(item, index, image) {
		if (this.brackets !== null) this.brackets.bracketAfter = true;
		this.brackets = {
			item,
			previous: this.brackets,
			previousDelimiter: this.delimiters,
			index,
			image,
			active: true,
			bracketAfter: false,
		};
	}

	parseBang() {
		if (this.subject[this.pos + 1] !== "[") {
			this.push(K_TEXT, this.pos, this.pos + 1);
			this.pos += 1;
			return true;
		}
		this.addBracket(
			this.push(K_BRACKET, this.pos, this.pos + 2),
			this.pos + 1,
			true,
		);
		this.pos += 2;
		return true;
	}

	parseCloseBracket() {
		const opener = this.brackets;
		if (opener === null) return false;
		if (!opener.active) {
			this.brackets = opener.previous;
			return false;
		}
		const closeAt = this.pos;
		this.pos += 1;
		const start = this.pos;
		let link = this.peek() === "(" ? this.parseInlineLink() : null;
		if (link === null) {
			this.pos = start;
			const beforeLabel = this.pos;
			const n = this.parseLinkLabel();
			let reflabel = null;
			if (n > 2) reflabel = this.subject.slice(beforeLabel, beforeLabel + n);
			else if (!opener.bracketAfter)
				reflabel = this.subject.slice(opener.index, start);
			if (n === 0) this.pos = start;
			if (reflabel !== null) {
				const label = normalizeLabel(reflabel);
				const ref = this.refmap.get(label);
				if (ref) link = { destination: ref.destination, title: ref.title };
			}
		}
		if (link === null) {
			this.brackets = opener.previous;
			this.pos = closeAt;
			return false;
		}
		opener.item.kind = K_LINK_OPEN;
		opener.item.data = {
			destination: link.destination,
			title: link.title ?? "",
			image: opener.image,
		};
		const end = this.pos;
		this.pos = closeAt;
		this.push(K_LINK_CLOSE, 0, 0);
		this.pos = end;
		this.processEmphasis(opener.previousDelimiter);
		this.brackets = opener.previous;
		if (!opener.image)
			for (let o = this.brackets; o !== null; o = o.previous)
				if (!o.image) o.active = false;
		return true;
	}

	/** The ( destination title ) of an inline link here, past it, or null (the position then left anywhere). */
	parseInlineLink() {
		this.pos += 1;
		this.spnl();
		const destination = this.parseLinkDestination();
		if (destination === null) return null;
		this.spnl();
		let title = null;
		if (reWhitespaceChar.test(this.subject[this.pos - 1]))
			title = this.parseLinkTitle();
		this.spnl();
		if (this.peek() !== ")") return null;
		this.pos += 1;
		return { destination, title };
	}

	parseLinkTitle() {
		return scanLinkTitle(this, this.decodeName);
	}

	parseLinkDestination() {
		return scanLinkDestination(this, this.decodeName);
	}

	parseLinkLabel() {
		return scanLinkLabel(this);
	}

	parseAutolink() {
		const start = this.pos;
		let m = this.match(reEmailAutolink);
		let destination;
		if (m !== null) {
			destination = normalizeURI(`mailto:${m.slice(1, -1)}`);
		} else {
			m = this.match(reAutolink);
			if (m === null) return false;
			destination = normalizeURI(m.slice(1, -1));
		}
		const end = this.pos;
		this.pos = start;
		this.push(K_AUTOLINK, start + 1, end - 1).data = destination;
		this.pos = end;
		return true;
	}

	parseHtmlTag() {
		const start = this.pos;
		const m = this.match(reHtmlTag);
		if (m === null) return false;
		const end = this.pos;
		this.pos = start;
		if (this.newlineIn(start, end)) this.pushLit(K_HTML, m);
		else this.push(K_HTML, start, end);
		this.pos = end;
		return true;
	}

	parseEntity() {
		reEntityHere.lastIndex = this.pos;
		const m = reEntityHere.exec(this.subject);
		if (m === null) return false;
		const decoded = decodeEntity(m[0], this.decodeName);
		if (decoded === null) return false;
		this.pushLit(K_TEXT, decoded);
		this.pos += m[0].length;
		return true;
	}

	/** A run of plain text, up to the next place something else may start. */
	parseString() {
		const start = this.pos;
		const s = this.subject;
		if (this.nextSpecial < start) {
			reSpecial.lastIndex = start;
			const m = reSpecial.exec(s);
			this.nextSpecial = m === null ? s.length : m.index;
		}
		let end = this.nextSpecial;
		if (end === start) return false;
		if (this.nextWww !== -1 && this.nextWww <= start)
			this.nextWww = this.subject.indexOf("www.", start + 1);
		if (this.nextScheme !== -1 && this.nextScheme <= start)
			this.nextScheme = this.subject.indexOf("://", start + 1);
		if (this.nextWww !== -1 && this.nextWww < end) end = this.nextWww;
		if (this.nextScheme !== -1 && this.nextScheme < end) end = this.nextScheme;
		this.pos = start;
		this.push(K_TEXT, start, end);
		this.pos = end;
		return true;
	}

	/** An extended www autolink starting here (GFM's www_match). */
	parseWww() {
		if (!this.autolink || this.brackets !== null) return false;
		const s = this.subject;
		const p = this.pos;
		if (p > 0 && !"*_~(".includes(s[p - 1]) && !isSpace(s[p - 1])) return false;
		if (!s.startsWith("www.", p)) return false;
		const data = s.slice(p, runEnd(s, p));
		const domain = checkDomain(data, false);
		if (domain === 0) return false;
		const end = autolinkEnd(data, domain);
		if (end === 0) return false;
		const url = data.slice(0, end);
		this.push(K_AUTOLINK, p, p + end).data = normalizeURI(`http://${url}`);
		this.pos += end;
		return true;
	}

	/** An extended url autolink whose scheme was just read, at its ":" (GFM's url_match). */
	parseUrl() {
		if (!this.autolink || this.brackets !== null) return false;
		const s = this.subject;
		const p = this.pos;
		if (s[p + 1] !== "/" || s[p + 2] !== "/") return false;
		const last = this.items[this.items.length - 1];
		if (last?.kind !== K_TEXT) return false;
		const text = last.lit ?? s.slice(last.start, last.end);
		let rewind = 0;
		while (rewind < text.length && isAsciiAlpha(text[text.length - rewind - 1]))
			rewind++;
		const scheme = text.slice(text.length - rewind);
		if (!["http", "https", "ftp"].includes(scheme.toLowerCase())) return false;
		const data = s.slice(p + 3, runEnd(s, p + 3));
		if (!isAsciiAlnum(data[0])) return false;
		const domain = checkDomain(data, true);
		if (domain === 0) return false;
		const end = autolinkEnd(data, domain);
		if (end === 0) return false;
		const url = `${scheme}://${data.slice(0, end)}`;
		this.pos = p - rewind;
		if (last.lit === null) {
			last.end -= rewind;
			this.push(K_AUTOLINK, p - rewind, p + 3 + end).data = normalizeURI(url);
		} else {
			last.lit = last.lit.slice(0, last.lit.length - rewind);
			this.pushLit(K_AUTOLINK, url).data = normalizeURI(url);
		}
		this.pos = p + 3 + end;
		return true;
	}

	/** Step 3: the items, read once in order, as the children of root. */
	build(root) {
		const t = this.nodes;
		const sp = this.spans;
		const stack = [root];
		let top = root;
		let text = -1;
		let hasAt = false;
		let inLink = 0;
		const textRow = (offset) => {
			if (text === -1) {
				text = t.add(TEXT, offset);
				t.appendInline(top, text);
			}
			return text;
		};
		// a range of the subject, or a literal, as the text of the open text node
		const addRange = (a, b, offset) => {
			if (a === b) return;
			this.piece(textRow(offset), a, b);
			if (this.autolink && !hasAt) {
				if (this.nextAt < a) {
					const i = this.subject.indexOf("@", a);
					this.nextAt = i === -1 ? this.subject.length : i;
				}
				hasAt = this.nextAt < b;
			}
		};
		const addLit = (s, offset) => {
			if (s === "") return;
			addLiteral(t, sp, textRow(offset), s);
			if (!hasAt && s.includes("@")) hasAt = true;
		};
		const addItem = (item, offset) => {
			if (item.lit === null) addRange(item.start, item.end, offset);
			else addLit(item.lit, offset);
		};
		const endText = () => {
			if (text !== -1 && hasAt && this.autolink && inLink === 0)
				this.autolinkEmails(text);
			text = -1;
			hasAt = false;
		};
		const open = (type, offset) => {
			endText();
			const n = t.add(type, offset);
			t.appendInline(top, n);
			stack.push(n);
			top = n;
			return n;
		};
		const close = () => {
			endText();
			stack.pop();
			top = stack[stack.length - 1];
		};
		// a node of one piece of text, the item's
		const leafOf = (type, item, parent) => {
			const n = t.add(type, item.offset);
			t.appendInline(parent, n);
			if (item.lit === null) {
				if (item.end > item.start) this.piece(n, item.start, item.end);
			} else if (item.lit !== "") addLiteral(t, sp, n, item.lit);
			return n;
		};
		for (const item of this.items) {
			switch (item.kind) {
				case K_TEXT:
				case K_BRACKET:
					addItem(item, item.offset);
					break;
				case K_DELIM:
					for (let i = 0; i < item.closes; i++) close();
					addRange(
						item.start + item.left,
						item.end - item.right,
						item.offset + item.left,
					);
					if (item.opens !== null)
						for (const type of item.opens) open(type, item.offset);
					break;
				case K_LINK_OPEN: {
					const n = open(item.data.image ? IMAGE : LINK, item.offset);
					setLink(t, n, item.data.destination, item.data.title);
					inLink++;
					break;
				}
				case K_LINK_CLOSE:
					close();
					inLink--;
					break;
				case K_CODE:
				case K_HTML:
					endText();
					leafOf(item.kind === K_CODE ? CODE : HTML_INLINE, item, top);
					break;
				case K_SOFTBREAK:
				case K_LINEBREAK:
					endText();
					t.appendInline(
						top,
						t.add(
							item.kind === K_SOFTBREAK ? SOFTBREAK : LINEBREAK,
							item.offset,
						),
					);
					break;
				case K_AUTOLINK: {
					endText();
					const link = t.add(LINK, item.offset);
					t.appendInline(top, link);
					setLink(t, link, item.data, "");
					leafOf(TEXT, item, link);
					break;
				}
			}
		}
		endText();
	}

	/** Turn the email addresses of text, the last row, into links, the row replaced by its pieces (GFM's postprocess). */
	autolinkEmails(text) {
		const t = this.nodes;
		const sp = this.spans;
		const s = inlineText(this.source, t, sp, text);
		const parts = splitEmails(s);
		if (parts.length === 3 && parts[0] === 0) return;
		const T = text << 3;
		const parent = t.i32[T + F_PARENT];
		const offset = t.i32[T + F_OFFSET];
		const at = t.i32[T + F_AT];
		// of one piece, the parts are pieces of it; else literals
		const single = t.i32[T + F_COUNT] === 1;
		const src = sp.i32[at * SPAN + 2];
		const base = sp.i32[at * SPAN];
		// text is the last row and parent's last child; the one before it, found from the first, is the last now
		const n = t.i32;
		let prev = -1;
		for (
			let c = n[(parent << 3) + F_FIRST];
			c !== text;
			c = n[(c << 3) + F_NEXT]
		)
			prev = c;
		n[(parent << 3) + F_LAST] = prev;
		if (prev === -1) n[(parent << 3) + F_FIRST] = -1;
		else n[(prev << 3) + F_NEXT] = -1;
		t.length = text;
		sp.length = at;
		const textOf = (row, from, to) => {
			if (single) addPiece(t, sp, row, src, base + from, base + to);
			else addLiteral(t, sp, row, s.slice(from, to));
		};
		for (let i = 0; i < parts.length; i += 3) {
			const from = parts[i + 1];
			const to = parts[i + 2];
			const row = t.add(TEXT, offset + from);
			if (parts[i] === 1) {
				const link = t.add(LINK, offset + from);
				t.appendInline(parent, link);
				setLink(t, link, normalizeURI(`mailto:${s.slice(from, to)}`), "");
				t.appendInline(link, row);
			} else t.appendInline(parent, row);
			textOf(row, from, to);
		}
	}
}

/** The text s as parts of text (0) and email links (1): kind, from, to for each. */
function splitEmails(s) {
	const parts = [];
	let from = 0;
	let at = s.indexOf("@");
	while (at !== -1) {
		let rewind = 0;
		let bad = false;
		while (at - rewind - 1 >= from) {
			const c = s[at - rewind - 1];
			if (isAsciiAlnum(c) || ".+-_".includes(c)) rewind++;
			else {
				if (c === "/") bad = true;
				break;
			}
		}
		if (bad || rewind === 0) {
			at = s.indexOf("@", at + 1);
			continue;
		}
		const data = s.slice(at, runEnd(s, at));
		let end = 0;
		let nb = 0;
		let np = 0;
		for (; end < data.length; end++) {
			const c = data[end];
			if (isAsciiAlnum(c)) continue;
			if (c === "@") nb++;
			else if (
				c === "." &&
				end < data.length - 1 &&
				isAsciiAlnum(data[end + 1])
			)
				np++;
			else if (c !== "-" && c !== "_") break;
		}
		if (
			end < 2 ||
			nb !== 1 ||
			np === 0 ||
			(!isAsciiAlpha(data[end - 1]) && data[end - 1] !== ".")
		) {
			at = s.indexOf("@", at + 1);
			continue;
		}
		end = autolinkDelim(data, end);
		if (end === 0) {
			at = s.indexOf("@", at + 1);
			continue;
		}
		const start = at - rewind;
		if (start > from) parts.push(0, from, start);
		parts.push(1, start, at + end);
		from = at + end;
		at = s.indexOf("@", from);
	}
	if (from < s.length) parts.push(0, from, s.length);
	return parts;
}
