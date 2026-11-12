// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1017: the scenarios of docs/specs/LCTYSP-1017_conversation-elements.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/ui/lcty-elements.js runs in a real browser on the test server's origin, on the empty unit page, which loads
// /c/lcty.v1.js for the custom elements. The container is a plain <div> with a <lcty-composer> as its composer (a real
// <lcty-c> would import the conversation page's features). The module and the elements are kept on window (E, c,
// composer) so each step can reach them.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

// ---- Background ----

async function background(page, context) {
	await givenAPage(page, context);
	await test.step("And a container element with a <lcty-composer> as its composer", async () => {
		await page.evaluate(async () => {
			window.E = await import("/js/ui/lcty-elements.js");
			window.c = document.createElement("div");
			window.composer = document.createElement("lcty-composer");
			window.c.composer = window.composer;
			document.body.append(window.c, window.composer);
			window.frame = () =>
				new Promise((resolve) => requestAnimationFrame(() => resolve()));
			window.calls = [];
		});
	});
}

/** Put messages of a conversation file (HTML) into the container. */
function fileMessages(page, html) {
	return page.evaluate((html) => {
		window.c.innerHTML = html;
	}, html);
}

/** The visible state of the message element at index i. */
function messageState(page, i = 0) {
	return page.evaluate((i) => {
		const el = window.c.querySelectorAll(":scope > lcty-message")[i];
		const article = el.querySelector(":scope > article");
		return {
			id: el.id,
			role: el.dataset.role,
			status: el.dataset.status ?? null,
			thinking: el.getAttribute("data-thinking"),
			thinkingHidden: el.thinking ? el.thinking.hidden : null,
			thinkingSummary: el.thinkingSummary?.textContent ?? null,
			thinkingBody: el.thinkingBody?.textContent ?? null,
			articleText: article ? article.textContent : null,
			articleHTML: article ? article.innerHTML : null,
		};
	}, i);
}

/** A streaming reply, added with appendMessage and kept as window.r. */
async function givenAStreamingReply(
	page,
	line = "Given a streaming reply",
	text = "",
) {
	await test.step(line, async () => {
		await page.evaluate((text) => {
			window.r = window.E.appendMessage(window.c, {
				id: "r",
				role: "assistant",
				content: "",
				status: "streaming",
			});
			window.E.appendText(window.r, text);
		}, text);
	});
}

async function whenFinishMessageSettlesIt(page) {
	await test.step("When finishMessage settles it", async () => {
		await page.evaluate(() => window.E.finishMessage(window.r));
	});
}

/** initComposer on the composer; onSend and onStop push to window.calls. */
async function givenInitComposer(page) {
	await test.step("Given initComposer has wired the composer", async () => {
		await page.evaluate(() => {
			window.E.initComposer(window.composer, {
				onSend: (text) => window.calls.push(["send", text]),
				onStop: () => window.calls.push(["stop"]),
			});
		});
	});
}

function setComposerText(page, text) {
	return page.evaluate((text) => {
		window.composer.input.value = text;
	}, text);
}

const input = (page) => page.locator("lcty-composer textarea");
const calls = (page) => page.evaluate(() => window.calls);
const composerValue = (page) =>
	page.evaluate(() => window.composer.input.value);
const composerHasFocus = (page) =>
	page.evaluate(
		() =>
			document.activeElement === window.composer &&
			window.composer.shadowRoot.activeElement === window.composer.input,
	);

async function thenOnSendWasNotCalled(page) {
	await test.step("Then onSend was not called", async () => {
		expect((await calls(page)).filter(([k]) => k === "send")).toEqual([]);
	});
}

// ---- Scenarios ----

test("A user message is added as plain text", async ({ page, context }) => {
	await background(page, context);
	await test.step('When appendMessage adds the user message "a" with the content "<b>hi</b>"', async () => {
		await page.evaluate(() => {
			window.m = { id: "a", role: "user", content: "<b>hi</b>" };
			window.el = window.E.appendMessage(window.c, window.m);
		});
	});
	await test.step('Then the container has one <lcty-message> with the id "c-msg-a", the role "user" and the status "completed"', async () => {
		expect(
			await page.evaluate(
				() => window.c.querySelectorAll("lcty-message").length,
			),
		).toBe(1);
		const s = await messageState(page);
		expect(s).toMatchObject({
			id: "c-msg-a",
			role: "user",
			status: "completed",
		});
	});
	await test.step('And its child div.user-text holds the text "<b>hi</b>"', async () => {
		expect(
			await page.evaluate(() => {
				const body = window.el.querySelector(":scope > div.user-text");
				return { text: body.textContent, elements: body.children.length };
			}),
		).toEqual({ text: "<b>hi</b>", elements: 0 });
	});
	await test.step("And messageOf returns the very object it was given", async () => {
		expect(
			await page.evaluate(() => window.E.messageOf(window.el) === window.m),
		).toBe(true);
	});
});

test("A finished reply is rendered as Markdown with its thinking", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('When appendMessage adds the reply "r" with the content "# Head\\n\\nSome **bold**" and the thinking "hmm"', async () => {
		await page.evaluate(() => {
			window.E.appendMessage(window.c, {
				id: "r",
				role: "assistant",
				content: "# Head\n\nSome **bold**",
				thinking: "hmm",
			});
		});
	});
	await test.step('Then its <article> shows a heading "Head" and the paragraph "Some bold" with "bold" in <strong>', async () => {
		expect(
			await page.evaluate(() => {
				const a = window.c.querySelector("lcty-message > article");
				return {
					h1: a.querySelector("h1")?.textContent,
					p: a.querySelector("p")?.textContent,
					strong: a.querySelector("p > strong")?.textContent,
				};
			}),
		).toEqual({ h1: "Head", p: "Some bold", strong: "bold" });
	});
	await test.step('And it has data-thinking "hmm" and its thinking view says "Thinking (3 characters)"', async () => {
		const s = await messageState(page);
		expect(s).toMatchObject({
			thinking: "hmm",
			thinkingHidden: false,
			thinkingSummary: "Thinking (3 characters)",
		});
	});
});

test("A reply that is still streaming starts empty", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('When appendMessage adds the reply "r" with the status "streaming", the content "ignored" and the thinking "hmm"', async () => {
		await page.evaluate(() => {
			window.E.appendMessage(window.c, {
				id: "r",
				role: "assistant",
				status: "streaming",
				content: "ignored",
				thinking: "hmm",
			});
		});
	});
	await test.step('Then its status is "streaming" and its <article> shows no text', async () => {
		const s = await messageState(page);
		expect(s).toMatchObject({ status: "streaming", articleText: "" });
	});
	await test.step("And it has no data-thinking and its thinking view is hidden", async () => {
		const s = await messageState(page);
		expect(s).toMatchObject({ thinking: null, thinkingHidden: true });
	});
});

const lastUserMarks = (page) =>
	page.evaluate(() =>
		[...window.c.querySelectorAll(":scope > lcty-message")].map((el) =>
			el.hasAttribute("data-last-user"),
		),
	);

test("Only the last user message is marked", async ({ page, context }) => {
	await background(page, context);
	await test.step("When appendMessage adds a user message, a reply and a user message", async () => {
		await page.evaluate(() => {
			window.E.appendMessage(window.c, {
				id: "u1",
				role: "user",
				content: "q1",
			});
			window.E.appendMessage(window.c, {
				id: "r1",
				role: "assistant",
				content: "a1",
			});
			window.E.appendMessage(window.c, {
				id: "u2",
				role: "user",
				content: "q2",
			});
		});
	});
	await test.step("Then only the third message has data-last-user", async () => {
		expect(await lastUserMarks(page)).toEqual([false, false, true]);
	});
	await test.step("When removeFrom removes the messages from index 2", async () => {
		await page.evaluate(() => window.E.removeFrom(window.c, 2));
	});
	await test.step("Then two messages remain and only the first has data-last-user", async () => {
		expect(await lastUserMarks(page)).toEqual([true, false]);
	});
});

test("removeFrom removes the messages from an index on", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the container holds four messages", async () => {
		await page.evaluate(() => {
			for (const [id, role] of [
				["u1", "user"],
				["r1", "assistant"],
				["u2", "user"],
				["r2", "assistant"],
			])
				window.E.appendMessage(window.c, { id, role, content: id });
		});
	});
	const ids = () =>
		page.evaluate(() =>
			[...window.c.querySelectorAll(":scope > lcty-message")].map(
				(el) => el.id,
			),
		);
	await test.step("When removeFrom removes the messages from index 4", async () => {
		await page.evaluate(() => window.E.removeFrom(window.c, 4));
	});
	await test.step("Then four messages remain", async () => {
		expect(await ids()).toEqual([
			"c-msg-u1",
			"c-msg-r1",
			"c-msg-u2",
			"c-msg-r2",
		]);
	});
	await test.step("When removeFrom removes the messages from index 1", async () => {
		await page.evaluate(() => window.E.removeFrom(window.c, 1));
	});
	await test.step("Then only the first message remains", async () => {
		expect(await ids()).toEqual(["c-msg-u1"]);
	});
	await test.step("And readMessages returns its message only", async () => {
		expect(await page.evaluate(() => window.E.readMessages(window.c))).toEqual([
			{ id: "u1", role: "user", content: "u1" },
		]);
	});
});

test("Streamed text is drawn once per animation frame", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	let before;
	await test.step('When appendText adds "Hello **wor" and "ld**\\n\\nSecond" in one task', async () => {
		before = await page.evaluate(() => {
			window.E.appendText(window.r, "Hello **wor");
			window.E.appendText(window.r, "ld**\n\nSecond");
			return window.r.querySelector(":scope > article").textContent;
		});
	});
	await test.step("Then its <article> shows no text before the next animation frame", async () => {
		expect(before).toBe("");
	});
	await test.step('And after the next animation frame its <article> holds "Hello world" in a committed paragraph, and the tail after it "Second"', async () => {
		await page.evaluate(() => window.frame());
		expect(
			await page.evaluate(() => {
				const a = window.r.querySelector(":scope > article");
				const tail = a.nextElementSibling;
				return {
					article: [...a.children].map((e) => [e.tagName, e.textContent]),
					tail: [tail.className, tail.textContent],
				};
			}),
		).toEqual({ article: [["P", "Hello world"]], tail: ["md-tail", "Second"] });
	});
});

test("Finishing a streamed reply fixes every block", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(
		page,
		'Given a streaming reply with the text "Hello **world**\\n\\nSecond" appended',
		"Hello **world**\n\nSecond",
	);
	await test.step("And the status is removed from its message", async () => {
		await page.evaluate(() => {
			delete window.E.messageOf(window.r).status;
		});
	});
	await whenFinishMessageSettlesIt(page);
	await test.step('Then its <article> holds the paragraphs "Hello world" and "Second", and no tail follows it', async () => {
		expect(
			await page.evaluate(() => {
				const a = window.r.querySelector(":scope > article");
				return {
					article: a.innerHTML,
					next: a.nextElementSibling,
				};
			}),
		).toEqual({
			article: "<p>Hello <strong>world</strong></p><p>Second</p>",
			next: null,
		});
	});
	await test.step('And its status is "completed"', async () => {
		expect((await messageState(page)).status).toBe("completed");
	});
});

test("A link reference definition after its use makes the blocks written before it link", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	const article = () =>
		page.evaluate(() => window.r.querySelector(":scope > article").innerHTML);
	await test.step('When appendText adds "See [docs].\\n\\n" and a frame is drawn', async () => {
		await page.evaluate(async () => {
			window.E.appendText(window.r, "See [docs].\n\n");
			await window.frame();
		});
	});
	await test.step('Then its <article> holds the paragraph "See [docs]." as text', async () => {
		expect(await article()).toBe("<p>See [docs].</p>");
	});
	await test.step('When appendText adds "[docs]: https://e.org\\n\\nNext\\n\\n" and a frame is drawn', async () => {
		await page.evaluate(async () => {
			window.E.appendText(window.r, "[docs]: https://e.org\n\nNext\n\n");
			await window.frame();
		});
	});
	await test.step('Then its <article> holds <p>See <a href="https://e.org" target="_blank" rel="noopener noreferrer">docs</a>.</p><p>Next</p>', async () => {
		expect(await article()).toBe(
			'<p>See <a href="https://e.org" target="_blank" rel="noopener noreferrer">docs</a>.</p><p>Next</p>',
		);
	});
});

test("An unfinished code block grows in one text node", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	await test.step('When appendText adds "```js\\nlet a" and a frame is drawn', async () => {
		await page.evaluate(async () => {
			window.E.appendText(window.r, "```js\nlet a");
			await window.frame();
		});
	});
	await test.step('Then the tail after its <article> shows a code block "js" with the code "let a"', async () => {
		expect(
			await page.evaluate(() => {
				const tail = window.r.querySelector(":scope > article + .md-tail");
				const code = tail.querySelector(".codeblock code");
				window.node = code.firstChild;
				return {
					lang: tail.querySelector(".codebar .lang").textContent,
					code: code.textContent,
				};
			}),
		).toEqual({ lang: "js", code: "let a" });
	});
	await test.step('When appendText adds " = 1;" and a frame is drawn', async () => {
		await page.evaluate(async () => {
			window.E.appendText(window.r, " = 1;");
			await window.frame();
		});
	});
	await test.step('Then the same text node now holds "let a = 1;"', async () => {
		expect(
			await page.evaluate(() => {
				const code = window.r.querySelector(".md-tail .codeblock code");
				return {
					same: code.firstChild === window.node && window.node.isConnected,
					data: window.node.data,
				};
			}),
		).toEqual({ same: true, data: "let a = 1;" });
	});
});

/** A few animation frames, for the observers of the tail's box to report and the page to settle. */
const settle = (page) =>
	page.evaluate(async () => {
		for (let i = 0; i < 4; i++) await window.frame();
	});

/** The tail's box of window.r: its height, its contain, the view's height and the content's text and bottom. */
const tailBox = (page) =>
	page.evaluate(() => {
		const box = window.r.querySelector(":scope > article + .md-tail");
		if (!box) return null;
		const content = box.querySelector(":scope > .md-tail-content");
		return {
			height: box.getBoundingClientRect().height,
			contain: getComputedStyle(box).contain,
			view: innerHeight,
			text: content.textContent,
			contentHeight: content.getBoundingClientRect().height,
			contentBottom: content.getBoundingClientRect().bottom,
			page: document.scrollingElement.scrollHeight,
		};
	});

/** Text of n lines of an open code block, which stays in the tail. */
const codeLines = (n, from = 0) =>
	Array.from({ length: n }, (_, i) => `line ${from + i}\n`).join("");

test("The tail is drawn in a box a third of the view high", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	await test.step('When appendText adds "Hello" and a frame is drawn', async () => {
		await page.evaluate(() => window.E.appendText(window.r, "Hello"));
		await settle(page);
	});
	await test.step('Then the box after its <article> holds "Hello", is contain: strict and a third of the view high', async () => {
		const box = await tailBox(page);
		expect(box.text).toBe("Hello");
		expect(box.contain).toBe("strict");
		expect(Math.abs(box.height - Math.round(box.view / 3))).toBeLessThanOrEqual(
			1,
		);
	});
});

test("The tail's box grows by a third of the view when its content does not fit", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	await test.step("When appendText adds an open code block of 80 lines and the frames are drawn", async () => {
		await page.evaluate(
			(text) => window.E.appendText(window.r, text),
			`\`\`\`\n${codeLines(80)}`,
		);
		await settle(page);
	});
	await test.step("Then the box is as tall as its content and a third of the view more", async () => {
		const box = await tailBox(page);
		expect(box.contentHeight).toBeGreaterThan(box.view / 3);
		expect(
			Math.abs(
				box.height - (Math.ceil(box.contentHeight) + Math.round(box.view / 3)),
			),
		).toBeLessThanOrEqual(1);
	});
});

test("A commit gives the room of the tail's box to the <article>", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	let before;
	await test.step("And the tail is a paragraph of 30 lines in its box", async () => {
		await page.evaluate(
			(text) => window.E.appendText(window.r, text),
			codeLines(30),
		);
		await settle(page);
		before = await tailBox(page);
	});
	await test.step("When appendText adds a blank line, which commits the paragraph, and the frames are drawn", async () => {
		await page.evaluate(() => window.E.appendText(window.r, "\n"));
		await settle(page);
	});
	await test.step("Then the <article> holds the paragraph, the box is smaller by what the <article> gained, and the page's height stays", async () => {
		const after = await tailBox(page);
		const article = await page.evaluate(
			() =>
				window.r.querySelector(":scope > article").getBoundingClientRect()
					.height,
		);
		expect(article).toBeGreaterThan(0);
		expect(after.text).toBe("");
		expect(
			Math.abs(before.height - article - after.height),
		).toBeLessThanOrEqual(2);
		expect(Math.abs(after.page - before.page)).toBeLessThanOrEqual(2);
	});
});

test("The page follows a reply whose box is in view until the reader scrolls", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given a page twice the view high", async () => {
		await page.evaluate(() => {
			const above = document.createElement("div");
			above.style.height = `${2 * innerHeight}px`;
			window.c.before(above);
		});
	});
	await givenAStreamingReply(page, "And a streaming reply below it");
	const append = async (from) => {
		await page.evaluate(
			(text) => window.E.appendText(window.r, text),
			codeLines(20, from),
		);
		await settle(page);
	};
	const endInView = async () => {
		const box = await tailBox(page);
		return box.contentBottom <= box.view;
	};
	await test.step("And the page is scrolled to its end, so the box is in view", async () => {
		await page.evaluate(() => window.E.appendText(window.r, "```\n"));
		await settle(page);
		await page.evaluate(() =>
			scrollTo(0, document.scrollingElement.scrollHeight),
		);
		await settle(page);
	});
	await test.step("When appendText adds 20 lines of code, then 20 more, with frames drawn after each", async () => {
		await append(0);
		await append(20);
	});
	await test.step("Then the end of the tail's content is in view", async () => {
		expect(await endInView()).toBe(true);
	});
	await test.step("When the reader turns the wheel up and 20 more lines are added", async () => {
		await page.mouse.move(100, 100);
		await page.mouse.wheel(0, -40);
		await settle(page);
		await append(40);
	});
	await test.step("Then the end of the tail's content is no longer in view", async () => {
		expect(await endInView()).toBe(false);
	});
	await test.step("When the page is scrolled to its top and back to its end, and 20 more lines are added", async () => {
		await page.evaluate(() => scrollTo(0, 0));
		await settle(page);
		await page.evaluate(() =>
			scrollTo(0, document.scrollingElement.scrollHeight),
		);
		await settle(page);
		await append(60);
	});
	await test.step("Then the end of the tail's content is in view again", async () => {
		expect(await endInView()).toBe(true);
	});
});

test("Thinking is counted while it streams and shown when it is open", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	await test.step('When appendThinking adds "abc" and "de" and a frame is drawn', async () => {
		await page.evaluate(async () => {
			window.E.appendThinking(window.r, "abc");
			window.E.appendThinking(window.r, "de");
			await window.frame();
		});
	});
	await test.step('Then its thinking view is shown with the summary "Thinking… (5 characters)" and an empty body', async () => {
		expect(await messageState(page)).toMatchObject({
			thinkingHidden: false,
			thinkingSummary: "Thinking… (5 characters)",
			thinkingBody: "",
		});
	});
	await test.step("When the thinking view is opened", async () => {
		await page.evaluate(
			() =>
				new Promise((resolve) => {
					window.r.thinking.addEventListener("toggle", () => resolve(), {
						once: true,
					});
					window.r.thinking.open = true;
				}),
		);
	});
	await test.step('Then its body holds "abcde"', async () => {
		expect((await messageState(page)).thinkingBody).toBe("abcde");
	});
	await whenFinishMessageSettlesIt(page);
	await test.step('Then it has data-thinking "abcde" and the summary "Thinking (5 characters)"', async () => {
		expect(await messageState(page)).toMatchObject({
			thinking: "abcde",
			thinkingSummary: "Thinking (5 characters)",
		});
	});
});

test("A reply finished without thinking has no thinking", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	await whenFinishMessageSettlesIt(page);
	await test.step("Then it has no data-thinking and its thinking view is hidden", async () => {
		expect(await messageState(page)).toMatchObject({
			thinking: null,
			thinkingHidden: true,
		});
	});
});

test("Finishing shows how an incomplete reply ended and its timings", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAStreamingReply(page);
	await test.step('And its message is given the status "incomplete", the error "boom", timings and a client time to first output', async () => {
		await page.evaluate(() => {
			Object.assign(window.E.messageOf(window.r), {
				status: "incomplete",
				error: "boom",
				timings: {
					cache_n: 10,
					prompt_n: 20,
					prompt_ms: 500,
					predicted_n: 5,
					predicted_per_second: 12.34,
				},
				client: { ttft_ms: 12345 },
			});
		});
	});
	await whenFinishMessageSettlesIt(page);
	await test.step('Then it has the status "incomplete", data-error "boom" and the timings and client as JSON attributes', async () => {
		expect(
			await page.evaluate(() => ({
				status: window.r.dataset.status,
				error: window.r.getAttribute("data-error"),
				timings: JSON.parse(window.r.getAttribute("data-timings")),
				client: JSON.parse(window.r.getAttribute("data-client")),
			})),
		).toEqual({
			status: "incomplete",
			error: "boom",
			timings: {
				cache_n: 10,
				prompt_n: 20,
				prompt_ms: 500,
				predicted_n: 5,
				predicted_per_second: 12.34,
			},
			client: { ttft_ms: 12345 },
		});
	});
	await test.step('And its foot says "Error: boom" and shows the ⓘ', async () => {
		expect(
			await page.evaluate(() => ({
				foot: window.r.foot.hidden,
				status: window.r.statusText.textContent,
				info: window.r.info.hidden,
			})),
		).toEqual({ foot: false, status: "Error: boom", info: false });
	});
	await test.step('And the timings popover says "Input 30 tok (cached 10 / computed 20, 0.50s)", "Output 5 tok, 12.3 tok/s" and "First output after 12.3s", one per line', async () => {
		expect(await page.evaluate(() => window.r.timings.textContent)).toBe(
			"Input 30 tok (cached 10 / computed 20, 0.50s)\nOutput 5 tok, 12.3 tok/s\nFirst output after 12.3s",
		);
	});
});

for (const [kase, elements, html, answer] of [
	[
		"LCTYSP-0003",
		"an <lcty-setup> and an <lcty-message>",
		'<lcty-setup data-instructions=""></lcty-setup><lcty-message data-role="user"></lcty-message>',
		false,
	],
	[
		"messages of 0003 only",
		"an <lcty-message>",
		'<lcty-message data-role="user"></lcty-message>',
		false,
	],
	[
		"LCTYSP-0013",
		"an <lcty-msg> and an <lcty-thinking>",
		'<lcty-msg data-role="user"></lcty-msg><lcty-thinking></lcty-thinking>',
		true,
	],
	["no element", "nothing", "", true],
]) {
	test(`isLctyMsgFile tells a file of LCTYSP-0013 from one of LCTYSP-0003 (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await test.step(`Given the container holds ${elements}`, () =>
			fileMessages(page, html));
		await test.step(`Then isLctyMsgFile is ${answer}`, async () => {
			expect(await page.evaluate(() => window.E.isLctyMsgFile(window.c))).toBe(
				answer,
			);
		});
	});
}

test("readLctyMsgs reads the user and model messages of a file of LCTYSP-0013", async ({
	page,
	context,
}) => {
	await background(page, context);
	const u = "0190f3a1-7c2e-7abc-8def-0123456789ab";
	const m = "0190f3a1-7c2e-7abc-8def-0123456789ac";
	const at = "2026-11-10T09:00:00+09:00";
	await test.step("Given the container holds a system <lcty-msg>, a user one, an <lcty-thinking>, a model one with its text in data-content-base64, and an <lcty-cmd>", () =>
		fileMessages(
			page,
			`<lcty-msg data-role="system" id="sys-${u}" data-content="be brief"><article>be brief</article></lcty-msg>` +
				`<lcty-msg data-role="user" id="msg-u-${u}" data-at="${at}" data-content="hi"><article>hi</article></lcty-msg>` +
				`<lcty-thinking id="think-${m}" data-at="${at}" data-content="hmm"><article>hmm</article></lcty-thinking>` +
				`<lcty-msg data-role="model" id="msg-m-${m}" data-at="${at}" data-content-base64="5pel5pys6Kqe"><article>日本語</article></lcty-msg>` +
				`<lcty-cmd id="cmd-${m}" data-op="send" data-at="${at}"></lcty-cmd>`,
		));
	let msgs;
	await test.step("When readLctyMsgs reads it", async () => {
		msgs = await page.evaluate(() => window.E.readLctyMsgs(window.c));
	});
	await test.step("Then it returns the user and model messages as id, role, time and content, with the bare ids and model as assistant", () => {
		expect(msgs).toEqual([
			{ id: u, role: "user", at, content: "hi" },
			{ id: m, role: "assistant", at, content: "日本語" },
		]);
	});
});

test("A message of the file is read from its attributes", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the container holds a reply of the file with every attribute, its content in data-content-base64", async () => {
		await fileMessages(
			page,
			`<lcty-message id="c-msg-r1" data-role="assistant" data-at="2026-11-01T09:00:00+09:00" data-status="incomplete"
				data-error="stopped" data-inherited="true" data-timings='{"prompt_n":1}' data-client='{"ttft_ms":5}'
				data-usage='{"input_tokens":3}' data-content-base64="5pel5pys6Kqe" data-thinking="deep"><article></article></lcty-message>`,
		);
	});
	await test.step("When messageOf reads it", async () => {
		await page.evaluate(() => {
			window.el = window.c.querySelector("lcty-message");
			window.m = window.E.messageOf(window.el);
		});
	});
	await test.step("Then it returns the id, role, time, status, error, inherited, timings, client, usage, content and thinking", async () => {
		expect(await page.evaluate(() => window.m)).toEqual({
			id: "r1",
			role: "assistant",
			at: "2026-11-01T09:00:00+09:00",
			status: "incomplete",
			error: "stopped",
			inherited: true,
			timings: { prompt_n: 1 },
			client: { ttft_ms: 5 },
			usage: { input_tokens: 3 },
			content: "日本語",
			thinking: "deep",
		});
	});
	await test.step("And a second call returns the same object even after the attributes change", async () => {
		expect(
			await page.evaluate(() => {
				window.el.setAttribute("data-content", "changed");
				window.el.removeAttribute("data-content-base64");
				const again = window.E.messageOf(window.el);
				return { same: again === window.m, content: again.content };
			}),
		).toEqual({ same: true, content: "日本語" });
	});
});

test("Attributes of the file that cannot be read are left out", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the container holds a user message of the file with broken JSON in data-timings, a bad data-content-base64 and data-thinking", async () => {
		await fileMessages(
			page,
			`<lcty-message id="c-msg-u1" data-role="user" data-at="t" data-timings="{bad" data-content-base64="!!!"
				data-thinking="t"><div class="user-text"></div></lcty-message>`,
		);
	});
	await test.step("When messageOf reads it", async () => {
		await page.evaluate(() => {
			window.m = window.E.messageOf(window.c.querySelector("lcty-message"));
		});
	});
	await test.step('Then it returns only the id, role, time and the content ""', async () => {
		expect(await page.evaluate(() => window.m)).toEqual({
			id: "u1",
			role: "user",
			at: "t",
			content: "",
		});
	});
});

test("Starting prepares the messages of the file", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the container holds a user message, a reply with saved presentation HTML, a reply without it and an old <lcty-thinking> child, a reply with timings, and a reply an older renderer saved", async () => {
		await fileMessages(
			page,
			`<lcty-message id="c-msg-u1" data-role="user" data-content="q"><div class="user-text">q</div></lcty-message>
			<lcty-message id="c-msg-r1" data-role="assistant" data-content="**x**"><article data-generator="lcty.v1.gfm"><p>saved</p></article></lcty-message>
			<lcty-message id="c-msg-r2" data-role="assistant" data-content="**new**"><lcty-thinking>old</lcty-thinking><article></article></lcty-message>
			<lcty-message id="c-msg-r3" data-role="assistant" data-content="t" data-timings='{"cache_n":0,"prompt_n":2,"prompt_ms":100}'><article data-generator="lcty.v1.gfm"><p>t</p></article></lcty-message>
			<lcty-message id="c-msg-r4" data-role="assistant" data-content="*o*"><article data-generator="lcty.v1"><p>old</p></article></lcty-message>`,
		);
	});
	await test.step("When initConversationElements starts", async () => {
		await page.evaluate(() => window.E.initConversationElements(window.c));
	});
	const article = (id) =>
		page.evaluate(
			(id) =>
				document.getElementById(id).querySelector(":scope > article").innerHTML,
			id,
		);
	await test.step("Then the reply with saved presentation HTML keeps it", async () => {
		expect(await article("c-msg-r1")).toBe("<p>saved</p>");
	});
	await test.step("And the reply without it is rendered from data-content", async () => {
		expect(await article("c-msg-r2")).toBe("<p><strong>new</strong></p>");
	});
	await test.step("And the reply an older renderer saved is rendered again from data-content", async () => {
		expect(await article("c-msg-r4")).toBe("<p><em>o</em></p>");
	});
	await test.step("And the old <lcty-thinking> child is removed", async () => {
		expect(
			await page.evaluate(
				() => window.c.querySelectorAll("lcty-thinking").length,
			),
		).toBe(0);
	});
	await test.step("And the reply with timings has its timings popover filled in", async () => {
		expect(
			await page.evaluate(
				() => document.getElementById("c-msg-r3").timings.textContent,
			),
		).toBe("Input 2 tok (cached 0 / computed 2, 0.10s)");
	});
	await test.step("And only the user message has data-last-user", async () => {
		expect(await lastUserMarks(page)).toEqual([
			true,
			false,
			false,
			false,
			false,
		]);
	});
});

test("The buttons of a message call the handlers with the message", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the container holds a user message and a reply of the file", async () => {
		await fileMessages(
			page,
			`<lcty-message id="c-msg-u1" data-role="user" data-content="q"><div class="user-text">q</div></lcty-message>
			<lcty-message id="c-msg-r1" data-role="assistant" data-content="a"><article data-generator="lcty.v1.gfm"><p>a</p></article></lcty-message>`,
		);
	});
	await test.step("When initConversationElements starts with the handlers onUndo, onFork and onRegenerate", async () => {
		await page.evaluate(() => {
			const record = (kind) => (el) =>
				window.calls.push([kind, window.E.messageOf(el).id]);
			window.E.initConversationElements(window.c, {
				onUndo: record("undo"),
				onFork: record("fork"),
				onRegenerate: record("regenerate"),
			});
		});
	});
	await test.step("And appendMessage adds a user message", async () => {
		await page.evaluate(() =>
			window.E.appendMessage(window.c, {
				id: "u2",
				role: "user",
				content: "q2",
			}),
		);
	});
	await test.step("And Undo and Fork from here of both user messages and Regenerate of the reply are clicked", async () => {
		const message = (id) => page.locator(`#c-msg-${id}`);
		for (const id of ["u1", "u2"]) {
			await message(id).getByRole("button", { name: "Undo" }).click();
			await message(id).getByRole("button", { name: "Fork from here" }).click();
		}
		await message("r1").getByRole("button", { name: "Regenerate" }).click();
	});
	await test.step("Then the handlers were called with those messages in order", async () => {
		expect(await calls(page)).toEqual([
			["undo", "u1"],
			["fork", "u1"],
			["undo", "u2"],
			["fork", "u2"],
			["regenerate", "r1"],
		]);
	});
});

test("A suggested next message goes into the composer", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the container holds a reply of the file whose content suggests "Tell me more"', async () => {
		await fileMessages(
			page,
			`<lcty-message id="c-msg-r1" data-role="assistant"
				data-content="Next:\n&lt;suggestion-for-user-turn&gt;Tell me more&lt;/suggestion-for-user-turn&gt;"><article></article></lcty-message>`,
		);
	});
	await test.step("When initConversationElements starts", async () => {
		await page.evaluate(() => window.E.initConversationElements(window.c));
	});
	await test.step("And the suggestion button is clicked", async () => {
		await page.locator("button.suggestion").click();
	});
	await test.step('Then the composer holds "Tell me more" and has the focus', async () => {
		expect(await composerValue(page)).toBe("Tell me more");
		expect(await composerHasFocus(page)).toBe(true);
	});
});

test("Select all selects the code of a code block", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the container holds a reply of the file whose text is the code block "```js\\nlet a = 1;\\n```", without its presentation', async () => {
		await fileMessages(
			page,
			`<lcty-message id="c-msg-r1" data-role="assistant" data-content="\`\`\`js&#10;let a = 1;&#10;\`\`\`"><article></article></lcty-message>`,
		);
	});
	await test.step("When initConversationElements starts", async () => {
		await page.evaluate(() => window.E.initConversationElements(window.c));
	});
	await test.step('Then the button says "Select all"', async () => {
		await expect(page.locator(".codebar button")).toHaveText("Select all");
	});
	await test.step("When the button is clicked", async () => {
		await page.locator(".codebar button").click();
	});
	await test.step("Then the selection is the code of the block", async () => {
		// the code's last line end is selected by some engines and not others
		expect(await page.evaluate(() => getSelection().toString().trimEnd())).toBe(
			"let a = 1;",
		);
	});
});

test("The composer of the conversation calls onSend and onStop", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("When initConversationElements starts with the handlers onSend and onStop", async () => {
		await page.evaluate(() =>
			window.E.initConversationElements(window.c, {
				onSend: (text) => window.calls.push(["send", text]),
				onStop: () => window.calls.push(["stop"]),
			}),
		);
	});
	await test.step('And "hello" is typed into the composer and Enter is pressed', async () => {
		await input(page).pressSequentially("hello");
		await input(page).press("Enter");
	});
	await test.step("And the Stop button is clicked", async () => {
		await page
			.locator("lcty-composer")
			.getByRole("button", { name: "Stop" })
			.click();
	});
	await test.step('Then onSend was called with "hello" and onStop once', async () => {
		expect(await calls(page)).toEqual([["send", "hello"], ["stop"]]);
	});
});

test("Enter sends the text without a new line", async ({ page, context }) => {
	await background(page, context);
	await givenInitComposer(page);
	await test.step('When "hello" is typed into the composer and Enter is pressed', async () => {
		await input(page).pressSequentially("hello");
		await input(page).press("Enter");
	});
	await test.step('Then onSend was called once with "hello"', async () => {
		expect(await calls(page)).toEqual([["send", "hello"]]);
	});
	await test.step('And the composer still holds "hello"', async () => {
		expect(await composerValue(page)).toBe("hello");
	});
});

test("Shift+Enter inserts a new line", async ({ page, context }) => {
	await background(page, context);
	await givenInitComposer(page);
	await test.step('When "a" is typed, Shift+Enter is pressed and "b" is typed', async () => {
		await input(page).pressSequentially("a");
		await input(page).press("Shift+Enter");
		await input(page).pressSequentially("b");
	});
	await thenOnSendWasNotCalled(page);
	await test.step('And the composer holds "a\\nb"', async () => {
		expect(await composerValue(page)).toBe("a\nb");
	});
});

for (const { composing, init } of [
	{ composing: "isComposing", init: { isComposing: true, keyCode: 13 } },
	{ composing: "the keyCode 229", init: { isComposing: false, keyCode: 229 } },
]) {
	test(`Enter while composing text with an input method is ignored (${composing})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenInitComposer(page);
		await test.step('And the composer holds "hello"', async () => {
			await setComposerText(page, "hello");
		});
		let cancelled;
		await test.step(`When Enter is pressed with ${composing}`, async () => {
			cancelled = await page.evaluate(({ isComposing, keyCode }) => {
				const ev = new KeyboardEvent("keydown", {
					key: "Enter",
					isComposing,
					bubbles: true,
					cancelable: true,
				});
				// keyCode is not settable through the event's init in every browser
				Object.defineProperty(ev, "keyCode", { get: () => keyCode });
				window.composer.input.dispatchEvent(ev);
				return ev.defaultPrevented;
			}, init);
		});
		await thenOnSendWasNotCalled(page);
		await test.step("And the keydown was not cancelled", async () => {
			expect(cancelled).toBe(false);
		});
	});
}

for (const { reason, state, prepare } of [
	{
		reason: "the text is blank",
		state: 'the composer holds " \\n "',
		prepare: (page) => setComposerText(page, " \n "),
	},
	{
		reason: "the composer is busy",
		state: 'the composer holds "hello" and is busy',
		prepare: async (page) => {
			await setComposerText(page, "hello");
			await page.evaluate(() =>
				window.E.setComposerBusy(window.composer, true),
			);
		},
	},
]) {
	test(`Nothing is sent from a blank or busy composer (${reason})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenInitComposer(page);
		await test.step(`And ${state}`, () => prepare(page));
		await test.step("When Enter is pressed in the composer", async () => {
			await input(page).press("Enter");
		});
		await test.step("And the form is submitted", async () => {
			await page.evaluate(() => window.composer.form.requestSubmit());
		});
		await thenOnSendWasNotCalled(page);
	});
}

test("Submitting the form sends and the Stop button stops", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenInitComposer(page);
	await test.step('And the composer holds "hello"', async () => {
		await setComposerText(page, "hello");
	});
	await test.step("When the Send button is clicked", async () => {
		await page
			.locator("lcty-composer")
			.getByRole("button", { name: "Send" })
			.click();
	});
	await test.step("And the Stop button is clicked", async () => {
		await page
			.locator("lcty-composer")
			.getByRole("button", { name: "Stop" })
			.click();
	});
	await test.step('Then onSend was called once with "hello" and onStop once', async () => {
		expect(await calls(page)).toEqual([["send", "hello"], ["stop"]]);
		expect(page.url()).toContain("/__lcty_unit.html");
	});
});

test("The composer is set, marked busy and focused by functions", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('When setComposerValue sets "x"', async () => {
		await page.evaluate(() => window.E.setComposerValue(window.composer, "x"));
	});
	await test.step("And setComposerBusy marks it busy", async () => {
		expect(
			await page.evaluate(() => window.E.setComposerBusy(window.composer, 1)),
		).toBe(true);
	});
	await test.step("And focusComposer focuses it", async () => {
		await page.evaluate(() => window.E.focusComposer(window.composer));
	});
	await test.step('Then the composer holds "x", has the attribute busy and has the focus', async () => {
		expect(await composerValue(page)).toBe("x");
		expect(
			await page.evaluate(() => window.composer.hasAttribute("busy")),
		).toBe(true);
		expect(await composerHasFocus(page)).toBe(true);
	});
	await test.step("When setComposerBusy marks it not busy", async () => {
		expect(
			await page.evaluate(() => window.E.setComposerBusy(window.composer, 0)),
		).toBe(false);
	});
	await test.step("Then it has no attribute busy", async () => {
		expect(
			await page.evaluate(() => window.composer.hasAttribute("busy")),
		).toBe(false);
	});
});

test("The input grows with its text up to 40% of the window", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenInitComposer(page);
	const height = () =>
		page.evaluate(() => Number.parseFloat(window.composer.input.style.height));
	let one;
	await test.step("When the composer is given one line by typing", async () => {
		await input(page).pressSequentially("x");
		one = await height();
	});
	let many;
	await test.step("And it is given 100 lines by typing", async () => {
		await input(page).fill(
			Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"),
		);
		many = await height();
	});
	await test.step("Then its height grew, but not beyond 40% of the window's height", async () => {
		const limit = await page.evaluate(() => window.innerHeight * 0.4);
		expect(one).toBeGreaterThan(0);
		expect(many).toBeGreaterThan(one);
		expect(many).toBeLessThanOrEqual(limit + 0.5);
	});
});
