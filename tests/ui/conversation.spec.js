// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The conversation page /c/<id>.html: sending, the reply's rendering, undo / regenerate / fork, stopping and errors,
// the title and deleting (LCTYSP-0003, LCTYSP-0004, LCTYSP-0005).

import {
	composerInput,
	createConversation,
	expect,
	messageAction,
	messages,
	openConversation,
	savedMessages,
	test,
	waitForSaved,
} from "./fixtures.js";

/** A conversation of two finished turns, opened. */
async function openTwoTurns(page, request) {
	const conv = await createConversation(request, {
		title: "二往復",
		messages: [
			["user", "最初の質問"],
			["assistant", "最初の答え"],
			["user", "二番目の質問"],
			["assistant", "二番目の答え"],
		],
	});
	await openConversation(page, conv.id);
	await expect(messages(page)).toHaveCount(4);
	return conv;
}

test.describe("sending", () => {
	test("a message sent on the conversation page gets a reply and both are saved (LCTYSP-0004)", async ({
		page,
		request,
		llm,
	}) => {
		const conv = await openTwoTurns(page, request);
		llm.reply("三番目の答え");
		await composerInput(page).fill("三番目の質問");
		await composerInput(page).press("Enter");

		await expect(composerInput(page)).toHaveValue("");
		await expect(messages(page)).toHaveCount(6);
		await expect(messages(page, "assistant").last()).toHaveAttribute(
			"data-status",
			"completed",
		);
		await expect(
			messages(page, "assistant").last().locator("article"),
		).toHaveText("三番目の答え");
		// The whole history went to the model
		const input = JSON.stringify(llm.requests[0].input);
		for (const t of [
			"最初の質問",
			"最初の答え",
			"二番目の質問",
			"三番目の質問",
		])
			expect(input).toContain(t);

		await waitForSaved(request, conv.id, 6);
		await page.reload();
		await expect(messages(page)).toHaveCount(6);
	});

	test("a reply starting with a level-1 heading becomes the title (LCTYSP-0003)", async ({
		page,
		request,
		llm,
	}) => {
		await openTwoTurns(page, request);
		llm.reply("# 見出しのタイトル\n\n本文です。");
		await composerInput(page).fill("タイトルを付けて");
		await composerInput(page).press("Enter");

		await expect(page).toHaveTitle("見出しのタイトル");
		await expect(page.locator('[part~="lcty-c__title"]')).toHaveValue(
			"見出しのタイトル",
		);
	});

	test("editing the title in the header saves it", async ({
		page,
		request,
	}) => {
		const conv = await openTwoTurns(page, request);
		const title = page.locator('[part~="lcty-c__title"]');
		await title.fill("手で付けたタイトル");
		await title.press("Enter"); // change fires on Enter or when the field loses focus
		await title.blur();

		await expect(page).toHaveTitle("手で付けたタイトル");
		await expect
			.poll(async () => {
				const res = await request.get(`/v1/conversations/${conv.id}`);
				return (await res.json()).title;
			})
			.toBe("手で付けたタイトル");
	});
});

test.describe("rendering a reply (LCTYSP-0005)", () => {
	test("Markdown is rendered and raw HTML or script URLs never reach the DOM", async ({
		page,
		request,
		llm,
	}) => {
		await openTwoTurns(page, request);
		llm.reply(
			[
				"**太字**と`コード`",
				"",
				'<img src="x" onerror="window.__xss = 1">',
				"",
				"[危ないリンク](javascript:window.__xss=2) と [安全なリンク](https://example.com/)",
			].join("\n"),
		);
		await composerInput(page).fill("Markdown を返して");
		await composerInput(page).press("Enter");

		const article = messages(page, "assistant").last().locator("article");
		await expect(messages(page, "assistant").last()).toHaveAttribute(
			"data-status",
			"completed",
		);
		await expect(article.locator("strong")).toHaveText("太字");
		await expect(article.locator("code")).toHaveText("コード");
		await expect(article.locator("img")).toHaveCount(0);
		await expect(article).toContainText('<img src="x"'); // shown as text
		await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
		await expect(article.locator('a[href="https://example.com/"]')).toHaveText(
			"安全なリンク",
		);
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
	});

	test("a reply's thinking is shown collapsed", async ({
		page,
		request,
		llm,
	}) => {
		await openTwoTurns(page, request);
		llm.reply({ thinking: "まず考えます。", text: "考えた結果です。" });
		await composerInput(page).fill("考えて");
		await composerInput(page).press("Enter");

		const reply = messages(page, "assistant").last();
		await expect(reply).toHaveAttribute("data-thinking", "まず考えます。");
		const details = reply.locator('[part~="lcty-message__thinking"]');
		await expect(details).toBeVisible();
		await expect(details).not.toHaveAttribute("open", /.*/);
	});

	test("suggested next messages are buttons that fill the composer", async ({
		page,
		request,
		llm,
	}) => {
		await openTwoTurns(page, request);
		llm.reply(
			[
				"答えです。",
				"<suggestion-for-user-turn>もっと詳しく</suggestion-for-user-turn>",
				"<suggestion-for-user-turn>例を挙げて</suggestion-for-user-turn>",
			].join("\n"),
		);
		await composerInput(page).fill("提案して");
		await composerInput(page).press("Enter");

		const buttons = messages(page, "assistant")
			.last()
			.locator("article button.suggestion");
		await expect(buttons).toHaveText(["もっと詳しく", "例を挙げて"]);
		await buttons.nth(1).click();
		await expect(composerInput(page)).toHaveValue("例を挙げて");
		await expect(composerInput(page)).toBeFocused();
	});

	test("a long suggestion wraps inside the reply instead of overflowing", async ({
		page,
		request,
		llm,
	}) => {
		await openTwoTurns(page, request);
		const long = "とても長い提案の文章です。".repeat(20);
		llm.reply(
			`答えです。\n<suggestion-for-user-turn>${long}</suggestion-for-user-turn>`,
		);
		await composerInput(page).fill("長い提案を");
		await composerInput(page).press("Enter");

		const article = messages(page, "assistant").last().locator("article");
		const button = article.locator("button.suggestion");
		await expect(button).toHaveText(long);
		const a = await article.boundingBox();
		const b = await button.boundingBox();
		expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width + 1);
		expect(b.height).toBeGreaterThan(40); // more than one line
	});
});

test.describe("undo, regenerate and fork (LCTYSP-0004)", () => {
	test("only the last user message has undo, and only the last reply has regenerate", async ({
		page,
		request,
	}) => {
		await openTwoTurns(page, request);
		const users = messages(page, "user");
		const replies = messages(page, "assistant");
		await expect(await messageAction(users.nth(0), "undo")).toBeHidden();
		await expect(await messageAction(users.nth(1), "undo")).toBeVisible();
		await expect(
			await messageAction(replies.nth(0), "regenerate"),
		).toBeHidden();
		await expect(
			await messageAction(replies.nth(1), "regenerate"),
		).toBeVisible();
		// Fork is on every user message
		for (const i of [0, 1])
			await expect(await messageAction(users.nth(i), "fork")).toBeVisible();
	});

	test("the actions show only while the message is hovered", async ({
		page,
		request,
	}) => {
		await openTwoTurns(page, request);
		const fork = messages(page, "user")
			.first()
			.locator('[part~="lcty-message__action--fork"]');
		await page.mouse.move(0, 0);
		await expect(fork).toBeHidden();
		await messages(page, "user").first().hover();
		await expect(fork).toBeVisible();
	});

	test("undo removes the last turn and puts the message back into the composer", async ({
		page,
		request,
	}) => {
		const conv = await openTwoTurns(page, request);
		await (await messageAction(messages(page, "user").last(), "undo")).click();

		await expect(messages(page)).toHaveCount(2);
		await expect(composerInput(page)).toHaveValue("二番目の質問");
		await expect(composerInput(page)).toBeFocused();
		await waitForSaved(request, conv.id, 2);

		// Undo again goes back one more turn
		await (await messageAction(messages(page, "user").last(), "undo")).click();
		await expect(messages(page)).toHaveCount(0);
		await waitForSaved(request, conv.id, 0);
	});

	test("regenerate replaces only the last reply", async ({
		page,
		request,
		llm,
	}) => {
		const conv = await openTwoTurns(page, request);
		llm.reply("作り直した答え");
		await (
			await messageAction(messages(page, "assistant").last(), "regenerate")
		).click();

		await expect(messages(page)).toHaveCount(4);
		await expect(
			messages(page, "assistant").last().locator("article"),
		).toHaveText("作り直した答え");
		await expect(
			messages(page, "assistant").first().locator("article"),
		).toHaveText("最初の答え");
		await expect
			.poll(async () => (await savedMessages(request, conv.id)).at(-1)?.content)
			.toBe("作り直した答え");
	});

	test("fork from here moves to / with the source and the message index", async ({
		page,
		request,
	}) => {
		const conv = await openTwoTurns(page, request);
		await (await messageAction(messages(page, "user").first(), "fork")).click();
		await page.waitForURL(`/?fork=${conv.id}&at=0`);
		await expect(composerInput(page)).toHaveValue("最初の質問");
	});
});

test.describe("stopping and errors (LCTYSP-0004)", () => {
	test("the stop button ends the generation and keeps the reply as incomplete", async ({
		page,
		request,
		llm,
	}) => {
		const conv = await openTwoTurns(page, request);
		llm.reply({ hang: true });
		await composerInput(page).fill("止める質問");
		await composerInput(page).press("Enter");

		const reply = messages(page, "assistant").last();
		await expect(reply).toHaveAttribute("data-status", "streaming");
		await expect(page.locator("lcty-c")).toHaveAttribute("busy", "");
		await page.locator('[part~="lcty-composer__stop"]').click();

		await expect(reply).toHaveAttribute("data-status", "incomplete");
		await expect(reply).not.toHaveAttribute("data-error", /.*/);
		await expect(reply.locator('[part~="lcty-message__status"]')).toHaveText(
			"停止しました",
		);
		await expect(page.locator("lcty-c")).not.toHaveAttribute("busy", /.*/);
		await waitForSaved(request, conv.id, 6);
	});

	test("an error from llama-server is shown on the reply", async ({
		page,
		request,
		llm,
	}) => {
		const conv = await openTwoTurns(page, request);
		llm.reply({ status: 500, error: "model is not loaded" });
		await composerInput(page).fill("失敗する質問");
		await composerInput(page).press("Enter");

		const reply = messages(page, "assistant").last();
		await expect(reply).toHaveAttribute("data-status", "incomplete");
		await expect(reply).toHaveAttribute("data-error", /model is not loaded/);
		await expect(reply.locator('[part~="lcty-message__status"]')).toContainText(
			"model is not loaded",
		);
		await waitForSaved(request, conv.id, 6);
	});
});

test("deleting the conversation asks first and returns to /", async ({
	page,
	request,
}) => {
	const conv = await openTwoTurns(page, request);

	// Dismissing the confirmation keeps it
	page.once("dialog", (d) => d.dismiss());
	await page.locator('[part~="lcty-c__delete"]').click();
	await expect(page).toHaveURL(`/c/${conv.id}.html`);

	page.once("dialog", (d) => d.accept());
	await page.locator('[part~="lcty-c__delete"]').click();
	await page.waitForURL("/");
	const res = await request.get(`/v1/conversations/${conv.id}`);
	expect(res.status()).toBe(404);
});
