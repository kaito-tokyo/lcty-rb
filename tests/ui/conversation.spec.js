// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-2002: the scenarios of docs/specs/LCTYSP-2002_conversation-page.feature, written by hand. Each test has the
// title of its Scenario and one test.step per line of it, so the two read side by side.
//
// The conversation page /c/<id>.html: opening it, sending, the reply's rendering, undo / regenerate / fork, stopping
// and errors, the title and deleting (LCTYSP-0003, LCTYSP-0004, LCTYSP-0005, LCTYSP-0009).

import {
	composerInput,
	createConversation,
	expect,
	messageAction,
	messages,
	openConversation,
	putTags,
	savedMessages,
	test,
	uniqueWord,
	waitForSaved,
} from "./fixtures.js";

// Tag definitions are global: leave none behind for the other tests
test.afterEach(async ({ request }) => {
	await putTags(request, []);
});

const TWO_TURNS = "Given a conversation of two finished turns is open";

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

/** Type a message into the composer and press Enter. */
async function send(page, text) {
	await composerInput(page).fill(text);
	await composerInput(page).press("Enter");
}

// ---- Opening ----

test("Opening a conversation loads its frame, its features and the sidebar", async ({
	page,
	request,
	baseURL,
}) => {
	const part = uniqueWord("open");
	const display = part.toUpperCase();
	let conv;
	const pageErrors = [];
	const failed = [];
	await test.step("Given a tag whose display name is its file-name part in upper case", () =>
		putTags(request, [{ file: `00010-${part}.html`, name: display }]));
	await test.step("And a conversation with that tag, created through the API", async () => {
		conv = await createConversation(request, {
			title: uniqueWord("開く"),
			messages: [
				["user", "質問"],
				["assistant", "答え"],
			],
			tags: [part],
		});
	});
	await test.step("When its page /c/<id>.html is opened, while the page errors and the answers of the site are recorded", async () => {
		const origin = new URL(baseURL).origin;
		page.on("pageerror", (e) => pageErrors.push(String(e)));
		page.on("response", (res) => {
			if (new URL(res.url()).origin === origin && res.status() >= 400)
				failed.push(`${res.status()} ${res.url()}`);
		});
		await openConversation(page, conv.id);
	});
	await test.step("Then the frame <lcty-c> is defined", async () => {
		expect(
			await page.evaluate(() => customElements.get("lcty-c") !== undefined),
		).toBe(true);
	});
	await test.step("And the features module has started: <lcty-c> has data-tag-defs", async () => {
		await expect(page.locator("lcty-c")).toHaveAttribute("data-tag-defs", /.*/);
	});
	await test.step("And the sidebar lists the conversation as current", async () => {
		await expect(
			page.locator(`a[part~="lcty-conv-list__item"][data-id="${conv.id}"]`),
		).toHaveAttribute("part", /lcty-conv-list__item--current/);
	});
	await test.step("And the tag chip in the header shows the tag's display name", async () => {
		await expect(page.locator('[part~="lcty-c__tag-name"]')).toHaveText(
			display,
		);
	});
	await test.step("And no page error happened and no request of the site was answered with a status of 400 or more", async () => {
		expect(pageErrors).toEqual([]);
		expect(failed).toEqual([]);
	});
});

// ---- Sending ----

test("A message sent on the conversation page gets a reply and both are saved", async ({
	page,
	request,
	llm,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will reply "三番目の答え"', () => {
		llm.reply("三番目の答え");
	});
	await test.step('When "三番目の質問" is sent', () =>
		send(page, "三番目の質問"));
	await test.step("Then the composer is emptied", async () => {
		await expect(composerInput(page)).toHaveValue("");
	});
	await test.step("And the page shows six messages", async () => {
		await expect(messages(page)).toHaveCount(6);
	});
	await test.step('And the last reply is completed with the text "三番目の答え"', async () => {
		await expect(messages(page, "assistant").last()).toHaveAttribute(
			"data-status",
			"completed",
		);
		await expect(
			messages(page, "assistant").last().locator("article"),
		).toHaveText("三番目の答え");
	});
	await test.step("And the whole history went to llama-server", () => {
		const input = JSON.stringify(llm.requests[0].input);
		for (const t of [
			"最初の質問",
			"最初の答え",
			"二番目の質問",
			"三番目の質問",
		])
			expect(input).toContain(t);
	});
	await test.step("And the server has saved six messages", () =>
		waitForSaved(request, conv.id, 6));
	await test.step("And after a reload the page shows six messages", async () => {
		await page.reload();
		await expect(messages(page)).toHaveCount(6);
	});
});

test("A reply starting with a level-1 heading becomes the title", async ({
	page,
	request,
	llm,
}) => {
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will reply "# 見出しのタイトル\\n\\n本文です。"', () => {
		llm.reply("# 見出しのタイトル\n\n本文です。");
	});
	await test.step('When "タイトルを付けて" is sent', () =>
		send(page, "タイトルを付けて"));
	await test.step('Then the page\'s title is "見出しのタイトル"', async () => {
		await expect(page).toHaveTitle("見出しのタイトル");
	});
	await test.step('And the title field in the header holds "見出しのタイトル"', async () => {
		await expect(page.locator('[part~="lcty-c__title"]')).toHaveValue(
			"見出しのタイトル",
		);
	});
});

test("Editing the title in the header saves it", async ({ page, request }) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('When "手で付けたタイトル" is typed into the title field in the header, Enter is pressed and the field loses focus', async () => {
		const title = page.locator('[part~="lcty-c__title"]');
		await title.fill("手で付けたタイトル");
		await title.press("Enter"); // change fires on Enter or when the field loses focus
		await title.blur();
	});
	await test.step('Then the page\'s title is "手で付けたタイトル"', async () => {
		await expect(page).toHaveTitle("手で付けたタイトル");
	});
	await test.step('And the server has saved the title "手で付けたタイトル"', async () => {
		await expect
			.poll(async () => {
				const res = await request.get(`/v1/conversations/${conv.id}`);
				return (await res.json()).title;
			})
			.toBe("手で付けたタイトル");
	});
});

// ---- Rendering a reply (LCTYSP-0005) ----

test("Markdown is rendered and raw HTML or script URLs never reach the DOM", async ({
	page,
	request,
	llm,
}) => {
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step("And llama-server will reply with bold text, code, a raw <img> with an onerror, a javascript: link and an https link", () => {
		llm.reply(
			[
				"**太字**と`コード`",
				"",
				'<img src="x" onerror="window.__xss = 1">',
				"",
				"[危ないリンク](javascript:window.__xss=2) と [安全なリンク](https://example.com/)",
			].join("\n"),
		);
	});
	await test.step('When "Markdown を返して" is sent', () =>
		send(page, "Markdown を返して"));
	const article = messages(page, "assistant").last().locator("article");
	await test.step("Then the last reply is completed", async () => {
		await expect(messages(page, "assistant").last()).toHaveAttribute(
			"data-status",
			"completed",
		);
	});
	await test.step("And the bold text is a <strong> and the code a <code>", async () => {
		await expect(article.locator("strong")).toHaveText("太字");
		await expect(article.locator("code")).toHaveText("コード");
	});
	await test.step("And the reply has no <img> and shows the raw <img> as text", async () => {
		await expect(article.locator("img")).toHaveCount(0);
		await expect(article).toContainText('<img src="x"');
	});
	await test.step("And the reply has no javascript: link, and the https link is a link with its text", async () => {
		await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
		await expect(article.locator('a[href="https://example.com/"]')).toHaveText(
			"安全なリンク",
		);
	});
	await test.step("And no script of the reply has run", async () => {
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
	});
});

test("A reply's thinking is shown collapsed", async ({
	page,
	request,
	llm,
}) => {
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will reply with the thinking "まず考えます。" and the text "考えた結果です。"', () => {
		llm.reply({ thinking: "まず考えます。", text: "考えた結果です。" });
	});
	await test.step('When "考えて" is sent', () => send(page, "考えて"));
	const reply = messages(page, "assistant").last();
	await test.step('Then the last reply has the thinking "まず考えます。" in data-thinking', async () => {
		await expect(reply).toHaveAttribute("data-thinking", "まず考えます。");
	});
	await test.step("And its thinking is shown, collapsed", async () => {
		const details = reply.locator('[part~="lcty-message__thinking"]');
		await expect(details).toBeVisible();
		await expect(details).not.toHaveAttribute("open", /.*/);
	});
});

test("Suggested next messages are buttons that fill the composer", async ({
	page,
	request,
	llm,
}) => {
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will reply "答えです。" with the suggestions "もっと詳しく" and "例を挙げて"', () => {
		llm.reply(
			[
				"答えです。",
				"<suggestion-for-user-turn>もっと詳しく</suggestion-for-user-turn>",
				"<suggestion-for-user-turn>例を挙げて</suggestion-for-user-turn>",
			].join("\n"),
		);
	});
	await test.step('When "提案して" is sent', () => send(page, "提案して"));
	const buttons = messages(page, "assistant")
		.last()
		.locator("article button.suggestion");
	await test.step('Then the last reply shows the suggestions as the buttons "もっと詳しく" and "例を挙げて"', async () => {
		await expect(buttons).toHaveText(["もっと詳しく", "例を挙げて"]);
	});
	await test.step('When the button "例を挙げて" is clicked', () =>
		buttons.nth(1).click());
	await test.step('Then the composer holds "例を挙げて" and has the focus', async () => {
		await expect(composerInput(page)).toHaveValue("例を挙げて");
		await expect(composerInput(page)).toBeFocused();
	});
});

test("A long suggestion wraps inside the reply instead of overflowing", async ({
	page,
	request,
	llm,
}) => {
	const long = "とても長い提案の文章です。".repeat(20);
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will reply "答えです。" with one suggestion of "とても長い提案の文章です。" repeated 20 times', () => {
		llm.reply(
			`答えです。\n<suggestion-for-user-turn>${long}</suggestion-for-user-turn>`,
		);
	});
	await test.step('When "長い提案を" is sent', () => send(page, "長い提案を"));
	const article = messages(page, "assistant").last().locator("article");
	const button = article.locator("button.suggestion");
	await test.step("Then the last reply shows the suggestion as a button", async () => {
		await expect(button).toHaveText(long);
	});
	await test.step("And the button ends inside the reply's text", async () => {
		const a = await article.boundingBox();
		const b = await button.boundingBox();
		expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width + 1);
	});
	await test.step("And the button is more than one line high", async () => {
		const b = await button.boundingBox();
		expect(b.height).toBeGreaterThan(40);
	});
});

// ---- Undo, regenerate and fork (LCTYSP-0004) ----

test("Only the last user message has undo, and only the last reply has regenerate", async ({
	page,
	request,
}) => {
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	const users = messages(page, "user");
	const replies = messages(page, "assistant");
	await test.step("Then undo is hidden on the first user message and shown on the second", async () => {
		await expect(await messageAction(users.nth(0), "undo")).toBeHidden();
		await expect(await messageAction(users.nth(1), "undo")).toBeVisible();
	});
	await test.step("And regenerate is hidden on the first reply and shown on the second", async () => {
		await expect(
			await messageAction(replies.nth(0), "regenerate"),
		).toBeHidden();
		await expect(
			await messageAction(replies.nth(1), "regenerate"),
		).toBeVisible();
	});
	await test.step("And fork is shown on both user messages", async () => {
		for (const i of [0, 1])
			await expect(await messageAction(users.nth(i), "fork")).toBeVisible();
	});
});

test("The actions show only while the message is hovered", async ({
	page,
	request,
}) => {
	await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	const fork = messages(page, "user")
		.first()
		.locator('[part~="lcty-message__action--fork"]');
	await test.step("When the mouse is moved to the top left corner of the page", () =>
		page.mouse.move(0, 0));
	await test.step("Then the fork button of the first user message is hidden", async () => {
		await expect(fork).toBeHidden();
	});
	await test.step("When the first user message is hovered", () =>
		messages(page, "user").first().hover());
	await test.step("Then its fork button is shown", async () => {
		await expect(fork).toBeVisible();
	});
});

test("Undo removes the last turn and puts the message back into the composer", async ({
	page,
	request,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step("When undo is clicked on the last user message", async () => {
		await (await messageAction(messages(page, "user").last(), "undo")).click();
	});
	await test.step("Then the page shows two messages", async () => {
		await expect(messages(page)).toHaveCount(2);
	});
	await test.step('And the composer holds "二番目の質問" and has the focus', async () => {
		await expect(composerInput(page)).toHaveValue("二番目の質問");
		await expect(composerInput(page)).toBeFocused();
	});
	await test.step("And the server has saved two messages", () =>
		waitForSaved(request, conv.id, 2));
	await test.step("When undo is clicked on the last user message again", async () => {
		await (await messageAction(messages(page, "user").last(), "undo")).click();
	});
	await test.step("Then the page shows no message", async () => {
		await expect(messages(page)).toHaveCount(0);
	});
	await test.step("And the server has saved no message", () =>
		waitForSaved(request, conv.id, 0));
});

test("Regenerate replaces only the last reply", async ({
	page,
	request,
	llm,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will reply "作り直した答え"', () => {
		llm.reply("作り直した答え");
	});
	await test.step("When regenerate is clicked on the last reply", async () => {
		await (
			await messageAction(messages(page, "assistant").last(), "regenerate")
		).click();
	});
	await test.step("Then the page shows four messages", async () => {
		await expect(messages(page)).toHaveCount(4);
	});
	await test.step('And the last reply shows "作り直した答え" and the first one still "最初の答え"', async () => {
		await expect(
			messages(page, "assistant").last().locator("article"),
		).toHaveText("作り直した答え");
		await expect(
			messages(page, "assistant").first().locator("article"),
		).toHaveText("最初の答え");
	});
	await test.step('And the last message the server has saved is "作り直した答え"', async () => {
		await expect
			.poll(async () => (await savedMessages(request, conv.id)).at(-1)?.content)
			.toBe("作り直した答え");
	});
});

test("Fork from here moves to the new conversation page /c/ with the source and the message index", async ({
	page,
	request,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step("When fork is clicked on the first user message", async () => {
		await (await messageAction(messages(page, "user").first(), "fork")).click();
	});
	await test.step("Then the browser goes to /c/?fork=<id>&at=0", () =>
		page.waitForURL(`/c/?fork=${conv.id}&at=0`));
	await test.step('And the composer holds "最初の質問"', async () => {
		await expect(composerInput(page)).toHaveValue("最初の質問");
	});
});

// ---- Stopping and errors (LCTYSP-0004) ----

test("The stop button ends the generation and keeps the reply as incomplete", async ({
	page,
	request,
	llm,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step("And llama-server will never answer", () => {
		llm.reply({ hang: true });
	});
	await test.step('When "止める質問" is sent', () => send(page, "止める質問"));
	const reply = messages(page, "assistant").last();
	await test.step("Then the last reply is streaming and <lcty-c> is busy", async () => {
		await expect(reply).toHaveAttribute("data-status", "streaming");
		await expect(page.locator("lcty-c")).toHaveAttribute("busy", "");
	});
	await test.step("When the stop button is clicked", () =>
		page.locator('[part~="lcty-composer__stop"]').click());
	await test.step("Then the last reply is incomplete, without an error", async () => {
		await expect(reply).toHaveAttribute("data-status", "incomplete");
		await expect(reply).not.toHaveAttribute("data-error", /.*/);
	});
	await test.step('And its status reads "停止しました"', async () => {
		await expect(reply.locator('[part~="lcty-message__status"]')).toHaveText(
			"停止しました",
		);
	});
	await test.step("And <lcty-c> is no longer busy", async () => {
		await expect(page.locator("lcty-c")).not.toHaveAttribute("busy", /.*/);
	});
	await test.step("And the server has saved six messages", () =>
		waitForSaved(request, conv.id, 6));
});

test("An error from llama-server is shown on the reply", async ({
	page,
	request,
	llm,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step('And llama-server will answer the status 500 with the error "model is not loaded"', () => {
		llm.reply({ status: 500, error: "model is not loaded" });
	});
	await test.step('When "失敗する質問" is sent', () =>
		send(page, "失敗する質問"));
	const reply = messages(page, "assistant").last();
	await test.step('Then the last reply is incomplete with the error "model is not loaded"', async () => {
		await expect(reply).toHaveAttribute("data-status", "incomplete");
		await expect(reply).toHaveAttribute("data-error", /model is not loaded/);
	});
	await test.step('And its status shows "model is not loaded"', async () => {
		await expect(reply.locator('[part~="lcty-message__status"]')).toContainText(
			"model is not loaded",
		);
	});
	await test.step("And the server has saved six messages", () =>
		waitForSaved(request, conv.id, 6));
});

// ---- Deleting ----

test("Deleting the conversation asks first and returns to the new conversation page /c/", async ({
	page,
	request,
}) => {
	const conv = await test.step(TWO_TURNS, () => openTwoTurns(page, request));
	await test.step("When the delete button is clicked and the confirmation is dismissed", async () => {
		page.once("dialog", (d) => d.dismiss());
		await page.locator('[part~="lcty-c__delete"]').click();
	});
	await test.step("Then the page stays at /c/<id>.html", async () => {
		await expect(page).toHaveURL(`/c/${conv.id}.html`);
	});
	await test.step("When the delete button is clicked and the confirmation is accepted", async () => {
		page.once("dialog", (d) => d.accept());
		await page.locator('[part~="lcty-c__delete"]').click();
	});
	await test.step("Then the browser goes to /c/", () => page.waitForURL("/c/"));
	await test.step("And GET /v1/conversations/<id> answers 404", async () => {
		const res = await request.get(`/v1/conversations/${conv.id}`);
		expect(res.status()).toBe(404);
	});
});
