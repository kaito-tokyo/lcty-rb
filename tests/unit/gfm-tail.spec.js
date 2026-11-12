// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1027: the scenarios of docs/specs/LCTYSP-1027_tail-converter.feature that draw the nodes into a page, written by
// hand. Each test has the title of its Scenario and one test.step per line of it, so the two read side by side. The
// scenarios that only read text run in Node.js (gfm-tail.test.js).
//
// public/js/convert/tail.js is imported into the empty unit page (tests/unit/unit-page.js) and kept as window.tail;
// each scenario draws into a <div> of its own, window.el.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** The first lines of every Scenario here, and the element drawn into. */
async function givenAPageWithTheModule(page, context) {
	await givenAPage(page, context);
	await test.step("And the module /js/convert/tail.js is imported", async () => {
		await page.evaluate(async () => {
			window.tail = await import("/js/convert/tail.js");
			window.el = document.createElement("div");
			document.body.append(window.el);
			window.draw = (text) =>
				window.tail.drawTail(window.el, window.tail.tailNodes(text));
		});
	});
}

test("Drawing again keeps the nodes that are the same", async ({
	page,
	context,
}) => {
	await givenAPageWithTheModule(page, context);
	await test.step('When "a **b**" is drawn into an empty element, then "a **b** c"', async () => {
		await page.evaluate(() => {
			window.draw("a **b**");
			window.before = [
				window.el.querySelector("p"),
				window.el.querySelector("strong"),
			];
			window.draw("a **b** c");
		});
	});
	await test.step("Then the paragraph and the strong are the same elements as before", async () => {
		expect(
			await page.evaluate(
				() =>
					window.before[0] === window.el.querySelector("p") &&
					window.before[1] === window.el.querySelector("strong"),
			),
		).toBe(true);
	});
	await test.step("And the element holds <p>a <strong>b</strong> c</p>", async () => {
		expect(await page.evaluate(() => window.el.innerHTML)).toBe(
			"<p>a <strong>b</strong> c</p>",
		);
	});
});

test("An open code block grows in one text node", async ({ page, context }) => {
	await givenAPageWithTheModule(page, context);
	await test.step('When "```\\nx" is drawn into an empty element, then "```\\nxy"', async () => {
		await page.evaluate(() => {
			window.draw("```\nx");
			window.node = window.el.querySelector("code").firstChild;
			window.draw("```\nxy");
		});
	});
	await test.step('Then the code\'s text node is the same as before and holds "xy"', async () => {
		expect(
			await page.evaluate(() => {
				const now = window.el.querySelector("code").firstChild;
				return { same: now === window.node, data: now.data };
			}),
		).toEqual({ same: true, data: "xy" });
	});
});

test("What differs is replaced and what is left over is removed", async ({
	page,
	context,
}) => {
	await givenAPageWithTheModule(page, context);
	await test.step('When "# h\\n\\npara" is drawn into an empty element, then "para2"', async () => {
		await page.evaluate(() => {
			window.draw("# h\n\npara");
			window.draw("para2");
		});
	});
	await test.step("Then the element holds <p>para2</p>", async () => {
		expect(await page.evaluate(() => window.el.innerHTML)).toBe("<p>para2</p>");
	});
});
