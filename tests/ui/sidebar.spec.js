// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-2003: the scenarios of docs/specs/LCTYSP-2003_sidebar.feature, written by hand. Each test has the title of its
// Scenario and one test.step per line of it, so the two read side by side.
//
// The sidebar shared by every page: the conversation list, search, the settings dialog, the tag menu and the tags
// dialog (LCTYSP-0005, LCTYSP-0007, LCTYSP-0009, LCTYSP-0010).

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

test("A change made elsewhere shows up in the list without a reload", async ({
	page,
	request,
}) => {
	const title = uniqueWord("追従");
	const tag = uniqueWord("follow");
	let conv;
	await test.step("Given the new conversation page /c/ is open", () =>
		openNewPage(page));
	const loads = [];
	page.on("load", () => loads.push(page.url()));
	await test.step("When a conversation with a unique title is created through /v1/rpc", async () => {
		conv = await createConversation(request, {
			title,
			messages: [["user", "質問"]],
		});
	});
	const link = () => item(page, conv.id);
	await test.step("Then it is listed, without a reload", async () => {
		await expect(link()).toContainText(title);
		expect(loads).toEqual([]);
	});
	await test.step("When its tags are changed to a unique tag through the HTTP API", async () => {
		const res = await request.post(`/v1/conversations/${conv.id}/lines`, {
			data: [{ type: "tags", tags: [tag] }],
		});
		expect(res.ok()).toBe(true);
	});
	await test.step("Then its item shows the tag", async () => {
		await expect(link().locator(".tag-name")).toHaveText([tag]);
	});
	await test.step("When it is deleted through the HTTP API", async () => {
		const res = await request.delete(`/v1/conversations/${conv.id}`);
		expect(res.ok()).toBe(true);
	});
	await test.step("Then it is no longer listed", async () => {
		await expect(link()).toHaveCount(0);
		expect(loads).toEqual([]);
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

const tagButton = (page) => page.locator('[part~="lcty-sidebar__tags"]');
const tagMenu = (page) => page.locator('[part~="lcty-sidebar__tag-menu"]');
const searchBox = (page) => page.locator('[part~="lcty-sidebar__search"]');
/** The names the tag menu lists, in order. */
const menuNames = (page) =>
	page.locator('[part~="lcty-sidebar__tag-menu-search"]');

/** Open the tag menu and choose the tag named name in it. */
async function chooseTag(page, name) {
	await tagButton(page).click();
	await tagMenu(page)
		.locator('[part~="lcty-sidebar__tag-menu-search"]', { hasText: name })
		.click();
}

test("The tag button next to 新しい会話 opens the tag menu, which lists the tags with links to their pages", async ({
	page,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	const edits = page.locator('[part~="lcty-sidebar__tag-menu-edit"]');
	await test.step("Given the tags A and B, in that order", () =>
		putTags(request, [{ name: a }, { name: b }]));
	await test.step("And the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step(`Then the sidebar's nav holds the new conversation button and then the tag button, which reads "タグ"`, async () => {
		const nav = page.locator('[part~="lcty-sidebar__nav"] > *');
		await expect(nav.nth(0)).toHaveAttribute("part", /lcty-sidebar__new/);
		await expect(nav.nth(1)).toHaveAttribute("part", /lcty-sidebar__tags/);
		await expect(nav.nth(1)).toHaveText("タグ");
	});
	await test.step("When the tag button is clicked", async () => {
		await tagButton(page).click();
	});
	await test.step("Then the tag menu is shown", async () => {
		await expect(tagMenu(page)).toBeVisible();
	});
	await test.step(`And it lists A and B, in that order, each with the link "編集" to its file's page, /t/00010-A.html and /t/00020-B.html`, async () => {
		await expect(menuNames(page)).toHaveText([a, b]);
		await expect(edits).toHaveText(["編集", "編集"]);
		const paths = await edits.evaluateAll((links) =>
			links.map((l) => new URL(l.href).pathname),
		);
		expect(paths).toEqual([`/t/00010-${a}.html`, `/t/00020-${b}.html`]);
	});
	await test.step(`When "編集" of B is clicked`, async () => {
		await edits.nth(1).click();
	});
	await test.step("Then the browser is on /t/00020-B.html", async () => {
		await expect(page).toHaveURL(new RegExp(`/t/00020-${b}\\.html$`));
	});
});

test("Choosing tags in the tag menu puts them in the search box and narrows the list", async ({
	page,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	let both;
	let one;
	await test.step("Given the tags A and B, in that order", () =>
		putTags(request, [{ name: a }, { name: b }]));
	await test.step("And a conversation tagged A and B, and another tagged A alone", async () => {
		both = await createConversation(request, {
			title: uniqueWord("both"),
			tags: [a, b],
		});
		one = await createConversation(request, {
			title: uniqueWord("one"),
			tags: [a],
		});
	});
	await test.step("And the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step("When the tag button is clicked and A is chosen in the tag menu", () =>
		chooseTag(page, a));
	await test.step("Then the tag menu is hidden", async () => {
		await expect(tagMenu(page)).toBeHidden();
	});
	await test.step(`And the search box holds "tag:A" and has the focus`, async () => {
		await expect(searchBox(page)).toHaveValue(`tag:${a}`);
		await expect(searchBox(page)).toBeFocused();
	});
	await test.step("And both conversations are listed", async () => {
		await expect(item(page, both.id)).toBeVisible();
		await expect(item(page, one.id)).toBeVisible();
	});
	await test.step("When the tag button is clicked and B is chosen in the tag menu", () =>
		chooseTag(page, b));
	await test.step(`Then the search box holds "tag:A tag:B"`, async () => {
		await expect(searchBox(page)).toHaveValue(`tag:${a} tag:${b}`);
	});
	await test.step("And the conversation tagged A and B is listed, and the other is not", async () => {
		await expect(item(page, both.id)).toBeVisible();
		await expect(item(page, one.id)).toHaveCount(0);
	});
	await test.step("When the tag button is clicked and A is chosen in the tag menu again", () =>
		chooseTag(page, a));
	await test.step(`Then the search box still holds "tag:A tag:B"`, async () => {
		await expect(searchBox(page)).toHaveValue(`tag:${a} tag:${b}`);
	});
});

test("タグを編集 in the tag menu opens the tags dialog, and a saved tag shows up in the picker and the menu", async ({
	page,
	request,
}) => {
	const dialog = page.locator("dialog#tags-dialog");
	const name = uniqueWord("tag");
	await test.step("Given there are no tags", () => putTags(request, []));
	await test.step("And the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step("When the tag button is clicked", async () => {
		await tagButton(page).click();
	});
	await test.step(`Then the tag menu shows "（タグはまだありません）"`, async () => {
		await expect(
			tagMenu(page).locator('[part~="lcty-sidebar__tag-menu-empty"]'),
		).toHaveText("（タグはまだありません）");
	});
	await test.step(`When "タグを編集" is clicked in the tag menu`, async () => {
		await tagMenu(page).getByRole("button", { name: "タグを編集" }).click();
	});
	await test.step("Then the tag menu is hidden", async () => {
		await expect(tagMenu(page)).toBeHidden();
	});
	await test.step("And the tags dialog is shown", async () => {
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
	await test.step("When the tag button is clicked", async () => {
		await tagButton(page).click();
	});
	await test.step("Then the tag menu lists the tag", async () => {
		await expect(menuNames(page)).toHaveText([name]);
	});
});

test("The tag menu works on a conversation page too", async ({
	page,
	request,
}) => {
	const a = uniqueWord("a");
	let conv;
	await test.step("Given the tag A", () => putTags(request, [{ name: a }]));
	await test.step("And a conversation with two messages", async () => {
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
	await test.step("When the tag button is clicked and A is chosen in the tag menu", () =>
		chooseTag(page, a));
	await test.step(`Then the search box holds "tag:A"`, async () => {
		await expect(searchBox(page)).toHaveValue(`tag:${a}`);
	});
	await test.step(`When the tag button is clicked and "タグを編集" is clicked in the tag menu`, async () => {
		await tagButton(page).click();
		await tagMenu(page).getByRole("button", { name: "タグを編集" }).click();
	});
	await test.step("Then the tags dialog is shown", async () => {
		await expect(page.locator("dialog#tags-dialog")).toBeVisible();
	});
});
