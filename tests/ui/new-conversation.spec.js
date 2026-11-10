// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-2001: the scenarios of docs/specs/LCTYSP-2001_new-conversation-page.feature, the new conversation page /c/
// (LCTYSP-0004 "Starting a conversation", LCTYSP-0005, LCTYSP-0009). Each test has the title of its Scenario and one
// test.step per line of it, so the two read side by side.

import {
	composerInput,
	conversationIdOf,
	createConversation,
	expect,
	messages,
	openNewPage,
	putTags,
	savedMessages,
	sendFirstMessage,
	startConversation,
	test,
	uniqueWord,
	userText,
	waitForSaved,
} from "./fixtures.js";

// Tag definitions are global: leave none behind for the other tests
test.afterEach(async ({ request }) => {
	await putTags(request, []);
});

test("The new conversation page shows the sidebar and the creation card", async ({
	page,
}) => {
	await test.step("When the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step("Then the sidebar is shown", async () => {
		await expect(page.locator("body > lcty-sidebar")).toBeVisible();
	});
	await test.step('And the card is headed "新しい会話", in Japanese as the page is', async () => {
		await expect(page.locator("main.new-card h2")).toHaveText("新しい会話"); // localized (html lang="ja")
	});
	await test.step("And the system prompt draft is shown", async () => {
		await expect(page.locator("#setup-instructions")).toBeVisible();
	});
	await test.step("And the composer has the focus", async () => {
		await expect(composerInput(page)).toBeFocused();
	});
});

test("The root of the site moves to the new conversation page /c/, and /c with its query", async ({
	page,
}) => {
	await test.step("When the root of the site / is opened", () =>
		openNewPage(page, "/"));
	await test.step("Then the browser is on /c/", async () => {
		await expect(page).toHaveURL(/\/c\/$/);
	});
	await test.step("When /c?q=abc is opened", () =>
		openNewPage(page, "/c?q=abc"));
	await test.step("Then the browser is on /c/?q=abc", async () => {
		await expect(page).toHaveURL(/\/c\/\?q=abc$/);
	});
});

test("Sending the first message creates the conversation and generates the reply", async ({
	page,
	request,
	llm,
}) => {
	let id;
	await test.step('Given the model will reply "こんにちは、テストです。"', () => {
		llm.reply("こんにちは、テストです。");
	});
	await test.step('When a conversation is started on /c/ with the first message "はじめまして"', async () => {
		id = await startConversation(page, "はじめまして");
	});
	await test.step("Then the page shows two messages", async () => {
		await expect(messages(page)).toHaveCount(2);
	});
	await test.step('And the user message is "はじめまして"', async () => {
		await expect(userText(messages(page, "user"))).toHaveText("はじめまして");
	});
	await test.step('And the assistant message is "こんにちは、テストです。"', async () => {
		await expect(messages(page, "assistant").locator("article")).toHaveText(
			"こんにちは、テストです。",
		);
	});
	await test.step('And the page title is "はじめまして", the first line of the first message', async () => {
		await expect(page).toHaveTitle("はじめまして");
	});
	await test.step('And the model got one request, which contains "はじめまして"', () => {
		expect(llm.requests).toHaveLength(1);
		expect(JSON.stringify(llm.requests[0].input)).toContain("はじめまして");
	});
	await test.step("And the server has saved both messages", () =>
		waitForSaved(request, id, 2));
});

test("Shift+Enter inserts a newline instead of sending", async ({ page }) => {
	const input = composerInput(page);
	await test.step("Given the new conversation page /c/ is open", () =>
		openNewPage(page));
	await test.step('When "一行目" is typed in the composer', () =>
		input.fill("一行目"));
	await test.step("And Shift+Enter is pressed", () =>
		input.press("Shift+Enter"));
	await test.step('And "二行目" is typed', () =>
		input.pressSequentially("二行目"));
	await test.step('Then the composer holds "一行目", a newline and "二行目"', async () => {
		await expect(input).toHaveValue("一行目\n二行目");
	});
	await test.step("And the browser is still on /c/", async () => {
		await expect(page).toHaveURL(/\/c\/$/);
	});
});

test("An empty message is not sent", async ({ page }) => {
	await test.step("Given the new conversation page /c/ is open", () =>
		openNewPage(page));
	await test.step("When the composer holds only spaces and Enter is pressed", async () => {
		await composerInput(page).fill("   ");
		await composerInput(page).press("Enter");
	});
	await test.step("Then the browser is still on /c/", async () => {
		await expect(page).toHaveURL(/\/c\/$/);
	});
});

test("Choosing a tag fills the system prompt draft from its prompt and memory", async ({
	page,
	request,
	llm,
}) => {
	const name = uniqueWord("tag");
	const prompt = `${uniqueWord("prompt")} として答えてください。`;
	const memory = uniqueWord("memory");
	const box = page.locator(`#setup-tags input[value="${name}"]`);
	const draft = page.locator("#setup-instructions");
	let id;
	await test.step("Given a tag with a prompt and a memory", () =>
		putTags(request, [{ name, prompt, memory: [{ id: "m1", text: memory }] }]));
	await test.step("And the new conversation page /c/ is open", () =>
		openNewPage(page));
	await test.step("When the tag is checked", () => box.check());
	await test.step("Then the system prompt draft contains the tag's prompt", async () => {
		await expect(draft).toHaveValue(new RegExp(prompt));
	});
	await test.step("And the system prompt draft contains the tag's memory", async () => {
		await expect(draft).toHaveValue(new RegExp(memory));
	});
	await test.step("When the tag is unchecked", () => box.uncheck());
	await test.step("Then the untouched draft is empty again", async () => {
		await expect(draft).toHaveValue("");
	});
	await test.step('When the tag is checked again and the first message "タグ付きの会話" is sent', async () => {
		await box.check();
		id = await sendFirstMessage(page, "タグ付きの会話");
	});
	await test.step("Then the conversation's page has the tag in data-setup-tags", async () => {
		await expect(page.locator("lcty-c")).toHaveAttribute(
			"data-setup-tags",
			name,
		);
	});
	await test.step("And the model got the tag's prompt in its instructions", () => {
		expect(llm.requests[0].instructions).toContain(prompt);
	});
	await test.step("And the server has saved the conversation with the tag", async () => {
		const res = await request.get(`/v1/conversations/${id}`);
		expect((await res.json()).tags).toEqual([name]);
	});
});

test("A fork starts from the source's system prompt and puts the chosen message into the composer", async ({
	page,
	request,
}) => {
	let src;
	let id;
	await test.step('Given a conversation with the system prompt "分岐元のシステムプロンプト" and two questions with their answers', async () => {
		src = await createConversation(request, {
			title: "分岐元",
			instructions: "分岐元のシステムプロンプト",
			messages: [
				["user", "最初の質問"],
				["assistant", "最初の答え"],
				["user", "二番目の質問"],
				["assistant", "二番目の答え"],
			],
		});
	});
	await test.step("When the new conversation page is opened with fork=<the source's id> and at=2", () =>
		openNewPage(page, `/c/?fork=${src.id}&at=2`));
	await test.step("Then the fork note is shown", async () => {
		await expect(page.locator("#fork-note")).toBeVisible();
	});
	await test.step("And it links to the source's page c/<id>.html on the site", async () => {
		// convUrl(): the URL of c/<id>.html on the site
		await expect(page.locator("#fork-note a")).toHaveAttribute(
			"href",
			new URL(`/c/${src.id}.html`, page.url()).href,
		);
	});
	await test.step('And the system prompt draft is "分岐元のシステムプロンプト"', async () => {
		await expect(page.locator("#setup-instructions")).toHaveValue(
			"分岐元のシステムプロンプト",
		);
	});
	await test.step('And the composer holds the chosen message "二番目の質問"', async () => {
		await expect(composerInput(page)).toHaveValue("二番目の質問");
	});
	await test.step('When the composer\'s text is replaced with "書き換えた二番目の質問" and Enter is pressed', async () => {
		await composerInput(page).fill("書き換えた二番目の質問");
		await composerInput(page).press("Enter");
	});
	await test.step("Then the browser moves to the new conversation's page", () =>
		page.waitForURL(/\/c\/[^/]+\.html$/));
	await test.step('And the page shows four messages, the last user message being "書き換えた二番目の質問"', async () => {
		await expect(messages(page)).toHaveCount(4);
		await expect(userText(messages(page, "user").last())).toHaveText(
			"書き換えた二番目の質問",
		);
	});
	await test.step("And the new conversation is not the source", () => {
		id = conversationIdOf(page);
		expect(id).not.toBe(src.id);
	});
	await test.step("And the server has saved four messages, the first two copies of the source's with ids of their own", async () => {
		// Sending copies the first two messages with new ids (a fork shares none, LCTYSP-0013) and adds the edited one,
		// then the reply
		await waitForSaved(request, id, 4);
		const saved = await savedMessages(request, id);
		const source = await savedMessages(request, src.id);
		expect(saved.slice(0, 2).map((m) => m.content)).toEqual(
			source.slice(0, 2).map((m) => m.content),
		);
		expect(saved.slice(0, 2).map((m) => m.id)).not.toContain(source[0].id);
		expect(saved.slice(0, 2).map((m) => m.id)).not.toContain(source[1].id);
	});
	await test.step("And the source still has its four messages", async () => {
		expect(await savedMessages(request, src.id)).toHaveLength(4);
	});
});
