// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The test side of LCTYSP-1025: the examples of tests/gfm/spec.txt, the named character references of
// tests/gfm/entities.json, and a document tree written as GFM's reference HTML (the HTML of the spec's examples, as
// cmark-gfm writes it with every extension on). The reference HTML is for the tests only: the pages write the HTML of
// LCTYSP-0017 instead.

import { readFileSync } from "node:fs";
import { publicUrl } from "./node-unit.js";

const {
	ALIGNS,
	BLOCK_NAMES,
	BLOCK_QUOTE,
	blockLines,
	CODE_BLOCK,
	B_A,
	B_C,
	B_D,
	B_STR,
	DOCUMENT,
	F_AT,
	F_FIRST,
	F_NEXT,
	F_PARENT,
	HEADING,
	HTML_BLOCK,
	ITEM,
	LIST,
	PARAGRAPH,
	TABLE,
	THEMATIC_BREAK,
} = await import(publicUrl("js/convert/gfm/gfm_blocks.js"));
const {
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
} = await import(publicUrl("js/convert/gfm/gfm_inlines.js"));

const GFM = new URL("../gfm/", import.meta.url);

/** The examples of spec.txt: { number, section, extension, markdown, html }, → read as a tab as the spec says. */
export function specExamples() {
	const lines = readFileSync(new URL("spec.txt", GFM), "utf8").split("\n");
	const examples = [];
	const fence = "`".repeat(32);
	let section = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const heading = line.match(/^#{1,6} (.*)$/);
		if (heading) section = heading[1];
		if (!line.startsWith(`${fence} example`)) continue;
		const extension = line.slice(`${fence} example`.length).trim();
		const md = [];
		const html = [];
		let part = md;
		for (i++; lines[i] !== fence; i++) {
			if (lines[i] === "." && part === md) part = html;
			else part.push(lines[i]);
		}
		const join = (ls) =>
			(ls.length ? `${ls.join("\n")}\n` : "").replace(/→/g, "\t");
		examples.push({
			number: examples.length + 1,
			section,
			extension,
			markdown: join(md),
			html: join(html),
		});
	}
	return examples;
}

let names = null;

/** The text of &name; from entities.json, or null when the HTML Standard has no such name. */
export function decodeNameFromTable(name) {
	if (names === null) {
		const table = JSON.parse(
			readFileSync(new URL("entities.json", GFM), "utf8"),
		);
		names = new Map();
		for (const [k, v] of Object.entries(table))
			if (k.endsWith(";")) names.set(k.slice(1, -1), v.characters);
	}
	return names.get(name) ?? null;
}

const escapeXml = (s) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const TAGFILTER =
	/<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[\s>]|\/>|$))/gi;

/** Raw HTML as GFM's tagfilter extension writes it: < of the disallowed tags as &lt;. */
const tagfilter = (s) => s.replace(TAGFILTER, "&lt;");

/**
 * The document doc ({ nodes, spans }, as parseGfm gives it), parsed from source, as GFM's reference HTML, or its block
 * at row when row is given. options.tagfilter (true by default) writes raw HTML through the tagfilter extension. As
 * cmark-gfm does, a strong right inside a strong writes no tags of its own.
 */
export function referenceHtml(
	doc,
	source,
	{ tagfilter: filter = true } = {},
	row = 0,
) {
	const raw = filter ? tagfilter : (s) => s;
	const t = doc.nodes;
	const n = t.i32;
	const type = (i) => n[i << 3] & 0xff;
	const slot = (i, f) => n[(i << 3) + f];
	// a block's own field
	const field = (i, f) => t.b32[(i << 3) + f];
	const textOf = (i) => inlineText(source, t, doc.spans, i);
	const lines = (i) => blockLines(source, t, doc.spans, i);
	let out = "";
	const cr = () => {
		if (out !== "" && !out.endsWith("\n")) out += "\n";
	};
	const plain = (i) => {
		let s = "";
		for (let c = slot(i, F_FIRST); c !== -1; c = slot(c, F_NEXT)) {
			const ty = type(c);
			if (ty === TEXT || ty === CODE || ty === HTML_INLINE) s += textOf(c);
			else if (ty === SOFTBREAK || ty === LINEBREAK) s += "\n";
			else s += plain(c);
		}
		return s;
	};
	// a paragraph in an item of a tight list writes no <p>
	const tight = (i) => {
		const item = slot(i, F_PARENT);
		const list = item === -1 ? -1 : slot(item, F_PARENT);
		return list !== -1 && type(list) === LIST && field(list, B_D) === 1;
	};
	// a leaf's children are its inlines, a container's its blocks
	const children = (i) => {
		for (let c = slot(i, F_FIRST); c !== -1; c = slot(c, F_NEXT)) node(c);
	};
	const node = (i) => {
		const ty = type(i);
		switch (ty) {
			case DOCUMENT:
				children(i);
				break;
			case PARAGRAPH:
				if (tight(i)) children(i);
				else {
					cr();
					out += "<p>";
					children(i);
					out += "</p>";
					cr();
				}
				break;
			case HEADING:
				cr();
				out += `<h${field(i, B_A)}>`;
				children(i);
				out += `</h${field(i, B_A)}>`;
				cr();
				break;
			case BLOCK_QUOTE:
				cr();
				out += "<blockquote>";
				cr();
				children(i);
				cr();
				out += "</blockquote>";
				cr();
				break;
			case LIST: {
				const tag = field(i, B_A) === 1 ? "ol" : "ul";
				const start = field(i, B_C);
				cr();
				out +=
					tag === "ol" && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
				cr();
				children(i);
				cr();
				out += `</${tag}>`;
				cr();
				break;
			}
			case ITEM:
				out += "<li>";
				if (field(i, B_C) === 2)
					out += '<input checked="" disabled="" type="checkbox"> ';
				if (field(i, B_C) === 1) out += '<input disabled="" type="checkbox"> ';
				children(i);
				out += "</li>";
				cr();
				break;
			case CODE_BLOCK: {
				cr();
				const info = field(i, B_STR) === -1 ? "" : t.strings[field(i, B_STR)];
				const lang = info.split(/[ \t\n]+/)[0];
				out += lang
					? `<pre><code class="language-${escapeXml(lang)}">`
					: "<pre><code>";
				out += `${escapeXml(
					lines(i)
						.map((l) => `${l}\n`)
						.join(""),
				)}</code></pre>`;
				cr();
				break;
			}
			case HTML_BLOCK:
				cr();
				out += raw(lines(i).join("\n"));
				cr();
				break;
			case THEMATIC_BREAK:
				cr();
				out += "<hr />";
				cr();
				break;
			case TABLE: {
				cr();
				out += "<table>\n<thead>\n";
				const tr = (r, tag) => {
					out += "<tr>\n";
					for (
						let cell = slot(r, F_FIRST);
						cell !== -1;
						cell = slot(cell, F_NEXT)
					) {
						const align = ALIGNS[field(cell, B_A)];
						out += align ? `<${tag} align="${align}">` : `<${tag}>`;
						children(cell);
						out += `</${tag}>\n`;
					}
					out += "</tr>\n";
				};
				const head = slot(i, F_FIRST);
				tr(head, "th");
				out += "</thead>\n";
				if (slot(head, F_NEXT) !== -1) {
					out += "<tbody>\n";
					for (let r = slot(head, F_NEXT); r !== -1; r = slot(r, F_NEXT))
						tr(r, "td");
					out += "</tbody>\n";
				}
				out += "</table>\n";
				break;
			}
			case TEXT:
				out += escapeXml(textOf(i));
				break;
			case SOFTBREAK:
				out += "\n";
				break;
			case LINEBREAK:
				out += "<br />\n";
				break;
			case CODE:
				out += `<code>${escapeXml(textOf(i))}</code>`;
				break;
			case HTML_INLINE:
				out += raw(textOf(i));
				break;
			case EMPH:
			case STRONG:
			case DEL: {
				if (ty === STRONG && type(slot(i, F_PARENT)) === STRONG) {
					children(i);
					break;
				}
				const tag = ty === EMPH ? "em" : ty === STRONG ? "strong" : "del";
				out += `<${tag}>`;
				children(i);
				out += `</${tag}>`;
				break;
			}
			case LINK:
			case IMAGE: {
				const k = slot(i, F_AT);
				const title = t.strings[k + 1];
				if (ty === LINK) {
					out += `<a href="${escapeXml(t.strings[k])}"`;
					if (title) out += ` title="${escapeXml(title)}"`;
					out += ">";
					children(i);
					out += "</a>";
				} else {
					out += `<img src="${escapeXml(t.strings[k])}" alt="${escapeXml(plain(i))}"`;
					if (title) out += ` title="${escapeXml(title)}"`;
					out += " />";
				}
				break;
			}
			default:
				throw new Error(
					`no reference HTML for ${ty >= TEXT ? INLINE_NAMES[ty - TEXT] : BLOCK_NAMES[ty]}`,
				);
		}
	};
	node(row);
	return out;
}

// The tokens of an HTML string of LCTYSP-0017's one form: a tag (its slash, name and attributes) or text
const reToken =
	/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
const attrsOf = (s) =>
	Object.fromEntries(
		[...s.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
	);

// The elements and attributes of LCTYSP-0017's "Nothing else", each attribute with the values it may take (null: any)
const ALLOWED = {
	p: {},
	br: {},
	hr: {},
	h1: {},
	h2: {},
	h3: {},
	h4: {},
	h5: {},
	h6: {},
	blockquote: {},
	ul: {},
	li: {},
	pre: {},
	table: {},
	thead: {},
	tbody: {},
	tr: {},
	strong: {},
	em: {},
	del: {},
	ol: { start: null },
	code: { "data-lang": null },
	th: { class: ["align-left", "align-center", "align-right"] },
	td: { class: ["align-left", "align-center", "align-right"] },
	a: { href: null, target: ["_blank"], rel: ["noopener noreferrer"] },
	div: { class: ["codeblock", "codebar", "table-wrap"] },
	span: { class: ["lang", "task", "task done"] },
	button: { type: ["button"], class: ["select", "suggestion"] },
};

/** What is wrong with html as LCTYSP-0017's output: elements, attributes or nesting, as messages. */
export function problemsOf(html) {
	const problems = [];
	const stack = [];
	for (const t of html.matchAll(reToken)) {
		if (t[4] !== undefined) continue;
		const tag = t[2];
		if (!(tag in ALLOWED)) problems.push(`element ${tag}`);
		if (t[1] === "/") {
			if (stack.pop() !== tag) problems.push(`</${tag}> out of order`);
			continue;
		}
		for (const [name, value] of Object.entries(attrsOf(t[3]))) {
			const values = ALLOWED[tag]?.[name];
			if (values === undefined) problems.push(`attribute ${tag}[${name}]`);
			else if (values !== null && !values.includes(value))
				problems.push(`${tag}[${name}="${value}"]`);
		}
		if (tag !== "br" && tag !== "hr") stack.push(tag);
	}
	if (stack.length > 0) problems.push(`unclosed ${stack.join(" ")}`);
	return problems;
}
