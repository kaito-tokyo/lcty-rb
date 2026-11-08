// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1016: the scenarios of docs/specs/LCTYSP-1016_conversation-file-elements.feature, written by hand. Each test
// has the title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two
// read side by side.
//
// The empty unit page (tests/unit/unit-page.js) loads /c/lcty.v1.js as a conversation file does, so LctyT and the
// element classes are globals and the elements are defined. <lcty-c> imports /c/lcty.v1.module.js once the page has
// loaded; a route answers it with an empty module (and counts the requests), so the page's features never run. Texts
// in quotes are JSON strings, decoded by json().

import { expect, test } from "@playwright/test";
import { givenAPage, openUnitPage } from "./unit-page.js";

const json = (raw) => JSON.parse(`"${raw}"`);

const ELEMENTS = [
	["lcty-conv-list", "LctyConvListElement"],
	["lcty-sidebar", "LctySidebarElement"],
	["lcty-c", "LctyCElement"],
	["lcty-setup", "LctySetupElement"],
	["lcty-message", "LctyMessageElement"],
	["lcty-composer", "LctyComposerElement"],
	["lcty-t", "LctyTElement"],
];

// ---- Background ----

async function background(page, context) {
	await givenAPage(page, context);
	const server = { moduleRequests: 0, tagFileRequests: 0 };
	await test.step("And /c/lcty.v1.module.js and /c/tag-file.js are empty modules", async () => {
		const empty = (count) => (route) => {
			server[count]++;
			return route.fulfill({
				contentType: "text/javascript",
				body: "export {};",
			});
		};
		await context.route("**/c/lcty.v1.module.js", empty("moduleRequests"));
		await context.route("**/c/tag-file.js", empty("tagFileRequests"));
	});
	return server;
}

// ---- Steps shared by the scenarios ----

function setBody(page, html) {
	return page.evaluate((html) => {
		document.body.innerHTML = html;
	}, html);
}

async function givenBody(page, html, line = `Given the body holds ${html}`) {
	await test.step(line, () => setBody(page, html));
}

async function givenJapanese(page, prefix = "Given") {
	await test.step(`${prefix} the page is in Japanese`, () =>
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
}

/** Set (value is a string) or remove (null) an attribute of the first element named tag. */
function setAttr(page, tag, name, value) {
	return page.evaluate(
		({ tag, name, value }) => {
			const el = window.created || document.querySelector(tag);
			if (value === null) el.removeAttribute(name);
			else el.setAttribute(name, value);
		},
		{ tag, name, value },
	);
}

function setupText(page) {
	return page.evaluate(
		() => document.querySelector("lcty-setup").text.textContent,
	);
}

/** The thinking of the message as plain values. */
function thinkingOf(page) {
	return page.evaluate(() => {
		const m = window.created || document.querySelector("lcty-message");
		return {
			hidden: m.thinking.hidden,
			summary: m.thinkingSummary.textContent,
			body: m.thinkingBody.textContent,
		};
	});
}

/** The foot of the message as plain values. */
function footOf(page) {
	return page.evaluate(() => {
		const m = document.querySelector("lcty-message");
		return {
			status: m.statusText.textContent,
			info: m.info.hidden ? "hidden" : "shown",
			foot: m.foot.hidden ? "hidden" : "shown",
		};
	});
}

async function thenFoot(page, status, info, foot, prefix = "Then") {
	await test.step(`${prefix} the status reads "${status}", the ⓘ is ${info} and the foot is ${foot}`, async () => {
		expect(await footOf(page)).toEqual({ status, info, foot });
	});
}

/** The chips and the picker of <lcty-c> as plain values. */
function tagsOf(page) {
	return page.evaluate(() => {
		const c = document.querySelector("lcty-c");
		return {
			chips: [...c.tagList.children].map((chip) => ({
				name: chip.dataset.tag,
				text: chip.querySelector(".tag-name").textContent,
				class: chip.className,
				part: chip.getAttribute("part"),
				title: chip.title,
				remove: [
					chip.querySelector("button").textContent,
					chip.querySelector("button").getAttribute("aria-label"),
					chip.querySelector("button").getAttribute("part"),
				],
			})),
			options: [...c.tagPicker.options].map((o) => [o.value, o.textContent]),
			disabled: c.tagPicker.disabled,
		};
	});
}

/** The ids of the items of the first <lcty-conv-list> (also inside a sidebar), in order. */
function listIds(page, inSidebar = false) {
	return page.evaluate((inSidebar) => {
		const list = inSidebar
			? document.querySelector("lcty-sidebar").list
			: document.querySelector("lcty-conv-list");
		return [...list.querySelectorAll("a[data-id]")].map((a) => a.dataset.id);
	}, inSidebar);
}

const meta = (id, day, extra = {}) => ({
	id,
	title: `Conversation ${id}`,
	created_at: "2026-11-01T00:00:00.000Z",
	updated_at_hint: `2026-11-${day}T00:00:00.000Z`,
	setup_tags: [],
	tags_hint: [],
	messages_hint: 1,
	...extra,
});

/** Create the database "lcty_c" at version 1 with c_meta holding items, as lcty_c.worker.js leaves it. */
function seedCMeta(page, items) {
	return page.evaluate(
		(items) =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_c", 1);
				req.onupgradeneeded = () => {
					const store = req.result.createObjectStore("c_meta", {
						keyPath: "id",
					});
					for (const item of items) store.put(item);
				};
				req.onsuccess = () => {
					req.result.close();
					resolve();
				};
				req.onerror = () => reject(req.error);
			}),
		items,
	);
}

function databaseExists(page) {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const req = indexedDB.open("lcty_c");
				req.onupgradeneeded = () => req.transaction.abort();
				req.onerror = () =>
					req.error?.name === "AbortError" ? resolve(false) : reject(req.error);
				req.onsuccess = () => {
					req.result.close();
					resolve(true);
				};
			}),
	);
}

async function whenSidebarPut(page) {
	await test.step("When a <lcty-sidebar> is put into the body", () =>
		page.evaluate(() =>
			document.body.append(document.createElement("lcty-sidebar")),
		));
}

// ---- lcty.v1.js and lcty.v1.mjs ----

test("lcty.v1.js is lcty.v1.mjs converted by the command in its head", async ({
	page,
	context,
}) => {
	await background(page, context);
	let files;
	await test.step("When /c/lcty.v1.mjs and /c/lcty.v1.js are fetched", async () => {
		files = await page.evaluate(async () => {
			const get = async (url) => {
				const res = await fetch(url, { cache: "no-store" });
				if (!res.ok) throw new Error(`${url}: ${res.status}`);
				return res.text();
			};
			return {
				mjs: await get("/c/lcty.v1.mjs"),
				js: await get("/c/lcty.v1.js"),
			};
		});
	});
	await test.step('Then lcty.v1.mjs\'s head comment holds the command that turns "export" at a line start into "/*export*/" and drops "//?" at a line start', () => {
		const head = files.mjs.split("\n").slice(0, 8).join("\n");
		expect(head).toContain(
			`ruby -E UTF-8 -e 'puts ARGF.read.gsub(/^export/, "/*export*/").gsub(%r[^//\\?], "")' lcty.v1.mjs >lcty.v1.js`,
		);
	});
	await test.step("And lcty.v1.js is lcty.v1.mjs with those two replacements, ending with a newline", () => {
		// the same as bin/prepare-commit.sh; Ruby's puts adds a newline unless the text ends with one
		let converted = files.mjs
			.replace(/^export/gm, "/*export*/")
			.replace(/^\/\/\?/gm, "");
		if (!converted.endsWith("\n")) converted += "\n";
		expect(files.js).toBe(converted);
	});
});

test("lcty.v1.js defines the elements with the classes it declares", async ({
	page,
	context,
}) => {
	await background(page, context);
	let defined;
	await test.step('Then "lcty-conv-list", "lcty-sidebar", "lcty-c", "lcty-setup", "lcty-message", "lcty-composer" and "lcty-t" are defined', async () => {
		defined = await page.evaluate((elements) => {
			// the classes are global lexical bindings of the classic script, reachable by name only
			const classes = {
				LctyConvListElement,
				LctySidebarElement,
				LctyCElement,
				LctySetupElement,
				LctyMessageElement,
				LctyComposerElement,
				LctyTElement,
			};
			return elements.map(([name, cls]) => [
				name,
				typeof customElements.get(name),
				customElements.get(name) === classes[cls],
			]);
		}, ELEMENTS);
		expect(defined.map(([name, type]) => [name, type])).toEqual(
			ELEMENTS.map(([name]) => [name, "function"]),
		);
	});
	await test.step("And each is defined by its global class: LctyConvListElement, LctySidebarElement, LctyCElement, LctySetupElement, LctyMessageElement, LctyComposerElement and LctyTElement", () => {
		expect(defined.every(([, , same]) => same)).toBe(true);
	});
	await test.step('And "lcty-cmd" is not defined', async () => {
		expect(
			await page.evaluate(() => customElements.get("lcty-cmd") === undefined),
		).toBe(true);
	});
});

test("lcty.v1.mjs defines nothing by itself and defineLctyV1CustomElements defines the elements in a registry", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("When /c/lcty.v1.mjs is imported as a module", () =>
		page.evaluate(async () => {
			window.mod = await import("/c/lcty.v1.mjs");
		}));
	await test.step("Then it exports LctyT, the seven element classes and defineLctyV1CustomElements", async () => {
		expect(await page.evaluate(() => Object.keys(window.mod).sort())).toEqual(
			[
				"LctyT",
				...ELEMENTS.map(([, cls]) => cls),
				"defineLctyV1CustomElements",
			].sort(),
		);
	});
	await test.step('And "lcty-c" is still defined by the global LctyCElement', async () => {
		expect(
			await page.evaluate(
				() =>
					customElements.get("lcty-c") === LctyCElement &&
					window.mod.LctyCElement !== LctyCElement,
			),
		).toBe(true);
	});
	let defined;
	await test.step("When defineLctyV1CustomElements is given a registry that records what is defined", async () => {
		defined = await page.evaluate(() => {
			const seen = [];
			window.mod.defineLctyV1CustomElements({
				define: (name, cls) => seen.push([name, cls]),
			});
			return seen.map(([name, cls]) => [
				name,
				Object.entries(window.mod).find(([, v]) => v === cls)?.[0] ?? null,
			]);
		});
	});
	await test.step('Then the registry is given "lcty-conv-list", "lcty-sidebar", "lcty-c", "lcty-setup", "lcty-message", "lcty-composer" and "lcty-t", in that order, with the module\'s classes', () => {
		expect(defined).toEqual(ELEMENTS);
	});
});

// ---- LctyT ----

test("LctyT._ returns the text of the page's language", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenJapanese(page);
	let result;
	await test.step('When LctyT._("stop", "Stop") is called', async () => {
		result = await page.evaluate(() => LctyT._("stop", "Stop"));
	});
	await test.step('Then it returns "停止"', () => {
		expect(result).toBe("停止");
	});
	await test.step('And with the language "en" given, it returns "Stop"', async () => {
		expect(await page.evaluate(() => LctyT._("stop", "Stop", "en"))).toBe(
			"Stop",
		);
	});
});

for (const [kase, key, lang, result] of [
	["a translated key", "word", "xx", "Word"],
	["an empty translation", "empty", "xx", "Text"],
	["a missing key", "other", "xx", "Text"],
	["a key inherited from Object", "toString", "xx", "Text"],
	["a language that is not registered", "word", "yy", "Text"],
	["a language inherited from Object", "word", "constructor", "Text"],
]) {
	test(`LctyT._ falls back to the given text (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await test.step('Given LctyT.addLang("xx", {"word": "Word", "empty": ""}) has been called', () =>
			page.evaluate(() => LctyT.addLang("xx", { word: "Word", empty: "" })));
		let out;
		await test.step(`When LctyT._("${key}", "Text", "${lang}") is called`, async () => {
			out = await page.evaluate(
				([key, lang]) => LctyT._(key, "Text", lang),
				[key, lang],
			);
		});
		await test.step(`Then it returns "${result}"`, () => {
			expect(out).toBe(result);
		});
	});
}

test("LctyT._ without a text shows undefined", async ({ page, context }) => {
	await background(page, context);
	let out;
	await test.step('When LctyT._("noSuchKey") is called', async () => {
		out = await page.evaluate(() => LctyT._("noSuchKey"));
	});
	await test.step('Then it returns "undefined"', () => {
		expect(out).toBe("undefined");
	});
});

test("A registered table is frozen", async ({ page, context }) => {
	await background(page, context);
	await test.step('When LctyT.addLang("xx", {"word": "Word"}) is called', () =>
		page.evaluate(() => LctyT.addLang("xx", { word: "Word" })));
	await test.step("Then LctyT.dicts.xx is frozen", async () => {
		expect(await page.evaluate(() => Object.isFrozen(LctyT.dicts.xx))).toBe(
			true,
		);
	});
	await test.step('And assigning "Other" to its "word" leaves LctyT._("word", "Text", "xx") returning "Word"', async () => {
		expect(
			await page.evaluate(() => {
				try {
					LctyT.dicts.xx.word = "Other";
				} catch {}
				return LctyT._("word", "Text", "xx");
			}),
		).toBe("Word");
	});
});

// ---- <lcty-setup> ----

test("The system prompt is shown collapsed", async ({ page, context }) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-setup data-instructions="Be brief.&#10;Use Ruby."></lcty-setup>',
	);
	let shadow;
	await test.step('Then its Shadow DOM is a closed <details> (part lcty-setup__details) holding the <summary> "System prompt" (part lcty-setup__summary) and a <pre> (part lcty-setup__text)', async () => {
		shadow = await page.evaluate(() => {
			const s = document.querySelector("lcty-setup");
			const [details, ...rest] = s.shadowRoot.children;
			return {
				rest: rest.length,
				details: [
					details.localName,
					details.open,
					details.getAttribute("part"),
				],
				children: [...details.children].map((e) => [
					e.localName,
					e.getAttribute("part"),
				]),
				summary: details.querySelector("summary").textContent,
				isText: details.querySelector("pre") === s.text,
				text: s.text.textContent,
			};
		});
		expect(shadow.rest).toBe(0);
		expect(shadow.details).toEqual(["details", false, "lcty-setup__details"]);
		expect(shadow.children).toEqual([
			["summary", "lcty-setup__summary"],
			["pre", "lcty-setup__text"],
		]);
		expect(shadow.summary).toBe("System prompt");
	});
	await test.step('And the <pre> is its field text and reads "Be brief.\\nUse Ruby."', () => {
		expect(shadow.isText).toBe(true);
		expect(shadow.text).toBe("Be brief.\nUse Ruby.");
	});
});

for (const [kase, attributes, text] of [
	[
		"base64 alone",
		'data-instructions-base64="G1sxbeaXpeacrOiqng=="',
		"\\u001b[1m日本語",
	],
	[
		"base64 over the plain",
		'data-instructions="plain" data-instructions-base64="AW9r"',
		"\\u0001ok",
	],
	["a leading BOM", 'data-instructions-base64="77u/eA=="', "\\ufeffx"],
	[
		"an empty base64",
		'data-instructions="plain" data-instructions-base64=""',
		"",
	],
	[
		"base64 that is invalid",
		'data-instructions="plain" data-instructions-base64="!!!"',
		"",
	],
	[
		"bytes that are not UTF-8",
		'data-instructions="plain" data-instructions-base64="/w=="',
		"",
	],
	["no attribute", 'class="none"', ""],
]) {
	test(`The system prompt is read from data-instructions-base64 when it is there (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenBody(page, `<lcty-setup ${attributes}></lcty-setup>`);
		await test.step(`Then its text reads "${text}"`, async () => {
			expect(await setupText(page)).toBe(json(text));
		});
	});
}

test("Changing the attributes changes the system prompt", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, '<lcty-setup data-instructions="first"></lcty-setup>');
	for (const [line, name, value, text] of [
		[
			'When data-instructions is set to "second"',
			"data-instructions",
			"second",
			"second",
		],
		[
			'When data-instructions-base64 is set to "AW9r"',
			"data-instructions-base64",
			"AW9r",
			"\\u0001ok",
		],
		[
			"When data-instructions-base64 is removed",
			"data-instructions-base64",
			null,
			"second",
		],
	]) {
		await test.step(line, () => setAttr(page, "lcty-setup", name, value));
		await test.step(`Then its text reads "${text}"`, async () => {
			expect(await setupText(page)).toBe(json(text));
		});
	}
});

// ---- <lcty-message> ----

/** The Shadow DOM of the message as plain values. */
function messageOf(page) {
	return page.evaluate(() => {
		const m = window.created || document.querySelector("lcty-message");
		const part = (e) => e?.getAttribute("part") ?? null;
		const head = m.shadowRoot.querySelector('[part="lcty-message__head"]');
		const actions = head
			? [...head.querySelector('[part="lcty-message__actions"]').children]
			: [];
		return {
			children: [...m.shadowRoot.children].map((e) => part(e) ?? e.localName),
			footHidden: m.foot.hidden,
			who: [m.who.textContent, part(m.who), head?.contains(m.who)],
			actions: actions.map((b) => [b.textContent, part(b), b.type]),
			fields: {
				undo: m.undoButton ? actions.indexOf(m.undoButton) : null,
				fork: m.forkButton ? actions.indexOf(m.forkButton) : null,
				regenerate: m.regenerateButton
					? actions.indexOf(m.regenerateButton)
					: null,
				thinking: m.thinking === null,
				thinkingSummary: m.thinkingSummary === null,
				thinkingBody: m.thinkingBody === null,
			},
			thinking: m.thinking && {
				tag: m.thinking.localName,
				open: m.thinking.open,
				hidden: m.thinking.hidden,
				children: [...m.thinking.children].map((e) => [e.localName, part(e)]),
				fields:
					m.thinking.children[0] === m.thinkingSummary &&
					m.thinking.children[1] === m.thinkingBody,
			},
			slotted: m.shadowRoot
				.querySelector("slot")
				.assignedElements()
				.map((e) => `${e.localName}.${e.className}`),
			details: m.shadowRoot.querySelectorAll("details").length,
		};
	});
}

test("A user message has a head with undo and fork, its content and a hidden foot", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-message data-role="user"><div class="user-text">Hi</div></lcty-message>',
	);
	const m = await messageOf(page);
	await test.step("Then its Shadow DOM is the head (part lcty-message__head), a <slot> and the foot (part lcty-message__foot), which is hidden", () => {
		expect(m.children).toEqual([
			"lcty-message__head",
			"slot",
			"lcty-message__foot",
		]);
		expect(m.footHidden).toBe(true);
	});
	await test.step('And the head holds the who "You" (part lcty-message__who) and the actions (part lcty-message__actions) "Undo" and "Fork from here"', () => {
		expect(m.who).toEqual(["You", "lcty-message__who", true]);
		expect(m.actions.map(([text]) => text)).toEqual(["Undo", "Fork from here"]);
	});
	await test.step('And the actions are its fields undoButton and forkButton, with the parts "lcty-message__action lcty-message__action--undo lcty-button" and "lcty-message__action lcty-message__action--fork lcty-button"', () => {
		expect([m.fields.undo, m.fields.fork]).toEqual([0, 1]);
		expect(m.actions.map(([, part, type]) => [part, type])).toEqual([
			["lcty-message__action lcty-message__action--undo lcty-button", "button"],
			["lcty-message__action lcty-message__action--fork lcty-button", "button"],
		]);
	});
	await test.step("And its fields regenerateButton, thinking, thinkingSummary and thinkingBody are null", () => {
		expect(m.fields.regenerate).toBe(null);
		expect([
			m.fields.thinking,
			m.fields.thinkingSummary,
			m.fields.thinkingBody,
		]).toEqual([true, true, true]);
	});
	await test.step("And the <slot> shows the div.user-text", () => {
		expect(m.slotted).toEqual(["div.user-text"]);
	});
});

test("An assistant message has a head with regenerate and a hidden thinking", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-message data-role="assistant"><article>Hello</article></lcty-message>',
	);
	const m = await messageOf(page);
	await test.step("Then its Shadow DOM is the head, the thinking (part lcty-message__thinking), a <slot> and the foot", () => {
		expect(m.children).toEqual([
			"lcty-message__head",
			"lcty-message__thinking",
			"slot",
			"lcty-message__foot",
		]);
		expect(m.slotted).toEqual(["article."]);
	});
	await test.step('And the head holds the who "Assistant" and the action "Regenerate", its field regenerateButton, with the part "lcty-message__action lcty-message__action--regenerate lcty-button"', () => {
		expect(m.who[0]).toBe("Assistant");
		expect(m.actions).toEqual([
			[
				"Regenerate",
				"lcty-message__action lcty-message__action--regenerate lcty-button",
				"button",
			],
		]);
		expect(m.fields.regenerate).toBe(0);
	});
	await test.step("And its fields undoButton and forkButton are null", () => {
		expect([m.fields.undo, m.fields.fork]).toEqual([null, null]);
	});
	await test.step("And the thinking is a closed, hidden <details> holding a <summary> (part lcty-message__thinking-summary) and a <div> (part lcty-message__thinking-body)", () => {
		expect(m.thinking).toEqual({
			tag: "details",
			open: false,
			hidden: true,
			children: [
				["summary", "lcty-message__thinking-summary"],
				["div", "lcty-message__thinking-body"],
			],
			fields: true,
		});
	});
});

async function givenCreatedMessage(page) {
	await test.step("Given a <lcty-message> is created without a role", () =>
		page.evaluate(() => {
			window.created = document.createElement("lcty-message");
			document.body.append(window.created);
		}));
}

test("Setting the role rebuilds the head and replaces the fields", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenCreatedMessage(page);
	await test.step("Then its who is empty and it has no actions", async () => {
		const m = await messageOf(page);
		expect(m.who[0]).toBe("");
		expect(m.actions).toEqual([]);
	});
	await test.step('When data-role is set to "user"', async () => {
		await page.evaluate(() => {
			window.oldHead = window.created.shadowRoot.firstElementChild;
		});
		await setAttr(page, "lcty-message", "data-role", "user");
	});
	await test.step('Then its Shadow DOM is built again, with the actions "Undo" and "Fork from here"', async () => {
		const m = await messageOf(page);
		expect(m.actions.map(([text]) => text)).toEqual(["Undo", "Fork from here"]);
		expect([m.fields.undo, m.fields.fork]).toEqual([0, 1]);
		expect(await page.evaluate(() => window.oldHead.isConnected)).toBe(false);
	});
	await test.step('When data-role is set to "assistant"', async () => {
		await page.evaluate(() => {
			window.oldHead = window.created.shadowRoot.firstElementChild;
		});
		await setAttr(page, "lcty-message", "data-role", "assistant");
	});
	await test.step('Then its Shadow DOM is built again, with the action "Regenerate", and undoButton is null', async () => {
		const m = await messageOf(page);
		expect(m.actions.map(([text]) => text)).toEqual(["Regenerate"]);
		expect(m.fields.undo).toBe(null);
		expect(await page.evaluate(() => window.oldHead.isConnected)).toBe(false);
	});
});

for (const [kase, attributes, shown, summary, body] of [
	[
		"data-thinking",
		'data-thinking="abc"',
		"shown",
		"Thinking (3 characters)",
		"abc",
	],
	[
		"base64 over the plain",
		'data-thinking="plain" data-thinking-base64="AW9r"',
		"shown",
		"Thinking (3 characters)",
		"\\u0001ok",
	],
	[
		"a leading BOM",
		'data-thinking-base64="77u/eA=="',
		"shown",
		"Thinking (2 characters)",
		"\\ufeffx",
	],
	[
		"base64 that is invalid",
		'data-thinking="plain" data-thinking-base64="!!!"',
		"hidden",
		"Thinking (0 characters)",
		"",
	],
	[
		"an empty data-thinking",
		'data-thinking=""',
		"hidden",
		"Thinking (0 characters)",
		"",
	],
]) {
	test(`A reply's thinking is shown from its attributes (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenBody(
			page,
			`<lcty-message data-role="assistant" ${attributes}></lcty-message>`,
		);
		await test.step(`Then the thinking is ${shown}, with the summary "${summary}" and the body "${body}"`, async () => {
			expect(await thinkingOf(page)).toEqual({
				hidden: shown === "hidden",
				summary,
				body: json(body),
			});
		});
	});
}

test("A thinking set before the role is shown once the role is assistant", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenCreatedMessage(page);
	await test.step('And data-thinking is set to "abc"', () =>
		setAttr(page, "lcty-message", "data-thinking", "abc"));
	await test.step('When data-role is set to "assistant"', () =>
		setAttr(page, "lcty-message", "data-role", "assistant"));
	await test.step('Then the thinking is shown, with the summary "Thinking (3 characters)" and the body "abc"', async () => {
		expect(await thinkingOf(page)).toEqual({
			hidden: false,
			summary: "Thinking (3 characters)",
			body: "abc",
		});
	});
});

test("A user message never shows a thinking", async ({ page, context }) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-message data-role="user" data-thinking="abc"></lcty-message>',
	);
	const m = await messageOf(page);
	await test.step("Then its Shadow DOM has no <details>", () => {
		expect(m.details).toBe(0);
	});
	await test.step("And its field thinking is null", () => {
		expect(m.fields.thinking).toBe(true);
	});
});

for (const [kase, attributes, status, info, foot] of [
	["completed", 'data-status="completed"', "", "hidden", "hidden"],
	["stopped", 'data-status="incomplete"', "Stopped", "hidden", "shown"],
	[
		"failed",
		'data-status="incomplete" data-error="Timeout"',
		"Error: Timeout",
		"hidden",
		"shown",
	],
	[
		"an error of a completed",
		'data-status="completed" data-error="Timeout"',
		"",
		"hidden",
		"hidden",
	],
	[
		"timings",
		'data-status="completed" data-timings="{}"',
		"",
		"shown",
		"shown",
	],
	["client", 'data-status="completed" data-client="{}"', "", "shown", "shown"],
]) {
	test(`The foot shows why a reply ended and the timings button (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenBody(
			page,
			`<lcty-message data-role="assistant" ${attributes}></lcty-message>`,
		);
		await thenFoot(page, status, info, foot);
	});
}

test("The foot follows its attributes as they change", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-message data-role="assistant" data-status="incomplete"></lcty-message>',
	);
	await test.step('When data-status is set to "completed"', () =>
		setAttr(page, "lcty-message", "data-status", "completed"));
	await thenFoot(page, "", "hidden", "hidden");
	await test.step('When data-timings is set to "{}"', () =>
		setAttr(page, "lcty-message", "data-timings", "{}"));
	await thenFoot(page, "", "shown", "shown");
});

test("The ⓘ opens the timings popover", async ({ page, context }) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-message data-role="assistant" data-timings="{}"></lcty-message>',
	);
	await test.step('Then the ⓘ is its field info, a button labelled "Timings" whose popovertarget is "timings"', async () => {
		expect(
			await page.evaluate(() => {
				const m = document.querySelector("lcty-message");
				return [
					m.info.localName,
					m.info.type,
					m.info.textContent,
					m.info.getAttribute("aria-label"),
					m.info.getAttribute("popovertarget"),
					m.info.getAttribute("part"),
					m.foot.contains(m.info),
				];
			}),
		).toEqual([
			"button",
			"button",
			"ⓘ",
			"Timings",
			"timings",
			"lcty-message__info",
			true,
		]);
	});
	await test.step('And its field timings is the <div id="timings"> with popover="auto" (part lcty-message__timings)', async () => {
		expect(
			await page.evaluate(() => {
				const m = document.querySelector("lcty-message");
				return [
					m.timings === m.shadowRoot.getElementById("timings"),
					m.timings.localName,
					m.timings.getAttribute("popover"),
					m.timings.getAttribute("part"),
				];
			}),
		).toEqual([true, "div", "auto", "lcty-message__timings"]);
	});
	await test.step("When the ⓘ is clicked", () =>
		page.evaluate(() => document.querySelector("lcty-message").info.click()));
	await test.step("Then the timings popover is open", async () => {
		expect(
			await page.evaluate(() =>
				document.querySelector("lcty-message").timings.matches(":popover-open"),
			),
		).toBe(true);
	});
});

// ---- <lcty-composer> ----

test("The composer is a form with a textarea, a send button and a stop button", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, "<lcty-composer></lcty-composer>");
	let c;
	await test.step("Then its Shadow DOM is its field form (part lcty-composer__form)", async () => {
		c = await page.evaluate(() => {
			const el = document.querySelector("lcty-composer");
			const [input, buttons] = el.form.children;
			return {
				roots: [...el.shadowRoot.children].map((e) => e === el.form),
				form: [el.form.localName, el.form.getAttribute("part")],
				input: {
					same: input === el.input,
					tag: input.localName,
					rows: input.getAttribute("rows"),
					placeholder: input.placeholder,
					part: input.getAttribute("part"),
				},
				buttons: {
					tag: buttons.localName,
					part: buttons.getAttribute("part"),
					same: [
						buttons.children[0] === el.sendButton,
						buttons.children[1] === el.stopButton,
					],
					items: [...buttons.children].map((b) => [
						b.type,
						b.textContent,
						b.getAttribute("part"),
					]),
				},
				sheets: el.shadowRoot.adoptedStyleSheets.map((s) =>
					[...s.cssRules].map((r) => r.selectorText),
				),
			};
		});
		expect(c.roots).toEqual([true]);
		expect(c.form).toEqual(["form", "lcty-composer__form"]);
	});
	await test.step('And the form holds its field input, a <textarea> with 2 rows, the placeholder "Message (Enter to send, Shift+Enter for a new line)" and the part lcty-composer__input', () => {
		expect(c.input).toEqual({
			same: true,
			tag: "textarea",
			rows: "2",
			placeholder: "Message (Enter to send, Shift+Enter for a new line)",
			part: "lcty-composer__input",
		});
	});
	await test.step('And then a <div> (part lcty-composer__buttons) holding its field sendButton, the submit button "Send" (part "lcty-composer__send lcty-button lcty-button--primary"), and its field stopButton, the button "Stop" (part "lcty-composer__stop lcty-button")', () => {
		expect(c.buttons).toEqual({
			tag: "div",
			part: "lcty-composer__buttons",
			same: [true, true],
			items: [
				[
					"submit",
					"Send",
					"lcty-composer__send lcty-button lcty-button--primary",
				],
				["button", "Stop", "lcty-composer__stop lcty-button"],
			],
		});
	});
	await test.step("And its Shadow DOM adopts one style sheet, which styles the textarea", () => {
		expect(c.sheets).toEqual([["textarea"]]);
	});
});

// ---- <lcty-c> ----

test("The frame holds the sidebar, the header, the messages, the dock, the memory dialog and the end", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the document\'s title is "My chat"', () =>
		page.evaluate(() => {
			document.title = "My chat";
		}));
	await givenBody(
		page,
		'<lcty-c id="c-conv"></lcty-c>',
		'And the body holds <lcty-c id="c-conv"></lcty-c>',
	);
	let f;
	await test.step("Then its Shadow DOM is lcty-sidebar#sidebar, header#conv-header, <slot>, div#log-spacer, div#dock, dialog#memory-dialog and the end (part lcty-c__end)", async () => {
		f = await page.evaluate(() => {
			const c = document.querySelector("lcty-c");
			const sel = (e) =>
				e.id
					? `${e.localName}#${e.id}`
					: `${e.localName}[${e.getAttribute("part") ?? ""}]`;
			const header = c.shadowRoot.getElementById("conv-header");
			const float = c.shadowRoot.getElementById("float");
			return {
				children: [...c.shadowRoot.children].map(sel),
				end: c.shadowRoot.lastElementChild.getAttribute("part"),
				header: [...header.children].map((e) =>
					["titleInput", "tags", "proposeMemoryButton", "deleteButton"].find(
						(f) => c[f] === e,
					),
				),
				tags: [...c.tags.children].map((e) =>
					["tagList", "tagPicker"].find((f) => c[f] === e),
				),
				texts: [
					c.proposeMemoryButton.textContent,
					c.deleteButton.textContent,
					c.toEndButton.textContent,
					c.titleInput.placeholder,
				],
				dock: [...c.dock.children].map((e) =>
					e === c.composer ? "composer" : sel(e),
				),
				float: [...float.children].map((e) =>
					e === c.toEndButton ? "toEndButton" : `${sel(e)}${e.name}`,
				),
				fields: [
					c.sidebar === c.shadowRoot.getElementById("sidebar"),
					c.dock === c.shadowRoot.getElementById("dock"),
					c.memoryDialog === c.shadowRoot.getElementById("memory-dialog"),
				],
				title: c.titleInput.value,
				exports: [
					c.sidebar.getAttribute("exportparts"),
					c.composer.getAttribute("exportparts"),
				],
			};
		});
		expect(f.children).toEqual([
			"lcty-sidebar#sidebar",
			"header#conv-header",
			"slot[]",
			"div#log-spacer",
			"div#dock",
			"dialog#memory-dialog",
			"div[lcty-c__end]",
		]);
	});
	await test.step("And the header holds its fields titleInput, tags (holding tagList and tagPicker), proposeMemoryButton and deleteButton", () => {
		expect(f.header).toEqual([
			"titleInput",
			"tags",
			"proposeMemoryButton",
			"deleteButton",
		]);
		expect(f.tags).toEqual(["tagList", "tagPicker"]);
		expect(f.texts).toEqual([
			"Propose memory",
			"Delete",
			"Scroll to bottom",
			"New chat",
		]);
	});
	await test.step('And the dock holds div#float (holding its field toEndButton and <slot name="float">) and its field composer', () => {
		expect(f.dock).toEqual(["div#float", "composer"]);
		expect(f.float).toEqual(["toEndButton", "slot[]float"]);
	});
	await test.step("And its fields sidebar, dock and memoryDialog are those elements", () => {
		expect(f.fields).toEqual([true, true, true]);
	});
	await test.step('And the title field reads "My chat"', () => {
		expect(f.title).toBe("My chat");
	});
	await test.step("And the sidebar exports the parts of the sidebar and its list, and the composer the parts of the composer", () => {
		const names = (s) => s.split(",").map((p) => p.trim());
		expect(names(f.exports[0])).toEqual(
			expect.arrayContaining([
				"lcty-button",
				"lcty-sidebar__nav",
				"lcty-sidebar__search",
				"lcty-sidebar__list",
				"lcty-conv-list__item",
				"lcty-conv-list__item--current",
			]),
		);
		expect(names(f.exports[1])).toEqual([
			"lcty-button",
			"lcty-button--primary",
			"lcty-composer__form",
			"lcty-composer__input",
			"lcty-composer__buttons",
			"lcty-composer__send",
			"lcty-composer__stop",
		]);
	});
});

test("The frame's children are shown through its slots", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the body holds <lcty-c id="c-conv"> with a <lcty-setup>, a <lcty-message> and a <div slot="float">', () =>
		setBody(
			page,
			'<lcty-c id="c-conv"><lcty-setup data-instructions="x"></lcty-setup><lcty-message data-role="user"></lcty-message><div slot="float">cmd</div></lcty-c>',
		));
	let slots;
	await test.step("Then the default <slot> shows the <lcty-setup> and the <lcty-message>", async () => {
		slots = await page.evaluate(() => {
			const c = document.querySelector("lcty-c");
			const names = (s) => s.assignedElements().map((e) => e.localName);
			return {
				main: names(c.shadowRoot.querySelector("slot:not([name])")),
				float: names(c.shadowRoot.querySelector('slot[name="float"]')),
			};
		});
		expect(slots.main).toEqual(["lcty-setup", "lcty-message"]);
	});
	await test.step('And <slot name="float"> shows the <div slot="float">', () => {
		expect(slots.float).toEqual(["div"]);
	});
});

test("The tag chips follow data-setup-tags while there are no tag definitions", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-c id="c-conv" data-setup-tags="ruby  concise"></lcty-c>',
	);
	const t = await tagsOf(page);
	await test.step('Then the tag list holds the chips "ruby" and "concise", neither marked unknown', () => {
		expect(t.chips.map((c) => [c.name, c.text, c.class, c.part])).toEqual([
			["ruby", "ruby", "tag-chip", "lcty-c__tag"],
			["concise", "concise", "tag-chip", "lcty-c__tag"],
		]);
	});
	await test.step('And the chip "ruby" has the title "Search tag:ruby" and a remove button "×" labelled "Remove ruby"', () => {
		expect(t.chips[0].title).toBe("Search tag:ruby");
		expect(t.chips[0].remove).toEqual([
			"×",
			"Remove ruby",
			"lcty-c__tag-remove",
		]);
	});
	await test.step('And the picker has only the option "+ Tag" and is enabled', () => {
		expect(t.options).toEqual([["", "+ Tag"]]);
		expect(t.disabled).toBe(false);
	});
});

test("Tag definitions mark the unknown chips and fill the picker", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-c id="c-conv" data-setup-tags="ruby concise" data-tag-defs="go ruby python"></lcty-c>',
	);
	const t = await tagsOf(page);
	await test.step('Then the chip "concise" is marked unknown, with the class "tag-chip unknown", the part "lcty-c__tag lcty-c__tag--unknown" and the title "Undefined tag"', () => {
		expect(t.chips[1]).toMatchObject({
			name: "concise",
			class: "tag-chip unknown",
			part: "lcty-c__tag lcty-c__tag--unknown",
			title: "Undefined tag",
		});
	});
	await test.step('And the chip "ruby" is not marked unknown', () => {
		expect(t.chips[0]).toMatchObject({
			name: "ruby",
			class: "tag-chip",
			part: "lcty-c__tag",
			title: "Search tag:ruby",
		});
	});
	await test.step('And the picker has the options "+ Tag", "go" and "python" and is enabled', () => {
		expect(t.options).toEqual([
			["", "+ Tag"],
			["go", "go"],
			["python", "python"],
		]);
		expect(t.disabled).toBe(false);
	});
});

test("Defined tags show their display names from data-tag-names", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-c id="c-conv" data-setup-tags="c~23 gone" data-tag-defs="c~23 ruby" data-tag-names="C# Ruby"></lcty-c>',
	);
	const t = await tagsOf(page);
	await test.step('Then the chip "c~23" shows "C#", has the title "Search tag:C#" and a remove button labelled "Remove C#"', () => {
		expect(t.chips[0]).toMatchObject({
			name: "c~23",
			text: "C#",
			class: "tag-chip",
			title: "Search tag:C#",
		});
		expect(t.chips[0].remove[1]).toBe("Remove C#");
	});
	await test.step('And the chip "gone" is marked unknown and shows "gone"', () => {
		expect(t.chips[1]).toMatchObject({
			name: "gone",
			text: "gone",
			class: "tag-chip unknown",
		});
	});
	await test.step('And the picker has the options "+ Tag" and "Ruby", whose value is "ruby"', () => {
		expect(t.options).toEqual([
			["", "+ Tag"],
			["ruby", "Ruby"],
		]);
	});
});

for (const [kase, defs] of [
	["every definition is used", "ruby"],
	["no tag is defined", ""],
]) {
	test(`The picker is disabled when there is no tag to add (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await givenBody(
			page,
			`<lcty-c id="c-conv" data-setup-tags="ruby" data-tag-defs="${defs}"></lcty-c>`,
		);
		await test.step('Then the picker has only the option "+ Tag" and is disabled', async () => {
			const t = await tagsOf(page);
			expect(t.options).toEqual([["", "+ Tag"]]);
			expect(t.disabled).toBe(true);
		});
	});
}

test("Changing data-setup-tags rebuilds the chips", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-c id="c-conv" data-setup-tags="ruby" data-tag-defs="ruby go"></lcty-c>',
	);
	await test.step('When data-setup-tags is set to "go"', () =>
		setAttr(page, "lcty-c", "data-setup-tags", "go"));
	const t = await tagsOf(page);
	await test.step('Then the tag list holds the chip "go" only', () => {
		expect(t.chips.map((c) => c.name)).toEqual(["go"]);
	});
	await test.step('And the picker has the options "+ Tag" and "ruby" and is enabled', () => {
		expect(t.options).toEqual([
			["", "+ Tag"],
			["ruby", "ruby"],
		]);
		expect(t.disabled).toBe(false);
	});
});

test("The frame marks its conversation as the current one in the sidebar", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, '<lcty-c id="c-abc"></lcty-c>');
	let items;
	await test.step('When its sidebar\'s list is shown the conversations "abc" and "def"', async () => {
		items = await page.evaluate(() => {
			const list = document.querySelector("lcty-c").sidebar.list;
			list.show([
				{ id: "abc", title: "A" },
				{ id: "def", title: "D" },
			]);
			return [...list.querySelectorAll("a[data-id]")].map((a) => [
				a.dataset.id,
				a.getAttribute("aria-current"),
				a.getAttribute("part"),
			]);
		});
	});
	await test.step('Then the item "abc" is current, with aria-current="true" and the part "lcty-conv-list__item lcty-conv-list__item--current"', () => {
		expect(items[0]).toEqual([
			"abc",
			"true",
			"lcty-conv-list__item lcty-conv-list__item--current",
		]);
	});
	await test.step('And the item "def" is not current', () => {
		expect(items[1]).toEqual(["def", null, "lcty-conv-list__item"]);
	});
});

test("The frame imports the page's features once, after the page has loaded", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step("Given the body holds two <lcty-c> elements", async () => {
		// parsed with the page, as a conversation file is, so they are connected before the page has loaded
		await openUnitPage(page, context, {
			body: '<lcty-c id="c-one"></lcty-c><lcty-c id="c-two"></lcty-c>',
		});
	});
	await test.step("When the page has loaded", async () => {
		await page.waitForLoadState("load");
		await page.waitForLoadState("networkidle");
	});
	await test.step("Then /c/lcty.v1.module.js has been requested once", () => {
		expect(server.moduleRequests).toBe(1);
	});
});

test('"Scroll to bottom" shows while the end of the page is out of view', async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the body holds <lcty-c id="c-conv"> with a message 3000px tall', () =>
		setBody(
			page,
			'<lcty-c id="c-conv"><lcty-message data-role="user"><div style="height: 3000px">tall</div></lcty-message></lcty-c>',
		));
	const hidden = () =>
		page.evaluate(() => document.querySelector("lcty-c").toEndButton.hidden);
	await test.step('Then the toEndButton "Scroll to bottom" is shown', async () => {
		await expect.poll(hidden).toBe(false);
	});
	await test.step("When it is clicked", () =>
		page.evaluate(() => document.querySelector("lcty-c").toEndButton.click()));
	await test.step("Then the page is scrolled to its bottom", async () => {
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						Math.abs(
							window.scrollY +
								window.innerHeight -
								document.scrollingElement.scrollHeight,
						) <= 1,
				),
			)
			.toBe(true);
	});
	await test.step("And the toEndButton is hidden", async () => {
		await expect.poll(hidden).toBe(true);
	});
});

// ---- <lcty-t> ----

/** The view of <lcty-t> as plain values. */
function tagViewOf(page) {
	return page.evaluate(() => {
		const t = document.querySelector("lcty-t");
		const v = t.view;
		const fields = (sel) =>
			[...v.querySelectorAll(sel)].map((f) => [f.value, f.readOnly]);
		return {
			heading: v.querySelector("h2")?.textContent,
			section: v.querySelector(":scope > section")?.className,
			name: fields(".tag-edit-head input"),
			prompt: fields("label.field textarea"),
			memory: fields(".mem-list textarea"),
			summary: v.querySelector("summary")?.textContent,
			open: v.querySelector("details")?.open,
		};
	});
}

test("A tag file is a page with the sidebar and the tag shown read-only", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given the page has no title", () =>
		page.evaluate(() => {
			document.title = "";
		}));
	await test.step('When the body is given a tag file\'s <lcty-t data-tag="Ruby"> with a prompt and two memory items', () =>
		setBody(
			page,
			'<lcty-t data-tag="Ruby">\n<lcty-system data-tag="Ruby" data-content="be brief"></lcty-system>\n<lcty-memory id="t-mem-a" data-tag="Ruby" data-content="abcd"></lcty-memory>\n<lcty-memory id="t-mem-b" data-tag="Ruby" data-content="efghi"></lcty-memory>\n</lcty-t>',
		));
	await test.step('Then <body> has the class "page" and its children are the sidebar, then <lcty-t>', async () => {
		expect(
			await page.evaluate(() => [
				document.body.className,
				[...document.body.children].map((c) => c.localName),
			]),
		).toEqual(["page", ["lcty-sidebar", "lcty-t"]]);
	});
	await test.step("And the frame's sidebar is that <lcty-sidebar>", async () => {
		expect(
			await page.evaluate(
				() =>
					document.querySelector("lcty-t").sidebar ===
					document.querySelector("lcty-sidebar"),
			),
		).toBe(true);
	});
	await test.step("And the first child of <lcty-t> is its view, div.tag-file-view", async () => {
		expect(
			await page.evaluate(() => {
				const t = document.querySelector("lcty-t");
				return [t.firstElementChild === t.view, t.view.className];
			}),
		).toEqual([true, "tag-file-view"]);
	});
	const view = await tagViewOf(page);
	await test.step('And the view holds the heading "Tags" and a section.tag-edit', () => {
		expect([view.heading, view.section]).toEqual(["Tags", "tag-edit"]);
	});
	await test.step('And the name field reads "Ruby", the prompt field the prompt and the memory fields the two items, all read-only', () => {
		expect([view.name, view.prompt, view.memory]).toEqual([
			[["Ruby", true]],
			[["be brief", true]],
			[
				["abcd", true],
				["efghi", true],
			],
		]);
	});
	await test.step('And the memory summary reads "Memory (2 items, about 9 characters)" and is open', () => {
		expect([view.summary, view.open]).toEqual([
			"Memory (2 items, about 9 characters)",
			true,
		]);
	});
	await test.step('And the page\'s title is "Ruby"', async () => {
		expect(await page.title()).toBe("Ruby");
	});
});

test("The view reads the texts written as base64", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('When the body is given <lcty-t data-tag="x"> whose prompt and memory item are written as data-content-base64', () =>
		setBody(
			page,
			// "a\u001bb" and "é" in UTF-8
			'<lcty-t data-tag="x"><lcty-system data-tag="x" data-content-base64="YRti"></lcty-system><lcty-memory id="t-mem-a" data-tag="x" data-content-base64="w6k="></lcty-memory></lcty-t>',
		));
	await test.step('Then the prompt field reads "a\\u001bb" and the memory field "é"', async () => {
		const view = await tagViewOf(page);
		expect([view.prompt[0][0], view.memory.map(([v]) => v)]).toEqual([
			json("a\\u001bb"),
			["é"],
		]);
	});
});

test("The view of a tag without prompt or memory has empty fields and a closed summary", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('When the body is given <lcty-t data-tag="x"></lcty-t>', () =>
		setBody(page, '<lcty-t data-tag="x"></lcty-t>'));
	const view = await tagViewOf(page);
	await test.step('Then the prompt field is empty, there is no memory field and the summary reads "Memory (0 items, about 0 characters)"', () => {
		expect([view.prompt, view.memory, view.summary]).toEqual([
			[["", true]],
			[],
			"Memory (0 items, about 0 characters)",
		]);
	});
	await test.step("And the summary is closed", () => {
		expect(view.open).toBe(false);
	});
});

test("The frame imports the tag file's features once, after the page has loaded", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step("Given the body holds a tag file's <lcty-t>", async () => {
		// parsed with the page, as a tag file is, so it is connected before the page has loaded
		await openUnitPage(page, context, {
			body: '<lcty-t data-tag="x"><lcty-system data-tag="x" data-content="p"></lcty-system></lcty-t>',
		});
	});
	await test.step("When the page has loaded", async () => {
		await page.waitForLoadState("load");
		await page.waitForLoadState("networkidle");
	});
	await test.step("Then /c/tag-file.js has been requested once", () => {
		expect(server.tagFileRequests).toBe(1);
	});
	await test.step("And /c/lcty.v1.module.js has not been requested", () => {
		expect(server.moduleRequests).toBe(0);
	});
});

// ---- <lcty-conv-list> ----

test("The conversation list shows each conversation as a link", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, "<lcty-conv-list></lcty-conv-list>");
	await test.step('When show() is given "a" titled "Alpha" with 2 messages, the tag "ruby" and a snippet, and "b" without a title for the chunk "0190abcd"', () =>
		page.evaluate(() =>
			document.querySelector("lcty-conv-list").show([
				{
					id: "a",
					title: "Alpha",
					updated_at_hint: "2026-11-02T03:04:05.000Z",
					messages: 2,
					tags: ["ruby"],
					snippet: "a matching line",
				},
				{
					id: "b",
					updated_at_hint: "2026-11-02T03:04:05.000Z",
					chunk_id: "0190abcd",
				},
			]),
		));
	let list;
	await test.step("Then the list is a <ul> (part lcty-conv-list__items) of two <li> (part lcty-conv-list__entry)", async () => {
		list = await page.evaluate(() => {
			const el = document.querySelector("lcty-conv-list");
			const ul = el.firstElementChild;
			const parts = (a) =>
				[...a.querySelectorAll("[part]")].map((e) => [
					e.getAttribute("part"),
					e.children.length ? null : e.textContent,
				]);
			return {
				count: el.children.length,
				ul: [ul.localName, ul.getAttribute("part")],
				lis: [...ul.children].map((li) => [
					li.localName,
					li.getAttribute("part"),
				]),
				links: [...ul.querySelectorAll("a")].map((a) => ({
					href: a.getAttribute("href"),
					id: a.dataset.id,
					chunk: a.dataset.chunk ?? null,
					parts: parts(a),
					chipTitle: a.querySelector(".tag-chip")?.title ?? null,
				})),
			};
		});
		expect(list.count).toBe(1);
		expect(list.ul).toEqual(["ul", "lcty-conv-list__items"]);
		expect(list.lis).toEqual([
			["li", "lcty-conv-list__entry"],
			["li", "lcty-conv-list__entry"],
		]);
	});
	await test.step('And the first is a link to "../c/a.html" with data-id "a" holding the title "Alpha", the snippet, the tag chip "ruby" titled "Search tag:ruby" and the meta "2026-11-02 03:04 · 2 messages"', () => {
		expect(list.links[0]).toEqual({
			href: "../c/a.html",
			id: "a",
			chunk: null,
			parts: [
				["lcty-conv-list__title", "Alpha"],
				["lcty-conv-list__snippet", "a matching line"],
				["lcty-conv-list__tags", null],
				["lcty-conv-list__tag", null],
				["lcty-conv-list__tag-name", "ruby"],
				["lcty-conv-list__meta", "2026-11-02 03:04 · 2 messages"],
			],
			chipTitle: "Search tag:ruby",
		});
	});
	await test.step('And the second is a link to "../c/b.html#c-msg-0190abcd" with data-chunk "0190abcd" holding the title "(untitled)" and the meta "2026-11-02 03:04"', () => {
		expect(list.links[1]).toEqual({
			href: "../c/b.html#c-msg-0190abcd",
			id: "b",
			chunk: "0190abcd",
			parts: [
				["lcty-conv-list__title", "(untitled)"],
				["lcty-conv-list__meta", "2026-11-02 03:04"],
			],
			chipTitle: null,
		});
	});
});

test("An empty list shows its empty text when it is given one", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, "<lcty-conv-list></lcty-conv-list>");
	const shape = () =>
		page.evaluate(() =>
			[...document.querySelector("lcty-conv-list").children].map((e) => [
				e.localName,
				e.getAttribute("part"),
				e.textContent,
			]),
		);
	await test.step('When show() is given no conversations and the text "No chats"', () =>
		page.evaluate(() =>
			document.querySelector("lcty-conv-list").show([], "No chats"),
		));
	await test.step('Then the list is a <p> (part lcty-conv-list__empty) reading "No chats"', async () => {
		expect(await shape()).toEqual([["p", "lcty-conv-list__empty", "No chats"]]);
	});
	await test.step("When show() is given no conversations and no text", () =>
		page.evaluate(() => document.querySelector("lcty-conv-list").show([])));
	await test.step("Then the list is an empty <ul>", async () => {
		expect(await shape()).toEqual([["ul", "lcty-conv-list__items", ""]]);
	});
});

test("Cached items are shown only until show() has been called", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, "<lcty-conv-list></lcty-conv-list>");
	const call = (method, id) =>
		page.evaluate(
			([method, id]) =>
				document.querySelector("lcty-conv-list")[method]([{ id, title: id }]),
			[method, id],
		);
	await test.step('When showCached() is given the conversation "a"', () =>
		call("showCached", "a"));
	await test.step('Then the list shows "a"', async () => {
		expect(await listIds(page)).toEqual(["a"]);
	});
	await test.step('When show() is given the conversation "b"', () =>
		call("show", "b"));
	await test.step('And showCached() is given the conversation "c"', () =>
		call("showCached", "c"));
	await test.step('Then the list shows "b"', async () => {
		expect(await listIds(page)).toEqual(["b"]);
	});
});

/**
 * Listen to select and tag on the list, and record whether the click's default (following the link) was left to the
 * browser; the click is then canceled at the document so the page stays.
 */
function listenToList(page, cancelSelect) {
	return page.evaluate((cancelSelect) => {
		const list = document.querySelector("lcty-conv-list");
		window.seen = { select: [], tag: [], followed: null };
		list.addEventListener("select", (e) => {
			window.seen.select.push(e.detail);
			if (cancelSelect) e.preventDefault();
		});
		list.addEventListener("tag", (e) => window.seen.tag.push(e.detail));
		document.addEventListener("click", (e) => {
			window.seen.followed = !e.defaultPrevented;
			e.preventDefault();
		});
	}, cancelSelect);
}

function clickIn(page, selector, init) {
	return page.evaluate(
		([selector, init]) =>
			document
				.querySelector("lcty-conv-list")
				.querySelector(selector)
				.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						...init,
					}),
				),
		[selector, init],
	);
}

for (const [kase, handles, how, fired, followed, init] of [
	[
		"handled",
		"cancels",
		"with the primary button",
		'fired with {"id": "a", "chunkId": "c1"}',
		"not followed",
		{ button: 0 },
	],
	[
		"not handled",
		"does not cancel",
		"with the primary button",
		'fired with {"id": "a", "chunkId": "c1"}',
		"followed",
		{ button: 0 },
	],
	[
		"with a modifier",
		"cancels",
		"with Ctrl held",
		"not fired",
		"followed",
		{ button: 0, ctrlKey: true },
	],
	[
		"with the middle button",
		"cancels",
		"with the middle button",
		"not fired",
		"followed",
		{ button: 1 },
	],
]) {
	test(`A click on an item is offered to the page first (${kase})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await test.step('Given the body holds <lcty-conv-list> showing the conversation "a" for the chunk "c1"', async () => {
			await setBody(page, "<lcty-conv-list></lcty-conv-list>");
			await page.evaluate(() =>
				document
					.querySelector("lcty-conv-list")
					.show([{ id: "a", title: "A", chunk_id: "c1" }]),
			);
		});
		await test.step(`And the page ${handles} select`, () =>
			listenToList(page, handles === "cancels"));
		await test.step(`When the item is clicked ${how}`, () =>
			clickIn(page, '[part="lcty-conv-list__title"]', init));
		const seen = await page.evaluate(() => window.seen);
		await test.step(`Then select is ${fired}`, () => {
			expect(seen.select).toEqual(
				fired === "not fired" ? [] : [{ id: "a", chunkId: "c1" }],
			);
		});
		await test.step(`And the link is ${followed}`, () => {
			expect(seen.followed).toBe(followed === "followed");
		});
	});
}

test("A click on a tag chip fires tag instead of select", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the body holds <lcty-conv-list> showing the conversation "a" with the tag "ruby"', async () => {
		await setBody(page, "<lcty-conv-list></lcty-conv-list>");
		await page.evaluate(() =>
			document
				.querySelector("lcty-conv-list")
				.show([{ id: "a", title: "A", tags: ["ruby"] }]),
		);
		await listenToList(page, false);
	});
	let notCanceled;
	await test.step('When the tag name "ruby" is clicked', async () => {
		notCanceled = await clickIn(page, ".tag-name", { button: 0 });
	});
	const seen = await page.evaluate(() => window.seen);
	await test.step('Then tag is fired with {"name": "ruby"}', () => {
		expect(seen.tag).toEqual([{ name: "ruby" }]);
	});
	await test.step("And select is not fired", () => {
		expect(seen.select).toEqual([]);
	});
	await test.step("And the link is not followed", () => {
		// the tag's click stops at the list (the document never sees it), which prevents its default
		expect(notCanceled).toBe(false);
		expect(seen.followed).toBe(null);
	});
});

test("A tag chip shows the display name of its reference", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(
		page,
		'<lcty-conv-list data-tag-defs="c~23 ruby" data-tag-names="C# Ruby"></lcty-conv-list>',
	);
	await test.step('When show() is given "a" with the tags "c~23" and "gone"', () =>
		page.evaluate(() =>
			document
				.querySelector("lcty-conv-list")
				.show([{ id: "a", title: "A", tags: ["c~23", "gone"] }]),
		));
	await test.step('Then the chips show "C#" titled "Search tag:C#" with data-tag "c~23", and "gone" titled "Search tag:gone" with data-tag "gone"', async () => {
		expect(await chips(page)).toEqual([
			["C#", "Search tag:C#", "c~23"],
			["gone", "Search tag:gone", "gone"],
		]);
	});
});

test("Setting the tag names redraws the chips, and a click fires the shown name", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given the body holds <lcty-conv-list> showing the conversation "a" with the tag "c~23"', async () => {
		await setBody(page, "<lcty-conv-list></lcty-conv-list>");
		await page.evaluate(() =>
			document
				.querySelector("lcty-conv-list")
				.show([{ id: "a", title: "A", tags: ["c~23"] }]),
		);
	});
	await test.step('When data-tag-defs is set to "c~23" and data-tag-names to "C#"', () =>
		page.evaluate(() => {
			const list = document.querySelector("lcty-conv-list");
			list.setAttribute("data-tag-defs", "c~23");
			list.setAttribute("data-tag-names", "C#");
		}));
	await test.step('Then the chip shows "C#"', async () => {
		expect((await chips(page)).map(([text]) => text)).toEqual(["C#"]);
	});
	await test.step('When the tag name "C#" is clicked', async () => {
		await listenToList(page, false);
		await clickIn(page, ".tag-name", { button: 0 });
	});
	await test.step('Then tag is fired with {"name": "C#"}', async () => {
		expect((await page.evaluate(() => window.seen)).tag).toEqual([
			{ name: "C#" },
		]);
	});
});

/** The tag chips of <lcty-conv-list>: [shown name, title, data-tag]. */
function chips(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll("lcty-conv-list .tag-chip")].map((c) => [
			c.querySelector(".tag-name").textContent,
			c.title,
			c.dataset.tag,
		]),
	);
}

// ---- <lcty-sidebar> ----

test("The sidebar holds its links, the search box and the list", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenBody(page, "<lcty-sidebar></lcty-sidebar>");
	let s;
	await test.step("Then its Shadow DOM is its field nav, the search box and its field list (part lcty-sidebar__list)", async () => {
		s = await page.evaluate(() => {
			const el = document.querySelector("lcty-sidebar");
			const kids = [...el.shadowRoot.children];
			const nav = [...el.nav.children];
			return {
				roots: [
					kids[0] === el.nav,
					kids[1] === el.searchBox,
					kids[2] === el.list,
					kids.length,
				],
				listPart: el.list.getAttribute("part"),
				navPart: el.nav.getAttribute("part"),
				fields: [
					nav[0] === el.newLink,
					nav[1] === el.tagsButton,
					nav[2] === el.refreshButton,
					nav[3] === el.settingsButton,
				],
				link: [
					el.newLink.textContent,
					el.newLink.getAttribute("href"),
					el.newLink.target,
					el.newLink.rel,
				],
				buttons: nav
					.slice(1)
					.map((b) => [
						b.textContent,
						b.title,
						b.getAttribute("aria-label"),
						b.type,
					]),
				parts: nav.map((e) => e.getAttribute("part")),
				search: {
					box: [...el.searchBox.children].map((e) =>
						e === el.search
							? "search"
							: e === el.searchStatus
								? "searchStatus"
								: e.localName,
					),
					type: el.search.type,
					placeholder: el.search.placeholder,
					label: el.search.getAttribute("aria-label"),
					parts: [
						el.searchBox.getAttribute("part"),
						el.search.getAttribute("part"),
						el.searchStatus.getAttribute("part"),
					],
				},
			};
		});
		expect(s.roots).toEqual([true, true, true, 3]);
		expect(s.listPart).toBe("lcty-sidebar__list");
		expect(s.navPart).toBe("lcty-sidebar__nav");
	});
	await test.step('And the nav holds the link "+ New chat" to "../c/" opening in a new window, and the buttons "Tags", "↻" and "⚙︎" titled "Edit tags", "Reload the list" and "Settings"', () => {
		expect(s.fields).toEqual([true, true, true, true]);
		expect(s.link).toEqual(["+ New chat", "../c/", "_blank", "noopener"]);
		expect(s.buttons).toEqual([
			["Tags", "Edit tags", "Edit tags", "button"],
			["↻", "Reload the list", "Reload the list", "button"],
			["⚙︎", "Settings", "Settings", "button"],
		]);
	});
	await test.step('And they have the parts "lcty-sidebar__new lcty-sidebar__link lcty-button lcty-button--primary", "lcty-sidebar__tags lcty-sidebar__link lcty-button", "lcty-sidebar__refresh lcty-sidebar__link lcty-button" and "lcty-sidebar__settings lcty-sidebar__link lcty-button"', () => {
		expect(s.parts).toEqual([
			"lcty-sidebar__new lcty-sidebar__link lcty-button lcty-button--primary",
			"lcty-sidebar__tags lcty-sidebar__link lcty-button",
			"lcty-sidebar__refresh lcty-sidebar__link lcty-button",
			"lcty-sidebar__settings lcty-sidebar__link lcty-button",
		]);
	});
	await test.step('And the search box holds its field search, a search field with the placeholder "Search chats", and its field searchStatus', () => {
		expect(s.search).toEqual({
			box: ["search", "searchStatus"],
			type: "search",
			placeholder: "Search chats",
			label: "Search chats",
			parts: [
				"lcty-sidebar__search-box",
				"lcty-sidebar__search",
				"lcty-sidebar__search-status",
			],
		});
	});
});

test("The sidebar's list is filled from the snapshot in localStorage", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given localStorage "lcty.meta.v1" holds "a" updated on 2026-11-01, "b" updated on 2026-11-03, "c" updated on 2026-11-03 and a broken entry', () =>
		page.evaluate(
			(items) => localStorage.setItem("lcty.meta.v1", JSON.stringify(items)),
			[
				meta("a", "01", { tags_hint: ["ruby"], messages_hint: 4 }),
				meta("b", "03"),
				null,
				{ id: 5 },
				meta("c", "03"),
			],
		));
	await test.step('And the database "lcty_c" holds "z" in "c_meta"', () =>
		seedCMeta(page, [meta("z", "05")]));
	await whenSidebarPut(page);
	await test.step('Then its list shows "c", "b" and "a", in that order', async () => {
		expect(await listIds(page, true)).toEqual(["c", "b", "a"]);
	});
	await test.step('And the item "a" shows its tags_hint as tags and its messages_hint as the count', async () => {
		expect(
			await page.evaluate(() => {
				const a = document
					.querySelector("lcty-sidebar")
					.list.querySelector('a[data-id="a"]');
				return [
					[...a.querySelectorAll(".tag-name")].map((e) => e.textContent),
					a.querySelector('[part="lcty-conv-list__meta"]').textContent,
				];
			}),
		).toEqual([["ruby"], "2026-11-01 00:00 · 4 messages"]);
	});
});

for (const [snapshot, value] of [
	["is not set", null],
	["holds []", "[]"],
	['holds "not json"', "not json"],
	['holds {"a": 1}', '{"a": 1}'],
]) {
	test(`The sidebar's list is filled from IndexedDB when there is no usable snapshot (${snapshot})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		await test.step(`Given localStorage "lcty.meta.v1" ${snapshot}`, () =>
			page.evaluate((value) => {
				if (value !== null) localStorage.setItem("lcty.meta.v1", value);
			}, value));
		await test.step('And the database "lcty_c" holds "a" updated on 2026-11-01 and "b" updated on 2026-11-03 in "c_meta"', () =>
			seedCMeta(page, [meta("a", "01"), meta("b", "03")]));
		await whenSidebarPut(page);
		await test.step('Then its list shows "b" and "a", in that order', async () => {
			await expect.poll(() => listIds(page, true)).toEqual(["b", "a"]);
		});
	});
}

test("The sidebar names its list's tags from the browser's copy of the tags", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step('Given "t_full" of the database "lcty_t" holds the tag file "00010-c~23.html" named "C#" and "00020-ruby.html" named "Ruby"', () =>
		page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					const req = indexedDB.open("lcty_t", 2); // the schema of lcty_t.worker.js
					req.onupgradeneeded = () => {
						const rows = req.result.createObjectStore("t_full", {
							keyPath: "file",
						});
						rows.put({ file: "00010-c~23.html", name: "C#" });
						rows.put({ file: "00020-ruby.html", name: "Ruby" });
						req.result.createObjectStore("t_set").put({ etag: "e1" }, "set");
					};
					req.onsuccess = () => {
						req.result.close();
						resolve();
					};
					req.onerror = () => reject(req.error);
				}),
		));
	await whenSidebarPut(page);
	await test.step('Then its list\'s data-tag-defs becomes "c~23 ruby" and data-tag-names "C# Ruby"', async () => {
		await expect
			.poll(() =>
				page.evaluate(() => {
					const list = document.querySelector("lcty-sidebar").list;
					return [
						list.getAttribute("data-tag-defs"),
						list.getAttribute("data-tag-names"),
					];
				}),
			)
			.toEqual(["c~23 ruby", "C# Ruby"]);
	});
});

test("The sidebar never creates the database", async ({ page, context }) => {
	await background(page, context);
	await test.step('Given there is no database "lcty_c"', async () => {
		expect(await databaseExists(page)).toBe(false);
	});
	await whenSidebarPut(page);
	await test.step("Then its list is empty", async () => {
		// the sidebar reads asynchronously: give it the time a read takes
		await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
		expect(
			await page.evaluate(
				() => document.querySelector("lcty-sidebar").list.children.length,
			),
		).toBe(0);
	});
	await test.step('And there is still no database "lcty_c"', async () => {
		expect(await databaseExists(page)).toBe(false);
	});
});

// ---- Languages ----

test("The elements' texts follow the page's language", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenJapanese(page);
	let t;
	await test.step('When the body is given <lcty-setup data-instructions="x">, a user message, an assistant message with data-status="incomplete" and data-thinking="abc", <lcty-composer> and <lcty-conv-list> showing an untitled conversation', async () => {
		await setBody(
			page,
			'<lcty-setup data-instructions="x"></lcty-setup><lcty-message data-role="user"></lcty-message><lcty-message data-role="assistant" data-status="incomplete" data-thinking="abc"></lcty-message><lcty-composer></lcty-composer><lcty-conv-list></lcty-conv-list>',
		);
		t = await page.evaluate(() => {
			const [user, assistant] = document.querySelectorAll("lcty-message");
			const composer = document.querySelector("lcty-composer");
			const list = document.querySelector("lcty-conv-list");
			list.show([{ id: "a" }]);
			return {
				summary: document
					.querySelector("lcty-setup")
					.shadowRoot.querySelector("summary").textContent,
				who: [user.who.textContent, assistant.who.textContent],
				status: assistant.statusText.textContent,
				thinking: assistant.thinkingSummary.textContent,
				buttons: [
					composer.sendButton.textContent,
					composer.stopButton.textContent,
				],
				untitled: list.querySelector('[part="lcty-conv-list__title"]')
					.textContent,
			};
		});
	});
	await test.step('Then the system prompt\'s summary reads "システムプロンプト"', () => {
		expect(t.summary).toBe("システムプロンプト");
	});
	await test.step('And the messages\' who read "あなた" and "アシスタント"', () => {
		expect(t.who).toEqual(["あなた", "アシスタント"]);
	});
	await test.step('And the assistant\'s status reads "停止しました" and its thinking "思考（3 文字）"', () => {
		expect([t.status, t.thinking]).toEqual(["停止しました", "思考（3 文字）"]);
	});
	await test.step('And the composer\'s buttons read "送信" and "停止"', () => {
		expect(t.buttons).toEqual(["送信", "停止"]);
	});
	await test.step('And the untitled conversation reads "(無題)"', () => {
		expect(t.untitled).toBe("(無題)");
	});
});
