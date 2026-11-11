// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1005: the scenarios of docs/specs/LCTYSP-1005_text-attributes.feature, written by hand. Each test has the title
// of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// js/convert/text-attr.js runs in Node.js (node-unit.js): textAttr(el, name) only calls el.getAttribute(), so the element is
// a stand-in, an object whose getAttribute() returns the attribute's value or null as an Element's does; no DOM is
// made. The element is described by its attributes: a string is written as it is, and { utf8: text } as base64 of the
// UTF-8 bytes of text, as Ruby writes name-base64 (LCTYSP-0003).

import { expect, publicUrl, scenario } from "./node-unit.js";

const { textAttr, textAttrOf } = await import(
	publicUrl("js/convert/text-attr.js")
);

/** A stand-in for an element with attrs: only getAttribute(), which is all textAttr() reads. */
function element(attrs) {
	const values = new Map(
		Object.entries(attrs).map(([name, value]) => [
			name,
			typeof value === "string"
				? value
				: btoa(String.fromCharCode(...new TextEncoder().encode(value.utf8))),
		]),
	);
	return { getAttribute: (name) => values.get(name) ?? null };
}

/** textAttr(el, name) for each of names, on an element with attrs. */
function readAttrs(attrs, names) {
	const el = element(attrs);
	return names.map((name) => textAttr(el, name));
}

/** The usual three lines: Given the element, When textAttr() reads "data-content", Then it returns expected. */
async function readsDataContent(step, given, attrs, then, expected) {
	let got;
	await step(given);
	await step('When textAttr() reads "data-content"', () => {
		[got] = readAttrs(attrs, ["data-content"]);
	});
	await step(then, () => {
		expect(got).toBe(expected);
	});
}

scenario("A plain attribute is read as it is", async ({ step }) => {
	const text = 'Hello, <world> & "you"\nsecond line';
	await readsDataContent(
		step,
		'Given an element with data-content "Hello, <world> & \\"you\\"\\nsecond line"',
		{ "data-content": text },
		'Then it returns "Hello, <world> & \\"you\\"\\nsecond line"',
		text,
	);
});

scenario("An empty attribute is the empty string", async ({ step }) => {
	await readsDataContent(
		step,
		'Given an element with data-content ""',
		{ "data-content": "" },
		'Then it returns ""',
		"",
	);
});

scenario("An element without the attribute has no text", async ({ step }) => {
	await readsDataContent(
		step,
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
	scenario(
		`The base64 form is decoded as UTF-8 (${label})`,
		async ({ step }) => {
			await readsDataContent(
				step,
				`Given an element with data-content-base64 holding the UTF-8 bytes of ${label}`,
				{ "data-content-base64": { utf8: text } },
				`Then it returns ${label}, byte-exact`,
				text,
			);
		},
	);
}

scenario(
	"A leading byte order mark of the base64 form is kept",
	async ({ step }) => {
		await readsDataContent(
			step,
			'Given an element with data-content-base64 holding the UTF-8 bytes of "\\u{feff}\\u0001x"',
			{ "data-content-base64": { utf8: "\u{feff}\u0001x" } },
			'Then it returns "\\u{feff}\\u0001x", byte-exact',
			"\u{feff}\u0001x",
		);
	},
);

scenario("The base64 form wins over the plain one", async ({ step }) => {
	await readsDataContent(
		step,
		'Given an element with data-content "plain" and data-content-base64 holding the UTF-8 bytes of "a\\u001bb"',
		{ "data-content": "plain", "data-content-base64": { utf8: "a\u001bb" } },
		'Then it returns "a\\u001bb"',
		"a\u001bb",
	);
});

scenario("An empty base64 form is the empty string", async ({ step }) => {
	await readsDataContent(
		step,
		'Given an element with data-content "plain" and data-content-base64 ""',
		{ "data-content": "plain", "data-content-base64": "" },
		'Then it returns ""',
		"",
	);
});

scenario("Each name is read from its own attributes", async ({ step }) => {
	let got;
	await step(
		'Given an element with data-content "answer" and data-thinking-base64 holding the UTF-8 bytes of "think\\u0002"',
	);
	await step('When textAttr() reads "data-content" and "data-thinking"', () => {
		got = readAttrs(
			{
				"data-content": "answer",
				"data-thinking-base64": { utf8: "think\u0002" },
			},
			["data-content", "data-thinking"],
		);
	});
	await step('Then it returns "answer" and "think\\u0002"', () => {
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
	scenario(
		`A base64 form that cannot be read is no text (${label})`,
		async ({ step }) => {
			await readsDataContent(
				step,
				`Given an element with data-content "plain" and data-content-base64 ${label}`,
				{ "data-content": "plain", "data-content-base64": value },
				"Then it returns null",
				null,
			);
		},
	);
}

scenario(
	"textAttrOf writes a text as it is, or as base64 when XML cannot hold it, and textAttr reads it back",
	async ({ step }) => {
		let plain;
		let forbidden;
		await step(
			'When textAttrOf writes "a\\u0009b" and "a\\u0001b" under "data-content"',
			() => {
				plain = textAttrOf("data-content", "a\tb");
				forbidden = textAttrOf("data-content", "a\u0001b");
			},
		);
		await step(
			'Then the first is {"data-content": "a\\u0009b"} and the second has only data-content-base64',
			() => {
				expect(plain).toEqual({ "data-content": "a\tb" });
				expect(Object.keys(forbidden)).toEqual(["data-content-base64"]);
			},
		);
		await step("And textAttr reads each back as it was", () => {
			const read = (attrs) =>
				textAttr({ getAttribute: (n) => attrs[n] ?? null }, "data-content");
			expect([read(plain), read(forbidden)]).toEqual(["a\tb", "a\u0001b"]);
		});
	},
);
