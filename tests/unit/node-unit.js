// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Shared helpers of the frontend unit tests that run in Node.js (LCTYSP-1000), with node:test.
//
// A module of public/ that needs no browser (no DOM, IndexedDB, Worker or wasm) is imported straight from public/ by
// these tests, as the pages import it: the files are ES modules with relative imports. Each Scenario is a test, and
// each line of it a subtest made by step(), so the report reads like the feature. A failed step stops the Scenario, as
// test.step() does in Playwright. expect() is Playwright's, so the assertions read as in the browser's specs.

import { test } from "node:test";

export { expect } from "@playwright/test";

/** The URL of a file of public/, to import it: await import(publicUrl("js/uuid.js")). */
export const publicUrl = (path) =>
	new URL(`../../public/${path}`, import.meta.url);

class StepFailed extends Error {}

/**
 * The test of the Scenario `title`. fn gets { step, t }: step(line, body) runs one line of the Scenario as a subtest
 * named after it and throws when it fails, so the lines after it do not run.
 */
export function scenario(title, fn) {
	return test(title, (t) => {
		const step = async (line, body = () => {}) => {
			let failed = null;
			await t.test(line, async () => {
				try {
					return await body();
				} catch (e) {
					failed = e;
					throw e;
				}
			});
			if (failed) throw new StepFailed(`failed: ${line}`, { cause: failed });
		};
		return fn({ step, t });
	});
}

/**
 * Make the global LctyT that js/i18n.js needs, as /c/lcty.v1.js does in a page, with the languages langs (such as
 * ["ja"] for /c/lcty.v1.lang-ja.mjs), and set the page's language (<html lang>, which LctyT._() reads) to lang.
 * HTMLElement is a stand-in so lcty.v1.mjs can define its element classes; they are never made here. The modules are
 * cached by the process, so LctyT is made once per test file and languages are only added.
 */
export async function useLctyT({ lang = "en", langs = [] } = {}) {
	globalThis.HTMLElement ??= class HTMLElement {};
	globalThis.LctyT ??= (await import(publicUrl("c/lcty.v1.mjs"))).LctyT;
	for (const l of langs) await import(publicUrl(`c/lcty.v1.lang-${l}.mjs`));
	setLang(lang);
	return globalThis.LctyT;
}

/** Set the page's language, document.documentElement.lang, the only part of the document LctyT._() reads. */
export function setLang(lang) {
	globalThis.document = { documentElement: { lang } };
}

/**
 * The URL a module asked for, as the browser would request it from a site whose root is base. In Node.js the root of
 * the site that js/site.js finds is public/ itself (siteUrl("v1/tags") is file:…/public/v1/tags), so a URL under
 * public/ is the same path under base; any other URL is resolved against base, as in a page.
 */
function onSite(url, base) {
	const root = publicUrl("").href;
	const href = String(url);
	return href.startsWith(root)
		? new URL(href.slice(root.length), base)
		: new URL(href, base);
}

/**
 * Replace the global fetch with handler(request) for the rest of the test t: every request a module makes is answered
 * by the test, as context.route() does in the browser. URLs are those of a site whose root is base (onSite: the page's
 * origin in a page). Returns the requests made, in order.
 */
export function routeFetch(
	t,
	handler,
	{ base = "http://127.0.0.1:45290/" } = {},
) {
	const requests = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const request =
			input instanceof Request && !init
				? input
				: new Request(
						onSite(input instanceof Request ? input.url : input, base),
						init,
					);
		requests.push(request.clone());
		return handler(request);
	};
	t.after(() => {
		globalThis.fetch = original;
	});
	return requests;
}
