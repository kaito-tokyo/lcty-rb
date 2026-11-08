// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-2003: the scenarios of docs/specs/LCTYSP-2003_sidebar.feature, written by hand. Each test has the title of its
// Scenario and one test.step per line of it, so the two read side by side.
//
// The sidebar shared by every page: the conversation list, search, the settings dialog and the tags dialog
// (LCTYSP-0005, LCTYSP-0007, LCTYSP-0009, LCTYSP-0010).

import {
	createConversation,
	expect,
	LLM_URL,
	openConversation,
	openNewPage,
	putTags,
	test,
	uniqueWord,
} from "./fixtures.js";

// Tag definitions are global: leave none behind for the other tests
test.afterEach(async ({ request }) => {
	await putTags(request, []);
});

const item = (page, id) =>
	page.locator(`a[part~="lcty-conv-list__item"][data-id="${id}"]`);

test("Conversations are listed as links to their pages", async ({
	page,
	request,
}) => {
	const title = uniqueWord("一覧");
	let conv;
	await test.step("Given a conversation with a unique title and two messages", async () => {
		conv = await createConversation(request, {
			title,
			messages: [
				["user", "質問"],
				["assistant", "答え"],
			],
		});
	});
	await test.step("When the new conversation page /c/ is opened", () =>
		openNewPage(page));
	const link = item(page, conv.id);
	await test.step('Then the conversation is listed with the link "../c/<id>.html", relative to the page', async () => {
		// relative to the page, which is one directory below the root (/c/ with the conversations, or /t/)
		await expect(link).toHaveAttribute("href", `../c/${conv.id}.html`);
	});
	await test.step("And the item shows the title", async () => {
		await expect(link).toContainText(title);
	});
	await test.step("And clicking it opens the page /c/<id>.html", async () => {
		await link.click();
		await page.waitForURL(`/c/${conv.id}.html`);
	});
});

test("Every page takes the server's tags as soon as it is shown", async ({
	page,
	request,
}) => {
	// Two display names of one tag file: they differ only in case, so the file-name part (the reference) is the same
	const part = uniqueWord("force");
	const before = part.toUpperCase();
	const after = `${part[0].toUpperCase()}${part.slice(1)}`;
	await test.step('Given the tag file "00010-<part>.html" named "<PART>", in upper case', () =>
		putTags(request, [{ file: `00010-${part}.html`, name: before }]));
	let conv;
	await test.step('And a conversation tagged "<part>"', async () => {
		conv = await createConversation(request, {
			title: uniqueWord("同期"),
			messages: [["user", "質問"]],
			tags: [part],
		});
	});
	const chip = () => page.locator(`a[data-id="${conv.id}"] .tag-name`);
	await test.step("When the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step(`Then the conversation's tag chip reads "<PART>"`, async () => {
		await expect(chip()).toHaveText(before);
	});
	// Changed on the server, not through this browser: the next page shown has the new name without any wait for idle
	// time or a save
	await test.step('When the tag is renamed "<Part>" on the server, not through the browser', () =>
		putTags(request, [{ file: `00010-${part}.html`, name: after }]));
	await test.step("And the new conversation page /c/ is opened again", () =>
		openNewPage(page));
	await test.step(`Then the conversation's tag chip reads "<Part>"`, async () => {
		await expect(chip()).toHaveText(after);
	});
});

test("The open conversation is marked as current", async ({
	page,
	request,
}) => {
	let conv;
	await test.step("Given a conversation", async () => {
		conv = await createConversation(request, {
			title: uniqueWord("現在"),
			messages: [["user", "質問"]],
		});
	});
	await test.step("When its page is opened", () =>
		openConversation(page, conv.id));
	await test.step('Then its item in the list has the part "lcty-conv-list__item--current"', async () => {
		await expect(item(page, conv.id)).toHaveAttribute(
			"part",
			/lcty-conv-list__item--current/,
		);
	});
});

test("Keyword search finds a conversation by a word in its messages", async ({
	page,
	request,
}) => {
	const word = uniqueWord("kw");
	let hit;
	let miss;
	await test.step("Given a conversation with a unique word in its first message", async () => {
		hit = await createConversation(request, {
			title: "検索で見つかる会話",
			messages: [
				["user", `${word} について教えて`],
				["assistant", "説明します。"],
			],
		});
	});
	await test.step("And another conversation without the word", async () => {
		miss = await createConversation(request, {
			title: "見つからない会話",
			messages: [["user", "関係のない話"]],
		});
	});
	await test.step("When the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step("Then the other conversation is listed", async () => {
		await expect(item(page, miss.id)).toBeVisible();
	});
	await test.step("When the word is typed into the search box", async () => {
		await page.locator('[part~="lcty-sidebar__search"]').fill(word);
	});
	await test.step("Then the conversation with the word is listed", async () => {
		await expect(item(page, hit.id)).toBeVisible();
	});
	await test.step("And the other conversation is not", async () => {
		await expect(item(page, miss.id)).toHaveCount(0);
	});
	await test.step('And the item links to the matching round, "../c/<id>.html#c-msg-…"', async () => {
		await expect(item(page, hit.id)).toHaveAttribute(
			"href",
			new RegExp(`^\\.\\./c/${hit.id}\\.html#c-msg-`),
		);
	});
});

test("A query in the URL is put into the search box", async ({ page }) => {
	const word = uniqueWord("q");
	await test.step("When the page /c/?q=<word> is opened", () =>
		openNewPage(page, `/c/?q=${word}`));
	await test.step("Then the search box holds the word", async () => {
		await expect(page.locator('[part~="lcty-sidebar__search"]')).toHaveValue(
			word,
		);
	});
});

test("The settings dialog shows the browser settings and saves changes", async ({
	page,
}) => {
	const dialog = page.locator("dialog#settings-dialog");
	await test.step("Given the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step("When the settings button is clicked", async () => {
		await page.locator('[part~="lcty-sidebar__settings"]').click();
	});
	await test.step("Then the settings dialog is shown", async () => {
		await expect(dialog).toBeVisible();
	});
	await test.step("And its base URL is the fake llama-server's", async () => {
		await expect(dialog.locator('input[name="base_url"]')).toHaveValue(LLM_URL);
	});
	await test.step('When the model "test-model" is typed and the form is submitted', async () => {
		await dialog.locator('input[name="model"]').fill("test-model");
		await dialog.locator('button[type="submit"]').click();
	});
	await test.step('Then localStorage "lcty.settings.v1" holds the base URL and the model "test-model"', async () => {
		const stored = await page.evaluate(() =>
			JSON.parse(localStorage.getItem("lcty.settings.v1")),
		);
		expect(stored).toMatchObject({ base_url: LLM_URL, model: "test-model" });
	});
	await test.step("When 閉じる is clicked", async () => {
		await dialog.getByRole("button", { name: "閉じる" }).click();
	});
	await test.step("Then the settings dialog is hidden", async () => {
		await expect(dialog).toBeHidden();
	});
});

test("The tag button next to 新しい会話 opens the tags dialog, and a saved tag shows up in the picker", async ({
	page,
	request,
}) => {
	const dialog = page.locator("dialog#tags-dialog");
	const name = uniqueWord("tag");
	await test.step("Given there are no tags", () => putTags(request, []));
	await test.step("And the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step(`Then the sidebar's nav holds the new conversation button and then the tag button, which reads "タグ"`, async () => {
		const nav = page.locator('[part~="lcty-sidebar__nav"] > *');
		await expect(nav.nth(0)).toHaveAttribute("part", /lcty-sidebar__new/);
		await expect(nav.nth(1)).toHaveAttribute("part", /lcty-sidebar__tags/);
		await expect(nav.nth(1)).toHaveText("タグ");
	});
	await test.step("When the tag button is clicked", async () => {
		await page.locator('[part~="lcty-sidebar__tags"]').click();
	});
	await test.step("Then the tags dialog is shown", async () => {
		await expect(dialog).toBeVisible();
	});
	await test.step('When a new tag with a unique name is added with "＋ 新しいタグ" and saved with "保存"', async () => {
		await dialog.getByRole("button", { name: "＋ 新しいタグ" }).click();
		await dialog.getByRole("textbox", { name: "タグの名前" }).fill(name);
		await dialog.getByRole("button", { name: "保存", exact: true }).click();
	});
	await test.step("Then the tag picker of the page has the tag", async () => {
		await expect(
			page.locator(`#setup-tags input[value="${name}"]`),
		).toBeAttached();
	});
	await test.step("When 閉じる is clicked", async () => {
		await dialog.getByRole("button", { name: "閉じる" }).click();
	});
	await test.step("Then the tags dialog is hidden", async () => {
		await expect(dialog).toBeHidden();
	});
});

test("The tag button opens the tags dialog on a conversation page too", async ({
	page,
	request,
}) => {
	let conv;
	await test.step("Given a conversation with two messages", async () => {
		conv = await createConversation(request, {
			title: uniqueWord("tags"),
			messages: [
				["user", "質問"],
				["assistant", "答え"],
			],
		});
	});
	await test.step("And its page is opened", () =>
		openConversation(page, conv.id));
	await test.step("When the tag button is clicked", async () => {
		await page.locator('[part~="lcty-sidebar__tags"]').click();
	});
	await test.step("Then the tags dialog is shown", async () => {
		await expect(page.locator("dialog#tags-dialog")).toBeVisible();
	});
});
