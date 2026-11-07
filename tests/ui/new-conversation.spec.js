// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The new conversation page / (LCTYSP-004 "Starting a conversation", LCTYSP-005, LCTYSP-009).

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

test("the top page shows the sidebar and the creation card (LCTYSP-005)", async ({
	page,
}) => {
	await openNewPage(page);
	await expect(page.locator("body > lcty-sidebar")).toBeVisible();
	await expect(page.locator("main.new-card h2")).toHaveText("新しい会話"); // localized (html lang="ja")
	await expect(page.locator("#setup-instructions")).toBeVisible();
	await expect(composerInput(page)).toBeFocused();
});

test("sending the first message creates the conversation and generates the reply (LCTYSP-004)", async ({
	page,
	request,
	llm,
}) => {
	llm.reply("こんにちは、テストです。");
	const id = await startConversation(page, "はじめまして");

	await expect(messages(page)).toHaveCount(2);
	await expect(userText(messages(page, "user"))).toHaveText("はじめまして");
	await expect(messages(page, "assistant").locator("article")).toHaveText(
		"こんにちは、テストです。",
	);
	// The title is the first line of the first message
	await expect(page).toHaveTitle("はじめまして");
	// The model got the first message
	expect(llm.requests).toHaveLength(1);
	expect(JSON.stringify(llm.requests[0].input)).toContain("はじめまして");
	// Both messages are in the file
	await waitForSaved(request, id, 2);
});

test("Shift+Enter inserts a newline instead of sending (LCTYSP-005)", async ({
	page,
}) => {
	await openNewPage(page);
	const input = composerInput(page);
	await input.fill("一行目");
	await input.press("Shift+Enter");
	await input.pressSequentially("二行目");
	await expect(input).toHaveValue("一行目\n二行目");
	await expect(page).toHaveURL(/\/$/);
});

test("an empty message is not sent", async ({ page }) => {
	await openNewPage(page);
	await composerInput(page).fill("   ");
	await composerInput(page).press("Enter");
	await expect(page).toHaveURL(/\/$/);
});

test("choosing a tag fills the system prompt draft from its prompt and memory (LCTYSP-009)", async ({
	page,
	request,
	llm,
}) => {
	const name = uniqueWord("tag");
	const prompt = `${uniqueWord("prompt")} として答えてください。`;
	const memory = uniqueWord("memory");
	await putTags(request, [
		{ name, prompt, memory: [{ id: "m1", text: memory }] },
	]);
	await openNewPage(page);

	const box = page.locator(`#setup-tags input[value="${name}"]`);
	await box.check();
	const draft = page.locator("#setup-instructions");
	await expect(draft).toHaveValue(new RegExp(prompt));
	await expect(draft).toHaveValue(new RegExp(memory));

	// Unchecking empties the untouched draft again
	await box.uncheck();
	await expect(draft).toHaveValue("");

	// The conversation keeps the tag and the system prompt it was created with, and the model gets that prompt
	await box.check();
	const id = await sendFirstMessage(page, "タグ付きの会話");
	await expect(page.locator("lcty-c")).toHaveAttribute("data-setup-tags", name);
	expect(llm.requests[0].instructions).toContain(prompt);
	const res = await request.get(`/v1/conversations/${id}`);
	expect((await res.json()).tags).toEqual([name]);
});

test("a fork starts from the source's system prompt and puts the chosen message into the composer (LCTYSP-004)", async ({
	page,
	request,
}) => {
	const src = await createConversation(request, {
		title: "分岐元",
		instructions: "分岐元のシステムプロンプト",
		messages: [
			["user", "最初の質問"],
			["assistant", "最初の答え"],
			["user", "二番目の質問"],
			["assistant", "二番目の答え"],
		],
	});
	await openNewPage(page, `/?fork=${src.id}&at=2`);

	await expect(page.locator("#fork-note")).toBeVisible();
	await expect(page.locator("#fork-note a")).toHaveAttribute(
		"href",
		`/c/${src.id}.html`,
	);
	await expect(page.locator("#setup-instructions")).toHaveValue(
		"分岐元のシステムプロンプト",
	);
	await expect(composerInput(page)).toHaveValue("二番目の質問");

	// Sending copies the first two messages (inherited) and adds the edited one
	await composerInput(page).fill("書き換えた二番目の質問");
	await composerInput(page).press("Enter");
	await page.waitForURL(/\/c\/[^/]+\.html$/);
	await expect(messages(page)).toHaveCount(4);
	await expect(userText(messages(page, "user").last())).toHaveText(
		"書き換えた二番目の質問",
	);
	const id = conversationIdOf(page);
	expect(id).not.toBe(src.id);
	await waitForSaved(request, id, 4);
	const saved = await savedMessages(request, id);
	expect(saved.slice(0, 2).every((m) => m.inherited)).toBe(true);
	// The source is unchanged
	expect(await savedMessages(request, src.id)).toHaveLength(4);
});
