// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1027: the scenarios of docs/specs/LCTYSP-1027_tail-converter.feature that read text, written by hand. Each test
// has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it.
//
// js/convert/tail.js runs in Node.js (node-unit.js). The nodes it gives are written as HTML here, in LCTYSP-0017's one
// form, to compare them with gfmHtml and to check them with problemsOf of tests/unit/gfm-reference.js.

import {
	decodeNameFromTable,
	problemsOf,
	specExamples,
} from "./gfm-reference.js";
import { expect, publicUrl, scenario } from "./node-unit.js";

const { tailNodes } = await import(publicUrl("js/convert/tail.js"));
const { gfmHtml } = await import(publicUrl("js/convert/gfm/converter.js"));

const read = (text) => tailNodes(text, { decodeName: decodeNameFromTable });

/** Text escaped as LCTYSP-0017's one form escapes it, in an attribute's value too when attr. */
function escaped(s, attr = false) {
	const t = s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return attr ? t.replaceAll('"', "&quot;") : t;
}

/** The nodes as HTML in LCTYSP-0017's one form. */
function htmlOf(nodes) {
	return nodes
		.map((n) => {
			if (typeof n === "string") return escaped(n);
			const [tag, attrs, children] = n;
			let a = "";
			for (let i = 0; i < (attrs ?? []).length; i += 2)
				a += ` ${attrs[i]}="${escaped(attrs[i + 1], true)}"`;
			if (tag === "br" || tag === "hr") return `<${tag}${a}>`;
			return `<${tag}${a}>${htmlOf(children)}</${tag}>`;
		})
		.join("");
}

// The Examples of "A complete text reads as GFM reads it": case, the markdown
for (const [label, markdown] of [
	[
		"a heading and inlines",
		"# H\n\npara **b** *e* ~~d~~ `c` [l](https://x.org) <https://a.b>\nnext",
	],
	["a nested list", "- a\n- b\n  - c"],
	["a loose list", "- a\n\n- b"],
	["an ordered list from 3", "3) x\n4) y"],
	["a block quote", "> q *e*\n> r"],
	["a table", "| a | b |\n| :- | -: |\n| 1 | 2 |"],
	["a code block", "```js\nlet x;\n```"],
	["task list items", "- [ ] t\n- [x] u"],
	[
		"a suggested next message",
		"a <suggestion-for-user-turn>Go *on*</suggestion-for-user-turn> b",
	],
	["setext headings", "foo\n===\nbar\n---"],
	["nested emphasis", "***x** y*"],
	["a link definition", "[ref]: https://e.org\n\ntext"],
	["character references", "&amp; &copy; &#35; &notit;"],
	["an image", "![alt *x*](https://e.org/i.png)"],
	["extended autolinks", "see www.e.org, https://e.org/a) and a.b@e.org."],
]) {
	scenario(
		`A complete text reads as GFM reads it (${label})`,
		async ({ step }) => {
			let got;
			await step(
				`When ${JSON.stringify(markdown)} and a line end are read by tailNodes`,
				() => {
					got = htmlOf(read(`${markdown}\n`));
				},
			);
			await step(
				"Then the HTML of its nodes is what gfmHtml writes of the same text",
				() => {
					expect(got).toBe(gfmHtml(`${markdown}\n`, decodeNameFromTable));
				},
			);
		},
	);
}

// The Examples of "A tail that may still grow is shown without a guess": case, the markdown, the HTML
for (const [label, markdown, html] of [
	["an unclosed strong", "a **b", "<p>a **b</p>"],
	["an unclosed code span", "a `b", "<p>a `b</p>"],
	["an unfinished link", "[a](http", "<p>[a](http</p>"],
	["a reference link", "[a][b]", "<p>[a][b]</p>"],
	["a table row without its rule", "| a | b |\n| -", "<p>| a | b |<br>| -</p>"],
	["a one-character underline", "a\n-", "<p>a<br>-</p>"],
	[
		"an open code block",
		"```js\nlet a",
		'<div class="codeblock"><div class="codebar"><span class="lang">js</span><button type="button" class="select">Select all</button></div><pre><code data-lang="js">let a</code></pre></div>',
	],
	[
		"a suggestion without its end",
		"<suggestion-for-user-turn>Go",
		'<p><button type="button" class="suggestion">Go</button></p>',
	],
	["a link definition", "[a]: https://e", "(nothing)"],
]) {
	scenario(
		`A tail that may still grow is shown without a guess (${label})`,
		async ({ step }) => {
			let got;
			await step(
				`When ${JSON.stringify(markdown)} is read by tailNodes, its last line growing`,
				() => {
					got = htmlOf(read(markdown));
				},
			);
			await step(`Then the HTML of its nodes is ${html}`, () => {
				expect(got).toBe(html === "(nothing)" ? "" : html);
			});
		},
	);
}

scenario(
	"Every prefix of every example shows only the elements and attributes of LCTYSP-0017",
	async ({ step }) => {
		let examples;
		await step(
			"Given the 672 examples of tests/gfm/spec.txt, with → read as a tab",
			() => {
				examples = specExamples();
				expect(examples).toHaveLength(672);
			},
		);
		const bad = [];
		await step("When every prefix of each example is read by tailNodes", () => {
			for (const e of examples)
				for (let k = 0; k <= e.markdown.length; k++) {
					const text = e.markdown.slice(0, k);
					const problems = problemsOf(htmlOf(read(text)));
					if (problems.length > 0) bad.push({ text, problems });
				}
		});
		await step(
			"Then the HTML of the nodes of each has only the elements and attributes of LCTYSP-0017, each closed in order",
			() => {
				expect(bad.slice(0, 5)).toEqual([]);
			},
		);
	},
);

scenario("A long tail is read in about linear time", async ({ step }) => {
	let ms;
	await step(
		'When texts of 20000 repetitions of "*a ", "_a ", "`a ", "[", "<a ", "a@" and "- a\\n  " are read by tailNodes',
		() => {
			const t0 = performance.now();
			for (const unit of ["*a ", "_a ", "`a ", "[", "<a ", "a@", "- a\n  "])
				read(unit.repeat(20000));
			ms = performance.now() - t0;
		},
	);
	await step("Then it takes less than 5 seconds in all", () => {
		expect(ms).toBeLessThan(5000);
	});
});
