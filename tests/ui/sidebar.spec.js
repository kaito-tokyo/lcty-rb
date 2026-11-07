// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar shared by every page: the conversation list, search and the settings dialog (LCTYSP-005, LCTYSP-007,
// LCTYSP-010).

import {
	createConversation,
	expect,
	LLM_URL,
	openConversation,
	openNewPage,
	test,
	uniqueWord,
} from "./fixtures.js";

const item = (page, id) =>
	page.locator(`a[part~="lcty-conv-list__item"][data-id="${id}"]`);

test("conversations are listed as links to their pages", async ({
	page,
	request,
}) => {
	const title = uniqueWord("一覧");
	const conv = await createConversation(request, {
		title,
		messages: [
			["user", "質問"],
			["assistant", "答え"],
		],
	});
	await openNewPage(page);

	const link = item(page, conv.id);
	await expect(link).toHaveAttribute("href", `/c/${conv.id}.html`);
	await expect(link).toContainText(title);
	await link.click();
	await page.waitForURL(`/c/${conv.id}.html`);
});

test("the open conversation is marked as current", async ({
	page,
	request,
}) => {
	const conv = await createConversation(request, {
		title: uniqueWord("現在"),
		messages: [["user", "質問"]],
	});
	await openConversation(page, conv.id);
	await expect(item(page, conv.id)).toHaveAttribute(
		"part",
		/lcty-conv-list__item--current/,
	);
});

test("keyword search finds a conversation by a word in its messages (LCTYSP-007)", async ({
	page,
	request,
}) => {
	const word = uniqueWord("kw");
	const hit = await createConversation(request, {
		title: "検索で見つかる会話",
		messages: [
			["user", `${word} について教えて`],
			["assistant", "説明します。"],
		],
	});
	const miss = await createConversation(request, {
		title: "見つからない会話",
		messages: [["user", "関係のない話"]],
	});
	await openNewPage(page);
	await expect(item(page, miss.id)).toBeVisible();

	await page.locator('[part~="lcty-sidebar__search"]').fill(word);
	await expect(item(page, hit.id)).toBeVisible();
	await expect(item(page, miss.id)).toHaveCount(0);
	// A search result links to the matching round
	await expect(item(page, hit.id)).toHaveAttribute(
		"href",
		new RegExp(`^/c/${hit.id}\\.html#c-msg-`),
	);
});

test("?q= puts the query into the search box", async ({ page }) => {
	const word = uniqueWord("q");
	await openNewPage(page, `/?q=${word}`);
	await expect(page.locator('[part~="lcty-sidebar__search"]')).toHaveValue(
		word,
	);
});

test("the settings dialog shows the browser settings and saves changes (LCTYSP-010)", async ({
	page,
}) => {
	await openNewPage(page);
	await page.locator('[part~="lcty-sidebar__settings"]').click();
	const dialog = page.locator("dialog#settings-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('input[name="base_url"]')).toHaveValue(LLM_URL);

	await dialog.locator('input[name="model"]').fill("test-model");
	await dialog.locator('button[type="submit"]').click();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("lcty.settings.v1")),
	);
	expect(stored).toMatchObject({ base_url: LLM_URL, model: "test-model" });

	await dialog.getByRole("button", { name: "閉じる" }).click();
	await expect(dialog).toBeHidden();
});
