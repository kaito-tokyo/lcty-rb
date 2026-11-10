// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1023: the scenarios of docs/specs/LCTYSP-1023_lcty-msg-elements.feature, written by hand. Each test has the
// title of its Scenario and one test.step per line of it, the Background first, so the two read side by side.
//
// js/ui/lcty-msg.js runs in a real browser on the test server's origin, on the empty unit page (which loads
// /c/lcty.v1.js, so the elements are defined). The module is kept on window (M).

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const UUID =
	"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

async function background(page, context) {
	await givenAPage(page, context);
	await test.step("And js/ui/lcty-msg.js is imported as window.M", () =>
		page.evaluate(async () => {
			window.M = await import("/js/ui/lcty-msg.js");
		}));
}

test("msgAttrs writes the attributes in their one order with the integrity placeholder", async ({
	page,
	context,
}) => {
	await background(page, context);
	let built;
	await test.step('When msgAttrs builds a user message "hi" at a time, and a system message "be brief" of the tag "ruby"', async () => {
		built = await page.evaluate(() => [
			window.M.msgAttrs("user", "hi", { at: "2026-11-10T09:00:00+09:00" }),
			window.M.msgAttrs("system", "be brief", { tag: "ruby" }),
		]);
	});
	await test.step("Then the user's keys are data-role, id, data-at, data-content-integrity and data-content, its id msg-u- and a UUIDv7", () => {
		expect(Object.keys(built[0])).toEqual([
			"data-role",
			"id",
			"data-at",
			"data-content-integrity",
			"data-content",
		]);
		expect(built[0].id).toMatch(new RegExp(`^msg-u-${UUID}$`));
	});
	await test.step("And the system's are data-role, id, data-tag, data-content-integrity and data-content, its id sys- and a UUIDv7", () => {
		expect(Object.keys(built[1])).toEqual([
			"data-role",
			"id",
			"data-tag",
			"data-content-integrity",
			"data-content",
		]);
		expect(built[1].id).toMatch(new RegExp(`^sys-${UUID}$`));
	});
	await test.step('And data-content-integrity is "sha384-", for the server to fill in', () => {
		expect(built.map((a) => a["data-content-integrity"])).toEqual([
			"sha384-",
			"sha384-",
		]);
	});
});

test("A text an attribute cannot hold goes to data-content-base64", async ({
	page,
	context,
}) => {
	await background(page, context);
	let a;
	await test.step("When msgAttrs builds a model message whose text holds U+0001", async () => {
		a = await page.evaluate(() =>
			window.M.msgAttrs("model", `a${String.fromCharCode(1)}日`),
		);
	});
	await test.step("Then it has data-content-base64, the base64 of the text's UTF-8 bytes, and no data-content", () => {
		expect(a["data-content-base64"]).toBe(
			Buffer.from("a\u0001日", "utf8").toString("base64"),
		);
		expect(a).not.toHaveProperty("data-content");
	});
});

test("thinkingAttrs and cmdAttrs give new ids and keep the order", async ({
	page,
	context,
}) => {
	await background(page, context);
	let t;
	let c;
	await test.step('When thinkingAttrs builds a thinking and cmdAttrs a send with the error "boom"', async () => {
		[t, c] = await page.evaluate(() => [
			window.M.thinkingAttrs("hmm", "2026-11-10T09:00:00+09:00"),
			window.M.cmdAttrs("send", "2026-11-10T09:00:00+09:00", "boom"),
		]);
	});
	await test.step("Then the thinking's keys are id, data-at, data-content-integrity and data-content, its id think- and a UUIDv7", () => {
		expect(Object.keys(t)).toEqual([
			"id",
			"data-at",
			"data-content-integrity",
			"data-content",
		]);
		expect(t.id).toMatch(new RegExp(`^think-${UUID}$`));
	});
	await test.step("And the command's are id, data-op, data-at and data-error, its id cmd- and a UUIDv7", () => {
		expect(Object.keys(c)).toEqual(["id", "data-op", "data-at", "data-error"]);
		expect(c.id).toMatch(new RegExp(`^cmd-${UUID}$`));
	});
});

test("A user message's article is its text alone, and a reply's its Markdown", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Then userArticle of "<b>&\\r" is <article>&lt;b&gt;&amp;&#13;</article>', async () => {
		expect(await page.evaluate(() => window.M.userArticle("<b>&\r"))).toBe(
			"<article>&lt;b&gt;&amp;&#13;</article>",
		);
	});
	await test.step('And replyArticle of "**bold**" is an <article> holding <p><strong>bold</strong></p>', async () => {
		expect(await page.evaluate(() => window.M.replyArticle("**bold**"))).toBe(
			"<article><p><strong>bold</strong></p></article>",
		);
	});
});

test("elementOf builds the element from its attributes and presentation", async ({
	page,
	context,
}) => {
	await background(page, context);
	let el;
	await test.step("When elementOf builds an lcty-msg from the attributes of a user message and its article", async () => {
		el = await page.evaluate(() => {
			const a = window.M.msgAttrs("user", "hi", {
				at: "2026-11-10T09:00:00+09:00",
			});
			const e = window.M.elementOf("lcty-msg", a, window.M.userArticle("hi"));
			return {
				tag: e.localName,
				names: e.getAttributeNames(),
				keys: Object.keys(a),
				children: [...e.children].map((c) => c.outerHTML),
			};
		});
	});
	await test.step("Then the element has the attributes in their order and the <article> as its only child", () => {
		expect(el.tag).toBe("lcty-msg");
		expect(el.names).toEqual(el.keys);
		expect(el.children).toEqual(["<article>hi</article>"]);
	});
});

test("lastElement is the last element of the file, skipping what is not written", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given a container holding a system message, a user message and a draft <lcty-message data-draft>", () =>
		page.evaluate(() => {
			window.c = document.createElement("div");
			window.c.innerHTML =
				'<lcty-msg data-role="system" id="sys-1"></lcty-msg><lcty-msg data-role="user" id="msg-u-1"></lcty-msg>' +
				'<lcty-message data-role="assistant" data-draft=""></lcty-message>';
			document.body.append(window.c);
		}));
	await test.step("Then lastElement is the user message", async () => {
		expect(await page.evaluate(() => window.M.lastElement(window.c)?.id)).toBe(
			"msg-u-1",
		);
	});
	await test.step("And lastElement of an empty container is null", async () => {
		expect(
			await page.evaluate(() =>
				window.M.lastElement(document.createElement("div")),
			),
		).toBeNull();
	});
});

test("historyOf gives the instructions and the messages the model is sent", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given a container holding a system message "a", a memory "b", a user message "q", a thinking and a model message "r"', () =>
		page.evaluate(() => {
			window.c = document.createElement("div");
			window.c.innerHTML =
				'<lcty-msg data-role="system" id="sys-1" data-content="a"></lcty-msg>' +
				'<lcty-msg data-role="memory" id="mem-1" data-tag="t" data-content="b"></lcty-msg>' +
				'<lcty-msg data-role="user" id="msg-u-u1" data-content="q"></lcty-msg>' +
				'<lcty-thinking id="think-1" data-content="hmm"></lcty-thinking>' +
				'<lcty-msg data-role="model" id="msg-m-m1" data-content="r"></lcty-msg>';
			document.body.append(window.c);
		}));
	let h;
	await test.step('Then historyOf gives the instructions "a", a blank line and "b"', async () => {
		h = await page.evaluate(() => window.M.historyOf(window.c));
		expect(h.instructions).toBe("a\n\nb");
	});
	await test.step('And the messages user "q" and assistant "r", with their bare ids', () => {
		expect(h.messages).toEqual([
			{ id: "u1", role: "user", content: "q" },
			{ id: "m1", role: "assistant", content: "r" },
		]);
	});
});
