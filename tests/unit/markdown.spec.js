// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1014: the scenarios of docs/specs/LCTYSP-1014_markdown.feature that check how a page's HTML parser reads the
// output ("the HTML put into a page"), written by hand. Each test has the title of its Scenario (an Examples row is
// added in parentheses) and one test.step per line of it, so the two read side by side. The scenarios that check only
// the HTML string run in Node.js (markdown.test.js).
//
// public/js/convert/markdown.js is imported into the empty unit page (tests/unit/unit-page.js), which loads /c/lcty.v1.js for
// the LctyT that tr() needs, and its output is put into a <div> with innerHTML. Texts in the steps are written as in the
// feature, where \n is a newline, \| is | and \\ is \; unquote() turns them into the text the module is given.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** The text a quoted string or a table cell of the feature stands for. */
const unquote = (raw) =>
	raw.replace(/\\(.)/g, (_, c) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c);

const A = (href, text) =>
	`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/** The first lines of every Scenario here: "Given a page on the server's origin" and the import of the module. */
async function givenAPageWithTheModule(page, context, options) {
	await givenAPage(page, context, options);
	await test.step("And the module /js/convert/markdown.js is imported", async () => {
		await page.evaluate(async () => {
			window.md = await import("/js/convert/markdown.js");
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

// ---- Inline ----

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
		await givenAPageWithTheModule(page, context);
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
	await givenAPageWithTheModule(page, context);
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
		await givenAPageWithTheModule(page, context);
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

// ---- Tables ----

test("A table aligns its columns and fills missing cells", async ({
	page,
	context,
}) => {
	await givenAPageWithTheModule(page, context);
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
				[...row.children].map((c) => [
					c.textContent,
					c.className.replace(/^align-/, ""),
				]);
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

// ---- codeBlockHTML ----

test('The "Select all" button follows the page\'s language', async ({
	page,
	context,
}) => {
	await givenAPageWithTheModule(page, context);
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
	let out;
	await test.step('When codeBlockHTML is given the language "" and the code "x"', async () => {
		out = await page.evaluate(() => window.md.codeBlockHTML("", "x"));
	});
	await test.step('Then the button reads "すべて選択"', async () => {
		expect((await codeBlocks(page, out))[0].button).toBe("すべて選択");
	});
});
