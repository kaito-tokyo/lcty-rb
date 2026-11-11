// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The inlines of GFM 0.29-gfm (LCTYSP-0017): the text of a leaf block becomes text, code spans, emphasis,
// strikethrough, links, images, autolinks, raw HTML and line breaks. It is done in three steps, so the tree is built
// once and never rearranged:
//
// 1. The text is read into a flat array of items: runs of text, delimiter runs (* _ ~), brackets, code spans, raw
//    HTML, autolinks and line breaks.
// 2. Emphasis and links are found with the delimiter and bracket stacks of the spec's "An algorithm for parsing nested
//    emphasis and links". A match does not move nodes: it marks the items, an opening run with the elements it opens
//    and a closing run with how many it closes, and a bracket as the start of a link.
// 3. The items are read once, in order, into the children of the leaf. Adjacent pieces of text are one text node whose
//    view is the pieces.
//
// The extended autolinks are found as GFM's reference finds them: www. and scheme:// while the text is read, email
// addresses in each text node, outside links, as it is built.

import {
	appendChild,
	BLOCK_NAMES,
	CLOSETAG,
	decodeEntity,
	ESCAPABLE,
	fitChildren,
	NONE,
	normalizeLabel,
	normalizeURI,
	OPENTAG,
	scanLinkDestination,
	scanLinkLabel,
	scanLinkTitle,
	skipSpnl,
	TABLE_CELL,
} from "./gfm_blocks.js";

// The types of the inlines, numbered on from the blocks' (gfm_blocks.js), so that one switch reads the whole tree
export const TEXT = TABLE_CELL + 1;
export const SOFTBREAK = TABLE_CELL + 2;
export const LINEBREAK = TABLE_CELL + 3;
export const CODE = TABLE_CELL + 4;
export const HTML_INLINE = TABLE_CELL + 5;
export const EMPH = TABLE_CELL + 6;
export const STRONG = TABLE_CELL + 7;
export const DEL = TABLE_CELL + 8;
export const LINK = TABLE_CELL + 9;
export const IMAGE = TABLE_CELL + 10;
/** The name of each type of node, blocks and inlines, by its number. */
export const TYPE_NAMES = Object.freeze([
	...BLOCK_NAMES,
	"text",
	"softbreak",
	"linebreak",
	"code",
	"html_inline",
	"emph",
	"strong",
	"del",
	"link",
	"image",
]);

/** @import { Inline } from "./gfm_inlines.js" */

/**
 * A new inline node, of no view and no children (gfm_blocks.d.ts gives the shapes); a block has the same fields
 * first.
 * @returns {Inline}
 */
export function inline(type, offset, data = null) {
	return { type, offset, view: NONE, parent: null, children: NONE, data };
}

/** A character reference, matched where the parser is (sticky). */
export const reEntityHere =
	/&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;

const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->";
const PROCESSINGINSTRUCTION = "[<][?][\\s\\S]*?[?][>]";
const DECLARATION = "<![A-Z]+\\s+[^>]*>";
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
/** An HTML tag of the spec (raw HTML), matched where the parser is (sticky). */
export const reHtmlTag = new RegExp(
	`(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSINGINSTRUCTION}|${DECLARATION}|${CDATA})`,
	"y",
);

/** Unicode whitespace of the spec: Zs, tab, LF, FF, CR. */
export const reUnicodeWhitespaceChar = /^[\t\n\f\r\p{Zs}]/u;
/** ASCII or Unicode punctuation of the spec (0.29: P* categories, plus the ASCII symbols). */
export const rePunctuation = /^[\p{P}!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/u;

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

/** An item of step 1, always of this shape. */
class Item {
	constructor(kind, text, offset) {
		this.kind = kind;
		this.text = text;
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

/**
 * Where an extended autolink starting at i of s must have ended: just past the first whitespace or < after it. The
 * autolink is looked for in s up to there only, so each look costs its own length, not the rest of the text.
 */
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

/** A text node of one piece. */
function textNode(s, offset) {
	const n = inline(TEXT, offset, null);
	n.view = [s];
	return n;
}

/** A link of an autolink: destination, and its text as its only child. */
function autolinkNode(destination, text, offset) {
	const link = inline(LINK, offset, { destination, title: "" });
	appendChild(link, textNode(text, offset));
	return link;
}

export class InlineParser {
	/**
	 * refmap holds the link reference definitions of the whole text, read by the block phase. autolink: whether the
	 * extended autolinks of GFM are made (the spec's examples without the extension turn it off).
	 */
	constructor(decodeName, refmap, { autolink = true } = {}) {
		this.decodeName = decodeName;
		this.autolink = autolink;
		this.refmap = refmap;
		this.subject = "";
		this.pos = 0;
		this.items = [];
		this.delimiters = null;
		this.brackets = null;
		// the next character that may start something other than text, and the next "www." and "://" (-1: none), where
		// a run of text ends
		this.nextSpecial = -1;
		this.nextWww = -1;
		this.nextScheme = -1;
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

	push(kind, text) {
		const item = new Item(kind, text, this.pos);
		this.items.push(item);
		return item;
	}

	/** Parse content as the inlines of node, which becomes their parent. */
	parse(node, content) {
		// the text without its leading and trailing spaces, tabs and line ends
		const edge = (c) => c === " " || c === "\t" || c === "\n";
		let a = 0;
		let b = content.length;
		while (a < b && edge(content[a])) a++;
		while (b > a && edge(content[b - 1])) b--;
		this.subject =
			a === 0 && b === content.length ? content : content.slice(a, b);
		this.pos = 0;
		this.items = [];
		this.delimiters = null;
		this.brackets = null;
		this.nextSpecial = -1;
		this.nextWww = this.autolink ? this.subject.indexOf("www.") : -1;
		this.nextScheme = this.autolink ? this.subject.indexOf("://") : -1;
		while (this.pos < this.subject.length) this.parseInline();
		this.processEmphasis(null);
		this.build(node);
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
				this.addBracket(this.push(K_BRACKET, "["), this.pos, false);
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
			this.push(K_TEXT, c);
			this.pos += 1;
		}
	}

	parseNewline() {
		this.pos += 1;
		const last = this.items[this.items.length - 1];
		if (last?.kind === K_TEXT && last.text.endsWith(" ")) {
			const hard = last.text.endsWith("  ");
			last.text = last.text.replace(reFinalSpace, "");
			this.push(hard ? K_LINEBREAK : K_SOFTBREAK, "");
		} else {
			this.push(K_SOFTBREAK, "");
		}
		this.match(reInitialSpace);
		return true;
	}

	parseBackslash() {
		this.pos += 1;
		const c = this.peek();
		if (c === "\n") {
			this.push(K_LINEBREAK, "");
			this.pos += 1;
		} else if (c !== undefined && reEscapable.test(c)) {
			this.push(K_TEXT, c);
			this.pos += 1;
		} else {
			this.push(K_TEXT, "\\");
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
				let contents = this.subject
					.slice(afterOpenTicks, m.index)
					.replace(/\n/g, " ");
				if (
					contents.length > 0 &&
					/[^ ]/.test(contents) &&
					contents[0] === " " &&
					contents[contents.length - 1] === " "
				)
					contents = contents.slice(1, -1);
				this.pos = start;
				this.push(K_CODE, contents);
				this.pos = reTicks.lastIndex;
				return true;
			}
		}
		this.pos = start;
		this.push(K_TEXT, ticks);
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
		const item = this.push(
			K_DELIM,
			this.subject.slice(this.pos, this.pos + res.n),
		);
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
		let closer = this.delimiters;
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
			this.push(K_TEXT, "!");
			this.pos += 1;
			return true;
		}
		this.addBracket(this.push(K_BRACKET, "!["), this.pos + 1, true);
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
		this.push(K_LINK_CLOSE, "");
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
		this.push(K_AUTOLINK, m.slice(1, -1)).data = destination;
		this.pos = end;
		return true;
	}

	parseHtmlTag() {
		const start = this.pos;
		const m = this.match(reHtmlTag);
		if (m === null) return false;
		const end = this.pos;
		this.pos = start;
		this.push(K_HTML, m);
		this.pos = end;
		return true;
	}

	parseEntity() {
		reEntityHere.lastIndex = this.pos;
		const m = reEntityHere.exec(this.subject);
		if (m === null) return false;
		const decoded = decodeEntity(m[0], this.decodeName);
		if (decoded === null) return false;
		this.push(K_TEXT, decoded);
		this.pos += m[0].length;
		return true;
	}

	/**
	 * A run of plain text, up to the next character that may start something else, cut before the next place an
	 * extended autolink may start. Each of those places is looked for once, ahead of the position, so the runs cost
	 * their own length.
	 */
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
		this.push(K_TEXT, this.subject.slice(start, end));
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
		this.push(K_AUTOLINK, url).data = normalizeURI(`http://${url}`);
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
		let rewind = 0;
		while (
			rewind < last.text.length &&
			isAsciiAlpha(last.text[last.text.length - rewind - 1])
		)
			rewind++;
		const scheme = last.text.slice(last.text.length - rewind);
		if (!["http", "https", "ftp"].includes(scheme.toLowerCase())) return false;
		const data = s.slice(p + 3, runEnd(s, p + 3));
		if (!isAsciiAlnum(data[0])) return false;
		const domain = checkDomain(data, true);
		if (domain === 0) return false;
		const end = autolinkEnd(data, domain);
		if (end === 0) return false;
		last.text = last.text.slice(0, last.text.length - rewind);
		const url = `${scheme}://${data.slice(0, end)}`;
		this.pos = p - rewind;
		this.push(K_AUTOLINK, url).data = normalizeURI(url);
		this.pos = p + 3 + end;
		return true;
	}

	/** Step 3: the items, read once in order, as the children of node. */
	build(node) {
		const stack = [node];
		let text = null;
		let inLink = 0;
		const top = () => stack[stack.length - 1];
		const addText = (s, offset) => {
			if (s === "") return;
			if (text === null) text = appendChild(top(), textNode(s, offset));
			else text.view.push(s);
		};
		const endText = () => {
			if (text !== null && this.autolink && inLink === 0) autolinkEmails(text);
			text = null;
		};
		const open = (n) => {
			endText();
			appendChild(top(), n);
			stack.push(n);
		};
		const close = () => {
			endText();
			fitChildren(stack.pop());
		};
		for (const item of this.items) {
			switch (item.kind) {
				case K_TEXT:
				case K_BRACKET:
					addText(item.text, item.offset);
					break;
				case K_DELIM:
					for (let i = 0; i < item.closes; i++) close();
					addText(
						item.text.slice(item.left, item.text.length - item.right),
						item.offset + item.left,
					);
					if (item.opens !== null)
						for (const type of item.opens)
							open(inline(type, item.offset, null));
					break;
				case K_LINK_OPEN:
					open(
						inline(item.data.image ? IMAGE : LINK, item.offset, {
							destination: item.data.destination,
							title: item.data.title,
						}),
					);
					inLink++;
					break;
				case K_LINK_CLOSE:
					close();
					inLink--;
					break;
				case K_CODE:
				case K_HTML: {
					endText();
					const n = appendChild(
						top(),
						inline(item.kind === K_CODE ? CODE : HTML_INLINE, item.offset),
					);
					n.view = [item.text];
					break;
				}
				case K_SOFTBREAK:
				case K_LINEBREAK:
					endText();
					appendChild(
						top(),
						inline(
							item.kind === K_SOFTBREAK ? SOFTBREAK : LINEBREAK,
							item.offset,
						),
					);
					break;
				case K_AUTOLINK:
					endText();
					appendChild(top(), autolinkNode(item.data, item.text, item.offset));
					break;
			}
		}
		endText();
		fitChildren(node);
	}
}

/** Turn the email addresses of a text node into links, replacing it with the pieces (GFM's postprocess). */
function autolinkEmails(node) {
	const view = node.view;
	if (!view.some((s) => s.includes("@"))) return;
	const parts = splitEmails(
		view.length === 1 ? view[0] : view.join(""),
		node.offset,
	);
	if (parts.length === 1 && parts[0].type === TEXT) return;
	const siblings = node.parent.children;
	siblings.pop();
	for (const p of parts) appendChild(node.parent, p);
	node.parent = null;
}

/** The text s as text nodes and email links. */
function splitEmails(s, offset) {
	const nodes = [];
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
		if (start > from) nodes.push(textNode(s.slice(from, start), offset + from));
		const addr = s.slice(start, at + end);
		nodes.push(
			autolinkNode(normalizeURI(`mailto:${addr}`), addr, offset + start),
		);
		from = at + end;
		at = s.indexOf("@", from);
	}
	if (from < s.length) nodes.push(textNode(s.slice(from), offset + from));
	return nodes;
}
