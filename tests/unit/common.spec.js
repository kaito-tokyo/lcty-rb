// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1004: the scenarios of docs/specs/LCTYSP-1004_common.feature that need the browser, written by hand. Each
// test has the title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the
// two read side by side. The Scenarios of the times, the ids, backendOf(), convUrl() and the settings in localStorage
// run in Node.js (common.test.js).
//
// js/common.js runs in a real browser on the test server's origin, on the empty page of unit-page.js. The time is set
// with page.clock, and every request the module makes (GET /v1/defaults.json) is answered by a route, so the server's
// data does not matter.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const NOW = "2026-11-04T01:23:05.678Z";

/**
 * fn(module, arg) in the page, where module is js/common.js and arg crosses as JSON. Like any function given to
 * page.evaluate, fn is sent as its source, so it must not use anything from this file.
 */
function common(page, fn, arg) {
	return page.evaluate(
		`(async () => (${fn})(await import("/js/common.js"), ${JSON.stringify(arg ?? null)}))()`,
	);
}

/** A fake clock that is paused (an installed clock otherwise runs on with the real time): only runFor moves it. */
async function givenTheClock(page) {
	await test.step("Given the clock is controlled by the test", async () => {
		await page.clock.install({ time: new Date(NOW) });
		await page.clock.pauseAt(new Date(Date.parse(NOW) + 1000));
	});
}

/** The #toast elements of the page: [{text, hidden, role, children}]. */
function toasts(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll("#toast")].map((t) => ({
			text: t.textContent,
			hidden: t.hidden,
			role: t.getAttribute("role"),
			children: t.children.length,
		})),
	);
}

async function theToastSays(page, line, text) {
	await test.step(line, async () => {
		expect(await toasts(page)).toEqual([
			{ text, hidden: false, role: "status", children: 0 },
		]);
	});
}

// ---- query() ----

test("query() returns the first element that matches", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let got;
	await test.step('Given the body has <p class="a" id="one"></p><p class="a" id="two"></p>', async () => {
		await page.evaluate(() => {
			document.body.innerHTML =
				'<p class="a" id="one"></p><p class="a" id="two"></p>';
		});
	});
	await test.step('When query(".a") and query(".none") are called', async () => {
		got = await common(page, ({ query }) => [query(".a")?.id, query(".none")]);
	});
	await test.step('Then they return the element "one" and null', () => {
		expect(got).toEqual(["one", null]);
	});
});

// ---- showToast() ----

test("showToast() makes the #toast status element", async ({
	page,
	context,
}) => {
	await givenAPage(page, context, { body: "<p>para</p>" });
	await test.step("Given the page has no #toast", async () => {
		expect(await toasts(page)).toEqual([]);
	});
	await test.step('When showToast("Saved") is called', () =>
		common(page, ({ showToast }) => showToast("Saved")));
	await test.step('Then the body ends with one #toast whose role is "status"', async () => {
		expect(await page.evaluate(() => document.body.lastElementChild.id)).toBe(
			"toast",
		);
		expect(await toasts(page)).toHaveLength(1);
	});
	await theToastSays(page, 'And it is shown with the text "Saved"', "Saved");
});

test("showToast() uses the #toast the page has", async ({ page, context }) => {
	await givenAPage(page, context);
	await test.step('Given the body has a hidden <div id="toast"> after a paragraph', async () => {
		await page.evaluate(() => {
			document.body.innerHTML =
				'<p>para</p><div id="toast" role="status" hidden>old</div><footer></footer>';
		});
	});
	await test.step('When showToast("Saved") is called', () =>
		common(page, ({ showToast }) => showToast("Saved")));
	await test.step("Then the page still has one #toast, after the paragraph", async () => {
		expect(await toasts(page)).toHaveLength(1);
		expect(
			await page.evaluate(() => {
				const t = document.getElementById("toast");
				return [t.previousElementSibling.tagName, t.nextElementSibling.tagName];
			}),
		).toEqual(["P", "FOOTER"]);
	});
	await theToastSays(page, 'And it is shown with the text "Saved"', "Saved");
});

test("showToast() writes its message as text", async ({ page, context }) => {
	await givenAPage(page, context);
	await test.step('When showToast("<b>bold</b>") is called', () =>
		common(page, ({ showToast }) => showToast("<b>bold</b>")));
	let toast;
	await test.step('Then the text of #toast is "<b>bold</b>"', async () => {
		[toast] = await toasts(page);
		expect(toast.text).toBe("<b>bold</b>");
	});
	await test.step("And #toast has no child elements", () => {
		expect(toast.children).toBe(0);
	});
});

test("A toast hides itself after 4 seconds", async ({ page, context }) => {
	await givenAPage(page, context);
	await givenTheClock(page);
	await test.step('When showToast("Saved") is called', () =>
		common(page, ({ showToast }) => showToast("Saved")));
	await test.step("Then #toast is shown 3999 ms later", async () => {
		await page.clock.runFor(3999);
		expect((await toasts(page))[0].hidden).toBe(false);
	});
	await test.step("And #toast is hidden 4000 ms after the call", async () => {
		await page.clock.runFor(1);
		expect((await toasts(page))[0].hidden).toBe(true);
	});
});

test("A new toast replaces the shown one and restarts the 4 seconds", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenTheClock(page);
	await test.step('When showToast("First") is called', () =>
		common(page, ({ showToast }) => showToast("First")));
	await test.step('And showToast("Second") is called 3000 ms later', async () => {
		await page.clock.runFor(3000);
		await common(page, ({ showToast }) => showToast("Second"));
	});
	await test.step('Then #toast shows "Second" 4000 ms after the first call', async () => {
		await page.clock.runFor(1000);
		expect(await toasts(page)).toEqual([
			{ text: "Second", hidden: false, role: "status", children: 0 },
		]);
	});
	await test.step("And #toast is hidden 4000 ms after the second call", async () => {
		await page.clock.runFor(2999);
		expect((await toasts(page))[0].hidden).toBe(false);
		await page.clock.runFor(1);
		expect((await toasts(page))[0].hidden).toBe(true);
	});
});

// ---- loadSettings() ----

for (const { lang, toast } of [
	{ lang: "en", toast: "Failed to load the settings: 500 boom" },
	{ lang: "ja", toast: "設定の読み込みに失敗しました: 500 boom" },
]) {
	test(`loadSettings() shows a toast and returns null when the defaults cannot be loaded (${lang})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await test.step(`Given the page's lang is "${lang}" and the Japanese table is loaded`, async () => {
			await page.evaluate((lang) => {
				document.documentElement.lang = lang;
			}, lang);
			await page.addScriptTag({ url: "/c/lcty.v1.lang-ja.js" });
		});
		await test.step('And GET /v1/defaults.json answers with the status 500 and the body "boom"', async () => {
			await context.route("**/v1/defaults.json", (route) =>
				route.fulfill({ status: 500, body: "boom" }),
			);
		});
		let got;
		await test.step("When loadSettings() is called", async () => {
			got = await common(page, ({ loadSettings }) => loadSettings());
		});
		await test.step("Then it returns null", () => {
			expect(got).toBeNull();
		});
		await theToastSays(page, `And the toast says "${toast}"`, toast);
	});
}
