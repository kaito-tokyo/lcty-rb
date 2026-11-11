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
	DOCUMENT,
	BLOCK_QUOTE,
	LIST,
	ITEM,
	PARAGRAPH,
	HEADING,
	CODE_BLOCK,
	HTML_BLOCK,
	THEMATIC_BREAK,
	TABLE,
} = await import(publicUrl("js/convert/gfm/gfm_blocks.js"));
const {
	TEXT,
	SOFTBREAK,
	LINEBREAK,
	CODE,
	HTML_INLINE,
	EMPH,
	STRONG,
	DEL,
	LINK,
	IMAGE,
	TYPE_NAMES,
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
 * The document tree doc as GFM's reference HTML. options.tagfilter (true by default) writes raw HTML through the
 * tagfilter extension. As cmark-gfm does, a strong right inside a strong writes no tags of its own.
 */
export function referenceHtml(doc, { tagfilter: filter = true } = {}) {
	const raw = filter ? tagfilter : (s) => s;
	let out = "";
	const cr = () => {
		if (out !== "" && !out.endsWith("\n")) out += "\n";
	};
	const plain = (node) =>
		node.children
			.map((n) =>
				n.type === TEXT || n.type === CODE || n.type === HTML_INLINE
					? n.view.join("")
					: n.type === SOFTBREAK || n.type === LINEBREAK
						? "\n"
						: plain(n),
			)
			.join("");
	const tight = (node) =>
		node.parent?.parent?.type === LIST && node.parent.parent.data.tight;
	const render = (node) => {
		const kids = () => {
			for (const c of node.children) render(c);
		};
		switch (node.type) {
			case DOCUMENT:
				kids();
				break;
			case PARAGRAPH:
				if (tight(node)) kids();
				else {
					cr();
					out += "<p>";
					kids();
					out += "</p>";
					cr();
				}
				break;
			case HEADING:
				cr();
				out += `<h${node.data.level}>`;
				kids();
				out += `</h${node.data.level}>`;
				cr();
				break;
			case BLOCK_QUOTE:
				cr();
				out += "<blockquote>";
				cr();
				kids();
				cr();
				out += "</blockquote>";
				cr();
				break;
			case LIST: {
				const d = node.data;
				const tag = d.type === "bullet" ? "ul" : "ol";
				cr();
				out +=
					tag === "ol" && d.start !== 1
						? `<ol start="${d.start}">`
						: `<${tag}>`;
				cr();
				kids();
				cr();
				out += `</${tag}>`;
				cr();
				break;
			}
			case ITEM:
				out += "<li>";
				if (node.data.task === "checked")
					out += '<input checked="" disabled="" type="checkbox"> ';
				if (node.data.task === "unchecked")
					out += '<input disabled="" type="checkbox"> ';
				kids();
				out += "</li>";
				cr();
				break;
			case CODE_BLOCK: {
				cr();
				const lang = node.data.info.split(/[ \t\n]+/)[0];
				out += lang
					? `<pre><code class="language-${escapeXml(lang)}">`
					: "<pre><code>";
				out += `${escapeXml(node.view.map((l) => `${l}\n`).join(""))}</code></pre>`;
				cr();
				break;
			}
			case HTML_BLOCK:
				cr();
				out += raw(node.view.join("\n"));
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
				const [head, ...rows] = node.children;
				const row = (r, tag) => {
					out += "<tr>\n";
					for (const cell of r.children) {
						out += cell.data.align
							? `<${tag} align="${cell.data.align}">`
							: `<${tag}>`;
						for (const c of cell.children) render(c);
						out += `</${tag}>\n`;
					}
					out += "</tr>\n";
				};
				row(head, "th");
				out += "</thead>\n";
				if (rows.length) {
					out += "<tbody>\n";
					for (const r of rows) row(r, "td");
					out += "</tbody>\n";
				}
				out += "</table>\n";
				break;
			}
			case TEXT:
				out += escapeXml(node.view.join(""));
				break;
			case SOFTBREAK:
				out += "\n";
				break;
			case LINEBREAK:
				out += "<br />\n";
				break;
			case CODE:
				out += `<code>${escapeXml(node.view.join(""))}</code>`;
				break;
			case HTML_INLINE:
				out += raw(node.view.join("\n"));
				break;
			case EMPH:
			case STRONG:
			case DEL: {
				if (node.type === STRONG && node.parent?.type === STRONG) {
					kids();
					break;
				}
				const tag =
					node.type === EMPH ? "em" : node.type === STRONG ? "strong" : "del";
				out += `<${tag}>`;
				kids();
				out += `</${tag}>`;
				break;
			}
			case LINK:
				out += `<a href="${escapeXml(node.data.destination)}"`;
				if (node.data.title) out += ` title="${escapeXml(node.data.title)}"`;
				out += ">";
				kids();
				out += "</a>";
				break;
			case IMAGE:
				out += `<img src="${escapeXml(node.data.destination)}" alt="${escapeXml(plain(node))}"`;
				if (node.data.title) out += ` title="${escapeXml(node.data.title)}"`;
				out += " />";
				break;
			default:
				throw new Error(`no reference HTML for ${TYPE_NAMES[node.type]}`);
		}
	};
	render(doc);
	return out;
}
