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
