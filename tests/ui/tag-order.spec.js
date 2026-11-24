// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-2004: the scenarios of docs/specs/LCTYSP-2004_tag-pages.feature, the tag reorder page /t/ and the tag files'
// pages /t/<part>.html (LCTYSP-0005, LCTYSP-0009). Each test has the title of its Scenario and one test.step per
// line of it, so the two read side by side. A and B in the steps are names made unique by uniqueWord.

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

/** Open the tags dialog from the sidebar's tag menu on the new conversation page /c/. */
async function openTagsDialog(page) {
	await openNewPage(page);
	await page.locator('[part~="lcty-sidebar__tags"]').click();
	await page
		.locator('[part~="lcty-sidebar__tag-menu"]')
		.getByRole("button", { name: "タグを編集" })
		.click();
}

/** The tags listed on the reorder page. */
const orderItems = (page) => page.locator("#tag-order > li");

/** The names, in order, as the reorder page lists them. */
const listed = (names) => names.map((n) => new RegExp(n));

test("The tags dialog links to /t/, where moving a tag and saving rewrites the order and keeps the files", async ({
	page,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	const link = page.locator("dialog#tags-dialog a.tags-reorder");
	let tags;
	await test.step("Given the tags A, with a prompt and a memory, and B, in that order", () =>
		putTags(request, [
			{ name: a, prompt: "A", memory: [{ id: "m1", text: "keep" }] },
			{ name: b, prompt: "B" },
		]));
	await test.step("When the tags dialog is opened on the new conversation page /c/", () =>
		openTagsDialog(page));
	await test.step('Then it has the link "並び順を変える"', async () => {
		await expect(link).toHaveText("並び順を変える");
	});
	await test.step("When the link is followed", () => link.click());
	await test.step("Then the browser is on /t/", async () => {
		await expect(page).toHaveURL(/\/t\/$/);
	});
	await test.step("And the reorder page lists A and B in that order", async () => {
		await expect(orderItems(page)).toHaveText(listed([a, b]));
	});
	await test.step('When the button "B を上へ" is pressed', () =>
		page.getByRole("button", { name: `${b} を上へ` }).click());
	await test.step("Then the reorder page lists B and A in that order", async () => {
		await expect(orderItems(page)).toHaveText(listed([b, a]));
	});
	await test.step('When the button "保存" is pressed', () =>
		page.getByRole("button", { name: "保存", exact: true }).click());
	await test.step('Then the toast says "タグを保存しました"', async () => {
		await expect(page.locator("#toast")).toHaveText("タグを保存しました");
	});
	await test.step("And t.list of the server lists B and A in that order, with the orders 10 and 20", async () => {
		tags = await getTags(request);
		expect(tags.map((t) => [t.name, t.order])).toEqual([
			[b, 10],
			[a, 20],
		]);
	});
	await test.step('And their files are still "B.html" and "A.html"', () => {
		expect(tags.map((t) => t.file)).toEqual([`${b}.html`, `${a}.html`]);
	});
	await test.step("And A keeps its name, its prompt and its memory", () => {
		expect(tags[1]).toMatchObject({
			name: a,
			prompt: "A",
			memory: [{ id: "m1", text: "keep" }],
		});
	});
	await test.step("And the name B on the reorder page still links to /t/B.html", async () => {
		const href = await page
			.locator("#tag-order")
			.getByRole("link", { name: b })
			.evaluate((l) => new URL(l.href).pathname);
		expect(href).toBe(`/t/${b}.html`);
	});
});

test("The reorder page does not list an invalid tag and sends it back as it is", async ({
	page,
	context,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	// A tag file without <lcty-t> cannot be put in the server's data directory from here (it may be another
	// machine's), so the answers of t.list list one more, and t.replace is answered by the test
	const invalid = {
		file: "broken.html",
		name: "broken",
		order: null,
		ops: [],
		prompt: "",
		memory: [],
		invalid: true,
	};
	const puts = [];
	await test.step("Given the tags A and B, in that order", () =>
		putTags(request, [{ name: a }, { name: b }]));
	await test.step('And t.list of the page\'s /v1/rpc also lists the invalid tag "broken.html" last, and t.replace is answered by the test', () =>
		context.routeWebSocket("**/v1/rpc", (ws) => {
			const server = ws.connectToServer();
			const lists = new Set(); // the ids of the page's t.list requests
			ws.onMessage((text) => {
				const m = JSON.parse(text);
				if (m.method === "t.replace") {
					puts.push(m.params);
					const version = "0.0";
					ws.send(
						JSON.stringify({
							jsonrpc: "2.0",
							id: m.id,
							result: { version, etag: '"put"' },
						}),
					);
					return;
				}
				if (m.method === "t.list") lists.add(m.id);
				server.send(text);
			});
			server.onMessage((text) => {
				const m = JSON.parse(text);
				if (lists.delete(m.id) && m.result) {
					m.result.items = [...m.result.items, invalid]; // a tag without an order comes last
					ws.send(JSON.stringify(m));
					return;
				}
				ws.send(text);
			});
		}));
	await test.step("When the reorder page /t/ is opened", () =>
		page.goto("/t/"));
	await test.step("Then it lists A and B in that order, without the invalid tag", async () => {
		await expect(orderItems(page)).toHaveText(listed([a, b]));
	});
	await test.step('When the button "B を上へ" is pressed, then the button "保存"', async () => {
		await page.getByRole("button", { name: `${b} を上へ` }).click();
		await page.getByRole("button", { name: "保存", exact: true }).click();
	});
	await test.step('Then the toast says "タグを保存しました"', async () => {
		await expect(page.locator("#toast")).toHaveText("タグを保存しました");
	});
	await test.step('And one t.replace was sent, with the files "B.html", "A.html" and "broken.html", in that order', () => {
		expect(puts.map((p) => p.tags.map((t) => t.file))).toEqual([
			[`${b}.html`, `${a}.html`, "broken.html"],
		]);
	});
	await test.step("And the invalid tag is sent back as it was received", () => {
		expect(puts[0].tags[2]).toEqual(invalid);
	});
});

test("A tag's name on the reorder page opens its file, which edits the tag and moves to its new file on a rename", async ({
	page,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	const name = page.getByRole("textbox", { name: "タグの名前" });
	let tags;
	await test.step("Given the tags A, with a prompt and a memory, and B, in that order", () =>
		putTags(request, [
			{ name: a, prompt: "A", memory: [{ id: "m1", text: "keep" }] },
			{ name: b, prompt: "B" },
		]));
	await test.step("When the reorder page /t/ is opened and the name B is followed", async () => {
		await page.goto("/t/");
		await page.locator("#tag-order").getByRole("link", { name: b }).click();
	});
	await test.step("Then the browser is on /t/B.html, whose title is B", async () => {
		await expect(page).toHaveURL(new RegExp(`/t/${b}\\.html$`));
		await expect(page).toHaveTitle(b);
	});
	await test.step("And the page shows the sidebar", async () => {
		await expect(page.locator("body > lcty-sidebar")).toBeVisible();
	});
	await test.step("And it shows the editor of B alone, whose name field holds B and can be edited", async () => {
		await expect(name).toHaveValue(b);
		await expect(name).toBeEditable();
		await expect(page.locator("lcty-t section.tag-edit")).toHaveCount(1);
	});
	await test.step('When the name is changed to "Bx" and the editor\'s button "保存" is pressed', async () => {
		await name.fill(`${b}x`);
		await page
			.locator("lcty-t")
			.getByRole("button", { name: "保存", exact: true })
			.click();
	});
	await test.step('Then the browser is on /t/Bx.html, whose name field holds "Bx"', async () => {
		await expect(page).toHaveURL(new RegExp(`/t/${b}x\\.html$`));
		await expect(page.getByRole("textbox", { name: "タグの名前" })).toHaveValue(
			`${b}x`,
		);
	});
	await test.step('And the server has the files "A.html" named A and "Bx.html" named "Bx", in that order', async () => {
		tags = await getTags(request);
		expect(tags.map((t) => [t.file, t.name])).toEqual([
			[`${a}.html`, a],
			[`${b}x.html`, `${b}x`],
		]);
	});
	await test.step("And A keeps its memory", () => {
		expect(tags[0]).toMatchObject({ memory: [{ id: "m1", text: "keep" }] });
	});
});

test("Deleting the tag on its file's page saves at once and goes to the reorder page", async ({
	page,
	request,
}) => {
	const [a, b] = [uniqueWord("a"), uniqueWord("b")];
	await test.step("Given the tags A and B, in that order", () =>
		putTags(request, [{ name: a }, { name: b }]));
	await test.step("When the page of A's file /t/A.html is opened", () =>
		page.goto(`/t/${a}.html`));
	await test.step('And the editor\'s button "削除" is pressed and the confirmation is accepted', async () => {
		page.once("dialog", (d) => d.accept());
		await page
			.locator("lcty-t .tag-edit-head")
			.getByRole("button", { name: "削除" })
			.click();
	});
	await test.step("Then the browser is on /t/", async () => {
		await expect(page).toHaveURL(/\/t\/$/);
	});
	await test.step("And the reorder page lists B alone", async () => {
		await expect(orderItems(page)).toHaveText(listed([b]));
	});
	await test.step('And the server has the file "B.html" alone', async () => {
		expect((await getTags(request)).map((t) => t.file)).toEqual([`${b}.html`]);
	});
});

test("The reorder page shows the sidebar, whose links lead to /c/", async ({
	page,
	request,
}) => {
	let conv;
	await test.step("Given a conversation with a question and its answer", async () => {
		conv = await createConversation(request, {
			title: uniqueWord("order"),
			messages: [
				["user", "質問"],
				["assistant", "答え"],
			],
		});
	});
	await test.step("When /t is opened", () => page.goto("/t"));
	await test.step("Then the browser is on /t/", async () => {
		await expect(page).toHaveURL(/\/t\/$/);
	});
	await test.step("When the conversation's link in the sidebar is followed", () =>
		page
			.locator(`a[part~="lcty-conv-list__item"][data-id="${conv.id}"]`)
			.click());
	await test.step("Then the browser goes to the conversation's page /c/<id>.html", () =>
		page.waitForURL(`/c/${conv.id}.html`));
});

test("A tag named C# is the file c~23.html, and a conversation refers to it as c~23", async ({
	page,
	request,
}) => {
	const dialog = page.locator("dialog#tags-dialog");
	await test.step("Given there are no tags", () => putTags(request, []));
	await test.step("When the tags dialog is opened on the new conversation page /c/", () =>
		openTagsDialog(page));
	await test.step('And a new tag named "C#" is saved in it', async () => {
		await dialog.getByRole("button", { name: "＋ 新しいタグ" }).click();
		await dialog.getByRole("textbox", { name: "タグの名前" }).fill("C#");
		await dialog.getByRole("button", { name: "保存", exact: true }).click();
	});
	await test.step('Then the new conversation\'s tag list has the value "c~23"', async () => {
		await expect(
			page.locator('#setup-tags input[value="c~23"]'),
		).toBeAttached();
	});
	await test.step('And the server has the file "c~23.html" named "C#" alone', async () => {
		expect((await getTags(request)).map((t) => [t.file, t.name])).toEqual([
			["c~23.html", "C#"],
		]);
	});
	await test.step('And the tag list shows the chip "C#"', async () => {
		await expect(page.locator("#setup-tags .tag-chip")).toHaveText(["C#"]);
	});
});

test("A tag named index cannot be saved, since its file would be the reorder page", async ({
	page,
	request,
}) => {
	const dialog = page.locator("dialog#tags-dialog");
	const message =
		"タグの名前「index」は予約されているため使えません（index、および . や lcty.v1 で始まる名前）";
	await test.step("Given there are no tags", () => putTags(request, []));
	await test.step("When the tags dialog is opened on the new conversation page /c/", () =>
		openTagsDialog(page));
	await test.step('And a new tag named "index" is saved in it', async () => {
		await dialog.getByRole("button", { name: "＋ 新しいタグ" }).click();
		await dialog.getByRole("textbox", { name: "タグの名前" }).fill("index");
		await dialog.getByRole("button", { name: "保存", exact: true }).click();
	});
	await test.step(`Then the dialog says "${message}"`, async () => {
		await expect(dialog.getByText(message, { exact: true })).toBeVisible();
	});
	await test.step("And the server has no tags", async () => {
		expect(await getTags(request)).toEqual([]);
	});
});

test("A tag named in Japanese has a page that opens from the reorder page and edits the tag", async ({
	page,
	request,
}) => {
	const tag = "料理";
	const name = page.getByRole("textbox", { name: "タグの名前" });
	const errors = [];
	const responses = [];
	/** The site's responses (those of the page's origin) as "<status> <path>". */
	const siteResponses = () => {
		const { origin } = new URL(page.url());
		return responses
			.filter((r) => r.url.origin === origin)
			.map((r) => `${r.status} ${decodeURIComponent(r.url.pathname)}`);
	};
	await test.step('Given the tag "料理"', () =>
		putTags(request, [{ name: tag }]));
	await test.step("And the page's errors and the site's responses are recorded", () => {
		page.on("pageerror", (e) => errors.push(String(e)));
		page.on("response", (r) =>
			responses.push({ url: new URL(r.url()), status: r.status() }),
		);
	});
	await test.step('When the reorder page /t/ is opened and the name "料理" is followed', async () => {
		await page.goto("/t/");
		await page.locator("#tag-order").getByRole("link", { name: tag }).click();
	});
	await test.step('Then the browser is on /t/料理.html, whose title is "料理"', async () => {
		await expect(page).toHaveURL(
			new RegExp(`/t/${encodeURIComponent(tag)}\\.html$`),
		);
		await expect(page).toHaveTitle(tag);
	});
	await test.step('And the name field holds "料理" and can be edited', async () => {
		await expect(name).toHaveValue(tag);
		await expect(name).toBeEditable();
	});
	await test.step("And the tag file's module /t/tag-file.js has been loaded", async () => {
		await expect.poll(siteResponses).toContain("200 /t/tag-file.js");
	});
	await test.step("And no page error happened, and no request of the site was answered with a status of 400 or more", () => {
		expect(errors).toEqual([]);
		expect(
			siteResponses().filter((r) => Number(r.split(" ")[0]) >= 400),
		).toEqual([]);
	});
});
