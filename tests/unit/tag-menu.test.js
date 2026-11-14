// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1028: the scenarios of docs/specs/LCTYSP-1028_tag-menu.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// addTagTerm of js/ui/tag-menu.js needs no DOM: it runs in Node.js (node-unit.js). Importing the module touches no
// browser API (tr() and document are used only when the menu is built).

import { expect, publicUrl, scenario } from "./node-unit.js";

const M = await import(publicUrl("js/ui/tag-menu.js"));

for (const [kase, query, name, result] of [
	["an empty query", "", "Ruby", "tag:Ruby"],
	["a query of blanks", "  ", "Ruby", "tag:Ruby"],
	["words kept", "rails  api", "Ruby", "rails api tag:Ruby"],
	["another tag kept", "tag:Go", "Ruby", "tag:Go tag:Ruby"],
	["the same tag", "tag:Ruby x", "Ruby", "tag:Ruby x"],
	["the same tag in other case", "tag:ruby", "Ruby", "tag:ruby"],
	["the same tag escaped", "tag:c~23", "C#", "tag:c~23"],
	["a word that is not a tag", "Ruby", "Ruby", "Ruby tag:Ruby"],
	["a Japanese name", "献立", "料理", "献立 tag:料理"],
]) {
	scenario(
		`addTagTerm adds the tag to the query (${kase})`,
		async ({ step }) => {
			let got;
			await step(
				`When addTagTerm is given the query "${query}" and the name "${name}"`,
				() => {
					got = M.addTagTerm(query, name);
				},
			);
			await step(`Then it returns "${result}"`, () => {
				expect(got).toBe(result);
			});
		},
	);
}
