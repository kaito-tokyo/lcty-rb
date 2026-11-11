// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1025: the scenarios of docs/specs/LCTYSP-1025_gfm-parser.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one step per line of it, the Background first, so the two
// read side by side.
//
// js/convert/gfm/converter.js runs in Node.js (node-unit.js). The examples, the entity table and the reference HTML are
// those of tests/unit/gfm-reference.js.

import {
	decodeNameFromTable,
	referenceHtml,
	specExamples,
} from "./gfm-reference.js";
import { expect, publicUrl, scenario } from "./node-unit.js";

const { BlockWatch, parseBlocks, parseGfm } = await import(
	publicUrl("js/convert/gfm/converter.js")
);
const { BLOCK_QUOTE, BlockParser, leafText, PARAGRAPH } = await import(
	publicUrl("js/convert/gfm/gfm_blocks.js")
);
const { InlineParser, inlineRoot } = await import(
	publicUrl("js/convert/gfm/gfm_inlines.js")
);

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
		e.markdown,
		{ tagfilter: e.extension === "tagfilter" },
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
	{ label: "lists and quotes by turns", unit: "- a\n> b\n" },
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
				const t = doc.blocks;
				let depth = 0;
				for (
					let n = t.first[0];
					n !== -1 && t.type[n] === BLOCK_QUOTE;
					n = t.first[n]
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
				const p = doc.blocks.first[inner];
				expect(doc.blocks.type[p]).toBe(PARAGRAPH);
				const text = doc.inlines[p].children.map((n) => n.view.join(""));
				expect(text.join("")).toBe("> > > > > > > > a");
			},
		);
	},
);

/** The examples without a link reference definition, whose blocks are parsed on their own alike. */
function withoutDefinitions(examples) {
	return examples.filter(
		(e) => parseBlocks(e.markdown, decodeNameFromTable).refmap.size === 0,
	);
}

/**
 * Example e pushed a character at a time into one BlockParser, the inlines of each block its advance takes parsed at
 * once and the block written as GFM's reference HTML, the rest taken with end at the end: the HTML of the blocks, one
 * after another, and of the whole example. advance is tried after each character until it needs more text, or, with a
 * BlockWatch, only when the watch says the head may have ended its block.
 */
function pushed(e, watch = null) {
	const parser = new BlockParser(decodeNameFromTable);
	const inlines = new InlineParser(decodeNameFromTable, parser.refmap, {
		autolink: e.extension === "autolink",
	});
	let got = "";
	// the document so far: the parser's blocks and ranges, and the inlines of the leaves taken
	const doc = { blocks: parser.blocks, ranges: parser.store, inlines: [] };
	const take = (step) => {
		for (const leaf of step[3]) {
			const root = inlineRoot();
			inlines.parse(
				root,
				leafText(e.markdown, parser.blocks, parser.store, leaf),
			);
			doc.inlines[leaf] = root;
		}
		if (step[2] !== -1)
			got += referenceHtml(
				doc,
				e.markdown,
				{ tagfilter: e.extension === "tagfilter" },
				step[2],
			);
	};
	// head is the text pushed so far that no block has taken; the nodes' offsets count from the start of the text
	let head = "";
	let pushedLength = 0;
	for (const c of e.markdown) {
		head += c;
		pushedLength += c.length;
		while (watch === null || watch.mayEnd(head)) {
			const step = parser.advance(head, false, pushedLength - head.length);
			if (step === undefined) {
				if (watch === null) break;
				continue;
			}
			watch?.reset();
			head = step[0];
			if (step[1] === undefined) break;
			take(step);
		}
	}
	for (;;) {
		const step = parser.advance(head, true, pushedLength - head.length);
		if (step[1] === undefined) break;
		head = step[0];
		take(step);
	}
	return { number: e.number, got, want: render(e) };
}

scenario(
	"A text pushed a character at a time gives, block by block, the HTML of the whole text",
	async ({ step }) => {
		const examples = await background(step);
		let results;
		await step(
			"When each of the 594 examples without a link reference definition is pushed a character at a time into one BlockParser, the inlines of each block its advance takes parsed at once, and the rest taken with end at the end",
			() => {
				const plain = withoutDefinitions(examples);
				expect(plain).toHaveLength(594);
				results = plain.map((e) => pushed(e));
			},
		);
		await step(
			"Then the HTML of the blocks, one after another, is the HTML of the whole example, byte for byte",
			() => {
				expect(results.filter((r) => r.got !== r.want)).toEqual([]);
			},
		);
	},
);

scenario(
	"With BlockWatch deciding when to try advance, the HTML is still that of the whole text",
	async ({ step }) => {
		const examples = await background(step);
		let results;
		await step(
			"When each of the 594 examples is pushed a character at a time, advance tried only when BlockWatch says the head may have ended its block",
			() => {
				const plain = withoutDefinitions(examples);
				expect(plain).toHaveLength(594);
				results = plain.map((e) => pushed(e, new BlockWatch()));
			},
		);
		await step(
			"Then the HTML of the blocks, one after another, is the HTML of the whole example, byte for byte",
			() => {
				expect(results.filter((r) => r.got !== r.want)).toEqual([]);
			},
		);
	},
);
