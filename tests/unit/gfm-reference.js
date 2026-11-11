// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The test side of LCTYSP-1025: the examples of tests/gfm/spec.txt, the named character references of
// tests/gfm/entities.json, and a document tree written as GFM's reference HTML (the HTML of the spec's examples, as
// cmark-gfm writes it with every extension on). The reference HTML is for the tests only: the pages write the HTML of
// LCTYSP-0017 instead.

import { readFileSync } from "node:fs";

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
				n.type === "text" || n.type === "code" || n.type === "html_inline"
					? n.literal
					: n.type === "softbreak" || n.type === "linebreak"
						? "\n"
						: plain(n),
			)
			.join("");
	const tight = (node) =>
		node.parent?.parent?.type === "list" && node.parent.parent.listData.tight;
	const render = (node) => {
		const kids = () => {
			for (const c of node.children) render(c);
		};
		switch (node.type) {
			case "document":
				kids();
				break;
			case "paragraph":
				if (tight(node)) kids();
				else {
					cr();
					out += "<p>";
					kids();
					out += "</p>";
					cr();
				}
				break;
			case "heading":
				cr();
				out += `<h${node.level}>`;
				kids();
				out += `</h${node.level}>`;
				cr();
				break;
			case "block_quote":
				cr();
				out += "<blockquote>";
				cr();
				kids();
				cr();
				out += "</blockquote>";
				cr();
				break;
			case "list": {
				const d = node.listData;
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
			case "item":
				out += "<li>";
				if (node.task === "checked")
					out += '<input checked="" disabled="" type="checkbox"> ';
				if (node.task === "unchecked")
					out += '<input disabled="" type="checkbox"> ';
				kids();
				out += "</li>";
				cr();
				break;
			case "code_block": {
				cr();
				const lang = (node.info ?? "").split(/[ \t\n]+/)[0];
				out += lang
					? `<pre><code class="language-${escapeXml(lang)}">`
					: "<pre><code>";
				out += `${escapeXml(node.literal)}</code></pre>`;
				cr();
				break;
			}
			case "html_block":
				cr();
				out += raw(node.literal);
				cr();
				break;
			case "thematic_break":
				cr();
				out += "<hr />";
				cr();
				break;
			case "table": {
				cr();
				out += "<table>\n<thead>\n";
				const [head, ...rows] = node.children;
				const row = (r, tag) => {
					out += "<tr>\n";
					for (const cell of r.children) {
						out += cell.align ? `<${tag} align="${cell.align}">` : `<${tag}>`;
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
			case "text":
				out += escapeXml(node.literal);
				break;
			case "softbreak":
				out += "\n";
				break;
			case "linebreak":
				out += "<br />\n";
				break;
			case "code":
				out += `<code>${escapeXml(node.literal)}</code>`;
				break;
			case "html_inline":
				out += raw(node.literal);
				break;
			case "emph":
			case "strong":
			case "del": {
				if (node.type === "strong" && node.parent?.type === "strong") {
					kids();
					break;
				}
				const tag = { emph: "em", strong: "strong", del: "del" }[node.type];
				out += `<${tag}>`;
				kids();
				out += `</${tag}>`;
				break;
			}
			case "link":
				out += `<a href="${escapeXml(node.destination)}"`;
				if (node.title) out += ` title="${escapeXml(node.title)}"`;
				out += ">";
				kids();
				out += "</a>";
				break;
			case "image":
				out += `<img src="${escapeXml(node.destination)}" alt="${escapeXml(plain(node))}"`;
				if (node.title) out += ` title="${escapeXml(node.title)}"`;
				out += " />";
				break;
			default:
				throw new Error(`no reference HTML for ${node.type}`);
		}
	};
	render(doc);
	return out;
}
