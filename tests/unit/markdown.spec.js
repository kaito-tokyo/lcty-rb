// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1014: the scenarios of docs/specs/LCTYSP-1014_markdown.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// public/js/ui/markdown.js is imported into the empty unit page (tests/unit/unit-page.js), which loads /c/lcty.v1.js for
// the LctyT that tr() needs. Texts in the steps are written as in the feature, where \n is a newline, \| is | and \\ is
// \; unquote() turns them into the text the module is given.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** The text a quoted string or a table cell of the feature stands for. */
const unquote = (raw) =>
	raw.replace(/\\(.)/g, (_, c) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c);

const A = (href, text) =>
	`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

// ---- Background ----

async function background(page, context, options) {
	await givenAPage(page, context, options);
	await test.step("And the module /js/ui/markdown.js is imported", async () => {
		await page.evaluate(async () => {
			window.md = await import("/js/ui/markdown.js");
		});
	});
}

// ---- Steps shared by the scenarios ----

async function whenRenders(page, raw) {
	let html;
	await test.step(`When renderMarkdown renders "${raw}"`, async () => {
		html = await page.evaluate(
			(src) => window.md.renderMarkdown(src),
			unquote(raw),
		);
	});
	return html;
}

async function thenTheHtmlIs(html, expected, prefix = "Then") {
	await test.step(`${prefix} the HTML is ${expected}`, () => {
		expect(html).toBe(expected);
	});
}

/** The tags and attribute names of every element of html, and its text, once put into a page. */
function parse(page, html) {
	return page.evaluate((h) => {
		const div = document.createElement("div");
		div.innerHTML = h;
		const els = [...div.querySelectorAll("*")];
		return {
			tags: [...new Set(els.map((e) => e.localName))].sort(),
			attrs: [...new Set(els.flatMap((e) => e.getAttributeNames()))].sort(),
			text: div.textContent,
		};
	}, html);
}

/** What a code block shows, once put into a page. */
function codeBlocks(page, html) {
	return page.evaluate((h) => {
		const div = document.createElement("div");
		div.innerHTML = h;
		return [...div.querySelectorAll(".codeblock")].map((b) => ({
			lang: b.querySelector(".codebar > .lang").textContent,
			dataLang: b.querySelector("pre > code").getAttribute("data-lang"),
			code: b.querySelector("pre > code").textContent,
			button: b.querySelector(".codebar > button.select").textContent,
		}));
	}, html);
}

function scan(page, raw, final) {
	return page.evaluate(
		({ src, final }) =>
			window.md
				.scanBlocks(src, final)
				.map(({ kind, start, end, lines, complete }) => ({
					kind,
					start,
					end,
					lines,
					complete,
				})),
		{ src: unquote(raw), final },
	);
}

async function whenScans(page, raw, final) {
	let blocks;
	await test.step(`When scanBlocks reads "${raw}" as ${final ? "final" : "not final"}`, async () => {
		blocks = await scan(page, raw, final);
	});
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
	test(`A block renders as its HTML element (${block})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		const out = await whenRenders(page, markdown);
		await thenTheHtmlIs(out, html);
	});
}

test("An empty text renders as nothing", async ({ page, context }) => {
	await background(page, context);
	const out = await whenRenders(page, "");
	await test.step("Then the HTML is empty", () => {
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
]) {
	test(`Inline formatting (${formatting})`, async ({ page, context }) => {
		await background(page, context);
		const out = await whenRenders(page, markdown);
		await thenTheHtmlIs(out, html);
	});
}

for (const [link, markdown, html] of [
	[
		"a javascript: link",
		"[bad](javascript:alert(1))",
		"<p>[bad](javascript:alert(1))</p>",
	],
	[
		"a data: link",
		"[x](data:text/html,<script>)",
		"<p>[x](data:text/html,&lt;script&gt;)</p>",
	],
	["a bare ftp: URL", "ftp://e.com", "<p>ftp://e.com</p>"],
	[
		"a quote inside a link URL",
		'[x](https://e.com/\\"onmouseover=)',
		`<p>${A("https://e.com/%22onmouseover=", "x")}</p>`,
	],
]) {
	test(`Only http, https and mailto links are made (${link})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		const out = await whenRenders(page, markdown);
		await thenTheHtmlIs(out, html);
		await test.step("And the HTML put into a page has no element but <p> and <a>, and no attribute but href, target and rel", async () => {
			const { tags, attrs } = await parse(page, out);
			expect(["a", "p"]).toEqual(expect.arrayContaining(tags));
			expect(["href", "rel", "target"]).toEqual(expect.arrayContaining(attrs));
			if (tags.includes("a")) {
				const href = await page.evaluate((h) => {
					const div = document.createElement("div");
					div.innerHTML = h;
					return div.querySelector("a").protocol;
				}, out);
				expect(["http:", "https:", "mailto:"]).toContain(href);
			}
		});
	});
}

test("HTML in the text is escaped", async ({ page, context }) => {
	await background(page, context);
	const raw = `<script>alert(1)</script> <img src=x onerror=\\"alert(1)\\"> & 'a'`;
	const out = await whenRenders(page, raw);
	await thenTheHtmlIs(
		out,
		"<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;a&#39;</p>",
	);
	await test.step("And the HTML put into a page has no element but <p>, and the text reads as written", async () => {
		const { tags, attrs, text } = await parse(page, out);
		expect(tags).toEqual(["p"]);
		expect(attrs).toEqual([]);
		expect(text).toBe(unquote(raw));
	});
});

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
	test(`A suggested next message is a button (${suggestion})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		const out = await whenRenders(page, markdown);
		await thenTheHtmlIs(out, html);
	});
}

// ---- Code blocks ----

for (const [fence, markdown, lang, code] of [
	[
		"backticks with a language",
		"```js\\nconst a = 1 < 2;\\n```",
		"js",
		"const a = 1 < 2;",
	],
	["backticks without a language", "```\\nplain\\n```", "", "plain"],
	[
		"tildes with words after the lang",
		"~~~~ python extra\\nx\\n~~~\\n~~~~",
		"python",
		"x\\n~~~",
	],
	["a fence that is never closed", "```\\nunclosed", "", "unclosed"],
	[
		"markup in the code",
		"```html\\n<b>&amp;</b>\\n```",
		"html",
		"<b>&amp;</b>",
	],
	["an indented fence", "\\n   ```\\n   a\\n    b\\n   ```", "", "a\\n b"],
	["a fence after a paragraph", "para\\n```\\ncode\\n```", "", "code"],
	[
		"a fence with a blank line in an item",
		"- item\\n  ```\\n  a\\n\\n  b\\n  ```",
		"",
		"a\\n\\nb",
	],
]) {
	test(`A code block shows its language and its code as text (${fence})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		const out = await whenRenders(page, markdown);
		await test.step(`Then the HTML put into a page is one code block with the language "${lang}" and the code "${code}"`, async () => {
			expect(await codeBlocks(page, out)).toEqual([
				{
					lang,
					dataLang: lang || null,
					code: unquote(code),
					button: "Select all",
				},
			]);
		});
	});
}

test("A code block's language is escaped", async ({ page, context }) => {
	await background(page, context);
	const out = await whenRenders(page, "```<x>\\n<b>\\n```");
	await thenTheHtmlIs(
		out,
		'<div class="codeblock"><div class="codebar"><span class="lang">&lt;x&gt;</span><button type="button" class="select">Select all</button></div><pre><code data-lang="&lt;x&gt;">&lt;b&gt;</code></pre></div>',
	);
});

// ---- Tables ----

test("A table aligns its columns and fills missing cells", async ({
	page,
	context,
}) => {
	await background(page, context);
	const out = await whenRenders(
		page,
		"| a | b | c |\\n|:--|:-:|--:|\\n| 1 | 2 |\\n| x \\\\| y | z | w |",
	);
	let table;
	await test.step("Then the HTML put into a page is one table inside div.table-wrap", async () => {
		table = await page.evaluate((h) => {
			const div = document.createElement("div");
			div.innerHTML = h;
			const cells = (row) =>
				[...row.children].map((c) => [c.textContent, c.style.textAlign]);
			return {
				wraps: div.children.length === 1 && div.firstElementChild.className,
				tables: div.querySelectorAll(".table-wrap > table").length,
				head: [...div.querySelectorAll("thead tr")].map(cells),
				body: [...div.querySelectorAll("tbody tr")].map(cells),
			};
		}, out);
		expect(table.wraps).toBe("table-wrap");
		expect(table.tables).toBe(1);
	});
	await test.step('And its header cells are "a", "b" and "c", aligned left, center and right', () => {
		expect(table.head).toEqual([
			[
				["a", "left"],
				["b", "center"],
				["c", "right"],
			],
		]);
	});
	await test.step('And its rows are "1", "2", "" and "x | y", "z", "w", aligned as the header', () => {
		expect(table.body).toEqual([
			[
				["1", "left"],
				["2", "center"],
				["", "right"],
			],
			[
				["x | y", "left"],
				["z", "center"],
				["w", "right"],
			],
		]);
	});
});

test("A table without alignment ends at a line without a pipe", async ({
	page,
	context,
}) => {
	await background(page, context);
	const out = await whenRenders(page, "a | b\\n--|--\\n1 | 2\\ntext");
	await thenTheHtmlIs(
		out,
		'<div class="table-wrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div><p>text</p>',
	);
});

test("A line with pipes but no separator is a paragraph", async ({
	page,
	context,
}) => {
	await background(page, context);
	const out = await whenRenders(page, "a|b\\nnot sep");
	await thenTheHtmlIs(out, "<p>a|b<br>not sep</p>");
});

// ---- scanBlocks ----

test("scanBlocks cuts a text into blocks with their kinds, offsets and lines", async ({
	page,
	context,
}) => {
	await background(page, context);
	const blocks = await whenScans(
		page,
		"para\\n\\n# h\\n---\\n- a\\n- b\\n\\n> q\\n```js\\nx\\n```\\n| a |\\n|---|\\nlast",
		true,
	);
	await test.step("Then the blocks are para, heading, hr, list, quote, fence, table and para", () => {
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
	});
	await test.step('And the first is para from 0 to 5 with the lines "para"', () => {
		expect(blocks[0]).toMatchObject({ start: 0, end: 5, lines: ["para"] });
	});
	await test.step('And the list is from 14 to 23 with the lines "- a", "- b" and ""', () => {
		expect(blocks[3]).toMatchObject({
			start: 14,
			end: 23,
			lines: ["- a", "- b", ""],
		});
	});
	await test.step("And every block is complete", () => {
		expect(blocks.every((b) => b.complete)).toBe(true);
	});
});

test("The last line still being written leaves its block incomplete", async ({
	page,
	context,
}) => {
	await background(page, context);
	const blocks = await whenScans(page, "para\\n\\npartial", false);
	await test.step("Then the blocks are para, complete, and para, not complete", () => {
		expect(states(blocks)).toEqual([
			["para", true],
			["para", false],
		]);
	});
	await test.step("And read as final, both blocks are complete", async () => {
		expect(states(await scan(page, "para\\n\\npartial", true))).toEqual([
			["para", true],
			["para", true],
		]);
	});
});

test("A paragraph stays incomplete until a blank line ends it", async ({
	page,
	context,
}) => {
	await background(page, context);
	const blocks = await whenScans(page, "a\\nb\\n", false);
	await test.step("Then the blocks are para, not complete", () => {
		expect(states(blocks)).toEqual([["para", false]]);
	});
});

test("A block closed by the line still being written is not complete yet", async ({
	page,
	context,
}) => {
	await background(page, context);
	const blocks = await whenScans(page, "para\\n# h", false);
	await test.step("Then the blocks are para, not complete, and heading, not complete", () => {
		expect(states(blocks)).toEqual([
			["para", false],
			["heading", false],
		]);
	});
	await test.step('And scanBlocks reading "para\\n# h\\n" as not final gives both blocks complete', async () => {
		expect(states(await scan(page, "para\\n# h\\n", false))).toEqual([
			["para", true],
			["heading", true],
		]);
	});
});

for (const [text, state] of [
	["```js\\ncode\\n", "not complete"],
	["```js\\ncode\\n```", "not complete"],
	["```js\\ncode\\n```\\n", "complete"],
]) {
	test(`A code block is complete only once its closing fence line has ended (${text})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		const blocks = await whenScans(page, text, false);
		await test.step(`Then the blocks are fence, ${state}`, () => {
			expect(states(blocks)).toEqual([["fence", state === "complete"]]);
		});
	});
}

const DOCUMENT =
	"# Title\n\nSome *text* with `code`.\n\n- one\n- two\n  - nested\n\n1. a\n2. b\n\n> quote\n> more\n\n```js\nlet x = 1;\n\nlet y = 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n<suggestion-for-user-turn>Next</suggestion-for-user-turn>\nlast line";

async function givenADocument() {
	await test.step("Given a document with every kind of block", () => {});
	return DOCUMENT;
}

test("A complete block never changes as the text grows", async ({
	page,
	context,
}) => {
	await background(page, context);
	const doc = await givenADocument();
	let changed;
	await test.step("When scanBlocks reads every prefix of it as not final", async () => {
		changed = await page.evaluate((doc) => {
			const pick = ({ kind, start, end, lines }) =>
				JSON.stringify({ kind, start, end, lines });
			const whole = window.md.scanBlocks(doc, true);
			const found = [];
			for (let i = 0; i <= doc.length; i++) {
				window.md.scanBlocks(doc.slice(0, i), false).forEach((b, j) => {
					if (b.complete && pick(b) !== pick(whole[j]))
						found.push({ prefix: i, block: j });
				});
			}
			return { found, kinds: whole.map((b) => b.kind) };
		}, doc);
	});
	await test.step("Then every block marked complete has the kind, offsets and lines of the same block of the whole document", () => {
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
	});
});

test("Rendering the blocks one by one gives the HTML of the whole text", async ({
	page,
	context,
}) => {
	await background(page, context);
	const doc = await givenADocument();
	let result;
	await test.step("When renderBlock renders each block of scanBlocks", async () => {
		result = await page.evaluate(
			(doc) => ({
				joined: window.md
					.scanBlocks(doc, true)
					.map((b) => window.md.renderBlock(b))
					.join(""),
				whole: window.md.renderMarkdown(doc),
			}),
			doc,
		);
	});
	await test.step("Then the joined HTML is the HTML of renderMarkdown", () => {
		expect(result.joined).toBe(result.whole);
		expect(result.whole).toContain("<h1>Title</h1>");
	});
});

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
	test(`fenceParts splits a code block into its language, code and whether it is closed (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		let parts;
		await test.step(`When fenceParts is given the lines ${lines}`, async () => {
			parts = await page.evaluate(
				(lines) => window.md.fenceParts({ kind: "fence", lines }),
				JSON.parse(lines),
			);
		});
		await test.step(`Then the language is "${lang}", the code is "${code}" and closed is ${closed}`, () => {
			expect(parts).toEqual({
				lang,
				code: unquote(code),
				closed: closed === "true",
			});
		});
	});
}

async function whenCodeBlockHTML(page, lang, code) {
	let html;
	await test.step(`When codeBlockHTML is given the language "${lang}" and the code "${code}"`, async () => {
		html = await page.evaluate(
			([lang, code]) => window.md.codeBlockHTML(lang, code),
			[unquote(lang), unquote(code)],
		);
	});
	return html;
}

test('codeBlockHTML builds the code block with a "Select all" button', async ({
	page,
	context,
}) => {
	await background(page, context);
	const out = await whenCodeBlockHTML(page, 'j\\"s', "a<b");
	await thenTheHtmlIs(
		out,
		'<div class="codeblock"><div class="codebar"><span class="lang">j&quot;s</span><button type="button" class="select">Select all</button></div><pre><code data-lang="j&quot;s">a&lt;b</code></pre></div>',
	);
});

test("codeBlockHTML without a language has no data-lang", async ({
	page,
	context,
}) => {
	await background(page, context);
	const out = await whenCodeBlockHTML(page, "", "x");
	await thenTheHtmlIs(
		out,
		'<div class="codeblock"><div class="codebar"><span class="lang"></span><button type="button" class="select">Select all</button></div><pre><code>x</code></pre></div>',
	);
});

test('The "Select all" button follows the page\'s language', async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the page is in Japanese", async () => {
		await page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					document.documentElement.lang = "ja";
					const s = document.createElement("script");
					s.src = "/c/lcty.v1.lang-ja.js";
					s.onload = resolve;
					s.onerror = reject;
					document.head.append(s);
				}),
		);
	});
	const out = await whenCodeBlockHTML(page, "", "x");
	await test.step('Then the button reads "すべて選択"', async () => {
		expect((await codeBlocks(page, out))[0].button).toBe("すべて選択");
	});
});

// ---- renderBlock ----

test("renderBlock renders a paragraph without <p> when tight", async ({
	page,
	context,
}) => {
	await background(page, context);
	let out;
	await test.step('When renderBlock renders the para block with the lines "a" and " b " with tight set', async () => {
		out = await page.evaluate(() =>
			window.md.renderBlock(
				{ kind: "para", lines: ["a", " b "] },
				{ tight: true },
			),
		);
	});
	await thenTheHtmlIs(out, "a<br>b");
});

test("renderBlock renders a heading and a rule from their lines", async ({
	page,
	context,
}) => {
	await background(page, context);
	let out;
	await test.step('When renderBlock renders the heading block "## Sub #" and the hr block "***"', async () => {
		out = await page.evaluate(() => [
			window.md.renderBlock({ kind: "heading", lines: ["## Sub #"] }),
			window.md.renderBlock({ kind: "hr", lines: ["***"] }),
		]);
	});
	await test.step("Then the HTMLs are <h2>Sub</h2> and <hr>", () => {
		expect(out).toEqual(["<h2>Sub</h2>", "<hr>"]);
	});
});
