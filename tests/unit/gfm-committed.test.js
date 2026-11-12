// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1026: the scenarios of docs/specs/LCTYSP-1026_committed-converter.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one step per line of it, the Background first.
//
// js/convert/gfm/committed.js and converter.js run in Node.js (node-unit.js). The examples and the entity table are
// those of tests/unit/gfm-reference.js.

import {
	decodeNameFromTable,
	problemsOf,
	specExamples,
} from "./gfm-reference.js";
import { expect, publicUrl, scenario } from "./node-unit.js";

const { gfmHtml, parseGfm } = await import(
	publicUrl("js/convert/gfm/converter.js")
);
const { DomSink, HtmlSink, writeCommitted } = await import(
	publicUrl("js/convert/gfm/committed.js")
);
const { B_C, ITEM } = await import(publicUrl("js/convert/gfm/gfm_blocks.js"));
const { HTML_INLINE, IMAGE, SOFTBREAK } = await import(
	publicUrl("js/convert/gfm/gfm_inlines.js")
);
const { HTML_BLOCK } = await import(publicUrl("js/convert/gfm/gfm_blocks.js"));

async function background(step) {
	let examples;
	await step(
		"Given the 672 examples of tests/gfm/spec.txt, with → read as a tab",
		() => {
			examples = specExamples();
			expect(examples).toHaveLength(672);
		},
	);
	await step(
		"And named character references resolved with tests/gfm/entities.json",
		() => {
			expect(decodeNameFromTable("amp")).toBe("&");
		},
	);
	return examples;
}

const optionsOf = (e) => ({ autolink: e.extension === "autolink" });

/** Whether e's tree has raw HTML, an image, a soft line break or a task list item, which LCTYSP-0017 writes its way. */
function ownWay(e) {
	const { nodes } = parseGfm(e.markdown, decodeNameFromTable, optionsOf(e));
	for (let i = 0; i < nodes.length; i++) {
		const ty = nodes.i32[i << 3] & 0xff;
		if (ty === HTML_BLOCK || ty === HTML_INLINE || ty === IMAGE) return true;
		if (ty === SOFTBREAK) return true;
		if (ty === ITEM && nodes.b32[(i << 3) + B_C] !== 0) return true;
	}
	return false;
}

const BLOCK = new Set(
	"p h1 h2 h3 h4 h5 h6 ul ol li blockquote pre table thead tbody tr th td hr".split(
		" ",
	),
);
const reToken =
	/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
const attrsOf = (s) =>
	Object.fromEntries(
		[...s.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
	);
const reAllowed = /^(?:https?|mailto):/i;

/** GFM's reference HTML mapped by the tables of LCTYSP-0017, element by element (the test's own reading of them). */
function mapReference(html) {
	const tokens = [...html.matchAll(reToken)];
	let out = "";
	let inPre = false;
	const links = [];
	const isBlockTag = (t) =>
		t !== undefined && t[2] !== undefined && (BLOCK.has(t[2]) || t[2] === "br");
	for (let k = 0; k < tokens.length; k++) {
		const t = tokens[k];
		if (t[4] !== undefined) {
			let text = t[4].replaceAll("&quot;", '"');
			if (!inPre) {
				if (k === 0 || isBlockTag(tokens[k - 1]))
					text = text.replace(/^\n+/, "");
				if (k === tokens.length - 1 || isBlockTag(tokens[k + 1]))
					text = text.replace(/\n+$/, "");
			}
			out += text;
			continue;
		}
		const close = t[1] === "/";
		const tag = t[2];
		const attrs = attrsOf(t[3]);
		if (tag === "pre") {
			if (close) {
				out += "</pre></div>";
				inPre = false;
			} else inPre = true;
		} else if (tag === "code" && inPre && !close) {
			const lang = (attrs.class ?? "").replace(/^language-/, "");
			out += `<div class="codeblock"><div class="codebar"><span class="lang">${lang.replaceAll("&quot;", '"')}</span><button type="button" class="select">Select all</button></div><pre><code${lang ? ` data-lang="${lang}"` : ""}>`;
		} else if (tag === "a") {
			if (close) {
				if (links.pop()) out += "</a>";
			} else {
				const allowed = reAllowed.test(attrs.href.replaceAll("&amp;", "&"));
				links.push(allowed);
				if (allowed)
					out += `<a href="${attrs.href}" target="_blank" rel="noopener noreferrer">`;
			}
		} else if (tag === "hr" || tag === "br") out += `<${tag}>`;
		else if (tag === "table")
			out += close ? "</table></div>" : '<div class="table-wrap"><table>';
		else if ((tag === "th" || tag === "td") && !close && attrs.align)
			out += `<${tag} class="align-${attrs.align}">`;
		else if (tag === "ol" && !close && attrs.start)
			out += `<ol start="${attrs.start}">`;
		else out += close ? `</${tag}>` : `<${tag}>`;
	}
	return out;
}

scenario(
	"An example without raw HTML, images, soft line breaks or task list items gives its HTML mapped by LCTYSP-0017",
	async ({ step }) => {
		const examples = await background(step);
		let compared;
		await step(
			"When each example whose tree has no raw HTML, image, soft line break or task list item is written by gfmHtml",
			() => {
				compared = examples
					.filter((e) => !ownWay(e))
					.map((e) => ({
						number: e.number,
						markdown: e.markdown,
						got: gfmHtml(e.markdown, decodeNameFromTable, optionsOf(e)),
						want: mapReference(e.html),
					}));
			},
		);
		await step(
			"Then each gives the HTML of its example mapped by the tables of LCTYSP-0017, byte for byte",
			() => {
				expect(compared.filter((c) => c.got !== c.want)).toEqual([]);
			},
		);
		await step("And at least 500 examples are compared", () => {
			expect(compared.length).toBeGreaterThanOrEqual(500);
		});
	},
);

scenario(
	"Every example writes only the elements and attributes of LCTYSP-0017",
	async ({ step }) => {
		const examples = await background(step);
		let written;
		await step("When each example is written by gfmHtml", () => {
			written = examples.map((e) => ({
				number: e.number,
				html: gfmHtml(e.markdown, decodeNameFromTable, optionsOf(e)),
			}));
		});
		await step(
			"Then every element and attribute it writes is one that LCTYSP-0017 lists",
			() => {
				const bad = written
					.map((w) => ({
						number: w.number,
						problems: problemsOf(w.html).filter(
							(p) => !p.includes("order") && !p.startsWith("unclosed"),
						),
					}))
					.filter((w) => w.problems.length > 0);
				expect(bad).toEqual([]);
			},
		);
		await step(
			"And every element it opens is closed in order, br and hr opening none",
			() => {
				const bad = written
					.map((w) => ({
						number: w.number,
						problems: problemsOf(w.html).filter(
							(p) => p.includes("order") || p.startsWith("unclosed"),
						),
					}))
					.filter((w) => w.problems.length > 0);
				expect(bad).toEqual([]);
			},
		);
	},
);

const CODE_BAR = (lang) =>
	`<div class="codeblock"><div class="codebar"><span class="lang">${lang}</span><button type="button" class="select">Select all</button></div>`;
// The Examples of the Outline: case, the markdown as the feature writes it, the HTML as it writes it (\n a line end)
for (const [label, markdown, html] of [
	["inline raw HTML", "<b>bold</b>", "<p>&lt;b&gt;bold&lt;/b&gt;</p>"],
	[
		"an HTML block",
		"<div>\na\n</div>",
		"<p>&lt;div&gt;<br>a<br>&lt;/div&gt;</p>",
	],
	[
		"an image",
		'![alt *x*](https://e.org/i.png "t")',
		'<p><a href="https://e.org/i.png" target="_blank" rel="noopener noreferrer">alt x</a></p>',
	],
	["an image of a relative URL", "![alt](/i.png)", "<p>alt</p>"],
	["a soft line break", "a\nb", "<p>a<br>b</p>"],
	["a hard line break", "a  \nb", "<p>a<br>b</p>"],
	[
		"task list items",
		"- [ ] a\n- [x] b",
		'<ul><li><span class="task">☐</span> a</li><li><span class="task done">☑</span> b</li></ul>',
	],
	[
		"a task in a loose list",
		"- [x] a\n\n- b",
		'<ul><li><p><span class="task done">☑</span> a</p></li><li><p>b</p></li></ul>',
	],
	[
		"a link's title",
		'[a](http://e.org "t")',
		'<p><a href="http://e.org" target="_blank" rel="noopener noreferrer">a</a></p>',
	],
	["a link of another scheme", "[a](javascript:alert(1))", "<p>a</p>"],
	["a relative link", "[a](/x)", "<p>a</p>"],
	[
		"an email autolink",
		"<a@b.co>",
		'<p><a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">a@b.co</a></p>',
	],
	[
		"an image in a link",
		"[![i](http://e.org/i)](http://e.org)",
		'<p><a href="http://e.org" target="_blank" rel="noopener noreferrer">i</a></p>',
	],
	["a strong inside a strong", "****a****", "<p><strong>a</strong></p>"],
	["an ordered list from 3", "3. a", '<ol start="3"><li>a</li></ol>'],
	[
		"a code block without info",
		"```\nx\n```",
		`${CODE_BAR("")}<pre><code>x\\n</code></pre></div>`,
	],
	[
		"a code block's language",
		"```js x\na\n```",
		`${CODE_BAR("js")}<pre><code data-lang="js">a\\n</code></pre></div>`,
	],
	["a thematic break", "***", "<hr>"],
	["character references", "&amp;&lt;&quot;", '<p>&amp;&lt;"</p>'],
	[
		"a suggested next message",
		"a <suggestion-for-user-turn>Tell *me*</suggestion-for-user-turn> b",
		'<p>a <button type="button" class="suggestion">Tell *me*</button> b</p>',
	],
	[
		"a suggestion without its end",
		"<suggestion-for-user-turn>Go on\nnext",
		'<p><button type="button" class="suggestion">Go on</button><br>next</p>',
	],
	[
		"an empty suggestion",
		"a <suggestion-for-user-turn></suggestion-for-user-turn>",
		"<p>a </p>",
	],
	[
		"a suggestion in a code span",
		"`<suggestion-for-user-turn>x`",
		"<p><code>&lt;suggestion-for-user-turn&gt;x</code></p>",
	],
]) {
	scenario(
		`What LCTYSP-0017 writes in a way of its own (${label})`,
		async ({ step }) => {
			await background(step);
			let got;
			await step(
				`When ${JSON.stringify(markdown)} is written by gfmHtml`,
				() => {
					got = gfmHtml(markdown, decodeNameFromTable);
				},
			);
			await step(`Then it gives ${html}`, () => {
				expect(got).toBe(html.replaceAll("\\n", "\n"));
			});
		},
	);
}

scenario(
	"A table writes its alignments as classes, and a body only when it has rows",
	async ({ step }) => {
		await background(step);
		let first;
		let second;
		await step(
			'When "\\| a \\| b \\|\\n\\| :- \\| -: \\|\\n\\| 1 \\|" and "\\| a \\|\\n\\| - \\|" are written by gfmHtml',
			() => {
				first = gfmHtml("| a | b |\n| :- | -: |\n| 1 |", decodeNameFromTable);
				second = gfmHtml("| a |\n| - |", decodeNameFromTable);
			},
		);
		await step(
			'Then the first gives a table-wrap, a head of th class="align-left" and th class="align-right", and a body whose row has an empty second cell',
			() => {
				expect(first).toBe(
					'<div class="table-wrap"><table><thead><tr><th class="align-left">a</th><th class="align-right">b</th></tr></thead><tbody><tr><td class="align-left">1</td><td class="align-right"></td></tr></tbody></table></div>',
				);
			},
		);
		await step(
			"And the second gives a table-wrap and a head, without a body",
			() => {
				expect(second).toBe(
					'<div class="table-wrap"><table><thead><tr><th>a</th></tr></thead></table></div>',
				);
			},
		);
	},
);

/** A document that records what it is given and serializes it as an HTML parser would read it back. */
class RecordingElement {
	constructor(document, tag) {
		this.ownerDocument = document;
		this.tag = tag;
		this.attrs = [];
		this.children = [];
	}

	setAttribute(name, value) {
		this.attrs.push(name, value);
	}

	append(child) {
		this.children.push(child);
	}

	get html() {
		const esc = (s) =>
			s
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;");
		const inner = this.children
			.map((c) => (typeof c === "string" ? esc(c) : c.outer))
			.join("");
		return inner;
	}

	get outer() {
		let attrs = "";
		for (let i = 0; i < this.attrs.length; i += 2)
			attrs += ` ${this.attrs[i]}="${this.attrs[i + 1].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}"`;
		if (this.tag === "br" || this.tag === "hr") return `<${this.tag}${attrs}>`;
		return `<${this.tag}${attrs}>${this.html}</${this.tag}>`;
	}
}

class RecordingDocument {
	createElement(tag) {
		return new RecordingElement(this, tag);
	}
}

scenario(
	"The HTML string and the DOM of a sink are the same output",
	async ({ step }) => {
		const examples = await background(step);
		let pairs;
		await step(
			"When each example is written by writeCommitted once into an HtmlSink and once into a DomSink of a document that records what it is given",
			() => {
				pairs = examples.map((e) => {
					const { nodes, spans } = parseGfm(
						e.markdown,
						decodeNameFromTable,
						optionsOf(e),
					);
					const doc = { source: e.markdown, nodes, spans };
					const html = new HtmlSink();
					writeCommitted(doc, 0, html);
					const root = new RecordingDocument().createElement("article");
					writeCommitted(doc, 0, new DomSink(root));
					return { number: e.number, html: html.html, dom: root.html };
				});
			},
		);
		await step(
			"Then the DOM serialized is the HTML string, byte for byte",
			() => {
				expect(pairs.filter((p) => p.html !== p.dom)).toEqual([]);
			},
		);
	},
);

scenario("A long text is written in about linear time", async ({ step }) => {
	await background(step);
	let ms;
	await step(
		'When a text of 100000 repetitions of "*a* [b](http://e.org) `c`\\n" is written by gfmHtml',
		() => {
			const text = "*a* [b](http://e.org) `c`\n".repeat(100000);
			const start = performance.now();
			gfmHtml(text, decodeNameFromTable);
			ms = performance.now() - start;
		},
	);
	await step("Then it takes less than 5 seconds", () => {
		expect(ms).toBeLessThan(5000);
	});
});
