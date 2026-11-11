// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The committed converter: a committed block of the shared tables as LCTYSP-0017's output (committed.d.ts).

import {
	ALIGNS,
	B_A,
	B_C,
	B_D,
	B_STR,
	BLOCK_QUOTE,
	blockLines,
	CODE_BLOCK,
	DOCUMENT,
	F_AT,
	F_FIRST,
	F_NEXT,
	F_OFFSET,
	F_PARENT,
	HEADING,
	HTML_BLOCK,
	ITEM,
	LIST,
	leafText,
	PARAGRAPH,
	TABLE,
	TABLE_CELL,
	TABLE_HEAD,
	TABLE_ROW,
	THEMATIC_BREAK,
} from "./gfm_blocks.js";
import {
	CODE,
	DEL,
	EMPH,
	HTML_INLINE,
	IMAGE,
	INLINE_NAMES,
	inlineText,
	LINEBREAK,
	LINK,
	SOFTBREAK,
	STRONG,
	TEXT,
} from "./gfm_inlines.js";

const SUGGESTION_OPEN = "<suggestion-for-user-turn>";
const SUGGESTION_CLOSE = "</suggestion-for-user-turn>";
const LINK_ATTRS = ["target", "_blank", "rel", "noopener noreferrer"];
const reAllowedUrl = /^(?:https?|mailto):/i;

/** Text escaped for an element's content. */
const escapeText = (s) =>
	/[&<>]/.test(s)
		? s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
		: s;

/** Text escaped for an attribute's value. */
const escapeAttr = (s) => escapeText(s).replaceAll('"', "&quot;");

/** A sink that writes the output as HTML in LCTYSP-0017's one form. */
export class HtmlSink {
	constructor() {
		this.html = "";
	}

	start(tag, attrs = null) {
		let s = `<${tag}`;
		if (attrs !== null)
			for (let i = 0; i < attrs.length; i += 2)
				s += ` ${attrs[i]}="${escapeAttr(attrs[i + 1])}"`;
		this.html += `${s}>`;
	}

	empty(tag) {
		this.html += `<${tag}>`;
	}

	text(s) {
		this.html += escapeText(s);
	}

	end(tag) {
		this.html += `</${tag}>`;
	}
}

/** A sink that builds the output as DOM nodes, appended to parent. */
export class DomSink {
	constructor(parent) {
		this.document = parent.ownerDocument;
		this.stack = [parent];
		this.top = parent;
	}

	start(tag, attrs = null) {
		const e = this.document.createElement(tag);
		if (attrs !== null)
			for (let i = 0; i < attrs.length; i += 2)
				e.setAttribute(attrs[i], attrs[i + 1]);
		this.top.append(e);
		this.stack.push(e);
		this.top = e;
	}

	empty(tag) {
		this.top.append(this.document.createElement(tag));
	}

	text(s) {
		if (s !== "") this.top.append(s);
	}

	end() {
		this.stack.pop();
		this.top = this.stack[this.stack.length - 1];
	}
}

/** Write node, a committed block of doc (or the document, row 0), into sink as LCTYSP-0017's output. */
export function writeCommitted(doc, node, sink) {
	new Writer(doc, sink).node(node);
}

class Writer {
	constructor({ source, nodes, spans, selectAll = "Select all" }, sink) {
		this.source = source;
		this.nodes = nodes;
		this.spans = spans;
		this.selectAll = selectAll;
		this.sink = sink;
		// links being written around the node, as a link inside one is its text
		this.inLink = 0;
	}

	type(i) {
		return this.nodes.i32[i << 3] & 0xff;
	}

	slot(i, f) {
		return this.nodes.i32[(i << 3) + f];
	}

	field(i, f) {
		return this.nodes.b32[(i << 3) + f];
	}

	children(i) {
		for (let c = this.slot(i, F_FIRST); c !== -1; c = this.slot(c, F_NEXT))
			this.node(c);
	}

	node(i) {
		const s = this.sink;
		const ty = this.type(i);
		switch (ty) {
			case DOCUMENT:
			case TABLE_CELL:
				this.children(i);
				break;
			case PARAGRAPH: {
				// in an item of a tight list, its inlines alone
				const item = this.slot(i, F_PARENT);
				const list = item === -1 ? -1 : this.slot(item, F_PARENT);
				const tight =
					list !== -1 &&
					this.type(list) === LIST &&
					this.field(list, B_D) === 1;
				if (!tight) s.start("p");
				// a task list item's box is the first inline of its first paragraph
				if (this.type(item) === ITEM && this.slot(item, F_FIRST) === i) {
					const task = this.field(item, B_C);
					if (task !== 0) {
						s.start("span", ["class", task === 2 ? "task done" : "task"]);
						s.text(task === 2 ? "☑" : "☐");
						s.end("span");
						s.text(" ");
					}
				}
				this.inlines(i);
				if (!tight) s.end("p");
				break;
			}
			case HEADING: {
				const tag = `h${this.field(i, B_A)}`;
				s.start(tag);
				this.inlines(i);
				s.end(tag);
				break;
			}
			case BLOCK_QUOTE:
				s.start("blockquote");
				this.children(i);
				s.end("blockquote");
				break;
			case LIST: {
				const ordered = this.field(i, B_A) === 1;
				const start = this.field(i, B_C);
				const tag = ordered ? "ol" : "ul";
				s.start(tag, ordered && start !== 1 ? ["start", String(start)] : null);
				this.children(i);
				s.end(tag);
				break;
			}
			case ITEM:
				s.start("li");
				this.children(i);
				s.end("li");
				break;
			case CODE_BLOCK:
				this.codeBlock(i);
				break;
			case HTML_BLOCK: {
				// its lines as text, each line end a <br>, in one paragraph
				s.start("p");
				const lines = blockLines(this.source, this.nodes, this.spans, i);
				for (let k = 0; k < lines.length; k++) {
					if (k > 0) s.empty("br");
					s.text(lines[k]);
				}
				s.end("p");
				break;
			}
			case THEMATIC_BREAK:
				s.empty("hr");
				break;
			case TABLE:
				this.table(i);
				break;
			default:
				this.inline(i, ty);
		}
	}

	codeBlock(i) {
		const s = this.sink;
		const str = this.field(i, B_STR);
		const info = str === -1 ? "" : this.nodes.strings[str];
		const lang = info.split(/[ \t]/)[0];
		s.start("div", ["class", "codeblock"]);
		s.start("div", ["class", "codebar"]);
		s.start("span", ["class", "lang"]);
		s.text(lang);
		s.end("span");
		s.start("button", ["type", "button", "class", "select"]);
		s.text(this.selectAll);
		s.end("button");
		s.end("div");
		s.start("pre");
		s.start("code", lang === "" ? null : ["data-lang", lang]);
		let code = "";
		for (const line of blockLines(this.source, this.nodes, this.spans, i))
			code += `${line}\n`;
		s.text(code);
		s.end("code");
		s.end("pre");
		s.end("div");
	}

	table(i) {
		const s = this.sink;
		s.start("div", ["class", "table-wrap"]);
		s.start("table");
		let body = false;
		for (let r = this.slot(i, F_FIRST); r !== -1; r = this.slot(r, F_NEXT)) {
			const head = this.type(r) === TABLE_HEAD;
			if (head) s.start("thead");
			else if (!body && this.type(r) === TABLE_ROW) {
				s.start("tbody");
				body = true;
			}
			s.start("tr");
			const tag = head ? "th" : "td";
			for (let c = this.slot(r, F_FIRST); c !== -1; c = this.slot(c, F_NEXT)) {
				const align = ALIGNS[this.field(c, B_A)];
				s.start(tag, align === null ? null : ["class", `align-${align}`]);
				this.inlines(c);
				s.end(tag);
			}
			s.end("tr");
			if (head) s.end("thead");
		}
		if (body) s.end("tbody");
		s.end("table");
		s.end("div");
	}

	/** The inlines of leaf, a suggested next message read from the text between its tags. */
	inlines(leaf) {
		let c = this.slot(leaf, F_FIRST);
		while (c !== -1) {
			if (
				this.type(c) === HTML_INLINE &&
				this.inLink === 0 &&
				this.textOf(c).toLowerCase() === SUGGESTION_OPEN
			)
				c = this.suggestion(leaf, c);
			else {
				this.node(c);
				c = this.slot(c, F_NEXT);
			}
		}
	}

	/** A suggested next message opened by open, a child of leaf; the sibling after what it took. */
	suggestion(leaf, open) {
		// its text is the subject's from the tag to the closing tag, or to the line's end
		const subject = this.subject(leaf);
		const from = this.slot(open, F_OFFSET) + SUGGESTION_OPEN.length;
		let to = subject.length;
		let next = this.slot(open, F_NEXT);
		for (; next !== -1; next = this.slot(next, F_NEXT)) {
			const ty = this.type(next);
			if (ty === SOFTBREAK || ty === LINEBREAK) break;
			if (
				ty === HTML_INLINE &&
				this.textOf(next).toLowerCase() === SUGGESTION_CLOSE
			) {
				to = this.slot(next, F_OFFSET);
				next = this.slot(next, F_NEXT);
				break;
			}
		}
		let text = subject.slice(from, to);
		const nl = text.indexOf("\n");
		if (nl !== -1) text = text.slice(0, nl);
		text = text.trim();
		if (text !== "") {
			this.sink.start("button", ["type", "button", "class", "suggestion"]);
			this.sink.text(text);
			this.sink.end("button");
		}
		return next;
	}

	/** The subject the inline parser read for leaf: its content, trimmed as the parser trims it. */
	subject(leaf) {
		const content = leafText(this.source, this.nodes, this.spans, leaf);
		const edge = (ch) => ch === " " || ch === "\t" || ch === "\n";
		let a = 0;
		let b = content.length;
		while (a < b && edge(content[a])) a++;
		while (b > a && edge(content[b - 1])) b--;
		return content.slice(a, b);
	}

	textOf(i) {
		return inlineText(this.source, this.nodes, this.spans, i);
	}

	inline(i, ty) {
		const s = this.sink;
		switch (ty) {
			case TEXT:
				s.text(this.textOf(i));
				break;
			case CODE:
				s.start("code");
				s.text(this.textOf(i));
				s.end("code");
				break;
			case HTML_INLINE:
				// raw HTML is text
				s.text(this.textOf(i));
				break;
			case SOFTBREAK:
			case LINEBREAK:
				s.empty("br");
				break;
			case EMPH:
			case DEL:
				s.start(ty === EMPH ? "em" : "del");
				this.children(i);
				s.end(ty === EMPH ? "em" : "del");
				break;
			case STRONG:
				// right inside another strong, its contents alone
				if (this.type(this.slot(i, F_PARENT)) === STRONG) this.children(i);
				else {
					s.start("strong");
					this.children(i);
					s.end("strong");
				}
				break;
			case LINK:
			case IMAGE:
				this.link(i, ty);
				break;
			default:
				throw new Error(`no output for ${INLINE_NAMES[ty - TEXT] ?? ty}`);
		}
	}

	link(i, ty) {
		const s = this.sink;
		const destination = this.nodes.strings[this.slot(i, F_AT)];
		const allowed = this.inLink === 0 && reAllowedUrl.test(destination);
		if (allowed) s.start("a", ["href", destination, ...LINK_ATTRS]);
		this.inLink++;
		// an image is a link of its alt text
		if (ty === IMAGE) s.text(this.plain(i));
		else this.children(i);
		this.inLink--;
		if (allowed) s.end("a");
	}

	/** The plain text of i's inlines, as an image's alt text. */
	plain(i) {
		let text = "";
		for (let c = this.slot(i, F_FIRST); c !== -1; c = this.slot(c, F_NEXT)) {
			const ty = this.type(c);
			if (ty === TEXT || ty === CODE || ty === HTML_INLINE)
				text += this.textOf(c);
			else if (ty === SOFTBREAK || ty === LINEBREAK) text += "\n";
			else text += this.plain(c);
		}
		return text;
	}
}
