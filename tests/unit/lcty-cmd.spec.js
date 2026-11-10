// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1015: the scenarios of docs/specs/LCTYSP-1015_commands.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// public/js/ui/lcty-cmd.js is imported into the empty unit page (tests/unit/unit-page.js), whose /c/lcty.v1.js
// (redirected to /lcty.v1/lcty.v1.cjs) defines <lcty-c>. <lcty-c> imports /lcty.v1/lcty.v1.async.mjs when it is
// connected, so that is answered with an empty module: the conversation page's features never run. The operations are
// made inside the page (window.makeOp): each records its call and waits until the test releases it or its signal is
// aborted.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

// ---- Background ----

async function background(page, context) {
	await givenAPage(page, context);
	await test.step("And /lcty.v1/lcty.v1.async.mjs is an empty module", async () => {
		await context.route("**/lcty.v1/lcty.v1.async.mjs", (route) =>
			route.fulfill({ contentType: "text/javascript", body: "export {};" }),
		);
	});
	await test.step("And the module /js/ui/lcty-cmd.js is imported", async () => {
		await page.evaluate(async () => {
			window.cmds = await import("/js/ui/lcty-cmd.js");
			window.calls = [];
			window.releases = {};
			window.makeOp = (name, mode) => async (cmd, controller) => {
				window.calls.push({ name, cmd, controller });
				if (mode === "throw") throw new Error("boom");
				await new Promise((resolve) => {
					window.releases[name] = resolve;
					controller.signal.addEventListener("abort", resolve);
				});
			};
		});
	});
}

// ---- The page ----

/** The command (the last <lcty-cmd> of the document, or window.cmd) as plain values. */
function commandState(page) {
	return page.evaluate(() => {
		const cmd = window.cmd || [...document.querySelectorAll("lcty-cmd")].pop();
		return {
			state: cmd.getAttribute("state"),
			slot: cmd.getAttribute("slot"),
		};
	});
}

function callsOf(page, name) {
	return page.evaluate(
		(name) =>
			window.calls
				.filter((c) => c.name === name)
				.map((c) => ({
					isCommand:
						c.cmd === (window.cmd || document.querySelector("lcty-cmd")),
					isController: c.controller instanceof AbortController,
					aborted: c.controller.signal.aborted,
				})),
		name,
	);
}

/** Let the operation's promise settle and the command update its state. */
const settle = (page) =>
	page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));

function define(page, name, mode) {
	return page.evaluate(
		({ name, mode }) =>
			window.cmds.defineCommands({ [name]: window.makeOp(name, mode) }),
		{ name, mode },
	);
}

function append(page, op) {
	return page.evaluate((op) => {
		const c = document.querySelector("lcty-c");
		window.before = Date.now();
		window.cmd = window.cmds.appendCommand(c, op);
		window.after = Date.now();
	}, op);
}

function setBody(page, html) {
	return page.evaluate((html) => {
		document.body.innerHTML = html;
	}, html);
}

const MESSAGE = '<lcty-message data-role="user"></lcty-message>';

// ---- Steps shared by the scenarios ----

async function givenDefined(page, name = "send", mode) {
	const line =
		mode === "throw"
			? `Given defineCommands has been given the operation "${name}", which throws an error`
			: `Given defineCommands has been given the operation "${name}"`;
	await test.step(line, () => define(page, name, mode));
}

async function givenAppended(page) {
	await test.step('And appendCommand has appended "send" to <lcty-c>', async () => {
		await setBody(page, `<lcty-c id="c-conv">${MESSAGE}</lcty-c>`);
		await append(page, "send");
	});
}

async function whenDefined(page, name = "send") {
	await test.step(`When defineCommands is given the operation "${name}"`, () =>
		define(page, name));
}

async function release(page, prefix) {
	await test.step(`${prefix} the operation "send" is released`, async () => {
		await page.evaluate(() => window.releases.send());
		await settle(page);
	});
}

async function thenCalledOnce(page) {
	await test.step('Then "send" has been called once, with the command and an AbortController whose signal is not aborted', async () => {
		expect(await callsOf(page, "send")).toEqual([
			{ isCommand: true, isController: true, aborted: false },
		]);
	});
}

async function thenNotCalled(page, name = "send", prefix = "Then") {
	await test.step(`${prefix} "${name}" has not been called`, async () => {
		expect(await callsOf(page, name)).toEqual([]);
	});
}

async function thenRunning(page, prefix = "And") {
	await test.step(`${prefix} the command's state is "running" and its slot is "float"`, async () => {
		expect(await commandState(page)).toEqual({
			state: "running",
			slot: "float",
		});
	});
}

async function thenState(page, state, prefix = "And") {
	await test.step(`${prefix} the command's state is "${state}" and it has no slot`, async () => {
		await settle(page);
		expect(await commandState(page)).toEqual({ state, slot: null });
	});
}

// ---- Scenarios ----

test("Importing the module defines nothing", async ({ page, context }) => {
	await background(page, context);
	await test.step("Then <lcty-cmd> is not defined", async () => {
		expect(
			await page.evaluate(() => customElements.get("lcty-cmd") === undefined),
		).toBe(true);
	});
});

test("A command that is the last element of <lcty-c> runs when the commands are defined", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given <lcty-c> holds a message and then <lcty-cmd data-op="send">', () =>
		setBody(
			page,
			`<lcty-c id="c-conv">${MESSAGE}<lcty-cmd data-op="send"></lcty-cmd></lcty-c>`,
		));
	await whenDefined(page);
	await thenCalledOnce(page);
	await thenRunning(page);
	await release(page, "When");
	await thenState(page, "done", "Then");
});

test("A command followed by other elements has already run", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given <lcty-c> holds <lcty-cmd data-op="send"> and then a message', () =>
		setBody(
			page,
			`<lcty-c id="c-conv"><lcty-cmd data-op="send"></lcty-cmd>${MESSAGE}</lcty-c>`,
		));
	await whenDefined(page);
	await thenNotCalled(page);
	await thenState(page, "done");
});

test("A command outside <lcty-c> does not run", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given a <div> holds a message and then <lcty-cmd data-op="send">', () =>
		setBody(page, `<div>${MESSAGE}<lcty-cmd data-op="send"></lcty-cmd></div>`));
	await whenDefined(page);
	await thenNotCalled(page);
	await thenState(page, "done");
});

for (const op of ["regenerate", "constructor", "__proto__"]) {
	test(`An unknown operation does nothing (${op})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await test.step(`Given <lcty-c> holds a message and then <lcty-cmd data-op="${op}">`, () =>
			setBody(
				page,
				`<lcty-c id="c-conv">${MESSAGE}<lcty-cmd data-op="${op}"></lcty-cmd></lcty-c>`,
			));
		await whenDefined(page);
		await thenNotCalled(page);
		await thenState(page, "unknown");
	});
}

test("appendCommand adds a command in memory that runs at once", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenDefined(page);
	await test.step("And <lcty-c> holds a message", () =>
		setBody(page, `<lcty-c id="c-conv">${MESSAGE}</lcty-c>`));
	await test.step('When appendCommand appends "send" to <lcty-c>', () =>
		append(page, "send"));
	await test.step("Then it returns the <lcty-cmd> that is now the last element of <lcty-c>", async () => {
		expect(
			await page.evaluate(
				() =>
					window.cmd.localName === "lcty-cmd" &&
					document.querySelector("lcty-c").lastElementChild === window.cmd,
			),
		).toBe(true);
	});
	await test.step('And its data-op is "send" and its data-at is the time it was appended, as an ISO string', async () => {
		const { op, at, before, after } = await page.evaluate(() => ({
			op: window.cmd.getAttribute("data-op"),
			at: window.cmd.getAttribute("data-at"),
			before: window.before,
			after: window.after,
		}));
		expect(op).toBe("send");
		expect(at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
		expect(new Date(at).toISOString()).toBe(at);
		expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
		expect(Date.parse(at)).toBeLessThanOrEqual(after);
	});
	await test.step('And "send" has been called once, with the command and an AbortController whose signal is not aborted', async () => {
		expect(await callsOf(page, "send")).toEqual([
			{ isCommand: true, isController: true, aborted: false },
		]);
	});
	await thenRunning(page);
});

for (const [how, act] of [
	[
		"the stop button of the command is clicked",
		() => window.cmd.stopButton.click(),
	],
	["abort() of the command is called", () => window.cmd.abort()],
]) {
	test(`A running command can be stopped (${how})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenDefined(page);
		await givenAppended(page);
		await test.step(`When ${how}`, () => page.evaluate(act));
		await test.step('Then the AbortSignal given to "send" is aborted', async () => {
			expect((await callsOf(page, "send")).map((c) => c.aborted)).toEqual([
				true,
			]);
		});
		await thenState(page, "aborted");
	});
}

test("abort() does nothing when the command is not running", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenDefined(page);
	await givenAppended(page);
	await release(page, "And");
	await test.step("When abort() of the command is called", () =>
		page.evaluate(() => window.cmd.abort()));
	await test.step('Then the AbortSignal given to "send" is not aborted', async () => {
		expect((await callsOf(page, "send")).map((c) => c.aborted)).toEqual([
			false,
		]);
	});
	await thenState(page, "done");
});

test("A failing operation marks the command failed", async ({
	page,
	context,
}) => {
	await background(page, context);
	const errors = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	await givenDefined(page, "send", "throw");
	await test.step('When appendCommand appends "send" to <lcty-c>', async () => {
		await setBody(page, `<lcty-c id="c-conv">${MESSAGE}</lcty-c>`);
		await append(page, "send");
	});
	await thenState(page, "failed", "Then");
	await test.step('And the console shows the error "lcty-cmd send failed"', async () => {
		await expect
			.poll(() => errors.some((e) => e.includes("lcty-cmd send failed")))
			.toBe(true);
	});
});

test("A command runs only once", async ({ page, context }) => {
	await background(page, context);
	await givenDefined(page);
	await givenAppended(page);
	await release(page, "And");
	await test.step("When the command is removed and appended to <lcty-c> again", async () => {
		await page.evaluate(() => {
			window.cmd.remove();
			document.querySelector("lcty-c").append(window.cmd);
		});
		await settle(page);
	});
	await test.step('Then "send" has been called once', async () => {
		expect(await callsOf(page, "send")).toHaveLength(1);
	});
	await thenState(page, "done");
});

test("Calling run() on a finished command does not run it again", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenDefined(page);
	await givenAppended(page);
	await release(page, "And");
	await test.step("When run() of the command is called", async () => {
		// run() resolves at once when it does nothing; a second run would wait to be released, so do not await it
		await page.evaluate(() => {
			window.cmd.run();
		});
		await settle(page);
	});
	await test.step('Then "send" has been called once', async () => {
		expect(await callsOf(page, "send")).toHaveLength(1);
	});
	await thenState(page, "done");
});

test("defineCommands can be called again to add operations", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenDefined(page);
	await page.evaluate(() => {
		window.cmdClass = customElements.get("lcty-cmd");
	});
	await whenDefined(page, "summarize");
	await test.step("Then <lcty-cmd> is still defined by the same class", async () => {
		expect(
			await page.evaluate(
				() => customElements.get("lcty-cmd") === window.cmdClass,
			),
		).toBe(true);
	});
	await test.step('And appendCommand appending "summarize" to <lcty-c> calls "summarize" once', async () => {
		await setBody(page, `<lcty-c id="c-conv">${MESSAGE}</lcty-c>`);
		await append(page, "summarize");
		expect(await callsOf(page, "summarize")).toEqual([
			{ isCommand: true, isController: true, aborted: false },
		]);
	});
	await thenNotCalled(page, "send", "And");
});

/** The Shadow DOM of a new <lcty-cmd> as plain values. */
function shadowOf(page) {
	return page.evaluate(() => {
		const cmd = document.createElement("lcty-cmd");
		const box = cmd.shadowRoot.children;
		const inner = [...(box[0]?.children || [])];
		return {
			roots: box.length,
			box: [box[0].localName, box[0].className, box[0].getAttribute("part")],
			inner: inner.map((e) => [
				e.localName,
				e.className,
				e.getAttribute("part"),
				e.getAttribute("type"),
				e.textContent,
			]),
			fields:
				cmd.label === inner[1] &&
				cmd.stopButton === inner[2] &&
				cmd.retryButton === inner[3] &&
				cmd.removeButton === inner[4],
		};
	});
}

test("A command shows a spinner, a label and a stop button in its Shadow DOM", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenDefined(page);
	let shadow;
	await test.step("When a <lcty-cmd> is created", async () => {
		shadow = await shadowOf(page);
	});
	await test.step('Then its Shadow DOM is a box holding a spinner, the label "Generating…" and the buttons "Stop", "Retry" and "Remove"', () => {
		expect(shadow.roots).toBe(1);
		expect(shadow.box.slice(0, 2)).toEqual(["div", "cmd-box"]);
		expect(
			shadow.inner.map(([tag, cls, , type, text]) => [tag, cls, type, text]),
		).toEqual([
			["span", "spinner", null, ""],
			["span", "", null, "Generating…"],
			["button", "", "button", "Stop"],
			["button", "", "button", "Retry"],
			["button", "", "button", "Remove"],
		]);
	});
	await test.step('And they have the parts lcty-cmd__box, lcty-cmd__spinner, lcty-cmd__label, "lcty-cmd__stop lcty-button", "lcty-cmd__retry lcty-button" and "lcty-cmd__remove lcty-button"', () => {
		expect([shadow.box[2], ...shadow.inner.map((e) => e[2])]).toEqual([
			"lcty-cmd__box",
			"lcty-cmd__spinner",
			"lcty-cmd__label",
			"lcty-cmd__stop lcty-button",
			"lcty-cmd__retry lcty-button",
			"lcty-cmd__remove lcty-button",
		]);
	});
	await test.step("And its fields label, stopButton, retryButton and removeButton are the label and the buttons", () => {
		expect(shadow.fields).toBe(true);
	});
});

test("A command's texts follow the page's language", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the page is in Japanese", () =>
		page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					document.documentElement.lang = "ja";
					const s = document.createElement("script");
					s.src = "/c/lcty.v1.lang-ja.js";
					s.onload = resolve;
					s.onerror = reject;
					document.head.append(s);
				}),
		));
	await test.step('And defineCommands has been given the operation "send"', () =>
		define(page, "send"));
	let shadow;
	await test.step("When a <lcty-cmd> is created", async () => {
		shadow = await shadowOf(page);
	});
	await test.step('Then its label reads "生成中…" and its buttons "停止", "やり直す" and "削除"', () => {
		expect(shadow.inner.map((e) => e[4])).toEqual([
			"",
			"生成中…",
			"停止",
			"やり直す",
			"削除",
		]);
	});
});

test("A command with data-error has failed and does not run", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given <lcty-c> holds a message and then <lcty-cmd data-op="send" data-error="boom">', () =>
		setBody(
			page,
			`<lcty-c id="c-conv">${MESSAGE}<lcty-cmd data-op="send" data-error="boom"></lcty-cmd></lcty-c>`,
		));
	await whenDefined(page);
	await thenNotCalled(page);
	await test.step('And the command\'s state is "failed" and its label reads "Stopped: boom"', async () => {
		expect(
			await page.evaluate(() => {
				const cmd = document.querySelector("lcty-cmd");
				return [cmd.getAttribute("state"), cmd.label.textContent];
			}),
		).toEqual(["failed", "Stopped: boom"]);
	});
});

test("A command that has a state already does not run", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given <lcty-c> holds a message and then <lcty-cmd data-op="send" state="stale">', () =>
		setBody(
			page,
			`<lcty-c id="c-conv">${MESSAGE}<lcty-cmd data-op="send" state="stale"></lcty-cmd></lcty-c>`,
		));
	await whenDefined(page);
	await thenNotCalled(page);
	await test.step('And the command\'s state is still "stale"', async () => {
		expect((await commandState(page)).state).toBe("stale");
	});
});
