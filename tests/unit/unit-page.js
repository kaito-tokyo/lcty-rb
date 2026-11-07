// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Shared helpers of the frontend unit tests (LCTYSP-1000).
//
// A unit test runs a module of public/ in a real browser on the test server's origin, on an empty page served by a
// route: no page module runs, so nothing but the test touches the module, IndexedDB or the network. Every test gets a
// new browser context, so storage starts empty. Modules are imported inside the page with import(), as the pages do.

import { test } from "@playwright/test";

export const UNIT_PAGE = "/__lcty_unit.html";

/**
 * Open the empty page. Options:
 * - lang: <html lang> (the language tr() and LctyT use), "en" by default
 * - lctyT: load /c/lcty.v1.js, which defines the global LctyT that js/i18n.js needs, true by default
 * - langs: the languages to load with it, such as ["ja"] for /c/lcty.v1.lang-ja.js
 * - body: HTML for the body
 */
export async function openUnitPage(
	page,
	context,
	{ lang = "en", lctyT = true, langs = [], body = "" } = {},
) {
	const scripts = lctyT
		? ["/c/lcty.v1.js", ...langs.map((l) => `/c/lcty.v1.lang-${l}.js`)]
		: [];
	const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>unit</title>${scripts
		.map((s) => `<script src="${s}"></script>`)
		.join("")}</head><body>${body}</body></html>`;
	await context.route(`**${UNIT_PAGE}`, (route) =>
		route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
	);
	await page.goto(UNIT_PAGE);
}

/** The usual Background of a unit feature: "Given a page on the server's origin". */
export async function givenAPage(page, context, options) {
	await test.step("Given a page on the server's origin", () =>
		openUnitPage(page, context, options));
}
