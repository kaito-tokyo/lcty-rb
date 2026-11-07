// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1005: the scenarios of docs/specs/LCTYSP-1005_text-attributes.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by
// side.
//
// js/ui/text-attr.js runs in a real browser on the test server's origin, on the empty page of unit-page.js. The
// element is made in the page from a description of its attributes: a string is written as it is, and { utf8: text }
// as base64 of the UTF-8 bytes of text, as Ruby writes name-base64 (LCTYSP-0003).

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** Make an element with attrs in the page and return textAttr(el, name) for each of names. */
function readAttrs(page, attrs, names) {
	return page.evaluate(
		async ({ attrs, names }) => {
			const { textAttr } = await import("/js/ui/text-attr.js");
			const el = document.createElement("lcty-message");
			for (const [name, value] of Object.entries(attrs)) {
				const v =
					typeof value === "string"
						? value
						: btoa(
								String.fromCharCode(...new TextEncoder().encode(value.utf8)),
							);
				el.setAttribute(name, v);
			}
			document.body.append(el);
			return names.map((name) => textAttr(el, name));
		},
		{ attrs, names },
	);
}

/** The usual three lines: Given the element, When textAttr() reads "data-content", Then it returns expected. */
async function readsDataContent(page, given, attrs, then, expected) {
	let got;
	await test.step(given, () => {});
	await test.step('When textAttr() reads "data-content"', async () => {
		[got] = await readAttrs(page, attrs, ["data-content"]);
	});
	await test.step(then, () => {
		expect(got).toBe(expected);
	});
}

test("A plain attribute is read as it is", async ({ page, context }) => {
	await givenAPage(page, context);
	const text = 'Hello, <world> & "you"\nsecond line';
	await readsDataContent(
		page,
		'Given an element with data-content "Hello, <world> & \\"you\\"\\nsecond line"',
		{ "data-content": text },
		'Then it returns "Hello, <world> & \\"you\\"\\nsecond line"',
		text,
	);
});

test("An empty attribute is the empty string", async ({ page, context }) => {
	await givenAPage(page, context);
	await readsDataContent(
		page,
		'Given an element with data-content ""',
		{ "data-content": "" },
		'Then it returns ""',
		"",
	);
});

test("An element without the attribute has no text", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await readsDataContent(
		page,
		"Given an element without data-content or data-content-base64",
		{},
		"Then it returns null",
		null,
	);
});

for (const { label, text } of [
	{ label: '"a\\u001bb" (ESC between letters)', text: "a\u001bb" },
	{ label: '"\\u0000" (only NUL)', text: "\u0000" },
	{ label: '"日本語\\u0007" (Japanese and BEL)', text: "日本語\u0007" },
	{
		label: '"x\\u{ffff}y\\u{fffe}z" (U+FFFF and U+FFFE)',
		text: "x\u{ffff}y\u{fffe}z",
	},
	{
		label: '"🙂\\u0001\\t\\r\\n" (an emoji, SOH and spaces)',
		text: "🙂\u0001\t\r\n",
	},
]) {
	test(`The base64 form is decoded as UTF-8 (${label})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await readsDataContent(
			page,
			`Given an element with data-content-base64 holding the UTF-8 bytes of ${label}`,
			{ "data-content-base64": { utf8: text } },
			`Then it returns ${label}, byte-exact`,
			text,
		);
	});
}

test("A leading byte order mark of the base64 form is kept", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	await readsDataContent(
		page,
		'Given an element with data-content-base64 holding the UTF-8 bytes of "\\u{feff}\\u0001x"',
		{ "data-content-base64": { utf8: "\u{feff}\u0001x" } },
		'Then it returns "\\u{feff}\\u0001x", byte-exact',
		"\u{feff}\u0001x",
	);
});

test("The base64 form wins over the plain one", async ({ page, context }) => {
	await givenAPage(page, context);
	await readsDataContent(
		page,
		'Given an element with data-content "plain" and data-content-base64 holding the UTF-8 bytes of "a\\u001bb"',
		{ "data-content": "plain", "data-content-base64": { utf8: "a\u001bb" } },
		'Then it returns "a\\u001bb"',
		"a\u001bb",
	);
});

test("An empty base64 form is the empty string", async ({ page, context }) => {
	await givenAPage(page, context);
	await readsDataContent(
		page,
		'Given an element with data-content "plain" and data-content-base64 ""',
		{ "data-content": "plain", "data-content-base64": "" },
		'Then it returns ""',
		"",
	);
});

test("Each name is read from its own attributes", async ({ page, context }) => {
	await givenAPage(page, context);
	let got;
	await test.step('Given an element with data-content "answer" and data-thinking-base64 holding the UTF-8 bytes of "think\\u0002"', () => {});
	await test.step('When textAttr() reads "data-content" and "data-thinking"', async () => {
		got = await readAttrs(
			page,
			{
				"data-content": "answer",
				"data-thinking-base64": { utf8: "think\u0002" },
			},
			["data-content", "data-thinking"],
		);
	});
	await test.step('Then it returns "answer" and "think\\u0002"', () => {
		expect(got).toEqual(["answer", "think\u0002"]);
	});
});

for (const { label, value } of [
	{ label: '"!!!!" (not base64)', value: "!!!!" },
	{ label: '"abcde" (a length base64 cannot have)', value: "abcde" },
	{ label: '"/w==" (the byte ff, not UTF-8)', value: "/w==" },
	{ label: '"wA==" (the byte c0, an incomplete sequence)', value: "wA==" },
	{ label: '"7aCA" (ed a0 80, a surrogate in UTF-8)', value: "7aCA" },
]) {
	test(`A base64 form that cannot be read is no text (${label})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await readsDataContent(
			page,
			`Given an element with data-content "plain" and data-content-base64 ${label}`,
			{ "data-content": "plain", "data-content-base64": value },
			"Then it returns null",
			null,
		);
	});
}
