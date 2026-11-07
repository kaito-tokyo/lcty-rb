// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tag reorder page /t/ and the tag files behind it (LCTYSP-0005, LCTYSP-0009).

import {
	createConversation,
	expect,
	getTags,
	openNewPage,
	putTags,
	test,
	uniqueWord,
} from "./fixtures.js";

// Tag definitions are global: leave none behind for the other tests
test.afterEach(async ({ request }) => {
	await putTags(request, []);
});

test("the tags dialog links to /t/, where moving a tag and saving renumbers the files (LCTYSP-0009)", async ({
	page,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	await putTags(request, [
		{ name: a, prompt: "A", memory: [{ id: "m1", text: "keep" }] },
		{ name: b, prompt: "B" },
	]);
	await openNewPage(page);
	await page.locator('[part~="lcty-sidebar__tags"]').click();
	const link = page.locator("dialog#tags-dialog a.tags-reorder");
	await expect(link).toHaveText("並び順を変える");
	await link.click();
	await expect(page).toHaveURL(/\/t\/$/);

	const items = page.locator("#tag-order > li");
	await expect(items).toHaveText([a, b].map((n) => new RegExp(n)));
	await page.getByRole("button", { name: `${b} を上へ` }).click();
	await expect(items).toHaveText([b, a].map((n) => new RegExp(n)));
	await page.getByRole("button", { name: "保存", exact: true }).click();
	await expect(page.locator("#toast")).toHaveText("タグを保存しました");

	const tags = await getTags(request);
	expect(tags.map((t) => t.file)).toEqual([
		`00010-${b}.html`,
		`00020-${a}.html`,
	]);
	expect(tags[1]).toMatchObject({
		name: a,
		prompt: "A",
		memory: [{ id: "m1", text: "keep" }],
	});
});

test("the reorder page shows the sidebar, whose links lead to /c/ (LCTYSP-0005)", async ({
	page,
	request,
}) => {
	const conv = await createConversation(request, {
		title: uniqueWord("order"),
		messages: [
			["user", "質問"],
			["assistant", "答え"],
		],
	});
	await page.goto("/t");
	await expect(page).toHaveURL(/\/t\/$/);
	const item = page.locator(
		`a[part~="lcty-conv-list__item"][data-id="${conv.id}"]`,
	);
	await item.click();
	await page.waitForURL(`/c/${conv.id}.html`);
});

test("a tag named C# is the file 00010-c~23.html, and a conversation refers to it as c~23 (LCTYSP-0009)", async ({
	page,
	request,
}) => {
	await putTags(request, []);
	await openNewPage(page);
	await page.locator('[part~="lcty-sidebar__tags"]').click();
	const dialog = page.locator("dialog#tags-dialog");
	await dialog.getByRole("button", { name: "＋ 新しいタグ" }).click();
	await dialog.getByRole("textbox", { name: "タグの名前" }).fill("C#");
	await dialog.getByRole("button", { name: "保存", exact: true }).click();
	await expect(page.locator('#setup-tags input[value="c~23"]')).toBeAttached();
	expect((await getTags(request)).map((t) => [t.file, t.name])).toEqual([
		["00010-c~23.html", "C#"],
	]);
	await expect(page.locator("#setup-tags .tag-chip")).toHaveText(["C#"]);
});
