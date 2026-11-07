// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// A check of the shared unit page itself (tests/unit/unit-page.js), so a broken page fails here and not in every
// feature. Not a Scenario of a feature.

import { expect, test } from "@playwright/test";
import { openUnitPage } from "./unit-page.js";

test("the unit page loads LctyT and the languages it is given", async ({
	page,
	context,
}) => {
	await openUnitPage(page, context, { lang: "ja", langs: ["ja"] });
	expect(
		await page.evaluate(() => ({
			lang: document.documentElement.lang,
			lctyT: typeof LctyT,
			ja: Object.hasOwn(LctyT.dicts, "ja"),
		})),
	).toEqual({ lang: "ja", lctyT: "object", ja: true });
});

// The modules whose Scenarios run in Node.js (*.test.js, LCTYSP-1000), imported in each browser as the pages import
// them, so a module that only Node.js can load fails here. Not a Scenario of a feature.
const NODE_TESTED = [
	"js/uuid.js",
	"js/site.js",
	"js/common.js",
	"js/ui/text-attr.js",
	"js/llm/sse.js",
	"js/llm/responses.js",
	"js/llm/client.js",
	"js/llm/history.js",
	"js/search/embed.js",
	"js/ui/markdown.js",
	"js/i18n.js",
	"js/api/storage.js",
	"js/search/vectors.js",
	"js/tag-names.js",
	"js/tags.js",
];

test("the modules tested in Node.js load in the browser with the same exports", async ({
	page,
	context,
}) => {
	await openUnitPage(page, context);
	const inPage = await page.evaluate(async (paths) => {
		const names = {};
		for (const p of paths) names[p] = Object.keys(await import(`/${p}`)).sort();
		return names;
	}, NODE_TESTED);
	const inNode = {};
	for (const p of NODE_TESTED)
		inNode[p] = Object.keys(
			await import(new URL(`../../public/${p}`, import.meta.url)),
		).sort();
	expect(inPage).toEqual(inNode);
});
