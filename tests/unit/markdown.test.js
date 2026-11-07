// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1014: the scenarios of docs/specs/LCTYSP-1014_markdown.feature that check the HTML string, written by hand.
// Each test has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the
// two read side by side. The scenarios that check how a page's HTML parser reads the output ("the HTML put into a
// page") run in the browser (markdown.spec.js).
//
// public/js/ui/markdown.js is pure and runs in Node.js (node-unit.js). codeBlockHTML() calls tr(), which needs the
// global LctyT and <html lang>: useLctyT() makes them, in English. Texts in the steps are written as in the feature,
// where \n is a newline, \| is | and \\ is \; unquote() turns them into the text the module is given.

import { expect, publicUrl, scenario, useLctyT } from "./node-unit.js";

await useLctyT({ lang: "en" });
const md = await import(publicUrl("js/ui/markdown.js"));

/** The text a quoted string or a table cell of the feature stands for. */
const unquote = (raw) =>
	raw.replace(/\\(.)/g, (_, c) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c);

const A = (href, text) =>
	`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

// ---- Steps shared by the scenarios ----

async function whenRenders(step, raw) {
	let html;
	await step(`When renderMarkdown renders "${raw}"`, () => {
		html = md.renderMarkdown(unquote(raw));
	});
	return html;
}

async function thenTheHtmlIs(step, html, expected, prefix = "Then") {
	await step(`${prefix} the HTML is ${expected}`, () => {
		expect(html).toBe(expected);
	});
}

const scan = (raw, final) =>
	md
		.scanBlocks(unquote(raw), final)
		.map(({ kind, start, end, lines, complete }) => ({
			kind,
			start,
			end,
			lines,
			complete,
		}));

async function whenScans(step, raw, final) {
	let blocks;
	await step(
		`When scanBlocks reads "${raw}" as ${final ? "final" : "not final"}`,
		() => {
			blocks = scan(raw, final);
		},
	);
	return blocks;
}

const states = (blocks) => blocks.map((b) => [b.kind, b.complete]);

// ---- Block types ----

for (const [block, markdown, html] of [
	["a paragraph", "Hello\\nworld", "<p>Hello<br>world</p>"],
	["two paragraphs", "one\\n\\ntwo", "<p>one</p><p>two</p>"],
	["a level-1 heading", "# Title", "<h1>Title</h1>"],
	["a level-6 heading with closing marks", "###### Six ##", "<h6>Six</h6>"],
	["seven hashes", "####### seven", "<p>####### seven</p>"],
	["a hash without a space", "#tag", "<p>#tag</p>"],
	[
		"a heading right after a paragraph",
		"para\\n# head",
		"<p>para</p><h1>head</h1>",
	],
	["rules", "---\\n***\\n_ _ _", "<hr><hr><hr>"],
	[
		"a quote with blocks inside",
		"> quote **b**\\n> - item",
		"<blockquote><p>quote <strong>b</strong></p><ul><li>item</li></ul></blockquote>",
	],
	[
		"a quote's lazy line",
		"> a\\nlazy",
		"<blockquote><p>a<br>lazy</p></blockquote>",
	],
	[
		"quotes split by a blank line",
		"> a\\n\\n> b",
		"<blockquote><p>a</p></blockquote><blockquote><p>b</p></blockquote>",
	],
	["a tight list", "- a\\n- b", "<ul><li>a</li><li>b</li></ul>"],
	[
		"a loose list",
		"- a\\n\\n- b",
		"<ul><li><p>a</p></li><li><p>b</p></li></ul>",
	],
	["an ordered list", "1. one\\n2. two", "<ol><li>one</li><li>two</li></ol>"],
	[
		"an ordered list from 3",
		"3. three\\n4. four",
		'<ol start="3"><li>three</li><li>four</li></ol>',
	],
	["a parenthesis marker", "1) x", "<ol><li>x</li></ol>"],
	[
		"a nested list",
		"- a\\n  - nested\\n- b",
		"<ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>",
	],
	[
		"a new marker starting a new list",
		"- a\\n1. b",
		"<ul><li>a</li></ul><ol><li>b</li></ol>",
	],
	[
		"a lazy continuation of an item",
		"- a\\nlazy",
		"<ul><li>a<br>lazy</li></ul>",
	],
	["a rule ending a list", "- a\\n---", "<ul><li>a</li></ul><hr>"],
	["CRLF line ends", "line1\\r\\nline2", "<p>line1<br>line2</p>"],
]) {
	scenario(
		`A block renders as its HTML element (${block})`,
		async ({ step }) => {
			const out = await whenRenders(step, markdown);
			await thenTheHtmlIs(step, out, html);
		},
	);
}

scenario("An empty text renders as nothing", async ({ step }) => {
	const out = await whenRenders(step, "");
	await step("Then the HTML is empty", () => {
		expect(out).toBe("");
	});
});

// ---- Inline ----

for (const [formatting, markdown, html] of [
	["bold", "**b**", "<p><strong>b</strong></p>"],
	["italic", "*i*", "<p><em>i</em></p>"],
	["strikethrough", "~~d~~", "<p><del>d</del></p>"],
	["inline code", "`**a**` <b>", "<p><code>**a**</code> &lt;b&gt;</p>"],
	["code holding a backtick", "``a ` b``", "<p><code>a ` b</code></p>"],
	["code padded with spaces", "` x `", "<p><code>x</code></p>"],
	["asterisks inside words", "a*b*c 2*3*4", "<p>a*b*c 2*3*4</p>"],
	["an unclosed bold", "**unclosed", "<p>**unclosed</p>"],
	["a line break", "a  \\nb", "<p>a<br>b</p>"],
	[
		"a link",
		"[link](https://e.com/?b=1&c=2)",
		`<p>${A("https://e.com/?b=1&amp;c=2", "link")}</p>`,
	],
	[
		"a link with emphasis",
		"[**b**](https://e.com)",
		`<p>${A("https://e.com/", "<strong>b</strong>")}</p>`,
	],
	[
		"a mailto link",
		"[mail](mailto:a@e.com)",
		`<p>${A("mailto:a@e.com", "mail")}</p>`,
	],
	[
		"a bare URL before a period",
		"see https://e.com/x.",
		`<p>see ${A("https://e.com/x", "https://e.com/x")}.</p>`,
	],
	[
		"a bare URL in parentheses",
		"(https://e.com/y)",
		`<p>(${A("https://e.com/y", "https://e.com/y")})</p>`,
	],
	[
		"a bare URL in Japanese",
		"見てhttps://e.com/パス。",
		`<p>見て${A("https://e.com/%E3%83%91%E3%82%B9", "https://e.com/パス")}。</p>`,
	],
	["bold and italic", "***x***", "<p><strong><em>x</em></strong></p>"],
	[
		"a bare URL in quotes",
		'say \\"https://e.com\\" ok',
		`<p>say &quot;${A("https://e.com/", "https://e.com")}&quot; ok</p>`,
	],
	[
		"a bare URL in brackets",
		"<https://e.com>",
		`<p>&lt;${A("https://e.com/", "https://e.com")}&gt;</p>`,
	],
]) {
	scenario(`Inline formatting (${formatting})`, async ({ step }) => {
		const out = await whenRenders(step, markdown);
		await thenTheHtmlIs(step, out, html);
	});
}

const SUGGESTION = (text) =>
	`<button type="button" class="suggestion">${text}</button>`;

for (const [suggestion, markdown, html] of [
	[
		"a closed one",
		"<suggestion-for-user-turn>Tell me more</suggestion-for-user-turn>",
		`<p>${SUGGESTION("Tell me more")}</p>`,
	],
	[
		"one without its closing tag",
		"<suggestion-for-user-turn>open\\nnext",
		`<p>${SUGGESTION("open")}<br>next</p>`,
	],
	[
		"an empty one",
		"<suggestion-for-user-turn>  </suggestion-for-user-turn>",
		"<p></p>",
	],
	[
		"one holding Markdown and HTML",
		"<suggestion-for-user-turn>**b** <i></suggestion-for-user-turn>",
		`<p>${SUGGESTION("**b** &lt;i&gt;")}</p>`,
	],
	[
		"one inside a code span",
		"`<suggestion-for-user-turn>x</suggestion-for-user-turn>`",
		"<p><code>&lt;suggestion-for-user-turn&gt;x&lt;/suggestion-for-user-turn&gt;</code></p>",
	],
]) {
	scenario(
		`A suggested next message is a button (${suggestion})`,
		async ({ step }) => {
			const out = await whenRenders(step, markdown);
			await thenTheHtmlIs(step, out, html);
		},
	);
}

// ---- Code blocks ----

scenario("A code block's language is escaped", async ({ step }) => {
	const out = await whenRenders(step, "```<x>\\n<b>\\n```");
	await thenTheHtmlIs(
		step,
		out,
		'<div class="codeblock"><div class="codebar"><span class="lang">&lt;x&gt;</span><button type="button" class="select">Select all</button></div><pre><code data-lang="&lt;x&gt;">&lt;b&gt;</code></pre></div>',
	);
});

// ---- Tables ----

scenario(
	"A table without alignment ends at a line without a pipe",
	async ({ step }) => {
		const out = await whenRenders(step, "a | b\\n--|--\\n1 | 2\\ntext");
		await thenTheHtmlIs(
			step,
			out,
			'<div class="table-wrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div><p>text</p>',
		);
	},
);

scenario(
	"A line with pipes but no separator is a paragraph",
	async ({ step }) => {
		const out = await whenRenders(step, "a|b\\nnot sep");
		await thenTheHtmlIs(step, out, "<p>a|b<br>not sep</p>");
	},
);

// ---- scanBlocks ----

scenario(
	"scanBlocks cuts a text into blocks with their kinds, offsets and lines",
	async ({ step }) => {
		const blocks = await whenScans(
			step,
			"para\\n\\n# h\\n---\\n- a\\n- b\\n\\n> q\\n```js\\nx\\n```\\n| a |\\n|---|\\nlast",
			true,
		);
		await step(
			"Then the blocks are para, heading, hr, list, quote, fence, table and para",
			() => {
				expect(blocks.map((b) => b.kind)).toEqual([
					"para",
					"heading",
					"hr",
					"list",
					"quote",
					"fence",
					"table",
					"para",
				]);
			},
		);
		await step(
			'And the first is para from 0 to 5 with the lines "para"',
			() => {
				expect(blocks[0]).toMatchObject({ start: 0, end: 5, lines: ["para"] });
			},
		);
		await step(
			'And the list is from 14 to 23 with the lines "- a", "- b" and ""',
			() => {
				expect(blocks[3]).toMatchObject({
					start: 14,
					end: 23,
					lines: ["- a", "- b", ""],
				});
			},
		);
		await step("And every block is complete", () => {
			expect(blocks.every((b) => b.complete)).toBe(true);
		});
	},
);

scenario(
	"The last line still being written leaves its block incomplete",
	async ({ step }) => {
		const blocks = await whenScans(step, "para\\n\\npartial", false);
		await step(
			"Then the blocks are para, complete, and para, not complete",
			() => {
				expect(states(blocks)).toEqual([
					["para", true],
					["para", false],
				]);
			},
		);
		await step("And read as final, both blocks are complete", () => {
			expect(states(scan("para\\n\\npartial", true))).toEqual([
				["para", true],
				["para", true],
			]);
		});
	},
);

scenario(
	"A paragraph stays incomplete until a blank line ends it",
	async ({ step }) => {
		const blocks = await whenScans(step, "a\\nb\\n", false);
		await step("Then the blocks are para, not complete", () => {
			expect(states(blocks)).toEqual([["para", false]]);
		});
	},
);

scenario(
	"A block closed by the line still being written is not complete yet",
	async ({ step }) => {
		const blocks = await whenScans(step, "para\\n# h", false);
		await step(
			"Then the blocks are para, not complete, and heading, not complete",
			() => {
				expect(states(blocks)).toEqual([
					["para", false],
					["heading", false],
				]);
			},
		);
		await step(
			'And scanBlocks reading "para\\n# h\\n" as not final gives both blocks complete',
			() => {
				expect(states(scan("para\\n# h\\n", false))).toEqual([
					["para", true],
					["heading", true],
				]);
			},
		);
	},
);

for (const [text, state] of [
	["```js\\ncode\\n", "not complete"],
	["```js\\ncode\\n```", "not complete"],
	["```js\\ncode\\n```\\n", "complete"],
]) {
	scenario(
		`A code block is complete only once its closing fence line has ended (${text})`,
		async ({ step }) => {
			const blocks = await whenScans(step, text, false);
			await step(`Then the blocks are fence, ${state}`, () => {
				expect(states(blocks)).toEqual([["fence", state === "complete"]]);
			});
		},
	);
}

const DOCUMENT =
	"# Title\n\nSome *text* with `code`.\n\n- one\n- two\n  - nested\n\n1. a\n2. b\n\n> quote\n> more\n\n```js\nlet x = 1;\n\nlet y = 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n<suggestion-for-user-turn>Next</suggestion-for-user-turn>\nlast line";

async function givenADocument(step) {
	await step("Given a document with every kind of block");
	return DOCUMENT;
}

scenario(
	"A complete block never changes as the text grows",
	async ({ step }) => {
		const doc = await givenADocument(step);
		let changed;
		await step("When scanBlocks reads every prefix of it as not final", () => {
			const pick = ({ kind, start, end, lines }) =>
				JSON.stringify({ kind, start, end, lines });
			const whole = md.scanBlocks(doc, true);
			const found = [];
			for (let i = 0; i <= doc.length; i++) {
				md.scanBlocks(doc.slice(0, i), false).forEach((b, j) => {
					if (b.complete && pick(b) !== pick(whole[j]))
						found.push({ prefix: i, block: j });
				});
			}
			changed = { found, kinds: whole.map((b) => b.kind) };
		});
		await step(
			"Then every block marked complete has the kind, offsets and lines of the same block of the whole document",
			() => {
				expect(changed.kinds).toEqual(
					expect.arrayContaining([
						"heading",
						"para",
						"list",
						"quote",
						"fence",
						"table",
						"hr",
					]),
				);
				expect(changed.found).toEqual([]);
			},
		);
	},
);

scenario(
	"Rendering the blocks one by one gives the HTML of the whole text",
	async ({ step }) => {
		const doc = await givenADocument(step);
		let result;
		await step("When renderBlock renders each block of scanBlocks", () => {
			result = {
				joined: md
					.scanBlocks(doc, true)
					.map((b) => md.renderBlock(b))
					.join(""),
				whole: md.renderMarkdown(doc),
			};
		});
		await step("Then the joined HTML is the HTML of renderMarkdown", () => {
			expect(result.joined).toBe(result.whole);
			expect(result.whole).toContain("<h1>Title</h1>");
		});
	},
);

// ---- fenceParts and codeBlockHTML ----

for (const [kase, lines, lang, code, closed] of [
	[
		"words after the language",
		'["```js extra", "x", "```"]',
		"js",
		"x",
		"true",
	],
	["no closing fence", '["```", "x"]', "", "x", "false"],
	[
		"an indented fence",
		'["  ~~~", "  a", "    b", "  ~~~"]',
		"",
		"a\\n  b",
		"true",
	],
	["a shorter closing fence", '["````", "a", "```"]', "", "a\\n```", "false"],
	[
		"a closing fence of the wrong kind",
		'["```py", "a", "~~~"]',
		"py",
		"a\\n~~~",
		"false",
	],
	["only the opening line", '["```"]', "", "", "false"],
]) {
	scenario(
		`fenceParts splits a code block into its language, code and whether it is closed (${kase})`,
		async ({ step }) => {
			let parts;
			await step(`When fenceParts is given the lines ${lines}`, () => {
				parts = md.fenceParts({ kind: "fence", lines: JSON.parse(lines) });
			});
			await step(
				`Then the language is "${lang}", the code is "${code}" and closed is ${closed}`,
				() => {
					expect(parts).toEqual({
						lang,
						code: unquote(code),
						closed: closed === "true",
					});
				},
			);
		},
	);
}

async function whenCodeBlockHTML(step, lang, code) {
	let html;
	await step(
		`When codeBlockHTML is given the language "${lang}" and the code "${code}"`,
		() => {
			html = md.codeBlockHTML(unquote(lang), unquote(code));
		},
	);
	return html;
}

scenario(
	'codeBlockHTML builds the code block with a "Select all" button',
	async ({ step }) => {
		const out = await whenCodeBlockHTML(step, 'j\\"s', "a<b");
		await thenTheHtmlIs(
			step,
			out,
			'<div class="codeblock"><div class="codebar"><span class="lang">j&quot;s</span><button type="button" class="select">Select all</button></div><pre><code data-lang="j&quot;s">a&lt;b</code></pre></div>',
		);
	},
);

scenario(
	"codeBlockHTML without a language has no data-lang",
	async ({ step }) => {
		const out = await whenCodeBlockHTML(step, "", "x");
		await thenTheHtmlIs(
			step,
			out,
			'<div class="codeblock"><div class="codebar"><span class="lang"></span><button type="button" class="select">Select all</button></div><pre><code>x</code></pre></div>',
		);
	},
);

// ---- renderBlock ----

scenario(
	"renderBlock renders a paragraph without <p> when tight",
	async ({ step }) => {
		let out;
		await step(
			'When renderBlock renders the para block with the lines "a" and " b " with tight set',
			() => {
				out = md.renderBlock(
					{ kind: "para", lines: ["a", " b "] },
					{ tight: true },
				);
			},
		);
		await thenTheHtmlIs(step, out, "a<br>b");
	},
);

scenario(
	"renderBlock renders a heading and a rule from their lines",
	async ({ step }) => {
		let out;
		await step(
			'When renderBlock renders the heading block "## Sub #" and the hr block "***"',
			() => {
				out = [
					md.renderBlock({ kind: "heading", lines: ["## Sub #"] }),
					md.renderBlock({ kind: "hr", lines: ["***"] }),
				];
			},
		);
		await step("Then the HTMLs are <h2>Sub</h2> and <hr>", () => {
			expect(out).toEqual(["<h2>Sub</h2>", "<hr>"]);
		});
	},
);
