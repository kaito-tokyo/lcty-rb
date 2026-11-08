// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1003: the scenarios of docs/specs/LCTYSP-1003_ui-texts.feature for tr() and the Japanese table, written by
// hand. Each test has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it,
// so the two read side by side. The localize() scenarios work on real elements and run in the browser
// (i18n.spec.js).
//
// js/i18n.js runs in Node.js (node-unit.js). Each Scenario gets its own LctyT, as each page loads its own
// /lcty.v1/lcty.v1.cjs: the classic script is run anew (newLctyT) and its LctyT made the global that tr() reads.
// <html lang> is the stand-in document.documentElement.lang of setLang(), the only part of the document LctyT._()
// reads. The Japanese table is the language script the pages load, /lcty.v1/lcty.v1.lang-ja.cjs itself, run as a
// classic script in this global scope (node:vm), as a <script> tag does.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	expect,
	newLctyT,
	publicUrl,
	runScript,
	scenario,
	setLang,
} from "./node-unit.js";

const { tr } = await import(publicUrl("js/i18n.js"));

/** "Given the page's lang is <label> and <tables>": set <html lang> and load the Japanese table unless noTable. */
async function givenLang(step, lang, { label = `"${lang}"`, noTable } = {}) {
	const tables = noTable
		? "no language table is loaded"
		: "the Japanese table is loaded";
	await step(`Given the page's lang is ${label} and ${tables}`, async () => {
		globalThis.LctyT = newLctyT();
		setLang(lang);
		if (!noTable) runScript("lcty.v1/lcty.v1.lang-ja.cjs");
		expect(Object.hasOwn(LctyT.dicts, "ja")).toBe(!noTable);
	});
}

/** "When <line> is called" / "Then it returns <expected>" for tr(...args). */
async function whenTrThen(step, line, args, expected) {
	let got;
	await step(`When ${line} is called`, () => {
		got = tr(...args);
	});
	await step(`Then it returns "${expected}"`, () => {
		expect(got).toBe(expected);
	});
}

// ---- tr() ----

scenario("An English page shows the English text", async ({ step }) => {
	await givenLang(step, "en");
	await whenTrThen(
		step,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"Delete",
	);
});

scenario("A Japanese page shows the Japanese text", async ({ step }) => {
	await givenLang(step, "ja");
	await whenTrThen(
		step,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"削除",
	);
});

scenario(
	"A key the language does not have shows the English text",
	async ({ step }) => {
		await givenLang(step, "ja");
		await whenTrThen(
			step,
			'tr("noSuchKey", "No such text")',
			["noSuchKey", "No such text"],
			"No such text",
		);
	},
);

for (const { label, lang } of [
	{ label: '"ja-JP" (not matched exactly)', lang: "ja-JP" },
	{ label: '"JA" (not matched exactly)', lang: "JA" },
	{ label: '"fr" (no table)', lang: "fr" },
	{ label: '"" (no language)', lang: "" },
]) {
	scenario(
		`A language that is not registered shows the English text (${label})`,
		async ({ step }) => {
			await givenLang(step, lang, { label });
			await whenTrThen(
				step,
				'tr("delete", "Delete")',
				["delete", "Delete"],
				"Delete",
			);
		},
	);
}

scenario(
	"Without the Japanese table a Japanese page shows the English text",
	async ({ step }) => {
		await givenLang(step, "ja", { noTable: true });
		await whenTrThen(
			step,
			'tr("delete", "Delete")',
			["delete", "Delete"],
			"Delete",
		);
	},
);

scenario("An empty translation counts as none", async ({ step }) => {
	await step(
		'Given the page\'s lang is "xx" and the language "xx" has the empty text for "delete"',
		async () => {
			globalThis.LctyT = newLctyT();
			setLang("xx");
			LctyT.addLang("xx", { delete: "" });
		},
	);
	await whenTrThen(
		step,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"Delete",
	);
});

scenario("Only the table's own keys are translations", async ({ step }) => {
	await givenLang(step, "ja");
	await whenTrThen(
		step,
		'tr("toString", "To string")',
		["toString", "To string"],
		"To string",
	);
});

scenario("A missing English text shows as undefined", async ({ step }) => {
	await givenLang(step, "en");
	let got;
	await step('When tr("noSuchKey") is called without a text', () => {
		got = tr("noSuchKey");
	});
	await step('Then it returns "undefined"', () => {
		expect(got).toBe("undefined");
	});
});

scenario("Placeholders are filled from vars", async ({ step }) => {
	await givenLang(step, "en");
	await whenTrThen(
		step,
		'tr("searchFailed", "Search failed: {error}", { error: "boom" })',
		["searchFailed", "Search failed: {error}", { error: "boom" }],
		"Search failed: boom",
	);
});

scenario("Placeholders are filled in the Japanese text", async ({ step }) => {
	await givenLang(step, "ja");
	await whenTrThen(
		step,
		'tr("confirmDelete", "Delete \\"{title}\\"?", { title: "Plans" })',
		["confirmDelete", 'Delete "{title}"?', { title: "Plans" }],
		"「Plans」を削除しますか？",
	);
});

scenario("A placeholder written twice is filled twice", async ({ step }) => {
	await givenLang(step, "en");
	await whenTrThen(
		step,
		'tr("k", "{name} and {name}", { name: "x" })',
		["k", "{name} and {name}", { name: "x" }],
		"x and x",
	);
});

scenario(
	"A placeholder vars does not have stays as written",
	async ({ step }) => {
		await givenLang(step, "en");
		await whenTrThen(
			step,
			'tr("k", "{error} at {where}", { error: "boom" })',
			["k", "{error} at {where}", { error: "boom" }],
			"boom at {where}",
		);
	},
);

scenario(
	"Without vars every placeholder stays as written",
	async ({ step }) => {
		await givenLang(step, "ja");
		await whenTrThen(
			step,
			'tr("messageCount", "{n} messages")',
			["messageCount", "{n} messages"],
			"{n}件",
		);
	},
);

scenario(
	"Only the own properties of vars fill placeholders",
	async ({ step }) => {
		await givenLang(step, "en");
		await whenTrThen(
			step,
			'tr("k", "{toString} {constructor} {a}", { a: "A" })',
			["k", "{toString} {constructor} {a}", { a: "A" }],
			"{toString} {constructor} A",
		);
	},
);

scenario(
	"Values that are not strings are converted to strings",
	async ({ step }) => {
		await givenLang(step, "en");
		await whenTrThen(
			step,
			'tr("k", "{n}|{zero}|{no}|{nothing}", { n: 3, zero: 0, no: false, nothing: null })',
			[
				"k",
				"{n}|{zero}|{no}|{nothing}",
				{ n: 3, zero: 0, no: false, nothing: null },
			],
			"3|0|false|null",
		);
	},
);

scenario("A filled value is not filled again", async ({ step }) => {
	await givenLang(step, "en");
	await whenTrThen(
		step,
		'tr("k", "{a} {b}", { a: "{b}", b: "B" })',
		["k", "{a} {b}", { a: "{b}", b: "B" }],
		"{b} B",
	);
});

scenario("Only names of word characters are placeholders", async ({ step }) => {
	await givenLang(step, "en");
	await whenTrThen(
		step,
		'tr("k", "{a-b} {a b} {} {a_1}", { "a-b": "x", "a b": "y", "": "z", a_1: "w" })',
		[
			"k",
			"{a-b} {a b} {} {a_1}",
			{ "a-b": "x", "a b": "y", "": "z", a_1: "w" },
		],
		"{a-b} {a b} {} w",
	);
});

// ---- The Japanese table ----

scenario("The Japanese table is frozen when registered", async ({ step }) => {
	await givenLang(step, "ja");
	await step('When a script sets LctyT.dicts.ja.delete to "changed"', () => {
		try {
			// a classic script is sloppy mode: ignored without an error
			runInThisContext('LctyT.dicts.ja.delete = "changed";');
		} catch {}
	});
	await step('Then tr("delete", "Delete") still returns "削除"', () => {
		expect(tr("delete", "Delete")).toBe("削除");
		expect(Object.isFrozen(LctyT.dicts.ja)).toBe(true);
	});
});

scenario(
	"The keys of the Japanese table are the keys of LctyTextKey",
	async ({ step }) => {
		await givenLang(step, "ja");
		let keys;
		await step(
			"When the keys of LctyT.dicts.ja are compared with LctyTextKey of /lcty.v1/lcty.v1.d.cts",
			() => {
				const dts = readFileSync(
					fileURLToPath(publicUrl("lcty.v1/lcty.v1.d.cts")),
					"utf8",
				);
				const union = dts.match(/type LctyTextKey =([^;]*);/)[1];
				keys = {
					ja: Object.keys(LctyT.dicts.ja).sort(),
					texts: Object.values(LctyT.dicts.ja),
					dts: [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort(),
				};
			},
		);
		await step("Then each is in the other", () => {
			expect(keys.dts.length).toBeGreaterThan(0);
			expect(keys.ja).toEqual(keys.dts);
		});
		await step("And every Japanese text is a non-empty string", () => {
			for (const text of keys.texts) {
				expect(typeof text).toBe("string");
				expect(text.length).toBeGreaterThan(0);
			}
		});
	},
);
