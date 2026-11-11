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
	DOCUMENT,
	HEADING,
	HTML_BLOCK,
	ITEM,
	LIST,
	PARAGRAPH,
	TABLE,
	THEMATIC_BREAK,
} = await import(publicUrl("js/convert/gfm/gfm_blocks.js"));

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
 * The document doc ({ blocks, ranges, inlines }, as parseGfm gives it), parsed from source, as GFM's reference HTML, or
 * its block at row when row is given. options.tagfilter (true by default) writes raw HTML through the tagfilter
 * extension. As cmark-gfm does, a strong right inside a strong writes no tags of its own.
 */
export function referenceHtml(
	doc,
	source,
	{ tagfilter: filter = true } = {},
	row = 0,
) {
	const raw = filter ? tagfilter : (s) => s;
	const t = doc.blocks;
	let out = "";
	const cr = () => {
		if (out !== "" && !out.endsWith("\n")) out += "\n";
	};
	const plain = (node) =>
		node.children
			.map((n) =>
				n.type === "text" || n.type === "code" || n.type === "html_inline"
					? n.view.join("")
					: n.type === "softbreak" || n.type === "linebreak"
						? "\n"
						: plain(n),
			)
			.join("");
	// a paragraph in an item of a tight list writes no <p>
	const tight = (i) => {
		const item = t.parent[i];
		const list = item === -1 ? -1 : t.parent[item];
		return list !== -1 && t.type[list] === LIST && t.d[list] === 1;
	};
	const inlines = (i) => {
		for (const c of doc.inlines[i].children) render(c);
	};
	const blocks = (i) => {
		for (let c = t.first[i]; c !== -1; c = t.next[c]) block(c);
	};
	const block = (i) => {
		switch (t.type[i]) {
			case DOCUMENT:
				blocks(i);
				break;
			case PARAGRAPH:
				if (tight(i)) inlines(i);
				else {
					cr();
					out += "<p>";
					inlines(i);
					out += "</p>";
					cr();
				}
				break;
			case HEADING:
				cr();
				out += `<h${t.a[i]}>`;
				inlines(i);
				out += `</h${t.a[i]}>`;
				cr();
				break;
			case BLOCK_QUOTE:
				cr();
				out += "<blockquote>";
				cr();
				blocks(i);
				cr();
				out += "</blockquote>";
				cr();
				break;
			case LIST: {
				const tag = t.a[i] === 1 ? "ol" : "ul";
				cr();
				out +=
					tag === "ol" && t.c[i] !== 1 ? `<ol start="${t.c[i]}">` : `<${tag}>`;
				cr();
				blocks(i);
				cr();
				out += `</${tag}>`;
				cr();
				break;
			}
			case ITEM:
				out += "<li>";
				if (t.c[i] === 2)
					out += '<input checked="" disabled="" type="checkbox"> ';
				if (t.c[i] === 1) out += '<input disabled="" type="checkbox"> ';
				blocks(i);
				out += "</li>";
				cr();
				break;
			case CODE_BLOCK: {
				cr();
				const lang = (t.info.get(i) ?? "").split(/[ \t\n]+/)[0];
				out += lang
					? `<pre><code class="language-${escapeXml(lang)}">`
					: "<pre><code>";
				out += `${escapeXml(
					blockLines(source, t, doc.ranges, i)
						.map((l) => `${l}\n`)
						.join(""),
				)}</code></pre>`;
				cr();
				break;
			}
			case HTML_BLOCK:
				cr();
				out += raw(blockLines(source, t, doc.ranges, i).join("\n"));
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
				const row = (r, tag) => {
					out += "<tr>\n";
					for (let cell = t.first[r]; cell !== -1; cell = t.next[cell]) {
						const align = ALIGNS[t.a[cell]];
						out += align ? `<${tag} align="${align}">` : `<${tag}>`;
						inlines(cell);
						out += `</${tag}>\n`;
					}
					out += "</tr>\n";
				};
				const head = t.first[i];
				row(head, "th");
				out += "</thead>\n";
				if (t.next[head] !== -1) {
					out += "<tbody>\n";
					for (let r = t.next[head]; r !== -1; r = t.next[r]) row(r, "td");
					out += "</tbody>\n";
				}
				out += "</table>\n";
				break;
			}
			default:
				throw new Error(`no reference HTML for ${BLOCK_NAMES[t.type[i]]}`);
		}
	};
	const render = (node) => {
		const kids = () => {
			for (const c of node.children) render(c);
		};
		switch (node.type) {
			case "text":
				out += escapeXml(node.view.join(""));
				break;
			case "softbreak":
				out += "\n";
				break;
			case "linebreak":
				out += "<br />\n";
				break;
			case "code":
				out += `<code>${escapeXml(node.view.join(""))}</code>`;
				break;
			case "html_inline":
				out += raw(node.view.join("\n"));
				break;
			case "emph":
			case "strong":
			case "del": {
				if (node.type === "strong" && node.parent?.type === "strong") {
					kids();
					break;
				}
				const tag =
					node.type === "emph"
						? "em"
						: node.type === "strong"
							? "strong"
							: "del";
				out += `<${tag}>`;
				kids();
				out += `</${tag}>`;
				break;
			}
			case "link":
				out += `<a href="${escapeXml(node.data.destination)}"`;
				if (node.data.title) out += ` title="${escapeXml(node.data.title)}"`;
				out += ">";
				kids();
				out += "</a>";
				break;
			case "image":
				out += `<img src="${escapeXml(node.data.destination)}" alt="${escapeXml(plain(node))}"`;
				if (node.data.title) out += ` title="${escapeXml(node.data.title)}"`;
				out += " />";
				break;
			default:
				throw new Error(`no reference HTML for ${node.type}`);
		}
	};
	block(row);
	return out;
}
