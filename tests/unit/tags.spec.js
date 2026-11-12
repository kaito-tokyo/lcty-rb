// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1018: the scenarios of docs/specs/LCTYSP-1018_tags.feature that need the browser, written by hand. Each test
// has the title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two
// read side by side.
//
// The editor and the dialogs of js/tags.js (renderTagsEditor, initTagsDialog, openMemoryDialog) build DOM elements and
// open <dialog>s: they run in a real browser on the test server's origin, on the empty unit page. composeDraft and
// proposeMemory run in Node.js, in tests/unit/tags.test.js. GET and PUT /v1/tags, POST /v1/tags/:file/memory and the
// fake llama-server at http://llm.test are answered by routes the test sets (server.*), which also record what was
// sent (the body of each PUT and its If-Match), so the server's data does not matter. What the module calls back
// (onSaved, toast, onDone) is pushed to window.seen.

import { expect, test } from "@playwright/test";
import { openUnitPage } from "./unit-page.js";

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

/**
 * The Background, then the Scenario's first line "Given a page on the server's origin" (the routes are set on the
 * context, so they are in place before the page opens).
 */
async function background(page, context) {
	const server = {
		tags: { tags: [] },
		etag: "e0",
		puts: [],
		ifMatch: [],
		memory: [],
		llm: [],
		get: (route) =>
			route.fulfill({ json: server.tags, headers: { ETag: server.etag } }),
		put: (route) =>
			route.fulfill({ json: { ok: true }, headers: { ETag: "e9" } }),
		addMemory: (route) =>
			route.fulfill({ status: 201, json: { id: "m", text: "t", at: "now" } }),
		answerLlm: replyWith('{"proposals":[]}'),
	};
	await test.step("Given /v1/tags, /v1/tags/:file/memory and the llama-server at http://llm.test are answered by the test", async () => {
		await context.route("**/v1/tags", async (route) => {
			const req = route.request();
			if (req.method() === "PUT") {
				// both recorded at once, as a test waits for the PUT and then reads its If-Match
				const ifMatch = await req.headerValue("if-match");
				server.puts.push(req.postDataJSON());
				server.ifMatch.push(ifMatch);
				return server.put(route);
			}
			return server.get(route);
		});
		await context.route("**/v1/tags/*/memory", (route) => {
			const req = route.request();
			const file = decodeURIComponent(
				new URL(req.url()).pathname.split("/")[3],
			);
			server.memory.push([file, req.postDataJSON()]);
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
	});
	await test.step("Given a page on the server's origin", async () => {
		await openUnitPage(page, context);
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

/** The definitions "a", "b", … of the feature: the tag files 00010-a.html, 00020-b.html, … named a, b, … */
const defsOf = (...tags) =>
	tags.map((t, i) => ({
		file: `${String((i + 1) * 10).padStart(5, "0")}-${t.name}.html`,
		ops: [],
		prompt: "",
		memory: [],
		...t,
	}));

const [RUBY, GO] = defsOf(
	{
		name: "ruby",
		prompt: "Ruby prompt",
		memory: [{ text: "fact" }, { text: "rules" }],
	},
	{ name: "go", prompt: "Go prompt", memory: [] },
);

// ---- The editor ----

/**
 * renderTagsEditor(container, {defs, etag, onSaved, toast}) into a new <div id="editor">, kept as window.editor. With
 * file (a tag file's page), onSaved's second argument is kept too.
 */
function renderEditor(page, defs, etag, file) {
	return page.evaluate(
		({ defs, etag, file }) => {
			const div = document.createElement("div");
			div.id = "editor";
			document.body.append(div);
			window.editor = window.T.renderTagsEditor(div, {
				defs,
				etag,
				...(file === undefined ? {} : { file }),
				onSaved: (d, s) =>
					window.seen.push(file === undefined ? ["saved", d] : ["saved", d, s]),
				toast: (m) => window.seen.push(["toast", m]),
			});
		},
		{ defs, etag, file },
	);
}

async function givenTheEditor(
	page,
	defs = [RUBY, GO],
	line = 'Given the editor of the definitions "ruby" and "go"',
	etag = "e0",
) {
	await test.step(line, () => renderEditor(page, defs, etag));
}

/** What the editor shows: one entry per tag section. */
function editorState(page, root = "#editor") {
	return page.evaluate(
		(root) =>
			[...document.querySelectorAll(`${root} section.tag-edit`)].map((s) => {
				const head = s.querySelector(".tag-edit-head");
				const details = s.querySelector("details");
				return {
					name: head.querySelector("input").value,
					head: [...head.children].map((e) =>
						e.tagName === "INPUT" ? `input ${e.value}` : e.textContent,
					),
					prompt: s.querySelector("label.field textarea").value,
					memory: [...s.querySelectorAll(".mem-list li textarea")].map(
						(t) => t.value,
					),
					summary: details.querySelector("summary").textContent,
					open: details.open,
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
/** Change the name field of tag i to name, as a user's input. */
async function fillName(page, i, name) {
	const input = nameInput(page, i);
	await input.fill(name);
	// Playwright's fill in Firefox drops control characters: the value is set and its input event sent instead
	if ((await input.inputValue()) !== name)
		await input.evaluate((el, value) => {
			el.value = value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
		}, name);
}
const promptInput = (page, i) =>
	section(page, i).locator("label.field textarea");
const button = (page, name) => page.getByRole("button", { name, exact: true });
/** The bodies of the PUTs as [file, name] of each tag. */
const putFiles = (server) =>
	server.puts.map((b) => b.tags.map((t) => [t.file, t.name]));

async function thenIsDirty(page, value, line = `And isDirty() is ${value}`) {
	await test.step(line, async () => {
		expect(await isDirty(page)).toBe(value);
	});
}

/**
 * Click Save and wait until the save has ended: saved (onSaved was called) or refused (the status changed). With
 * until "put", wait only until the PUT has been sent (a save whose status stays the same).
 */
async function clickSave(page, server, { until } = {}) {
	const before = await page.evaluate(() => ({
		seen: window.seen.length,
		status: document.querySelector(
			"#editor .tags-form > p.hint:not(:first-child)",
		).textContent,
	}));
	const puts = server.puts.length;
	await button(page, "Save").click();
	if (until === "put") {
		await expect.poll(() => server.puts.length).toBe(puts + 1);
		return;
	}
	await page.waitForFunction(
		(before) =>
			window.seen.length !== before.seen ||
			document.querySelector("#editor .tags-form > p.hint:not(:first-child)")
				.textContent !== before.status,
		before,
	);
}

// ---- renderTagsEditor ----

test("The editor shows every definition with its memory", async ({
	page,
	context,
}) => {
	await background(page, context);
	const [ruby, go, big] = defsOf(
		RUBY,
		{ name: "go" },
		{
			name: "big",
			memory: Array.from({ length: 6 }, (_, i) => ({ text: `m${i}` })),
		},
	);
	await givenTheEditor(
		page,
		[ruby, go, big],
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
	await thenIsDirty(page, false);
});

test("The order is changed on the reorder page, not in the editor", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheEditor(page);
	await test.step('Then the head of each tag has its name and only the button "Delete"', async () => {
		expect((await editorState(page)).map((s) => s.head)).toEqual([
			["input ruby", "Delete"],
			["input go", "Delete"],
		]);
	});
	await test.step('And the hint has the link "Change the order" to /t/ of the site', async () => {
		const link = await page.evaluate(() => {
			const links = document.querySelectorAll(
				"#editor .tags-form > p.hint:first-child a",
			);
			return [...links].map((a) => [a.className, a.textContent, a.href]);
		});
		expect(link).toEqual([
			["tags-reorder", "Change the order", new URL("/t/", page.url()).href],
		]);
	});
});

test("Saving puts the definitions and takes the saved ones back", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[{ ...RUBY, memory: [{ text: "fact" }, { text: "  " }] }, GO],
		'Given the editor of the definitions "ruby" with the memory items "fact" and "  ", and "go", read with the ETag "e1"',
		"e1",
	);
	const stored = {
		tags: [
			{
				file: "00010-ruby.html",
				name: "ruby",
				ops: [],
				prompt: "New prompt",
				memory: [{ id: "1", text: "fact", at: "2026-11-01T00:00:00+09:00" }],
			},
			{
				file: "00020-go.html",
				name: "go",
				ops: [],
				prompt: "Go prompt",
				memory: [],
			},
			{
				file: "00030-rust.html",
				name: "rust",
				ops: [],
				prompt: "",
				memory: [],
			},
		],
	};
	await test.step('And GET /v1/tags will return the definitions with timestamps and the ETag "e2"', () => {
		server.tags = stored;
		server.etag = "e2";
	});
	await test.step('When the prompt of "ruby" is changed to "New prompt", a new tag "rust" is added and Save is clicked', async () => {
		await promptInput(page, 0).fill("New prompt");
		await button(page, "+ New tag").click();
		await nameInput(page, 2).fill("rust");
		await clickSave(page, server);
	});
	await test.step('Then PUT /v1/tags is sent with If-Match "e1"', () => {
		expect(server.ifMatch).toEqual(["e1"]);
	});
	await test.step('And it is sent "00010-ruby.html" with the new prompt and only the memory item "fact", "00020-go.html" and "00030-rust.html" without memory', () => {
		expect(server.puts).toEqual([
			{
				tags: [
					{
						file: "00010-ruby.html",
						name: "ruby",
						ops: [],
						prompt: "New prompt",
						memory: [{ text: "fact" }],
					},
					{
						file: "00020-go.html",
						name: "go",
						ops: [],
						prompt: "Go prompt",
						memory: [],
					},
					{
						file: "00030-rust.html",
						name: "rust",
						ops: [],
						prompt: "",
						memory: [],
					},
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
	await test.step('When the prompt of "go" is changed and Save is clicked', async () => {
		await promptInput(page, 1).fill("Changed");
		await clickSave(page, server);
	});
	await test.step('Then the second PUT /v1/tags is sent with If-Match "e2"', () => {
		expect(server.ifMatch).toEqual(["e1", "e2"]);
	});
});

test("Saving gives each tag its file name", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheEditor(page);
	await test.step('When the name of "go" is changed to "Golang", the new tags "C#" and "Café" typed decomposed are added and Save is clicked', async () => {
		await nameInput(page, 1).fill("Golang");
		await button(page, "+ New tag").click();
		await nameInput(page, 2).fill("C#");
		await button(page, "+ New tag").click();
		await nameInput(page, 3).fill("Café");
		await clickSave(page, server);
	});
	await test.step('Then PUT /v1/tags is sent "00010-ruby.html" named "ruby", "00020-golang.html" named "Golang", "00030-c~23.html" named "C#" and "00040-café.html" named "Café", composed', () => {
		expect(putFiles(server)).toEqual([
			[
				["00010-ruby.html", "ruby"],
				["00020-golang.html", "Golang"],
				["00030-c~23.html", "C#"],
				["00040-café.html", "Café"],
			],
		]);
	});
});

test("A new tag is numbered after the largest number", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[RUBY, { ...GO, file: "00050-go.html" }],
		'Given the editor of the tag files "00010-ruby.html" named "ruby" and "00050-go.html" named "go"',
	);
	await test.step('When a new tag "rust" is added and Save is clicked', async () => {
		await button(page, "+ New tag").click();
		await nameInput(page, 2).fill("rust");
		await clickSave(page, server);
	});
	await test.step('Then PUT /v1/tags is sent the files "00010-ruby.html", "00050-go.html" and "00060-rust.html"', () => {
		expect(server.puts.map((b) => b.tags.map((t) => t.file))).toEqual([
			["00010-ruby.html", "00050-go.html", "00060-rust.html"],
		]);
	});
});

const BAD_NAME = (name) =>
	`The tag name "${name}" cannot be used (1 to 40 characters, no spaces, control characters or : ; / " ' \` ~ \\ |)`;

test("A tag name that breaks the rules is not saved, and the status says the rules", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(page);
	await test.step('When the name of "go" is changed to "a b" and Save is clicked', async () => {
		await nameInput(page, 1).fill("a b");
		await clickSave(page, server);
	});
	await test.step("Then the status says 'The tag name \"a b\" cannot be used (1 to 40 characters, no spaces, control characters or : ; / \" ' ` ~ \\ |)'", async () => {
		expect(await status(page)).toBe(BAD_NAME("a b"));
	});
	await test.step("And nothing is sent to PUT /v1/tags", () => {
		expect(server.puts).toEqual([]);
	});
	await thenIsDirty(page, true);
});

for (const { caseName, name, shown } of [
	{ caseName: "a colon", name: "a:b", shown: '"a:b"' },
	{ caseName: "a semicolon", name: "a;b", shown: '"a;b"' },
	{ caseName: "a slash", name: "a/b", shown: '"a/b"' },
	{ caseName: "a tilde", name: "a~b", shown: '"a~b"' },
	{ caseName: "a backslash", name: "a\\b", shown: '"a\\b"' },
	{ caseName: "a vertical bar", name: "a|b", shown: '"a|b"' },
	{
		caseName: "a no-break space",
		name: "a b",
		shown: '"a" U+00A0 "b"',
	},
	{
		caseName: "a zero width joiner",
		name: "a‍b",
		shown: '"a" U+200D "b"',
	},
	{
		caseName: "a control character",
		name: "a\u0007b",
		shown: '"a" U+0007 "b"',
	},
	{ caseName: "empty", name: "", shown: '""' },
	{ caseName: "41 code points", name: "x".repeat(41), shown: '41 times "x"' },
	{
		caseName: "41 astral characters",
		name: "𝒳".repeat(41),
		shown: '41 times "𝒳"',
	},
]) {
	test(`A tag name that cannot be used is not saved (${caseName})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheEditor(page);
		await test.step(`When the name of "go" is changed to ${shown} and Save is clicked`, async () => {
			await fillName(page, 1, name);
			await clickSave(page, server);
		});
		await test.step(`Then the status says that the tag name ${shown} cannot be used`, async () => {
			expect(await status(page)).toBe(BAD_NAME(name));
		});
		await test.step("And nothing is sent to PUT /v1/tags", () => {
			expect(server.puts).toEqual([]);
		});
		await thenIsDirty(page, true);
	});
}

for (const { caseName, name } of [
	{ caseName: "the same name", name: "ruby" },
	{ caseName: "another case", name: "Ruby" },
	{ caseName: "upper case", name: "RUBY" },
]) {
	test(`A tag name with the file-name part of another tag is not saved (${caseName})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheEditor(page);
		await test.step(`When the name of "go" is changed to "${name}" and Save is clicked`, async () => {
			await fillName(page, 1, name);
			await clickSave(page, server);
		});
		await test.step('Then the status says "Tag names must be unique"', async () => {
			expect(await status(page)).toBe("Tag names must be unique");
		});
		await test.step("And nothing is sent to PUT /v1/tags", () => {
			expect(server.puts).toEqual([]);
		});
	});
}

/** The invalid tag of the feature: a file without <lcty-t>, as GET /v1/tags lists it. */
const BROKEN = {
	file: "00020-broken.html",
	name: "broken",
	ops: [],
	prompt: "",
	memory: [],
	invalid: true,
};

test("An invalid tag is shown without fields and sent back as it is", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[RUBY, BROKEN],
		'Given the editor of the definitions "ruby" and the invalid tag "00020-broken.html" named "broken"',
	);
	await test.step('Then the second section has the name "broken", the button "Delete" and the note that "00020-broken.html" cannot be read, and no field', async () => {
		const shown = await section(page, 1).evaluate((s) => ({
			head: [...s.querySelector(".tag-edit-head").children].map(
				(e) => e.textContent,
			),
			note: s.querySelector("p.hint").textContent,
			fields: s.querySelectorAll("input, textarea").length,
		}));
		expect(shown).toEqual({
			head: ["broken", "Delete"],
			note: "The tag file 00020-broken.html cannot be read (it has no <lcty-t>), so it cannot be edited here. Fix or delete the file in t/ of the data directory.",
			fields: 0,
		});
	});
	await test.step('When the prompt of "ruby" is changed to "New prompt" and Save is clicked', async () => {
		await promptInput(page, 0).fill("New prompt");
		await clickSave(page, server);
	});
	await test.step('Then PUT /v1/tags is sent "00010-ruby.html" with the new prompt and "00020-broken.html" as it was, with invalid true', () => {
		expect(server.puts).toHaveLength(1);
		const [ruby, broken] = server.puts[0].tags;
		expect(ruby).toMatchObject({
			file: "00010-ruby.html",
			prompt: "New prompt",
		});
		expect(broken).toEqual(BROKEN);
	});
});

test("A new tag with the file-name part of an invalid tag is not saved", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[RUBY, BROKEN],
		'Given the editor of the definitions "ruby" and the invalid tag "00020-broken.html" named "broken"',
	);
	await test.step('When a new tag "Broken" is added and Save is clicked', async () => {
		await button(page, "+ New tag").click();
		await nameInput(page, 2).fill("Broken");
		await clickSave(page, server);
	});
	await test.step('Then the status says "Tag names must be unique"', async () => {
		expect(await status(page)).toBe("Tag names must be unique");
	});
	await test.step("And nothing is sent to PUT /v1/tags", () => {
		expect(server.puts).toEqual([]);
	});
});

// ---- renderTagsEditor with a file (the page of a tag file) ----

async function givenTheEditorOfGo(page, defs = [RUBY, GO]) {
	await test.step(`Given the editor of the definitions ${defs.map((d) => `"${d.name}"`).join(" and ")} for the file "00020-go.html"`, () =>
		renderEditor(page, defs, "e0", "00020-go.html"));
}

test("With a file, the editor shows only that tag and no + New tag", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheEditorOfGo(page);
	await test.step('Then it shows one section, "go", with its prompt', async () => {
		expect((await editorState(page)).map((s) => [s.name, s.prompt])).toEqual([
			["go", "Go prompt"],
		]);
	});
	await test.step('And there is no button "+ New tag"', async () => {
		await expect(button(page, "+ New tag")).toHaveCount(0);
	});
});

test("Saving with a file sends the whole set and gives onSaved the tag's new file", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditorOfGo(page);
	await test.step('When the name is changed to "Golang" and Save is clicked', async () => {
		await nameInput(page, 0).fill("Golang");
		await clickSave(page, server);
	});
	await test.step('Then PUT /v1/tags is sent "00010-ruby.html" as it was and "00020-golang.html" named "Golang"', () => {
		expect(server.puts).toHaveLength(1);
		const [ruby, go] = server.puts[0].tags;
		expect(ruby).toEqual(RUBY);
		expect([go.file, go.name]).toEqual(["00020-golang.html", "Golang"]);
	});
	await test.step('And onSaved is given the file "00020-golang.html"', async () => {
		const saved = (await seen(page)).filter(([k]) => k === "saved");
		expect(saved.map(([, , s]) => s)).toEqual([{ file: "00020-golang.html" }]);
	});
});

test("Deleting the tag of the file saves at once and gives onSaved no file", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditorOfGo(page);
	await test.step("When Delete is clicked and the question is accepted", async () => {
		answerNextQuestion(page, true, []);
		await section(page, 0)
			.locator(".tag-edit-head")
			.getByRole("button", { name: "Delete" })
			.click();
		await expect.poll(() => seen(page)).toContainEqual(["toast", "Tags saved"]);
	});
	await test.step('Then PUT /v1/tags is sent only "00010-ruby.html"', () => {
		expect(putFiles(server)).toEqual([[["00010-ruby.html", "ruby"]]]);
	});
	await test.step("And onSaved is given the file null", async () => {
		const saved = (await seen(page)).filter(([k]) => k === "saved");
		expect(saved.map(([, , s]) => s)).toEqual([{ file: null }]);
	});
});

test("A file that is not in the set shows that the tag is gone", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheEditorOfGo(page, [RUBY]);
	await test.step('Then no section is shown and the list says "This tag is not in the tags any more: it was renamed or deleted."', async () => {
		expect(await editorState(page)).toEqual([]);
		expect(await page.locator("#editor .tags-edit").textContent()).toBe(
			"This tag is not in the tags any more: it was renamed or deleted.",
		);
	});
});

test("A name is trimmed and may have 40 code points", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(page);
	await test.step('When the name of "go" is changed to " 40 times "𝒳" " and Save is clicked', async () => {
		await nameInput(page, 1).fill(` ${"𝒳".repeat(40)} `);
		await clickSave(page, server);
	});
	await test.step('Then PUT /v1/tags is sent the tags "ruby" and 40 times "𝒳"', () => {
		expect(server.puts.map((b) => b.tags.map((t) => t.name))).toEqual([
			["ruby", "𝒳".repeat(40)],
		]);
	});
});

test("A save made stale elsewhere loads the tags again", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheEditor(
		page,
		[RUBY, GO],
		'Given the editor of the definitions "ruby" and "go", read with the ETag "e1"',
		"e1",
	);
	await test.step("And PUT /v1/tags answers with the status 412", () => {
		server.put = (route) =>
			route.fulfill({ status: 412, body: "the tags have changed" });
	});
	await test.step('And GET /v1/tags will return the definitions "ruby", "go" and "rust" with the ETag "e2"', () => {
		server.tags = { tags: defsOf(RUBY, GO, { name: "rust" }) };
		server.etag = "e2";
	});
	await test.step('When the name of "go" is changed to "golang" and Save is clicked', async () => {
		await nameInput(page, 1).fill("golang");
		await clickSave(page, server);
	});
	await test.step('Then the status says "The tags were changed elsewhere, so they were loaded again. Make the edit again."', async () => {
		expect(await status(page)).toBe(
			"The tags were changed elsewhere, so they were loaded again. Make the edit again.",
		);
	});
	await test.step('And the tags are "ruby", "go" and "rust" and isDirty() is false', async () => {
		expect(await names(page)).toEqual(["ruby", "go", "rust"]);
		expect(await isDirty(page)).toBe(false);
	});
	await test.step("And onSaved is not called", async () => {
		expect(await seen(page)).toEqual([]);
	});
	await test.step('When the prompt of "rust" is changed and Save is clicked', async () => {
		await promptInput(page, 2).fill("Rust prompt");
		await clickSave(page, server, { until: "put" });
	});
	await test.step('Then the second PUT /v1/tags is sent with If-Match "e2"', () => {
		expect(server.ifMatch).toEqual(["e1", "e2"]);
	});
});

test("A failed save keeps the edits", async ({ page, context }) => {
	const server = await background(page, context);
	await givenTheEditor(page);
	await test.step('And PUT /v1/tags answers with the status 500 and "boom"', () => {
		server.put = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	await test.step('When the prompt of "ruby" is changed and Save is clicked', async () => {
		await promptInput(page, 0).fill("Changed");
		await clickSave(page, server);
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
	await test.step("When Save is clicked", () => clickSave(page, server));
	await test.step('Then PUT /v1/tags was sent "00010-ruby.html" with only the memory item "fact"', () => {
		expect(server.puts.map((b) => b.tags[0])).toEqual([
			{
				file: "00010-ruby.html",
				name: "ruby",
				ops: [],
				prompt: "Ruby prompt",
				memory: [{ text: "fact" }],
			},
		]);
	});
	await test.step('And the status says "Could not save: 500 boom"', async () => {
		expect(await status(page)).toBe("Could not save: 500 boom");
	});
	await thenIsDirty(page, false);
	await test.step('When "+ New tag" is clicked', async () => {
		await button(page, "+ New tag").click();
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
	await test.step('And GET /v1/tags returns the definitions "ruby" and "go" with the ETag "e1"', () => {
		server.tags = { tags: [RUBY, GO] };
		server.etag = "e1";
	});
	await clickOpenTags(page, "When the button is clicked");
	await test.step('Then the modal dialog "#tags-dialog" is open with the editor of "ruby" and "go"', async () => {
		expect(await dialogOpen(page)).toBe(true);
		expect(await names(page, "#tags-dialog")).toEqual(["ruby", "go"]);
	});
	await test.step('And Save in it sends PUT /v1/tags with If-Match "e1"', async () => {
		await button(page, "Save").click();
		await page.waitForFunction(() => window.seen.length > 0);
		expect(server.ifMatch).toEqual(["e1"]);
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

// ---- openMemoryDialog ----

const SOURCE = { conv_id: "c1", msg_id: "m1" };
const TAGS = [
	{ name: "Ruby", file: "00010-ruby.html" },
	{ name: "Go", file: "00020-go.html" },
];
/** A proposal of the text for the tag of the display name, as proposeMemory returns it */
const proposalFor = (tag, text) => ({
	tag,
	file: TAGS.find((t) => t.name === tag).file,
	text,
});

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
function openMemory(page, proposals, tags = TAGS) {
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
				(p) => {
					const select = p.querySelector("select");
					return {
						adopt: p.querySelector("input[type=checkbox]").checked,
						label: p.querySelector("label").textContent,
						options: [...select.options].map((o) => o.textContent),
						values: [...select.options].map((o) => o.value),
						tag: select.selectedOptions[0].textContent,
						text: p.querySelector("textarea").value,
					};
				},
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
	await test.step('When openMemoryDialog shows the proposals "A" for "Ruby" and "B" for "Go" with the tags "Ruby" of "00010-ruby.html" and "Go" of "00020-go.html"', () =>
		openMemory(page, [proposalFor("Ruby", "A"), proposalFor("Go", "B")]));
	let state;
	await test.step('Then "#memory-dialog" is open as a modal dialog', async () => {
		state = await memoryDialogState(page);
		expect([state.open, state.modal]).toEqual([true, true]);
	});
	await test.step('And it shows two proposals, each with a checked "Adopt" box, a choice of "Ruby" and "Go" with its tag chosen, and its text', () => {
		expect(state.proposals.map(({ values, ...p }) => p)).toEqual([
			{
				adopt: true,
				label: "Adopt",
				options: ["Ruby", "Go"],
				tag: "Ruby",
				text: "A",
			},
			{
				adopt: true,
				label: "Adopt",
				options: ["Ruby", "Go"],
				tag: "Go",
				text: "B",
			},
		]);
	});
	await test.step('And the choices are the files "00010-ruby.html" and "00020-go.html"', () => {
		expect(state.proposals.map((p) => p.values)).toEqual([
			["00010-ruby.html", "00020-go.html"],
			["00010-ruby.html", "00020-go.html"],
		]);
	});
	await test.step('And it has the buttons "Close" and "Add the adopted items"', () => {
		expect(state.buttons).toEqual(["Close", "Add the adopted items"]);
	});
});

test("The adopted proposals are added as edited", async ({ page, context }) => {
	const server = await background(page, context);
	await givenAMemoryDialog(page);
	await test.step('And openMemoryDialog shows the proposals "A" for "Ruby", "B" for "Go" and "C" for "Ruby" with the source of the conversation', () =>
		openMemory(page, [
			proposalFor("Ruby", "A"),
			proposalFor("Go", "B"),
			proposalFor("Ruby", "C"),
		]));
	await test.step('When the text of "A" is changed to "  A2  ", the tag of "B" to "Ruby", "C" is not adopted and Add the adopted items is clicked', async () => {
		await proposal(page, 0).locator("textarea").fill("  A2  ");
		await proposal(page, 1).locator("select").selectOption({ label: "Ruby" });
		await proposal(page, 2).getByRole("checkbox").uncheck();
		await clickAdd(page);
	});
	await test.step('Then POST /v1/tags/00010-ruby.html/memory is sent "A2" and then "B", each with the source', () => {
		expect(server.memory).toEqual([
			["00010-ruby.html", { text: "A2", source: SOURCE }],
			["00010-ruby.html", { text: "B", source: SOURCE }],
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
	await test.step('And openMemoryDialog shows the proposals "A" for "Ruby" and "B" for "Go"', () =>
		openMemory(page, [proposalFor("Ruby", "A"), proposalFor("Go", "B")]));
	await test.step('When "A" is not adopted, the text of "B" is made blank and Add the adopted items is clicked', async () => {
		await proposal(page, 0).getByRole("checkbox").uncheck();
		await proposal(page, 1).locator("textarea").fill("  ");
		await clickAdd(page);
	});
	await test.step("Then nothing is sent to POST /v1/tags/:file/memory", () => {
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
	await test.step('And openMemoryDialog shows the proposal "A" for "Ruby"', () =>
		openMemory(page, [proposalFor("Ruby", "A")]));
	await test.step('And POST /v1/tags/00010-ruby.html/memory answers with the status 404 and "no such tag file"', () => {
		server.addMemory = (route) =>
			route.fulfill({ status: 404, body: "no such tag file" });
	});
	await test.step("When Add the adopted items is clicked", () =>
		clickAdd(page));
	await test.step('Then the dialog says "Could not add: 404 no such tag file"', async () => {
		expect((await memoryDialogState(page)).hints).toContain(
			"Could not add: 404 no such tag file",
		);
		expect(server.memory.map(([file]) => file)).toEqual(["00010-ruby.html"]);
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
