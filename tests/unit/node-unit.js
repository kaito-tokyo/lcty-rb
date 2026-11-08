// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Shared helpers of the frontend unit tests that run in Node.js (LCTYSP-1000), with node:test.
//
// A module of public/ that needs no DOM or IndexedDB is imported straight from public/ by these tests, as the pages
// import it: the files are ES modules with relative imports. Its workers run as Web Workers (Node.js 26,
// node-preload.cjs). Each Scenario is a test, and each line of it a subtest made by step(), so the report reads like the
// feature. A failed step stops the Scenario, as test.step() does in Playwright. expect() is Playwright's, so the
// assertions read as in the browser's specs.
//
// localStorage is Node.js's own Web Storage (--localstorage-file=:memory:, npm run test:node): kept in memory, so each
// test file's process starts with an empty one, and emptied before every Scenario, as a new browser context is.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, runInThisContext } from "node:vm";

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
		globalThis.localStorage?.clear();
		t.after(endWorkers);
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

/** Run the file of public/ at path as a classic script in this global scope (node:vm), as <script src> does. */
export function runScript(path) {
	runInThisContext(readFileSync(fileURLToPath(publicUrl(path)), "utf8"), {
		filename: path,
	});
}

/**
 * A new LctyT, as a page that has loaded /lcty.v1/lcty.v1.cjs alone has: the classic script is run in a context of its
 * own (node:vm), so each call makes a new one, with stand-ins for what it needs of a page: HTMLElement, so it can
 * declare its element classes (they are never made here), customElements, whose define() its last line calls and
 * which does nothing, and document, which is this global scope's (setLang), the only part of it LctyT._() reads.
 */
export function newLctyT() {
	const page = {
		HTMLElement: class HTMLElement {},
		customElements: { define() {}, get() {} },
	};
	Object.defineProperty(page, "document", { get: () => globalThis.document });
	const context = createContext(page);
	runInContext(
		readFileSync(fileURLToPath(publicUrl("lcty.v1/lcty.v1.cjs")), "utf8"),
		context,
		{ filename: "lcty.v1/lcty.v1.cjs" },
	);
	return runInContext("LctyT", context);
}

/**
 * Make the global LctyT that js/i18n.js needs, as /lcty.v1/lcty.v1.cjs does in a page, with the languages langs (such
 * as ["ja"] for /lcty.v1/lcty.v1.lang-ja.cjs, run as classic scripts), and set the page's language (<html lang>, which
 * LctyT._() reads) to lang. LctyT is made once per test file; languages are added again, which replaces their tables.
 */
export function useLctyT({ lang = "en", langs = [] } = {}) {
	globalThis.LctyT ??= newLctyT();
	for (const l of langs) runScript(`lcty.v1/lcty.v1.lang-${l}.cjs`);
	setLang(lang);
	return globalThis.LctyT;
}

/** Set the page's language, document.documentElement.lang, the only part of the document LctyT._() reads. */
export function setLang(lang) {
	globalThis.document = { documentElement: { lang } };
}

/** The origin of the site in the tests, as the test server's in the browser. */
const BASE = "http://127.0.0.1:45290/";

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

const TYPES = {
	".js": "text/javascript; charset=utf-8",
	".wasm": "application/wasm",
	".json": "application/json",
	".html": "text/html; charset=utf-8",
};

/**
 * What the site answers for a request that the test leaves alone: the file of public/ at its path, as the server
 * serves public/ (404 when there is none, or for another origin).
 */
export async function servePublic(request, { base = BASE } = {}) {
	const url = new URL(request.url);
	if (url.origin !== new URL(base).origin)
		return new Response("not found", { status: 404 });
	try {
		const body = await readFile(publicUrl(url.pathname.slice(1)));
		const type = TYPES[extname(url.pathname)] ?? "application/octet-stream";
		return new Response(body, { headers: { "Content-Type": type } });
	} catch {
		return new Response("not found", { status: 404 });
	}
}

// The route of the current test (routeFetch): { handler, base, requests }
const state = { route: null };

/**
 * A request to the site of the test, from the main thread or a worker (node-preload.cjs): the test's handler answers
 * it, or the file of public/ when the handler answers nothing (undefined, as route.continue() in the browser) or no
 * test routes its requests.
 */
async function siteFetch(input, init) {
	const route = state.route;
	const base = route?.base ?? BASE;
	const request =
		input instanceof Request && !init
			? input
			: new Request(
					onSite(input instanceof Request ? input.url : input, base),
					init,
				);
	if (!route) return servePublic(request, { base });
	route.requests.push(request.clone());
	return (await route.handler(request)) ?? servePublic(request, { base });
}
globalThis[Symbol.for("lcty.unit.route")] = siteFetch;

/**
 * Replace the global fetch with handler(request) for the rest of the test t: every request a module makes is answered
 * by the test, as context.route() does in the browser, also the requests of the workers and of their scripts
 * (node-preload.cjs). URLs are those of a site whose root is base (onSite: the page's origin in a page). A handler that
 * answers undefined lets the site serve the file of public/. Returns the requests made, in order.
 */
export function routeFetch(t, handler, { base = BASE } = {}) {
	const requests = [];
	const original = globalThis.fetch;
	state.route = { handler, base, requests };
	globalThis.fetch = siteFetch;
	t.after(() => {
		globalThis.fetch = original;
		state.route = null;
	});
	return requests;
}

/** End the workers the test started (node-preload.cjs), as closing the page does in the browser. */
function endWorkers() {
	for (const w of globalThis[Symbol.for("lcty.unit.workers")] ?? [])
		w.terminate();
}
