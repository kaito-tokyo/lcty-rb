// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1025: the scenarios of docs/specs/LCTYSP-1025_gfm-parser.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one step per line of it, the Background first, so the two
// read side by side.
//
// js/convert/gfm/parse.js runs in Node.js (node-unit.js). The examples, the entity table and the reference HTML are
// those of tests/unit/gfm-reference.js.

import {
	decodeNameFromTable,
	referenceHtml,
	specExamples,
} from "./gfm-reference.js";
import { expect, publicUrl, scenario } from "./node-unit.js";

const { parseGfm } = await import(publicUrl("js/convert/gfm/parse.js"));

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
			expect(decodeNameFromTable("ClockwiseContourIntegral")).toBe("∲");
			expect(decodeNameFromTable("nosuchname")).toBeNull();
		},
	);
	return examples;
}

/** The reference HTML of example e, with extended autolinks when autolink is true, or only when e names them. */
function render(e, autolink = e.extension === "autolink") {
	return referenceHtml(
		parseGfm(e.markdown, decodeNameFromTable, { autolink }),
		{
			tagfilter: e.extension === "tagfilter",
		},
	);
}

scenario(
	"Every example of the GFM spec gives the HTML of its reference",
	async ({ step }) => {
		const examples = await background(step);
		let failed;
		await step(
			"When each example is parsed and written as GFM's reference HTML, with an extension only when the example names it",
			() => {
				failed = examples
					.map((e) => ({ e, got: render(e) }))
					.filter(({ e, got }) => got !== e.html)
					.map(({ e, got }) => ({
						number: e.number,
						section: e.section,
						markdown: e.markdown,
						want: e.html,
						got,
					}));
			},
		);
		await step("Then each gives the HTML of its example, byte for byte", () => {
			expect(failed).toEqual([]);
		});
	},
);

scenario(
	"With the extended autolinks always on, only five examples change",
	async ({ step }) => {
		const examples = await background(step);
		let changed;
		await step(
			"When each example is parsed with the extended autolinks on",
			() => {
				changed = examples.filter((e) => render(e, true) !== e.html);
			},
		);
		await step(
			"Then the examples that change are 610, 614, 616, 619 and 620, each a bare URL or address that becomes a link",
			() => {
				expect(changed.map((e) => e.number)).toEqual([610, 614, 616, 619, 620]);
				for (const e of changed) {
					expect(e.section).toBe("Autolinks");
					expect(render(e, true)).toMatch(/<a href="(?:http|mailto)/);
				}
			},
		);
	},
);

for (const { label, unit } of [
	{ label: "nested brackets", unit: "[" },
	{ label: "unclosed brackets", unit: "[a" },
	{ label: "star runs", unit: "*a" },
	{ label: "underscore runs", unit: "_a_ " },
	{ label: "backticks", unit: "`a" },
	{ label: "nested block quotes", unit: "> " },
	{ label: "nested list items", unit: "- " },
	{ label: "unclosed link destinations", unit: "[](" },
	{ label: "www autolinks", unit: "www.a.b " },
	{ label: "email addresses", unit: "a@b.c " },
]) {
	scenario(
		`A pathological text is parsed in about linear time (${label})`,
		async ({ step }) => {
			await background(step);
			let ms;
			await step(
				`When a text of 100000 repetitions of ${JSON.stringify(unit)} is parsed`,
				() => {
					const text = unit.repeat(100000);
					const start = performance.now();
					parseGfm(text, decodeNameFromTable);
					ms = performance.now() - start;
				},
			);
			await step("Then it takes less than 5 seconds", () => {
				expect(ms).toBeLessThan(5000);
			});
		},
	);
}

scenario(
	"Block quotes and list items nest at most 32 deep",
	async ({ step }) => {
		await background(step);
		let doc;
		await step('When a line of 40 "> " and then "a" is parsed', () => {
			doc = parseGfm(`${"> ".repeat(40)}a`, decodeNameFromTable);
		});
		let inner = null;
		await step(
			"Then the document holds 32 block quotes, one in another",
			() => {
				let depth = 0;
				for (
					let n = doc.firstChild;
					n?.type === "block_quote";
					n = n.firstChild
				) {
					depth++;
					inner = n;
				}
				expect(depth).toBe(32);
			},
		);
		await step(
			'And the innermost holds a paragraph of "> > > > > > > > a"',
			() => {
				const p = inner.firstChild;
				expect(p.type).toBe("paragraph");
				expect(p.children.map((n) => n.literal).join("")).toBe(
					"> > > > > > > > a",
				);
			},
		);
	},
);
