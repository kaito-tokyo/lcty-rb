// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1004: the scenarios of docs/specs/LCTYSP-1004_common.feature that need the browser, written by hand. Each
// test has the title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the
// two read side by side. The Scenarios of the times, the ids, backendOf() and convUrl() run in Node.js
// (common.test.js).
//
// js/common.js runs in a real browser on the test server's origin, on the empty page of unit-page.js. The time is set
// with page.clock, and every request the module makes (GET /v1/defaults.json, GET /v1/vectors/pending) is answered by a
// route, so the server's data does not matter.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const SETTINGS_KEY = "lcty.settings.v1";
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

function setStored(page, raw) {
	return page.evaluate(
		({ key, raw }) =>
			raw === null
				? localStorage.removeItem(key)
				: localStorage.setItem(key, raw),
		{ key: SETTINGS_KEY, raw },
	);
}

function getStored(page) {
	return page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
}

async function givenStored(page, raw, label = raw) {
	await test.step(`Given localStorage "${SETTINGS_KEY}" holds ${label}`, () =>
		setStored(page, raw));
}

async function thenStored(page, raw) {
	await test.step(`And localStorage "${SETTINGS_KEY}" holds ${raw}`, async () => {
		expect(await getStored(page)).toBe(raw);
	});
}

/** The settings of the pages with one backend whose embedding model is model. */
function settingsWith(model) {
	return {
		backends: [
			{
				id: "local",
				label: "llama-server",
				base_url: "http://127.0.0.1:9",
				api: "responses",
				api_key: "",
				model: "chat",
				embedding_model: model,
				extra: {},
			},
		],
		default_backend: "local",
	};
}

/** GET /v1/vectors/pending answered by answer; returns the URLs requested. */
async function routePending(context, answer) {
	const urls = [];
	await context.route("**/v1/vectors/pending**", (route) => {
		const url = new URL(route.request().url());
		urls.push(`${url.pathname}${url.search}`);
		return answer(route);
	});
	return urls;
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

// ---- Settings ----

/** "Given the defaults …" (or "And the defaults …"), "When storeSettings() is given …", "Then it returns …". */
async function storeSettingsSteps(page, { first, defaults, values, returns }) {
	let got;
	await test.step(`${first} the defaults ${defaults.label}`, () => {});
	await test.step(`When storeSettings() is given ${values.label}`, async () => {
		got = await common(
			page,
			({ storeSettings }, { values, defaults }) =>
				storeSettings(values, defaults),
			{ values: values.value, defaults: defaults.value },
		);
	});
	await test.step(`Then it returns ${returns.label}`, () => {
		expect(got).toEqual(returns.value);
	});
}

test("storeSettings() stores only the values that differ from the defaults", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await storeSettingsSteps(page, {
		first: "Given",
		defaults: {
			label: '{ base_url: "http://d", model: "m", api_key: "k" }',
			value: { base_url: "http://d", model: "m", api_key: "k" },
		},
		values: {
			label: '{ base_url: "http://d", model: "other", api_key: "k" }',
			value: { base_url: "http://d", model: "other", api_key: "k" },
		},
		returns: { label: '{ model: "other" }', value: { model: "other" } },
	});
	await thenStored(page, '{"model":"other"}');
});

test("storeSettings() ignores the keys the defaults do not have", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await storeSettingsSteps(page, {
		first: "Given",
		defaults: { label: '{ model: "m" }', value: { model: "m" } },
		values: {
			label: '{ model: "other", unknown: "x" }',
			value: { model: "other", unknown: "x" },
		},
		returns: { label: '{ model: "other" }', value: { model: "other" } },
	});
	await thenStored(page, '{"model":"other"}');
});

test("storeSettings() keeps the default of a key the values do not have", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await storeSettingsSteps(page, {
		first: "Given",
		defaults: {
			label: '{ model: "m", api_key: "k" }',
			value: { model: "m", api_key: "k" },
		},
		values: { label: '{ api_key: "" }', value: { api_key: "" } },
		returns: { label: '{ api_key: "" }', value: { api_key: "" } },
	});
	await thenStored(page, '{"api_key":""}');
});

test("storeSettings() removes the stored changes when nothing differs", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenStored(page, '{"model":"other"}');
	await storeSettingsSteps(page, {
		first: "And",
		defaults: { label: '{ model: "m" }', value: { model: "m" } },
		values: { label: '{ model: "m" }', value: { model: "m" } },
		returns: { label: "{}", value: {} },
	});
	await test.step(`And localStorage has no "${SETTINGS_KEY}"`, async () => {
		expect(await getStored(page)).toBeNull();
	});
});

test("storeSettings() replaces the stored changes as a whole", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenStored(page, '{"model":"other"}');
	await storeSettingsSteps(page, {
		first: "And",
		defaults: {
			label: '{ model: "m", api_key: "k" }',
			value: { model: "m", api_key: "k" },
		},
		values: {
			label: '{ model: "m", api_key: "mine" }',
			value: { model: "m", api_key: "mine" },
		},
		returns: { label: '{ api_key: "mine" }', value: { api_key: "mine" } },
	});
	await thenStored(page, '{"api_key":"mine"}');
});

test("mergeSettings() overlays the defaults with the stored changes", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await givenStored(page, '{"model":"other"}');
	let got;
	await test.step('When mergeSettings() is given the defaults { base_url: "http://d", model: "m" }', async () => {
		got = await common(page, ({ mergeSettings }) =>
			mergeSettings({ base_url: "http://d", model: "m" }),
		);
	});
	await test.step('Then it returns { base_url: "http://d", model: "other" }', () => {
		expect(got).toEqual({ base_url: "http://d", model: "other" });
	});
});

test("mergeSettings() ignores unknown keys and values of another type", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let got;
	await test.step('When mergeSettings() is given the defaults { model: "m", count: 3 } and the changes { model: 5, count: 4, unknown: "x" }', async () => {
		got = await common(page, ({ mergeSettings }) =>
			mergeSettings(
				{ model: "m", count: 3 },
				{ model: 5, count: 4, unknown: "x" },
			),
		);
	});
	await test.step('Then it returns { model: "m", count: 4 }', () => {
		expect(got).toEqual({ model: "m", count: 4 });
	});
});

for (const { label, raw } of [
	{ label: "not JSON", raw: "not JSON" },
	{ label: "null", raw: "null" },
	{ label: '["model"]', raw: '["model"]' },
	{ label: '"model"', raw: '"model"' },
	{ label: "nothing", raw: null },
]) {
	test(`mergeSettings() uses the defaults when the stored changes cannot be read (${label})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await givenStored(page, raw, label);
		let got;
		await test.step('When mergeSettings() is given the defaults { model: "m" }', async () => {
			got = await common(page, ({ mergeSettings }) =>
				mergeSettings({ model: "m" }),
			);
		});
		await test.step('Then it returns { model: "m" }', () => {
			expect(got).toEqual({ model: "m" });
		});
	});
}

test("loadSettings() makes the backend of the pages from the defaults and the stored changes", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await test.step('Given GET /v1/defaults.json returns { base_url: "http://d", api_key: "k", model: "m", embedding_model: "e" }', async () => {
		await context.route("**/v1/defaults.json", (route) =>
			route.fulfill({
				json: {
					base_url: "http://d",
					api_key: "k",
					model: "m",
					embedding_model: "e",
				},
			}),
		);
	});
	await test.step(`And localStorage "${SETTINGS_KEY}" holds {"model":"other"}`, () =>
		setStored(page, '{"model":"other"}'));
	let got;
	await test.step("When loadSettings() is called", async () => {
		got = await common(page, ({ loadSettings }) => loadSettings());
	});
	await test.step('Then it returns the one backend "local" of the default backend "local", with the model "other" and the rest of the defaults', () => {
		expect(got).toEqual({
			backends: [
				{
					id: "local",
					label: "llama-server",
					base_url: "http://d",
					api: "responses",
					api_key: "k",
					model: "other",
					embedding_model: "e",
					extra: {},
				},
			],
			default_backend: "local",
		});
	});
});

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

// ---- appIndexer() ----

test("The indexer does nothing without settings", async ({ page, context }) => {
	await givenAPage(page, context);
	let urls;
	await test.step("Given GET /v1/vectors/pending is answered by the test", async () => {
		urls = await routePending(context, (route) => route.fulfill({ json: [] }));
	});
	await test.step("When the indexer of appIndexer() with no settings is kicked", () =>
		common(page, ({ appIndexer }) => appIndexer(() => null).kick()));
	await test.step("Then no request is sent to /v1/vectors/pending", () => {
		expect(urls).toEqual([]);
	});
});

test("The indexer does nothing without an embedding model", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let urls;
	await test.step("Given GET /v1/vectors/pending is answered by the test", async () => {
		urls = await routePending(context, (route) => route.fulfill({ json: [] }));
	});
	await test.step('When the indexer of appIndexer() with settings whose embedding model is "" is kicked', () =>
		common(
			page,
			({ appIndexer }, settings) => appIndexer(() => settings).kick(),
			settingsWith(""),
		));
	await test.step("Then no request is sent to /v1/vectors/pending", () => {
		expect(urls).toEqual([]);
	});
});

test("The indexer asks for the pending rounds of the embedding model", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let urls;
	await test.step("Given GET /v1/vectors/pending returns no rounds", async () => {
		urls = await routePending(context, (route) => route.fulfill({ json: [] }));
	});
	await test.step('When the indexer of appIndexer() with settings whose embedding model is "embed" is kicked', () =>
		common(
			page,
			({ appIndexer }, settings) => appIndexer(() => settings).kick(),
			settingsWith("embed"),
		));
	await test.step("Then GET /v1/vectors/pending?model=embed&limit=16 is sent once", () => {
		expect(urls).toEqual(["/v1/vectors/pending?model=embed&limit=16"]);
	});
	await test.step("And no toast is shown", async () => {
		expect(await toasts(page)).toEqual([]);
	});
});

test("The indexer reads the settings at every kick", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let urls;
	await test.step("Given GET /v1/vectors/pending returns no rounds", async () => {
		urls = await routePending(context, (route) => route.fulfill({ json: [] }));
	});
	await test.step("And the indexer of appIndexer() has no settings", () =>
		common(page, ({ appIndexer }) => {
			window.lctyTest = { settings: null };
			window.lctyTest.indexer = appIndexer(() => window.lctyTest.settings);
		}));
	await test.step('When it is kicked, then given settings whose embedding model is "embed" and kicked again', () =>
		page.evaluate(async (settings) => {
			await window.lctyTest.indexer.kick();
			window.lctyTest.settings = settings;
			await window.lctyTest.indexer.kick();
		}, settingsWith("embed")));
	await test.step("Then GET /v1/vectors/pending?model=embed&limit=16 is sent once", () => {
		expect(urls).toEqual(["/v1/vectors/pending?model=embed&limit=16"]);
	});
});

test("The indexer shows only its first failure in a toast", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let urls;
	await test.step('Given GET /v1/vectors/pending answers with the status 500 and the body "boom"', async () => {
		urls = await routePending(context, (route) =>
			route.fulfill({ status: 500, body: "boom" }),
		);
	});
	await test.step('When the indexer of appIndexer() with settings whose embedding model is "embed" is kicked', () =>
		common(
			page,
			async ({ appIndexer }, settings) => {
				window.lctyTest = { indexer: appIndexer(() => settings) };
				await window.lctyTest.indexer.kick();
			},
			settingsWith("embed"),
		));
	await theToastSays(
		page,
		'Then the toast says "Failed to index: 500 boom"',
		"Failed to index: 500 boom",
	);
	await test.step("When the toast is hidden and the indexer is kicked again", () =>
		page.evaluate(async () => {
			document.getElementById("toast").hidden = true;
			await window.lctyTest.indexer.kick();
		}));
	await test.step("Then GET /v1/vectors/pending was sent twice", () => {
		expect(urls).toHaveLength(2);
	});
	await test.step("And the toast is still hidden", async () => {
		expect(await toasts(page)).toEqual([
			{
				text: "Failed to index: 500 boom",
				hidden: true,
				role: "status",
				children: 0,
			},
		]);
	});
});
