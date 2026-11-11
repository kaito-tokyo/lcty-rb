// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The inlines of GFM 0.29-gfm (LCTYSP-0017): the text of a leaf block becomes text, code spans, emphasis,
// strikethrough, links, images, autolinks, raw HTML and line breaks. Emphasis and links are found with the delimiter
// and bracket stacks of the spec's "An algorithm for parsing nested emphasis and links"; the extended autolinks are
// found as GFM's reference finds them (www. and scheme:// while the text is read, email addresses afterwards).

import {
	decodeEntity,
	ESCAPABLE,
	Node,
	normalizeLabel,
	normalizeURI,
	reEntityHere,
	reHtmlTag,
	rePunctuation,
	reUnicodeWhitespaceChar,
	unescapeString,
	walk,
} from "./common.js";

const reEscapable = new RegExp(`^${ESCAPABLE}`);
const reLinkTitle = new RegExp(
	`"(?:\\\\${ESCAPABLE}|\\\\[^\\\\]|[^\\\\"\\x00])*"|'(?:\\\\${ESCAPABLE}|\\\\[^\\\\]|[^\\\\'\\x00])*'|\\((?:\\\\${ESCAPABLE}|\\\\[^\\\\]|[^\\\\()\\x00])*\\)`,
	"y",
);
// biome-ignore lint/suspicious/noControlCharactersInRegex: GFM's grammar excludes NUL here
const reLinkDestinationBraces = /<(?:[^<>\n\\\x00]|\\.)*>/y;
const reTicksHere = /`+/y;
const reTicks = /`+/g;
const reEmailAutolink =
	/<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
// biome-ignore lint/suspicious/noControlCharactersInRegex: GFM's grammar excludes controls and spaces from a URI
const reAutolink = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/y;
const reSpnl = /[ \t]*(?:\n[ \t]*)?/y;
const reWhitespaceChar = /^[ \t\n\v\f\r]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a link destination ends at a control or a space
const reControlOrSpace = /^[\x00-\x20]$/;
const reInitialSpace = / */y;
const reSpaceAtEndOfLine = / *(?:\n|$)/y;
const reLinkLabel = /\[(?:[^\\[\]]|\\.){0,1000}\]/sy;
const reMain = /[^\n`[\]\\!<&*_~w:]+/y;
const reFinalSpace = / *$/;

const isAsciiAlnum = (c) => c !== undefined && /^[A-Za-z0-9]$/.test(c);
const isAsciiAlpha = (c) => c !== undefined && /^[A-Za-z]$/.test(c);
const isSpace = (c) => c !== undefined && /^[ \t\n\r\f\v]$/.test(c);

const text = (s) => new Node("text", { literal: s });

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

export class InlineParser {
	/** autolink: whether the extended autolinks of GFM are made (the spec's examples without the extension turn it off). */
	constructor(decodeName, { autolink = true } = {}) {
		this.decodeName = decodeName;
		this.autolink = autolink;
		this.subject = "";
		this.pos = 0;
		this.delimiters = null;
		this.brackets = null;
		this.refmap = new Map();
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
		this.match(reSpnl);
		return true;
	}

	/** Parse the inlines of block's text into its children. */
	parse(block, content) {
		this.subject = content.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
		this.pos = 0;
		this.delimiters = null;
		this.brackets = null;
		while (this.parseInline(block)) {}
		block.string_content = null;
		this.processEmphasis(null);
		mergeText(block);
		if (this.autolink) autolinkEmails(block);
	}

	parseInline(block) {
		const c = this.peek();
		if (c === undefined) return false;
		let res;
		switch (c) {
			case "\n":
				res = this.parseNewline(block);
				break;
			case "\\":
				res = this.parseBackslash(block);
				break;
			case "`":
				res = this.parseBackticks(block);
				break;
			case "*":
			case "_":
			case "~":
				res = this.handleDelim(c, block);
				break;
			case "[":
				res = this.parseOpenBracket(block);
				break;
			case "!":
				res = this.parseBang(block);
				break;
			case "]":
				res = this.parseCloseBracket(block);
				break;
			case "<":
				res = this.parseAutolink(block) || this.parseHtmlTag(block);
				break;
			case "&":
				res = this.parseEntity(block);
				break;
			case "w":
				res = this.parseWww(block) || this.parseString(block);
				break;
			case ":":
				res = this.parseUrl(block);
				break;
			default:
				res = this.parseString(block);
		}
		if (!res) {
			this.pos += 1;
			block.append(text(c));
		}
		return true;
	}

	parseNewline(block) {
		this.pos += 1;
		const last = block.lastChild;
		if (last?.type === "text" && last.literal.endsWith(" ")) {
			const hard = last.literal.endsWith("  ");
			last.literal = last.literal.replace(reFinalSpace, "");
			block.append(new Node(hard ? "linebreak" : "softbreak"));
		} else {
			block.append(new Node("softbreak"));
		}
		this.match(reInitialSpace);
		return true;
	}

	parseBackslash(block) {
		this.pos += 1;
		const c = this.peek();
		if (c === "\n") {
			this.pos += 1;
			block.append(new Node("linebreak"));
		} else if (c !== undefined && reEscapable.test(c)) {
			this.pos += 1;
			block.append(text(c));
		} else {
			block.append(text("\\"));
		}
		return true;
	}

	parseBackticks(block) {
		const ticks = this.match(reTicksHere);
		if (ticks === null) return false;
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
				block.append(new Node("code", { literal: contents }));
				this.pos = reTicks.lastIndex;
				return true;
			}
		}
		this.pos = afterOpenTicks;
		block.append(text(ticks));
		return true;
	}

	scanDelims(c) {
		const start = this.pos;
		let n = 0;
		while (this.subject[this.pos] === c) {
			n++;
			this.pos++;
		}
		if (n === 0) return null;
		const before = start === 0 ? "\n" : charBefore(this.subject, start);
		const after =
			this.pos >= this.subject.length ? "\n" : charAt(this.subject, this.pos);
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
		let canOpen;
		let canClose;
		if (c === "_") {
			canOpen = left && (!right || beforeIsPunctuation);
			canClose = right && (!left || afterIsPunctuation);
		} else {
			canOpen = left;
			canClose = right;
		}
		this.pos = start;
		return { n, canOpen, canClose };
	}

	handleDelim(c, block) {
		const res = this.scanDelims(c);
		if (!res) return false;
		const start = this.pos;
		this.pos += res.n;
		const node = block.append(text(this.subject.slice(start, this.pos)));
		if ((res.canOpen || res.canClose) && (c !== "~" || res.n <= 2)) {
			this.delimiters = {
				cc: c,
				numdelims: res.n,
				origdelims: res.n,
				node,
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
			const oldCloser = closer;
			if (found) {
				const use =
					cc === "~"
						? closer.numdelims
						: closer.numdelims >= 2 && opener.numdelims >= 2
							? 2
							: 1;
				const openerInl = opener.node;
				const closerInl = closer.node;
				opener.numdelims -= use;
				closer.numdelims -= use;
				openerInl.literal = openerInl.literal.slice(
					0,
					openerInl.literal.length - use,
				);
				closerInl.literal = closerInl.literal.slice(
					0,
					closerInl.literal.length - use,
				);
				const type = cc === "~" ? "del" : use === 1 ? "emph" : "strong";
				const wrap = new Node(type);
				openerInl.moveFollowingInto(wrap, closerInl);
				openerInl.insertAfter(wrap);
				if (opener.next !== closer) {
					opener.next = closer;
					closer.previous = opener;
				}
				if (opener.numdelims === 0) {
					openerInl.unlink();
					this.removeDelimiter(opener);
				}
				if (closer.numdelims === 0) {
					closerInl.unlink();
					const next = closer.next;
					this.removeDelimiter(closer);
					closer = next;
				}
			} else {
				closer = closer.next;
				openersBottom.set(key, oldCloser.previous);
				if (!oldCloser.canOpen) this.removeDelimiter(oldCloser);
			}
		}
		while (this.delimiters !== null && this.delimiters !== stackBottom)
			this.removeDelimiter(this.delimiters);
	}

	addBracket(node, index, image) {
		if (this.brackets !== null) this.brackets.bracketAfter = true;
		this.brackets = {
			node,
			previous: this.brackets,
			previousDelimiter: this.delimiters,
			index,
			image,
			active: true,
			bracketAfter: false,
		};
	}

	removeBracket() {
		this.brackets = this.brackets.previous;
	}

	parseOpenBracket(block) {
		const start = this.pos;
		this.pos += 1;
		this.addBracket(block.append(text("[")), start, false);
		return true;
	}

	parseBang(block) {
		const start = this.pos;
		this.pos += 1;
		if (this.peek() === "[") {
			this.pos += 1;
			this.addBracket(block.append(text("![")), start + 1, true);
		} else {
			block.append(text("!"));
		}
		return true;
	}

	parseCloseBracket(block) {
		this.pos += 1;
		const start = this.pos;
		const opener = this.brackets;
		if (opener === null) {
			block.append(text("]"));
			return true;
		}
		if (!opener.active) {
			block.append(text("]"));
			this.removeBracket();
			return true;
		}
		const isImage = opener.image;
		const savepos = this.pos;
		let dest = null;
		let title = null;
		let matched = false;
		const inline = this.peek() === "(" ? this.parseInlineLink() : null;
		if (inline !== null) {
			({ dest, title } = inline);
			matched = true;
		} else {
			this.pos = savepos;
		}
		if (!matched) {
			const beforeLabel = this.pos;
			const n = this.parseLinkLabel();
			let reflabel = null;
			if (n > 2) reflabel = this.subject.slice(beforeLabel, beforeLabel + n);
			else if (!opener.bracketAfter)
				reflabel = this.subject.slice(opener.index, start);
			if (n === 0) this.pos = savepos;
			if (reflabel !== null) {
				const ref = this.refmap.get(normalizeLabel(reflabel));
				if (ref) {
					dest = ref.destination;
					title = ref.title;
					matched = true;
				}
			}
		}
		if (!matched) {
			this.removeBracket();
			this.pos = start;
			block.append(text("]"));
			return true;
		}
		const node = new Node(isImage ? "image" : "link", {
			destination: dest,
			title: title ?? "",
		});
		opener.node.moveFollowingInto(node);
		block.append(node);
		this.processEmphasis(opener.previousDelimiter);
		this.removeBracket();
		opener.node.unlink();
		if (!isImage) {
			for (let o = this.brackets; o !== null; o = o.previous)
				if (!o.image) o.active = false;
		}
		return true;
	}

	parseLinkTitle() {
		const title = this.match(reLinkTitle);
		if (title === null) return null;
		return unescapeString(title.slice(1, -1), this.decodeName);
	}

	/** The ( destination title ) of an inline link here, past it, or null (the position then left anywhere). */
	parseInlineLink() {
		this.pos += 1;
		this.spnl();
		const dest = this.parseLinkDestination();
		if (dest === null) return null;
		this.spnl();
		let title = null;
		if (reWhitespaceChar.test(this.subject[this.pos - 1]))
			title = this.parseLinkTitle();
		this.spnl();
		if (this.peek() !== ")") return null;
		this.pos += 1;
		return { dest, title };
	}

	parseLinkDestination() {
		const braced = this.match(reLinkDestinationBraces);
		if (braced !== null)
			return normalizeURI(unescapeString(braced.slice(1, -1), this.decodeName));
		if (this.peek() === "<") return null;
		const savepos = this.pos;
		let openparens = 0;
		let c = this.peek();
		for (; c !== undefined; c = this.peek()) {
			if (c === "\\" && reEscapable.test(this.subject[this.pos + 1] ?? "")) {
				this.pos += 2;
			} else if (c === "(") {
				// the spec lets an implementation limit the nesting (at least 3); 32 keeps this linear
				if (openparens === 32) return null;
				this.pos += 1;
				openparens += 1;
			} else if (c === ")") {
				if (openparens < 1) break;
				this.pos += 1;
				openparens -= 1;
			} else if (reControlOrSpace.test(c)) {
				break;
			} else {
				this.pos += 1;
			}
		}
		if (this.pos === savepos && c !== ")") return null;
		if (openparens !== 0) return null;
		return normalizeURI(
			unescapeString(this.subject.slice(savepos, this.pos), this.decodeName),
		);
	}

	parseLinkLabel() {
		const m = this.match(reLinkLabel);
		return m === null || m.length > 1001 ? 0 : m.length;
	}

	parseAutolink(block) {
		let m = this.match(reEmailAutolink);
		if (m !== null) {
			const dest = m.slice(1, -1);
			const link = new Node("link", {
				destination: normalizeURI(`mailto:${dest}`),
				title: "",
			});
			link.append(text(dest));
			block.append(link);
			return true;
		}
		m = this.match(reAutolink);
		if (m !== null) {
			const dest = m.slice(1, -1);
			const link = new Node("link", {
				destination: normalizeURI(dest),
				title: "",
			});
			link.append(text(dest));
			block.append(link);
			return true;
		}
		return false;
	}

	parseHtmlTag(block) {
		const m = this.match(reHtmlTag);
		if (m === null) return false;
		block.append(new Node("html_inline", { literal: m }));
		return true;
	}

	parseEntity(block) {
		reEntityHere.lastIndex = this.pos;
		const m = reEntityHere.exec(this.subject);
		if (m === null) return false;
		const decoded = decodeEntity(m[0], this.decodeName);
		if (decoded === null) return false;
		this.pos += m[0].length;
		block.append(text(decoded));
		return true;
	}

	parseString(block) {
		const m = this.match(reMain);
		if (m === null) return false;
		block.append(text(m));
		return true;
	}

	/** An extended www autolink starting here (GFM's www_match). */
	parseWww(block) {
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
		const link = new Node("link", {
			destination: normalizeURI(`http://${url}`),
			title: "",
		});
		link.append(text(url));
		block.append(link);
		this.pos += end;
		return true;
	}

	/** An extended url autolink whose scheme was just read, at its ":" (GFM's url_match). */
	parseUrl(block) {
		if (!this.autolink || this.brackets !== null) return false;
		const s = this.subject;
		const p = this.pos;
		if (s[p + 1] !== "/" || s[p + 2] !== "/") return false;
		const last = block.lastChild;
		if (last?.type !== "text") return false;
		let rewind = 0;
		while (
			rewind < last.literal.length &&
			isAsciiAlpha(last.literal[last.literal.length - rewind - 1])
		)
			rewind++;
		const scheme = last.literal
			.slice(last.literal.length - rewind)
			.toLowerCase();
		if (!["http", "https", "ftp"].includes(scheme)) return false;
		const data = s.slice(p + 3, runEnd(s, p + 3));
		if (!isAsciiAlnum(data[0])) return false;
		const domain = checkDomain(data, true);
		if (domain === 0) return false;
		const end = autolinkEnd(data, domain);
		if (end === 0) return false;
		const schemeText = last.literal.slice(last.literal.length - rewind);
		last.literal = last.literal.slice(0, last.literal.length - rewind);
		if (last.literal === "") last.unlink();
		const url = `${schemeText}://${data.slice(0, end)}`;
		const link = new Node("link", {
			destination: normalizeURI(url),
			title: "",
		});
		link.append(text(url));
		block.append(link);
		this.pos = p + 3 + end;
		return true;
	}
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

/** Join the adjacent text nodes of root's subtree. */
function mergeText(root) {
	for (const node of walk(root)) {
		for (let n = node.firstChild; n !== null; n = n.next) {
			while (n.type === "text" && n.next?.type === "text") {
				n.literal += n.next.literal;
				n.next.unlink();
			}
		}
	}
}

/** Turn the email addresses in the text of root's subtree into links, outside links and images (GFM's postprocess). */
function autolinkEmails(root) {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node.type === "link" || node.type === "image") continue;
		for (let n = node.firstChild; n !== null; ) {
			const next = n.next;
			if (n.type === "text" && n.literal.includes("@")) {
				const parts = splitEmails(n.literal);
				if (parts.length !== 1 || parts[0].type !== "text") {
					let at = n;
					for (const p of parts) {
						at.insertAfter(p);
						at = p;
					}
					n.unlink();
				}
			} else if (n.firstChild !== null) {
				stack.push(n);
			}
			n = next;
		}
	}
}

/** The text s as text nodes and email links. */
function splitEmails(s) {
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
		if (start > from) nodes.push(text(s.slice(from, start)));
		const addr = s.slice(start, at + end);
		const link = new Node("link", {
			destination: normalizeURI(`mailto:${addr}`),
			title: "",
		});
		link.append(text(addr));
		nodes.push(link);
		from = at + end;
		at = s.indexOf("@", from);
	}
	if (from < s.length) nodes.push(text(s.slice(from)));
	return nodes;
}

/**
 * Read a link reference definition at the start of s into refmap; the number of characters it takes, or 0 when s does
 * not start with one.
 */
export function parseReference(s, refmap, decodeName) {
	const p = new InlineParser(decodeName);
	p.subject = s;
	p.pos = 0;
	const n = p.parseLinkLabel();
	if (n === 0) return 0;
	const rawlabel = s.slice(0, n);
	if (p.peek() !== ":") return 0;
	p.pos += 1;
	p.spnl();
	const dest = p.parseLinkDestination();
	if (dest === null) return 0;
	const beforeTitle = p.pos;
	p.spnl();
	let title = null;
	if (p.pos !== beforeTitle) title = p.parseLinkTitle();
	if (title === null) {
		title = "";
		p.pos = beforeTitle;
	}
	let atLineEnd = true;
	if (p.match(reSpaceAtEndOfLine) === null) {
		if (title === "") atLineEnd = false;
		else {
			title = "";
			p.pos = beforeTitle;
			atLineEnd = p.match(reSpaceAtEndOfLine) !== null;
		}
	}
	if (!atLineEnd) return 0;
	const label = normalizeLabel(rawlabel);
	if (label === "") return 0;
	if (!refmap.has(label)) refmap.set(label, { destination: dest, title });
	return p.pos;
}
