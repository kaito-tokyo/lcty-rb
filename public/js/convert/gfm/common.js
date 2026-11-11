// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// What the block and inline parsers of GFM 0.29-gfm share (LCTYSP-0017): the tree's nodes, backslash escapes,
// character references, link labels, link destinations and the grammar of HTML tags.

/**
 * A node of the document tree. type is one of the GFM names (paragraph, list, emph, …); the rest depends on it. The
 * children are a linked list, so moving a run of them (into an emphasis, a link) costs only the run.
 */
export class Node {
	constructor(type, props = {}) {
		this.type = type;
		this.parent = null;
		this.firstChild = null;
		this.lastChild = null;
		this.prev = null;
		this.next = null;
		Object.assign(this, props);
	}

	/** Add child as the last child (taking it out of where it was). */
	append(child) {
		child.unlink();
		child.parent = this;
		child.prev = this.lastChild;
		if (this.lastChild) this.lastChild.next = child;
		else this.firstChild = child;
		this.lastChild = child;
		return child;
	}

	/** Take this node out of its parent. */
	unlink() {
		if (this.prev) this.prev.next = this.next;
		else if (this.parent) this.parent.firstChild = this.next;
		if (this.next) this.next.prev = this.prev;
		else if (this.parent) this.parent.lastChild = this.prev;
		this.parent = null;
		this.prev = null;
		this.next = null;
	}

	/** Put node right after this one, in the same parent. */
	insertAfter(node) {
		node.unlink();
		node.parent = this.parent;
		node.prev = this;
		node.next = this.next;
		if (this.next) this.next.prev = node;
		else if (this.parent) this.parent.lastChild = node;
		this.next = node;
	}

	/** Move the siblings after this node, up to (not including) end or to the last, into node. */
	moveFollowingInto(node, end = null) {
		for (let n = this.next; n !== null && n !== end; ) {
			const next = n.next;
			node.append(n);
			n = next;
		}
	}

	/** The children, in order, as an array. */
	get children() {
		const out = [];
		for (let n = this.firstChild; n !== null; n = n.next) out.push(n);
		return out;
	}

	/** Replace the children with nodes, in order. */
	set children(nodes) {
		this.firstChild = null;
		this.lastChild = null;
		for (const n of nodes) {
			n.parent = null;
			n.prev = null;
			n.next = null;
			this.append(n);
		}
	}
}

/** Each node of root's subtree once, parents before their children (no recursion, so any depth). */
export function* walk(root) {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		yield node;
		for (let n = node.lastChild; n !== null; n = n.prev) stack.push(n);
	}
}

export const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";
const reBackslashOrAmp = /[\\&]/;
const reEntityOrEscape = new RegExp(
	`\\\\${ESCAPABLE}|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});`,
	"g",
);
/** A character reference, matched where the parser is (sticky). */
export const reEntityHere =
	/&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;

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

const URL_SAFE = /[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]/;

/** A link destination percent-encoded as GFM's reference writes it: %XX already there is kept. */
export function normalizeURI(uri) {
	let out = "";
	for (let i = 0; i < uri.length; i++) {
		const c = uri[i];
		if (c === "%" && /^[0-9a-fA-F]{2}$/.test(uri.slice(i + 1, i + 3))) {
			out += uri.slice(i, i + 3);
			i += 2;
		} else if (URL_SAFE.test(c)) {
			out += c;
		} else {
			const code = uri.codePointAt(i);
			if (code > 0xffff) {
				out += encodeURIComponent(String.fromCodePoint(code));
				i++;
			} else if (code >= 0xd800 && code <= 0xdfff) {
				out += "%EF%BF%BD";
			} else {
				out += encodeURIComponent(c);
			}
		}
	}
	return out;
}

// The grammar of HTML tags (the spec's "Raw HTML")
const TAGNAME = "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
const ATTRIBUTEVALUE = `(?:${UNQUOTEDVALUE}|'[^']*'|"[^"]*")`;
const ATTRIBUTEVALUESPEC = `(?:\\s*=\\s*${ATTRIBUTEVALUE})`;
const ATTRIBUTE = `(?:\\s+${ATTRIBUTENAME}${ATTRIBUTEVALUESPEC}?)`;
export const OPENTAG = `<${TAGNAME}${ATTRIBUTE}*\\s*/?>`;
export const CLOSETAG = `</${TAGNAME}\\s*[>]`;
const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->";
const PROCESSINGINSTRUCTION = "[<][?][\\s\\S]*?[?][>]";
const DECLARATION = "<![A-Z]+\\s+[^>]*>";
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
/** An HTML tag of the spec, matched where the parser is (sticky). */
export const reHtmlTag = new RegExp(
	`(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSINGINSTRUCTION}|${DECLARATION}|${CDATA})`,
	"y",
);

/** Unicode whitespace of the spec: Zs, tab, LF, FF, CR. */
export const reUnicodeWhitespaceChar = /^[\t\n\f\r\p{Zs}]/u;
/** ASCII or Unicode punctuation of the spec (0.29: P* categories, plus the ASCII symbols). */
export const rePunctuation = /^[\p{P}!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/u;
