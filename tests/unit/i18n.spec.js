// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1003: the localize() scenarios of docs/specs/LCTYSP-1003_ui-texts.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read
// side by side. The scenarios of tr() and the Japanese table run in Node.js (i18n.test.js).
//
// localize() works on real elements, so js/i18n.js runs here in a real browser on the test server's origin, on the
// empty page of unit-page.js, which loads /c/lcty.v1.js (the global LctyT). The Given lines set <html lang> and load
// the language script, as a page does in its head: LctyT._ reads <html lang> at every call, so setting it after the
// page has loaded is the same.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** "Given the page's lang is <lang> and the Japanese table is loaded": set <html lang> and load the Japanese table. */
async function givenLang(page, lang) {
	await test.step(`Given the page's lang is "${lang}" and the Japanese table is loaded`, async () => {
		await page.evaluate((lang) => {
			document.documentElement.lang = lang;
		}, lang);
		await page.addScriptTag({ url: "/c/lcty.v1.lang-ja.js" });
		expect(await page.evaluate(() => Object.hasOwn(LctyT.dicts, "ja"))).toBe(
			true,
		);
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
	test(`localize() replaces the attribute an element names for localization (${attribute})`, async ({
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
