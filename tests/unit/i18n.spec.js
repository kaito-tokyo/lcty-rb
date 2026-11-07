// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1003: the scenarios of docs/specs/LCTYSP-1003_ui-texts.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/i18n.js runs in a real browser on the test server's origin, on the empty page of unit-page.js, which loads
// /c/lcty.v1.js (the global LctyT). The Given lines set <html lang> and load the language script, as a page does in its
// head: LctyT._ reads <html lang> at every call, so setting it after the page has loaded is the same.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** "Given the page's lang is <label> and <tables>": set <html lang> and load the Japanese table unless noTable. */
async function givenLang(page, lang, { label = `"${lang}"`, noTable } = {}) {
	const tables = noTable
		? "no language table is loaded"
		: "the Japanese table is loaded";
	await test.step(`Given the page's lang is ${label} and ${tables}`, async () => {
		await page.evaluate((lang) => {
			document.documentElement.lang = lang;
		}, lang);
		if (!noTable) await page.addScriptTag({ url: "/c/lcty.v1.lang-ja.js" });
		expect(await page.evaluate(() => Object.hasOwn(LctyT.dicts, "ja"))).toBe(
			!noTable,
		);
	});
}

/** tr(...args) in the page. */
function tr(page, args) {
	return page.evaluate(
		async (args) => (await import("/js/i18n.js")).tr(...args),
		args,
	);
}

/** "When <line> is called" / "Then it returns <expected>" for tr(...args). */
async function whenTrThen(page, line, args, expected) {
	let got;
	await test.step(`When ${line} is called`, async () => {
		got = await tr(page, args);
	});
	await test.step(`Then it returns "${expected}"`, () => {
		expect(got).toBe(expected);
	});
}

/** "And the body has <html>" */
async function givenBody(page, html) {
	await test.step(`And the body has ${html}`, async () => {
		await page.evaluate((html) => {
			document.body.innerHTML = html;
		}, html);
	});
}

async function whenLocalizeRuns(page) {
	await test.step("When localize() runs", async () => {
		await page.evaluate(async () => (await import("/js/i18n.js")).localize());
	});
}

/** The text and the attributes of the element selector finds. */
function inspect(page, selector) {
	return page.evaluate((selector) => {
		const el = document.querySelector(selector);
		return {
			text: el.textContent,
			attrs: Object.fromEntries(
				[...el.attributes].map((a) => [a.name, a.value]),
			),
		};
	}, selector);
}

// ---- tr() ----

test("An English page shows the English text", async ({ page, context }) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"Delete",
	);
});

test("A Japanese page shows the Japanese text", async ({ page, context }) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await whenTrThen(
		page,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"削除",
	);
});

test("A key the language does not have shows the English text", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await whenTrThen(
		page,
		'tr("noSuchKey", "No such text")',
		["noSuchKey", "No such text"],
		"No such text",
	);
});

for (const { label, lang } of [
	{ label: '"ja-JP" (not matched exactly)', lang: "ja-JP" },
	{ label: '"JA" (not matched exactly)', lang: "JA" },
	{ label: '"fr" (no table)', lang: "fr" },
	{ label: '"" (no language)', lang: "" },
]) {
	test(`A language that is not registered shows the English text (${label})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await givenLang(page, lang, { label });
		await whenTrThen(
			page,
			'tr("delete", "Delete")',
			["delete", "Delete"],
			"Delete",
		);
	});
}

test("Without the Japanese table a Japanese page shows the English text", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja", { noTable: true });
	await whenTrThen(
		page,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"Delete",
	);
});

test("An empty translation counts as none", async ({ page, context }) => {
	await givenAPage(page, context);
	await test.step('Given the page\'s lang is "xx" and the language "xx" has the empty text for "delete"', async () => {
		await page.evaluate(() => {
			document.documentElement.lang = "xx";
			LctyT.addLang("xx", { delete: "" });
		});
	});
	await whenTrThen(
		page,
		'tr("delete", "Delete")',
		["delete", "Delete"],
		"Delete",
	);
});

test("Only the table's own keys are translations", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await whenTrThen(
		page,
		'tr("toString", "To string")',
		["toString", "To string"],
		"To string",
	);
});

test("A missing English text shows as undefined", async ({ page, context }) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	let got;
	await test.step('When tr("noSuchKey") is called without a text', async () => {
		got = await tr(page, ["noSuchKey"]);
	});
	await test.step('Then it returns "undefined"', () => {
		expect(got).toBe("undefined");
	});
});

test("Placeholders are filled from vars", async ({ page, context }) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("searchFailed", "Search failed: {error}", { error: "boom" })',
		["searchFailed", "Search failed: {error}", { error: "boom" }],
		"Search failed: boom",
	);
});

test("Placeholders are filled in the Japanese text", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await whenTrThen(
		page,
		'tr("confirmDelete", "Delete \\"{title}\\"?", { title: "Plans" })',
		["confirmDelete", 'Delete "{title}"?', { title: "Plans" }],
		"「Plans」を削除しますか？",
	);
});

test("A placeholder written twice is filled twice", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("k", "{name} and {name}", { name: "x" })',
		["k", "{name} and {name}", { name: "x" }],
		"x and x",
	);
});

test("A placeholder vars does not have stays as written", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("k", "{error} at {where}", { error: "boom" })',
		["k", "{error} at {where}", { error: "boom" }],
		"boom at {where}",
	);
});

test("Without vars every placeholder stays as written", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await whenTrThen(
		page,
		'tr("messageCount", "{n} messages")',
		["messageCount", "{n} messages"],
		"{n}件",
	);
});

test("Only the own properties of vars fill placeholders", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("k", "{toString} {constructor} {a}", { a: "A" })',
		["k", "{toString} {constructor} {a}", { a: "A" }],
		"{toString} {constructor} A",
	);
});

test("Values that are not strings are converted to strings", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("k", "{n}|{zero}|{no}|{nothing}", { n: 3, zero: 0, no: false, nothing: null })',
		[
			"k",
			"{n}|{zero}|{no}|{nothing}",
			{ n: 3, zero: 0, no: false, nothing: null },
		],
		"3|0|false|null",
	);
});

test("A filled value is not filled again", async ({ page, context }) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
		'tr("k", "{a} {b}", { a: "{b}", b: "B" })',
		["k", "{a} {b}", { a: "{b}", b: "B" }],
		"{b} B",
	);
});

test("Only names of word characters are placeholders", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await whenTrThen(
		page,
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

test("The Japanese table is frozen when registered", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await test.step('When a script sets LctyT.dicts.ja.delete to "changed"', async () => {
		await page.evaluate(() => {
			try {
				LctyT.dicts.ja.delete = "changed"; // a classic script is sloppy mode: ignored without an error
			} catch {}
		});
	});
	await test.step('Then tr("delete", "Delete") still returns "削除"', async () => {
		expect(await tr(page, ["delete", "Delete"])).toBe("削除");
		expect(await page.evaluate(() => Object.isFrozen(LctyT.dicts.ja))).toBe(
			true,
		);
	});
});

test("The keys of the Japanese table are the keys of LctyTextKey", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	let keys;
	await test.step("When the keys of LctyT.dicts.ja are compared with LctyTextKey of /c/lcty.v1.d.ts", async () => {
		// The server does not serve .d.ts files: the test reads it from the repository
		const dts = readFileSync(
			fileURLToPath(new URL("../../public/c/lcty.v1.d.ts", import.meta.url)),
			"utf8",
		);
		const union = dts.match(/type LctyTextKey =([^;]*);/)[1];
		keys = await page.evaluate(() => ({
			ja: Object.keys(LctyT.dicts.ja).sort(),
			texts: Object.values(LctyT.dicts.ja),
		}));
		keys.dts = [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
	});
	await test.step("Then each is in the other", () => {
		expect(keys.dts.length).toBeGreaterThan(0);
		expect(keys.ja).toEqual(keys.dts);
	});
	await test.step("And every Japanese text is a non-empty string", () => {
		for (const text of keys.texts) {
			expect(typeof text).toBe("string");
			expect(text.length).toBeGreaterThan(0);
		}
	});
});

// ---- localize() ----

test("localize() replaces the text of data-lcty-t elements", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await givenBody(page, '<button data-lcty-t="delete">Delete</button>');
	await whenLocalizeRuns(page);
	await test.step('Then the button\'s text is "削除"', async () => {
		expect((await inspect(page, "button")).text).toBe("削除");
	});
});

test("localize() keeps the English written in the HTML on an English page", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "en");
	await givenBody(page, '<button data-lcty-t="delete">Delete</button>');
	await whenLocalizeRuns(page);
	await test.step('Then the button\'s text is "Delete"', async () => {
		expect((await inspect(page, "button")).text).toBe("Delete");
	});
});

test("localize() keeps the English written in the HTML for a key the language does not have", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await givenBody(page, '<button data-lcty-t="noSuchKey">Written</button>');
	await whenLocalizeRuns(page);
	await test.step('Then the button\'s text is "Written"', async () => {
		expect((await inspect(page, "button")).text).toBe("Written");
	});
});

for (const attribute of ["placeholder", "title", "aria-label"]) {
	test(`localize() replaces the attribute of data-lcty-t-<attribute> elements (${attribute})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await givenLang(page, "ja");
		await givenBody(
			page,
			`<input data-lcty-t-${attribute}="searchPlaceholder" ${attribute}="Search conversations">`,
		);
		let el;
		await whenLocalizeRuns(page);
		await test.step(`Then the input's ${attribute} is "会話を検索"`, async () => {
			el = await inspect(page, "input");
			expect(el.attrs[attribute]).toBe("会話を検索");
		});
		await test.step("And its text and its other attributes are unchanged", () => {
			expect(el.text).toBe("");
			expect(el.attrs).toEqual({
				[`data-lcty-t-${attribute}`]: "searchPlaceholder",
				[attribute]: "会話を検索",
			});
		});
	});
}

test("localize() keeps an attribute's English for a key the language does not have", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await givenBody(
		page,
		'<input data-lcty-t-title="noSuchKey" title="Written">',
	);
	await whenLocalizeRuns(page);
	await test.step('Then the input\'s title is "Written"', async () => {
		expect((await inspect(page, "input")).attrs.title).toBe("Written");
	});
});

test("localize() replaces the text and the attributes of one element", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await givenBody(
		page,
		'<button data-lcty-t="delete" data-lcty-t-title="refreshList" title="Refresh">Delete</button>',
	);
	let el;
	await whenLocalizeRuns(page);
	await test.step('Then the button\'s text is "削除"', async () => {
		el = await inspect(page, "button");
		expect(el.text).toBe("削除");
	});
	await test.step('And the button\'s title is "一覧を読み込み直す"', () => {
		expect(el.attrs.title).toBe("一覧を読み込み直す");
	});
});

test("localize() leaves placeholders in the texts as they are", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await givenBody(page, '<span data-lcty-t="messageCount">{n} messages</span>');
	await whenLocalizeRuns(page);
	await test.step('Then the span\'s text is "{n}件"', async () => {
		expect((await inspect(page, "span")).text).toBe("{n}件");
	});
});

test("localize(root) localizes only the elements inside root", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenLang(page, "ja");
	await givenBody(
		page,
		'<div id="root"><b data-lcty-t="delete">Delete</b></div><i data-lcty-t="delete">Delete</i>',
	);
	await test.step("When localize() runs on the div", async () => {
		await page.evaluate(async () =>
			(await import("/js/i18n.js")).localize(document.getElementById("root")),
		);
	});
	await test.step('Then the text of b is "削除"', async () => {
		expect((await inspect(page, "b")).text).toBe("削除");
	});
	await test.step('And the text of i is still "Delete"', async () => {
		expect((await inspect(page, "i")).text).toBe("Delete");
	});
});
