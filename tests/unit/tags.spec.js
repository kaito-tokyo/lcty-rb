// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1018: the scenarios of docs/specs/LCTYSP-1018_tags.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/tags.js runs in a real browser on the test server's origin, on the empty unit page. GET and PUT /v1/tags,
// POST /v1/tags/:name/memory and the fake llama-server at http://llm.test are answered by routes the test sets
// (server.*), which also record what was sent, so the server's data does not matter. What the module calls back
// (onSaved, toast, onDone) is pushed to window.seen.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const LLM_URL = "http://llm.test";
const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** A Responses API stream (the events js/llm/responses.js reads) of these events, then [DONE]. */
function sse(events) {
	return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
}

/** A reply whose text is text, in deltas of 7 characters, completed with timings. */
function replyWith(text, timings = { prompt_n: 3, predicted_n: 9 }) {
	return (route) =>
		route.fulfill({
			headers: { ...CORS, "Content-Type": "text/event-stream" },
			body: sse([
				...(text.match(/[\s\S]{1,7}/g) || []).map((delta) => ({
					type: "response.output_text.delta",
					delta,
				})),
				{ type: "response.completed", response: {}, timings },
			]),
		});
}

// ---- Background ----

async function background(page, context) {
	await givenAPage(page, context);
	const server = {
		tags: { tags: [] },
		puts: [],
		memory: [],
		llm: [],
		get: (route) => route.fulfill({ json: server.tags }),
		put: (route) => route.fulfill({ json: { ok: true } }),
		addMemory: (route) =>
			route.fulfill({ status: 201, json: { id: "m", text: "t", at: "now" } }),
		answerLlm: replyWith('{"proposals":[]}'),
	};
	await test.step("And /v1/tags, /v1/tags/:name/memory and the llama-server at http://llm.test are answered by the test", async () => {
		await context.route("**/v1/tags", (route) => {
			const req = route.request();
			if (req.method() === "PUT") {
				server.puts.push(req.postDataJSON());
				return server.put(route);
			}
			return server.get(route);
		});
		await context.route("**/v1/tags/*/memory", (route) => {
			const req = route.request();
			const name = decodeURIComponent(
				new URL(req.url()).pathname.split("/")[3],
			);
			server.memory.push([name, req.postDataJSON()]);
			return server.addMemory(route);
		});
		await context.route(`${LLM_URL}/**`, (route) => {
			const req = route.request();
			if (req.method() === "OPTIONS")
				return route.fulfill({ status: 204, headers: CORS });
			server.llm.push({
				url: req.url(),
				authorization: req.headers().authorization ?? null,
				body: req.postDataJSON(),
			});
			return server.answerLlm(route);
		});
		await page.evaluate(async () => {
			window.T = await import("/js/tags.js");
			window.seen = [];
		});
	});
	return server;
}

const seen = (page) => page.evaluate(() => window.seen);

/** Answer the next confirm() with accept, and keep its message in questions. */
function answerNextQuestion(page, accept, questions) {
	page.once("dialog", async (d) => {
		questions.push(d.message());
		if (accept) await d.accept();
		else await d.dismiss();
	});
}

// ---- Definitions ----

const RUBY = {
	name: "ruby",
	prompt: "Ruby prompt",
	memory: [{ text: "fact" }, { text: "rules" }],
};
const GO = { name: "go", prompt: "Go prompt", memory: [] };

// ---- The editor ----

/** renderTagsEditor(container, {defs, onSaved, toast}) into a new <div id="editor">, kept as window.editor. */
function renderEditor(page, defs) {
	return page.evaluate((defs) => {
		const div = document.createElement("div");
		div.id = "editor";
		document.body.append(div);
		window.editor = window.T.renderTagsEditor(div, {
			defs,
			onSaved: (d) => window.seen.push(["saved", d]),
			toast: (m) => window.seen.push(["toast", m]),
		});
	}, defs);
}

async function givenTheEditor(
	page,
	defs = [RUBY, GO],
	line = 'Given the editor of the definitions "ruby" and "go"',
) {
	await test.step(line, () => renderEditor(page, defs));
}

/** What the editor shows: one entry per tag section. */
function editorState(page, root = "#editor") {
	return page.evaluate(
		(root) =>
			[...document.querySelectorAll(`${root} section.tag-edit`)].map((s) => {
				const [up, down] = s.querySelectorAll(".tag-edit-head button");
				const details = s.querySelector("details");
				return {
					name: s.querySelector(".tag-edit-head input").value,
					prompt: s.querySelector("label.field textarea").value,
					memory: [...s.querySelectorAll(".mem-list li textarea")].map(
						(t) => t.value,
					),
					summary: details.querySelector("summary").textContent,
					open: details.open,
					up: !up.disabled,
					down: !down.disabled,
				};
			}),
		root,
	);
}

const names = async (page, root) =>
	(await editorState(page, root)).map((s) => s.name);
const isDirty = (page) => page.evaluate(() => window.editor.isDirty());
const status = (page) =>
	page.evaluate(
		() =>
			document.querySelector("#editor .tags-form > p.hint:not(:first-child)")
				.textContent,
	);
const section = (page, i) => page.locator("section.tag-edit").nth(i);
const nameInput = (page, i) => section(page, i).locator(".tag-edit-head input");
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function thenIsDirty(page, value, line = `And isDirty() is ${value}`) {
	await test.step(line, async () => {
		expect(await isDirty(page)).toBe(value);
	});
}

/** Click Save and wait until the save has ended: saved (onSaved was called) or refused (the status says why). */
async function clickSave(page) {
	await button(page, "Save").click();
	await page.waitForFunction(
		() =>
			window.seen.length > 0 ||
			document.querySelector("#editor .tags-form > p.hint:not(:first-child)")
				.textContent !== "",
	);
}

// ---- sortTags and composeDraft ----

test("Tag names are sorted in the order of the definitions", async ({
	page,
	context,
}) => {
	await background(page, context);
	let defs;
	await test.step('Given the definitions "ruby", "go" and "rust"', () => {
		defs = [{ name: "ruby" }, { name: "go" }, { name: "rust" }];
	});
	let sorted;
	await test.step('When sortTags sorts "rust", "zig", "ruby", "ada" and "rust"', async () => {
		sorted = await page.evaluate(
			(defs) => window.T.sortTags(defs, ["rust", "zig", "ruby", "ada", "rust"]),
			defs,
		);
	});
	await test.step('Then it returns "ruby", "rust", "zig" and "ada"', () => {
		expect(sorted).toEqual(["ruby", "rust", "zig", "ada"]);
	});
});

const compose = (page, defs, selected) =>
	page.evaluate(({ defs, selected }) => window.T.composeDraft(defs, selected), {
		defs,
		selected,
	});

test("The draft follows the definitions, not the order of the choice", async ({
	page,
	context,
}) => {
	await background(page, context);
	let defs;
	await test.step('Given the definitions "ruby" with a prompt and two memory items and "go" with a prompt and no memory', () => {
		defs = [RUBY, GO];
	});
	let draft;
	await test.step('When composeDraft composes the draft of "go" and "ruby"', async () => {
		draft = await compose(page, defs, ["go", "ruby"]);
	});
	await test.step('Then it is the prompt of "ruby", its memory under "# Memory (ruby)" and the prompt of "go", joined by blank lines', () => {
		expect(draft).toBe(
			"Ruby prompt\n\n# Memory (ruby)\n- fact\n- rules\n\nGo prompt",
		);
	});
});

test("Empty prompts and blank memory items are left out of the draft", async ({
	page,
	context,
}) => {
	await background(page, context);
	let defs;
	await test.step('Given the definitions "a" with a blank prompt and the memory items " x " and "  ", "b" with neither and "c" with the prompt " only "', () => {
		defs = [
			{ name: "a", prompt: " \n ", memory: [{ text: " x " }, { text: "  " }] },
			{ name: "b" },
			{ name: "c", prompt: " only " },
		];
	});
	let draft;
	await test.step('When composeDraft composes the draft of "a", "b" and "c"', async () => {
		draft = await compose(page, defs, ["a", "b", "c"]);
	});
	await test.step('Then it is "# Memory (a)\\n- x\\n\\nonly"', () => {
		expect(draft).toBe("# Memory (a)\n- x\n\nonly");
	});
	await test.step('And the draft of no tags is ""', async () => {
		expect(await compose(page, defs, [])).toBe("");
	});
});

test("The memory heading of the draft is in the page's language", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the page is in Japanese", async () => {
		await page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					document.documentElement.lang = "ja";
					const s = document.createElement("script");
					s.src = "/c/lcty.v1.lang-ja.js";
					s.onload = resolve;
					s.onerror = reject;
					document.head.append(s);
				}),
		);
	});
	let draft;
	await test.step('When composeDraft composes the draft of a tag "ruby" with the memory item "x"', async () => {
		draft = await compose(
			page,
			[{ name: "ruby", prompt: "", memory: [{ text: "x" }] }],
			["ruby"],
		);
	});
	await test.step('Then it is "# メモリ（ruby）\\n- x"', () => {
		expect(draft).toBe("# メモリ（ruby）\n- x");
	});
});

// ---- renderTagsEditor ----

test("The editor shows every definition with its memory", async ({
	page,
	context,
}) => {
	await background(page, context);
	const big = {
		name: "big",
		prompt: "",
		memory: Array.from({ length: 6 }, (_, i) => ({ text: `m${i}` })),
	};
	await givenTheEditor(
		page,
		[RUBY, { name: "go" }, big],
		'Given the definitions "ruby" with a prompt and two memory items, "go" with none and "big" with six memory items',
	);
	let state;
	await test.step("When renderTagsEditor draws them", async () => {
		state = await editorState(page);
	});
	await test.step("Then it shows a section per tag with its name and prompt, in order", () => {
		expect(state.map((s) => [s.name, s.prompt])).toEqual([
			["ruby", "Ruby prompt"],
			["go", ""],
			["big", ""],
		]);
	});
	await test.step('And "ruby" shows its two memory items under "Memory (2 items, about 9 characters)", open', () => {
		expect(state[0]).toMatchObject({
			memory: ["fact", "rules"],
			summary: "Memory (2 items, about 9 characters)",
			open: true,
		});
	});
	await test.step('And "go" shows "Memory (0 items, about 0 characters)" and "big" its six items, both closed', () => {
		expect(state[1]).toMatchObject({
			memory: [],
			summary: "Memory (0 items, about 0 characters)",
			open: false,
		});
		expect(state[2]).toMatchObject({
			memory: ["m0", "m1", "m2", "m3", "m4", "m5"],
			summary: "Memory (6 items, about 12 characters)",
			open: false,
		});
	});
	await test.step("And ↑ is disabled for the first tag only and ↓ for the last tag only", () => {
		expect(state.map((s) => [s.up, s.down])).toEqual([
			[false, true],
			[true, true],
			[true, false],
		]);
	});
	await thenIsDirty(page, false);
});

test("Moving a tag makes the editor dirty", async ({ page, context }) => {
	await background(page, context);
	await givenTheEditor(page);
	await test.step('When ↓ of "ruby" is clicked', async () => {
		await section(page, 0).getByRole("button", { name: "↓" }).click();
	});
	await test.step('Then the tags are in the order "go", "ruby"', async () => {
		expect(await names(page)).toEqual(["go", "ruby"]);
	});
	await thenIsDirty(page, true);
});

test("Saving puts the definitions and takes the saved ones back", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[{ ...RUBY, memory: [{ text: "fact" }, { text: "  " }] }, GO],
		'Given the editor of the definitions "ruby" with the memory items "fact" and "  ", and "go"',
	);
	const stored = {
		tags: [
			{
				name: "ruby",
				prompt: "New prompt",
				memory: [{ id: "1", text: "fact", at: "2026-11-01T00:00:00+09:00" }],
			},
			{ name: "go", prompt: "Go prompt", memory: [] },
			{ name: "rust", prompt: "", memory: [] },
		],
	};
	await test.step("And GET /v1/tags will return the definitions with timestamps", () => {
		server.tags = stored;
	});
	await test.step('When the prompt of "ruby" is changed to "New prompt", a new tag "rust" is added and Save is clicked', async () => {
		await section(page, 0).locator("label.field textarea").fill("New prompt");
		await button(page, "+ New tag").click();
		await nameInput(page, 2).fill("rust");
		await clickSave(page);
	});
	await test.step('Then PUT /v1/tags is sent "ruby" with the new prompt and only the memory item "fact", "go" and "rust" without memory', () => {
		expect(server.puts).toEqual([
			{
				tags: [
					{ name: "ruby", prompt: "New prompt", memory: [{ text: "fact" }] },
					{ name: "go", prompt: "Go prompt", memory: [] },
					{ name: "rust", prompt: "", memory: [] },
				],
			},
		]);
	});
	await test.step("And onSaved is called with the definitions GET /v1/tags returned", async () => {
		expect((await seen(page)).filter(([k]) => k === "saved")).toEqual([
			["saved", stored.tags],
		]);
	});
	await test.step('And the toast says "Tags saved", the status is empty and isDirty() is false', async () => {
		expect((await seen(page)).filter(([k]) => k === "toast")).toEqual([
			["toast", "Tags saved"],
		]);
		expect(await status(page)).toBe("");
		expect(await isDirty(page)).toBe(false);
	});
});

const BAD_NAME = (name) =>
	`The tag name "${name}" cannot be used (no spaces or ":", up to 40 characters)`;

for (const { caseName, name, shown, message } of [
	{
		caseName: "a space",
		name: "a b",
		shown: '"a b"',
		message: BAD_NAME("a b"),
	},
	{
		caseName: "a colon",
		name: "a:b",
		shown: '"a:b"',
		message: BAD_NAME("a:b"),
	},
	{ caseName: "empty", name: "", shown: '""', message: BAD_NAME("") },
	{
		caseName: "41 letters",
		name: "x".repeat(41),
		shown: '41 times "x"',
		message: BAD_NAME("x".repeat(41)),
	},
	{
		caseName: "a duplicate",
		name: "ruby",
		shown: '"ruby"',
		message: "Tag names must be unique",
	},
]) {
	test(`A tag name that cannot be used is not saved (${caseName})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheEditor(page);
		await test.step(`When the name of "go" is changed to ${shown} and Save is clicked`, async () => {
			await nameInput(page, 1).fill(name);
			await clickSave(page);
		});
		const quoted = message.startsWith("The tag")
			? `'${message}'`
			: `"${message}"`;
		await test.step(`Then the status says ${quoted}`, async () => {
			expect(await status(page)).toBe(message);
		});
		await test.step("And nothing is sent to PUT /v1/tags", () => {
			expect(server.puts).toEqual([]);
		});
		await thenIsDirty(page, true);
	});
}

test("A name is trimmed and may have 40 characters", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(page);
	await test.step('When the name of "go" is changed to " 40 times "y" " and Save is clicked', async () => {
		await nameInput(page, 1).fill(` ${"y".repeat(40)} `);
		await clickSave(page);
	});
	await test.step('Then PUT /v1/tags is sent the tags "ruby" and 40 times "y"', () => {
		expect(server.puts.map((b) => b.tags.map((t) => t.name))).toEqual([
			["ruby", "y".repeat(40)],
		]);
	});
});

test("A failed save keeps the edits", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheEditor(page);
	await test.step('And PUT /v1/tags answers with the status 500 and "boom"', () => {
		server.put = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	await test.step('When the prompt of "ruby" is changed and Save is clicked', async () => {
		await section(page, 0).locator("label.field textarea").fill("Changed");
		await clickSave(page);
	});
	await test.step('Then the status says "Could not save: 500 boom"', async () => {
		expect(await status(page)).toBe("Could not save: 500 boom");
	});
	await test.step("And onSaved is not called and isDirty() is true", async () => {
		expect(await seen(page)).toEqual([]);
		expect(await isDirty(page)).toBe(true);
	});
});

test("A failed save keeps the blank memory items", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[{ ...RUBY, memory: [{ text: "fact" }, { text: "  " }] }, GO],
		'Given the editor of the definitions "ruby" with the memory items "fact" and "  ", and "go"',
	);
	await test.step('And PUT /v1/tags answers with the status 500 and "boom"', () => {
		server.put = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	await test.step("When Save is clicked", () => clickSave(page));
	await test.step('Then PUT /v1/tags was sent "ruby" with only the memory item "fact"', () => {
		expect(server.puts.map((b) => b.tags[0])).toEqual([
			{ name: "ruby", prompt: "Ruby prompt", memory: [{ text: "fact" }] },
		]);
	});
	await test.step('And the status says "Could not save: 500 boom"', async () => {
		expect(await status(page)).toBe("Could not save: 500 boom");
	});
	await thenIsDirty(page, false);
	await test.step('When ↓ of "ruby" is clicked', async () => {
		await section(page, 0).getByRole("button", { name: "↓" }).click();
	});
	await test.step('Then "ruby" shows the memory items "fact" and "  "', async () => {
		const ruby = (await editorState(page)).find((s) => s.name === "ruby");
		expect(ruby.memory).toEqual(["fact", "  "]);
	});
});

test("Deleting a tag asks first", async ({ page, context }) => {
	await background(page, context);
	await givenTheEditor(page);
	const questions = [];
	const deleteRuby = () =>
		section(page, 0)
			.locator(".tag-edit-head")
			.getByRole("button", { name: "Delete" })
			.click();
	await test.step('When Delete of "ruby" is clicked and the question is dismissed', async () => {
		answerNextQuestion(page, false, questions);
		await deleteRuby();
	});
	await test.step(`Then the question was 'Delete the tag "ruby"? (Conversations keep the tag name.)'`, () => {
		expect(questions).toEqual([
			'Delete the tag "ruby"? (Conversations keep the tag name.)',
		]);
	});
	await test.step('And the tags are still "ruby" and "go"', async () => {
		expect(await names(page)).toEqual(["ruby", "go"]);
	});
	await test.step('When Delete of "ruby" is clicked and the question is accepted', async () => {
		answerNextQuestion(page, true, questions);
		await deleteRuby();
	});
	await test.step('Then the tags are "go"', async () => {
		expect(await names(page)).toEqual(["go"]);
	});
});

test("Deleting a memory item removes it at once", async ({ page, context }) => {
	await background(page, context);
	await givenTheEditor(
		page,
		[RUBY],
		'Given the editor of the definitions "ruby" with a prompt and two memory items',
	);
	await test.step("When Delete of the first memory item is clicked", async () => {
		await page.locator(".mem-list li").first().getByRole("button").click();
	});
	await test.step('Then "ruby" shows one memory item under "Memory (1 items, about 5 characters)"', async () => {
		expect((await editorState(page))[0]).toMatchObject({
			memory: ["rules"],
			summary: "Memory (1 items, about 5 characters)",
		});
	});
	await thenIsDirty(page, true);
});

test("Discarding the changes asks first and goes back to the saved state", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheEditor(page);
	await test.step('And the name of "go" is changed to "golang"', async () => {
		await nameInput(page, 1).fill("golang");
	});
	const questions = [];
	await test.step("When Discard changes is clicked and the question is dismissed", async () => {
		answerNextQuestion(page, false, questions);
		await button(page, "Discard changes").click();
	});
	await test.step('Then the tags are "ruby" and "golang"', async () => {
		expect(await names(page)).toEqual(["ruby", "golang"]);
	});
	await test.step("When Discard changes is clicked and the question is accepted", async () => {
		answerNextQuestion(page, true, questions);
		await button(page, "Discard changes").click();
	});
	await test.step('Then the tags are "ruby" and "go"', async () => {
		expect(await names(page)).toEqual(["ruby", "go"]);
	});
	await thenIsDirty(page, false);
	expect(questions).toEqual([
		"Discard the changes and go back to the saved state?",
		"Discard the changes and go back to the saved state?",
	]);
});

// ---- initTagsDialog ----

async function givenTheTagsDialog(page) {
	await test.step("Given initTagsDialog has wired a button", async () => {
		await page.evaluate(() => {
			const b = document.createElement("button");
			b.id = "open-tags";
			b.textContent = "Open tags";
			document.body.append(b);
			window.openTags = window.T.initTagsDialog(b, {
				onSaved: (d) => window.seen.push(["saved", d]),
				toast: (m) => window.seen.push(["toast", m]),
			});
		});
	});
}

async function givenGetTagsReturns(server) {
	await test.step('And GET /v1/tags returns the definitions "ruby" and "go"', () => {
		server.tags = { tags: [RUBY, GO] };
	});
}

const dialogOpen = (page) =>
	page.evaluate(() => {
		const d = document.getElementById("tags-dialog");
		return d.open && d.matches(":modal");
	});

async function clickOpenTags(page, line) {
	const click = async () => {
		await page.locator("#open-tags").click();
		await page.waitForFunction(() => {
			const d = document.getElementById("tags-dialog");
			return d.open || window.seen.length > 0;
		});
	};
	if (line) await test.step(line, click);
	else await click();
}

test("The tags dialog opens on the saved definitions", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheTagsDialog(page);
	await givenGetTagsReturns(server);
	await clickOpenTags(page, "When the button is clicked");
	await test.step('Then the modal dialog "#tags-dialog" is open with the editor of "ruby" and "go"', async () => {
		expect(await dialogOpen(page)).toBe(true);
		expect(await names(page, "#tags-dialog")).toEqual(["ruby", "go"]);
	});
	await test.step("And the function it returned opens it as well after the dialog is closed", async () => {
		await page.evaluate(() => document.getElementById("tags-dialog").close());
		expect(await dialogOpen(page)).toBe(false);
		await page.evaluate(() => window.openTags());
		expect(await dialogOpen(page)).toBe(true);
	});
});

test("The tags dialog stays closed when the definitions cannot be loaded", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheTagsDialog(page);
	await test.step('And GET /v1/tags answers with the status 500 and "boom"', () => {
		server.get = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	await clickOpenTags(page, "When the button is clicked");
	await test.step('Then the toast says "Failed to load the tags: 500 boom"', async () => {
		expect(await seen(page)).toEqual([
			["toast", "Failed to load the tags: 500 boom"],
		]);
	});
	await test.step("And the dialog is closed", async () => {
		expect(await dialogOpen(page)).toBe(false);
	});
});

for (const { closing, close } of [
	{
		closing: "Close is clicked",
		close: (page) => button(page, "Close").click(),
	},
	{
		closing: "Escape is pressed",
		close: (page) => page.keyboard.press("Escape"),
	},
	{
		closing: "the backdrop is clicked",
		close: (page) => page.mouse.click(3, 3),
	},
]) {
	test(`The tags dialog closes at once without edits (${closing})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheTagsDialog(page);
		await givenGetTagsReturns(server);
		await clickOpenTags(page, "And the button is clicked");
		const questions = [];
		page.on("dialog", (d) => {
			questions.push(d.message());
			d.dismiss();
		});
		await test.step(`When ${closing}`, () => close(page));
		await test.step("Then the dialog is closed and nothing was asked", async () => {
			expect(await dialogOpen(page)).toBe(false);
			expect(questions).toEqual([]);
		});
	});
}

test("Closing the tags dialog with unsaved edits asks first", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheTagsDialog(page);
	await givenGetTagsReturns(server);
	await clickOpenTags(page, "And the button is clicked");
	await test.step('And the name of "go" is changed to "golang"', async () => {
		await nameInput(page, 1).fill("golang");
	});
	const questions = [];
	await test.step("When Close is clicked and the question is dismissed", async () => {
		answerNextQuestion(page, false, questions);
		await button(page, "Close").click();
	});
	await test.step('Then the question was "Close without saving? The unsaved changes are discarded."', () => {
		expect(questions).toEqual([
			"Close without saving? The unsaved changes are discarded.",
		]);
	});
	await test.step("And the dialog is still open", async () => {
		expect(await dialogOpen(page)).toBe(true);
	});
	await test.step("When Close is clicked and the question is accepted", async () => {
		answerNextQuestion(page, true, questions);
		await button(page, "Close").click();
	});
	await test.step("Then the dialog is closed", async () => {
		expect(await dialogOpen(page)).toBe(false);
	});
});

// ---- proposeMemory ----

/** proposeMemory in the page: {result} or {error}, and the conversation's messages afterwards. */
function propose(
	page,
	{ conv, defs, backend = { base_url: LLM_URL, model: "m" } },
) {
	return page.evaluate(
		async ({ conv, defs, backend }) => {
			try {
				const result = await window.T.proposeMemory({ conv, backend, defs });
				return { result, messages: conv.messages };
			} catch (e) {
				return { error: e.message, messages: conv.messages };
			}
		},
		{ conv, defs, backend },
	);
}

const PROMPT = [
	"From this conversation so far, propose what should be added to the memory of the following tags.",
	"Follow the policy written in each system prompt about what to remember. For a tag without a policy, you need not propose anything.",
	"Do not propose what is already in memory or what matters only for this conversation. Write each item in one or two sentences that can be understood on their own.",
	"If there is nothing to add, make proposals an empty array.",
	"",
	'- Current memory of the tag "ruby":',
	"  - existing",
	'- Current memory of the tag "go":',
	"  (none yet)",
].join("\n");

test("A memory proposal continues the conversation with one temporary message", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	let defs;
	await test.step('Given the definitions "ruby" with the memory item "existing", "go" without memory and "python"', () => {
		defs = [
			{ name: "ruby", prompt: "p", memory: [{ text: "existing" }] },
			{ name: "go", prompt: "p" },
			{ name: "python", prompt: "p", memory: [] },
		];
	});
	const messages = [
		{ id: "u1", role: "user", content: "q" },
		{ id: "a1", role: "assistant", content: "a", thinking: "t" },
		{ id: "a2", role: "assistant", content: "", error: "failed" },
	];
	let conv;
	await test.step('And a conversation with the tags "ruby", "unknown" and "go", the instructions "Be brief" and a user message, a reply and an empty reply', () => {
		conv = {
			meta: { id: "c1", instructions: "Be brief" },
			tags: ["ruby", "unknown", "go"],
			messages,
		};
	});
	await test.step('And the model replies with proposals for "ruby", "python", "go" with blank text and "go"', () => {
		server.answerLlm = replyWith(
			JSON.stringify({
				proposals: [
					{ tag: "ruby", text: "  New fact  " },
					{ tag: "python", text: "Py fact" },
					{ tag: "go", text: "   " },
					{ tag: "go", text: "Go fact" },
				],
			}),
			{ prompt_n: 12, predicted_n: 30 },
		);
	});
	let out;
	await test.step('When proposeMemory asks for proposals with the backend "m" at http://llm.test/ and the key "k"', async () => {
		out = await propose(page, {
			conv,
			defs,
			backend: {
				base_url: `${LLM_URL}/`,
				api_key: "k",
				model: "m",
				extra: { temperature: 0.2 },
			},
		});
	});
	await test.step("Then one request is sent to http://llm.test/v1/responses with the key as a bearer token", () => {
		expect(server.llm.map((r) => [r.url, r.authorization])).toEqual([
			[`${LLM_URL}/v1/responses`, "Bearer k"],
		]);
	});
	await test.step("And its body has the backend's extra, the model \"m\", stream, the instructions and the conversation's user message and reply", () => {
		const { body } = server.llm[0];
		expect(body).toMatchObject({
			temperature: 0.2,
			model: "m",
			stream: true,
			instructions: "Be brief",
		});
		expect(body.input.slice(0, -1)).toEqual([
			{ role: "user", content: "q" },
			{ type: "message", role: "assistant", content: "a" },
		]);
	});
	await test.step('And its last input is the temporary user message listing the current memory of "ruby" and "go"', () => {
		expect(server.llm[0].body.input.at(-1)).toEqual({
			role: "user",
			content: PROMPT,
		});
	});
	await test.step('And its response_format is the JSON schema "memory_proposals" with the tags "ruby" and "go"', () => {
		expect(server.llm[0].body.response_format).toEqual({
			type: "json_schema",
			json_schema: {
				name: "memory_proposals",
				schema: {
					type: "object",
					properties: {
						proposals: {
							type: "array",
							items: {
								type: "object",
								properties: {
									tag: { type: "string", enum: ["ruby", "go"] },
									text: { type: "string" },
								},
								required: ["tag", "text"],
							},
						},
					},
					required: ["proposals"],
				},
			},
		});
	});
	await test.step('And it returns the trimmed proposals for "ruby" and "go", the tags "ruby" and "go" and the timings of the reply', () => {
		expect(out.result).toEqual({
			proposals: [
				{ tag: "ruby", text: "New fact" },
				{ tag: "go", text: "Go fact" },
			],
			tags: ["ruby", "go"],
			timings: { prompt_n: 12, predicted_n: 30 },
		});
	});
	await test.step("And the conversation's messages are unchanged", () => {
		expect(out.messages).toEqual(messages);
	});
});

test("A conversation without defined tags gets no proposal", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	let defs;
	let conv;
	await test.step('Given the definitions "ruby"', () => {
		defs = [{ name: "ruby", prompt: "p" }];
	});
	await test.step('And a conversation with the tags "unknown"', () => {
		conv = { meta: {}, tags: ["unknown"], messages: [] };
	});
	let out;
	await test.step("When proposeMemory asks for proposals", async () => {
		out = await propose(page, { conv, defs });
	});
	await test.step('Then it throws "The conversation has no defined tags"', () => {
		expect(out.error).toBe("The conversation has no defined tags");
	});
	await test.step("And nothing is sent to the model", () => {
		expect(server.llm).toEqual([]);
	});
});

async function givenRubyAndAConversation() {
	const defs = [{ name: "ruby", prompt: "p" }];
	const conv = {
		meta: {},
		tags: ["ruby"],
		messages: [{ role: "user", content: "q" }],
	};
	await test.step('Given the definitions "ruby"', () => {});
	await test.step('And a conversation with the tags "ruby"', () => {});
	return { defs, conv };
}

test("A reply without proposals proposes nothing", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const { defs, conv } = await givenRubyAndAConversation();
	await test.step('And the model replies with "{}"', () => {
		server.answerLlm = replyWith("{}");
	});
	let out;
	await test.step("When proposeMemory asks for proposals", async () => {
		out = await propose(page, { conv, defs });
	});
	await test.step('Then it returns no proposals and the tags "ruby"', () => {
		expect(out.result).toMatchObject({ proposals: [], tags: ["ruby"] });
	});
});

test("Proposals that are not objects are skipped", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	const { defs, conv } = await givenRubyAndAConversation();
	await test.step('And the model replies with the proposals null, 5, "x", a list and one for "ruby"', () => {
		server.answerLlm = replyWith(
			JSON.stringify({
				proposals: [null, 5, "x", ["ruby", "y"], { tag: "ruby", text: "ok" }],
			}),
		);
	});
	let out;
	await test.step("When proposeMemory asks for proposals", async () => {
		out = await propose(page, { conv, defs });
	});
	await test.step('Then it returns only the proposal for "ruby"', () => {
		expect(out).toMatchObject({
			result: { proposals: [{ tag: "ruby", text: "ok" }], tags: ["ruby"] },
		});
	});
});

for (const { answer, message, fulfill } of [
	{
		answer: "replies with text that is not JSON",
		message: "Could not read the proposal as JSON",
		fulfill: replyWith("Sure! Here are some proposals"),
	},
	{
		answer: 'replies with "null"',
		message: "Could not read the proposal as JSON",
		fulfill: replyWith("null"),
	},
	{
		answer: "replies with a list",
		message: "Could not read the proposal as JSON",
		fulfill: replyWith('[{"tag":"ruby","text":"x"}]'),
	},
	{
		answer: "replies with proposals that is a text",
		message: "Could not read the proposal as JSON",
		fulfill: replyWith('{"proposals":"ruby: x"}'),
	},
	{
		answer: 'sends the error event "overloaded"',
		message: "overloaded",
		fulfill: (route) =>
			route.fulfill({
				headers: { ...CORS, "Content-Type": "text/event-stream" },
				body: sse([
					{ type: "response.output_text.delta", delta: '{"prop' },
					{ type: "error", error: { message: "overloaded" } },
				]),
			}),
	},
	{
		answer: 'answers with the status 500 and "boom"',
		message: "HTTP 500: boom",
		fulfill: (route) =>
			route.fulfill({
				status: 500,
				headers: CORS,
				json: { error: { message: "boom" } },
			}),
	},
]) {
	test(`A failed proposal throws (${answer})`, async ({ page, context }) => {
		const server = await background(page, context);
		const { defs, conv } = await givenRubyAndAConversation();
		await test.step(`And the model ${answer}`, () => {
			server.answerLlm = fulfill;
		});
		let out;
		await test.step("When proposeMemory asks for proposals", async () => {
			out = await propose(page, { conv, defs });
		});
		await test.step(`Then it throws "${message}"`, () => {
			expect(out.error).toBe(message);
		});
	});
}

// ---- openMemoryDialog ----

const SOURCE = { conv_id: "c1", msg_id: "m1" };

async function givenAMemoryDialog(page) {
	await test.step('Given a <dialog id="memory-dialog"> in the page', async () => {
		await page.evaluate(() => {
			const d = document.createElement("dialog");
			d.id = "memory-dialog";
			document.body.append(d);
		});
	});
}

/** openMemoryDialog with the default dialog; onDone and toast push to window.seen. */
function openMemory(page, proposals, tags = ["ruby", "go"]) {
	return page.evaluate(
		({ proposals, tags, source }) =>
			window.T.openMemoryDialog({
				proposals,
				tags,
				source,
				onDone: () => window.seen.push(["done"]),
				toast: (m) => window.seen.push(["toast", m]),
			}),
		{ proposals, tags, source: SOURCE },
	);
}

function memoryDialogState(page) {
	return page.evaluate(() => {
		const d = document.getElementById("memory-dialog");
		return {
			open: d.open,
			modal: d.matches(":modal"),
			proposals: [...d.querySelectorAll('[part="lcty-memory__proposal"]')].map(
				(p) => ({
					adopt: p.querySelector("input[type=checkbox]").checked,
					label: p.querySelector("label").textContent,
					options: [...p.querySelectorAll("option")].map((o) => o.value),
					tag: p.querySelector("select").value,
					text: p.querySelector("textarea").value,
				}),
			),
			hints: [...d.querySelectorAll('p[part="lcty-memory__hint"]')].map(
				(p) => p.textContent,
			),
			buttons: [...d.querySelectorAll("button")].map((b) => b.textContent),
		};
	});
}

const proposal = (page, i) =>
	page.locator('#memory-dialog [part="lcty-memory__proposal"]').nth(i);

/** Click "Add the adopted items" and wait until the additions are done (closed, or a message shown). */
async function clickAdd(page) {
	await button(page, "Add the adopted items").click();
	await page.waitForFunction(() => {
		const d = document.getElementById("memory-dialog");
		return (
			!d.open || d.querySelector('p[part="lcty-memory__hint"]:empty') === null
		);
	});
}

test("The memory dialog shows every proposal, adopted", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAMemoryDialog(page);
	await test.step('When openMemoryDialog shows the proposals "A" for "ruby" and "B" for "go" with the tags "ruby" and "go"', () =>
		openMemory(page, [
			{ tag: "ruby", text: "A" },
			{ tag: "go", text: "B" },
		]));
	let state;
	await test.step('Then "#memory-dialog" is open as a modal dialog', async () => {
		state = await memoryDialogState(page);
		expect([state.open, state.modal]).toEqual([true, true]);
	});
	await test.step('And it shows two proposals, each with a checked "Adopt" box, a choice of "ruby" and "go" with its tag chosen, and its text', () => {
		expect(state.proposals).toEqual([
			{
				adopt: true,
				label: "Adopt",
				options: ["ruby", "go"],
				tag: "ruby",
				text: "A",
			},
			{
				adopt: true,
				label: "Adopt",
				options: ["ruby", "go"],
				tag: "go",
				text: "B",
			},
		]);
	});
	await test.step('And it has the buttons "Close" and "Add the adopted items"', () => {
		expect(state.buttons).toEqual(["Close", "Add the adopted items"]);
	});
});

test("The adopted proposals are added as edited", async ({ page, context }) => {
	const server = await background(page, context);
	await givenAMemoryDialog(page);
	await test.step('And openMemoryDialog shows the proposals "A" for "ruby", "B" for "go" and "C" for "ruby" with the source of the conversation', () =>
		openMemory(page, [
			{ tag: "ruby", text: "A" },
			{ tag: "go", text: "B" },
			{ tag: "ruby", text: "C" },
		]));
	await test.step('When the text of "A" is changed to "  A2  ", the tag of "B" to "ruby", "C" is not adopted and Add the adopted items is clicked', async () => {
		await proposal(page, 0).locator("textarea").fill("  A2  ");
		await proposal(page, 1).locator("select").selectOption("ruby");
		await proposal(page, 2).getByRole("checkbox").uncheck();
		await clickAdd(page);
	});
	await test.step('Then POST /v1/tags/ruby/memory is sent "A2" and then "B", each with the source', () => {
		expect(server.memory).toEqual([
			["ruby", { text: "A2", source: SOURCE }],
			["ruby", { text: "B", source: SOURCE }],
		]);
	});
	await test.step('And the dialog is closed, onDone is called and the toast says "Added 2 items to memory"', async () => {
		expect((await memoryDialogState(page)).open).toBe(false);
		expect(await seen(page)).toEqual([
			["done"],
			["toast", "Added 2 items to memory"],
		]);
	});
});

test("Adding nothing adopted sends nothing", async ({ page, context }) => {
	const server = await background(page, context);
	await givenAMemoryDialog(page);
	await test.step('And openMemoryDialog shows the proposals "A" for "ruby" and "B" for "go"', () =>
		openMemory(page, [
			{ tag: "ruby", text: "A" },
			{ tag: "go", text: "B" },
		]));
	await test.step('When "A" is not adopted, the text of "B" is made blank and Add the adopted items is clicked', async () => {
		await proposal(page, 0).getByRole("checkbox").uncheck();
		await proposal(page, 1).locator("textarea").fill("  ");
		await clickAdd(page);
	});
	await test.step("Then nothing is sent to POST /v1/tags/:name/memory", () => {
		expect(server.memory).toEqual([]);
	});
	await test.step('And the dialog is closed, onDone is called and the toast says "Nothing was added"', async () => {
		expect((await memoryDialogState(page)).open).toBe(false);
		expect(await seen(page)).toEqual([
			["done"],
			["toast", "Nothing was added"],
		]);
	});
});

test("A failed addition keeps the dialog open", async ({ page, context }) => {
	const server = await background(page, context);
	await givenAMemoryDialog(page);
	await test.step('And openMemoryDialog shows the proposal "A" for "ruby"', () =>
		openMemory(page, [{ tag: "ruby", text: "A" }]));
	await test.step('And POST /v1/tags/ruby/memory answers with the status 404 and "no such tag"', () => {
		server.addMemory = (route) =>
			route.fulfill({ status: 404, body: "no such tag" });
	});
	await test.step("When Add the adopted items is clicked", () =>
		clickAdd(page));
	await test.step('Then the dialog says "Could not add: 404 no such tag"', async () => {
		expect((await memoryDialogState(page)).hints).toContain(
			"Could not add: 404 no such tag",
		);
	});
	await test.step("And the dialog is still open and onDone is not called", async () => {
		expect((await memoryDialogState(page)).open).toBe(true);
		expect(await seen(page)).toEqual([]);
	});
});

test("The memory dialog without proposals says so", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenAMemoryDialog(page);
	await test.step("When openMemoryDialog shows no proposals", () =>
		openMemory(page, []));
	await test.step('Then it says "Nothing to add was found."', async () => {
		expect((await memoryDialogState(page)).hints).toContain(
			"Nothing to add was found.",
		);
	});
	await test.step('And it has only the button "Close"', async () => {
		expect((await memoryDialogState(page)).buttons).toEqual(["Close"]);
	});
	await test.step("When Close is clicked", async () => {
		await button(page, "Close").click();
	});
	await test.step("Then the dialog is closed and onDone is not called", async () => {
		expect((await memoryDialogState(page)).open).toBe(false);
		expect(await seen(page)).toEqual([]);
	});
});
