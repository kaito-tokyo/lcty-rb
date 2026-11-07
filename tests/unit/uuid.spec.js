// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1002: the scenarios of docs/specs/LCTYSP-1002_uuid-v7.feature, written by hand. Each test has the title of its
// Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/uuid.js runs in a real browser on the test server's origin, on the empty page of unit-page.js. Values cross as
// JSON, so byte arrays are returned as arrays of numbers.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const ID = "0190f3a1-7c2e-7abc-8def-0123456789ab";
const ID_BYTES = [
	0x01, 0x90, 0xf3, 0xa1, 0x7c, 0x2e, 0x7a, 0xbc, 0x8d, 0xef, 0x01, 0x23, 0x45,
	0x67, 0x89, 0xab,
];

/** uuidv7(...args) in the page, for each of calls (an array of argument lists). */
function makeIds(page, calls) {
	return page.evaluate(async (calls) => {
		const { uuidv7 } = await import("/js/uuid.js");
		return calls.map((args) => uuidv7(...args));
	}, calls);
}

/** uuidToBytes(id, out, off) in the page on size bytes filled with fill; returns the bytes. */
function toBytes(page, id, { size = 16, off = 0, fill = 0 } = {}) {
	return page.evaluate(
		async ({ id, size, off, fill }) => {
			const { uuidToBytes } = await import("/js/uuid.js");
			const out = new Uint8Array(size).fill(fill);
			uuidToBytes(id, out, off);
			return [...out];
		},
		{ id, size, off, fill },
	);
}

/** The milliseconds in the first 48 bits of an id. */
const msOf = (id) => Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);

test("A new id is a canonical UUIDv7", async ({ page, context }) => {
	await givenAPage(page, context);
	let id;
	await test.step("When uuidv7() makes an id", async () => {
		[id] = await makeIds(page, [[]]);
	});
	await test.step("Then it is 36 lowercase characters in the groups 8-4-4-4-12", () => {
		expect(id).toHaveLength(36);
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
	await test.step("And its version is 7 and its variant is 10", () => {
		expect(id[14]).toBe("7");
		expect(Number.parseInt(id[19], 16) >> 2).toBe(0b10);
	});
	await test.step("And UUID_RE accepts it", async () => {
		expect(
			await page.evaluate(
				async (id) => (await import("/js/uuid.js")).UUID_RE.test(id),
				id,
			),
		).toBe(true);
	});
});

for (const { ms, value, start } of [
	{ ms: "0x0123456789ab", value: 0x0123456789ab, start: "01234567-89ab-7" },
	{ ms: "0", value: 0, start: "00000000-0000-7" },
	{ ms: "0xffffffffffff", value: 0xffffffffffff, start: "ffffffff-ffff-7" },
]) {
	test(`The first 48 bits are the milliseconds (${ms})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		let id;
		await test.step(`When uuidv7() makes an id for the milliseconds ${ms}`, async () => {
			[id] = await makeIds(page, [[value]]);
		});
		await test.step(`Then the id starts with "${start}"`, () => {
			expect(id.startsWith(start)).toBe(true);
		});
	});
}

test("Without milliseconds the id is for now", async ({ page, context }) => {
	await givenAPage(page, context);
	let made;
	await test.step("When uuidv7() makes an id without milliseconds", async () => {
		made = await page.evaluate(async () => {
			const { uuidv7 } = await import("/js/uuid.js");
			const before = Date.now();
			const id = uuidv7();
			return { before, id, after: Date.now() };
		});
	});
	await test.step("Then the milliseconds in its first 48 bits are between those before and after the call", () => {
		const ms = msOf(made.id);
		expect(ms).toBeGreaterThanOrEqual(made.before);
		expect(ms).toBeLessThanOrEqual(made.after);
	});
});

test("Ids of later milliseconds sort after earlier ones", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let ids;
	await test.step("When uuidv7() makes ids for the milliseconds 1000, 1001 and 2000", async () => {
		ids = await makeIds(page, [[1000], [1001], [2000]]);
	});
	await test.step("Then they sort as strings in the same order", () => {
		expect([...ids].sort()).toEqual(ids);
		expect(new Set(ids).size).toBe(3);
	});
});

test("Ids of the same millisecond differ", async ({ page, context }) => {
	await givenAPage(page, context);
	let ids;
	await test.step("When uuidv7() makes 100 ids for the millisecond 1000", async () => {
		ids = await makeIds(
			page,
			Array.from({ length: 100 }, () => [1000]),
		);
	});
	await test.step("Then all of them are different", () => {
		expect(new Set(ids).size).toBe(100);
	});
	await test.step('And all of them start with "00000000-03e8-7"', () => {
		for (const id of ids) expect(id.startsWith("00000000-03e8-7")).toBe(true);
	});
});

test("Every id is a valid UUIDv7, whatever its random bits", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let ids;
	await test.step("When uuidv7() makes 1000 ids", async () => {
		ids = await makeIds(
			page,
			Array.from({ length: 1000 }, () => []),
		);
	});
	await test.step("Then UUID_RE accepts every one of them", async () => {
		const rejected = await page.evaluate(async (ids) => {
			const { UUID_RE } = await import("/js/uuid.js");
			return ids.filter((id) => !UUID_RE.test(id));
		}, ids);
		expect(rejected).toEqual([]);
	});
});

for (const { label, value } of [
	{
		label: '"0190f3a1-7c2e-4abc-8def-0123456789ab" (version 4)',
		value: "0190f3a1-7c2e-4abc-8def-0123456789ab",
	},
	{
		label: '"0190f3a1-7c2e-7abc-cdef-0123456789ab" (variant 11)',
		value: "0190f3a1-7c2e-7abc-cdef-0123456789ab",
	},
	{
		label: '"0190F3A1-7C2E-7ABC-8DEF-0123456789AB" (uppercase)',
		value: "0190F3A1-7C2E-7ABC-8DEF-0123456789AB",
	},
	{
		label: '"0190f3a17c2e7abc8def0123456789ab" (no hyphens)',
		value: "0190f3a17c2e7abc8def0123456789ab",
	},
	{
		label: '"0190f3a1-7c2e-7abc-8def-0123456789ab\\n" (a trailing newline)',
		value: "0190f3a1-7c2e-7abc-8def-0123456789ab\n",
	},
	{
		label: '" 0190f3a1-7c2e-7abc-8def-0123456789ab" (a leading space)',
		value: " 0190f3a1-7c2e-7abc-8def-0123456789ab",
	},
	{
		label: '"0190f3a1-7c2e-7abc-8def-0123456789a" (a digit short)',
		value: "0190f3a1-7c2e-7abc-8def-0123456789a",
	},
	{ label: '"" (empty)', value: "" },
	{ label: "null", value: null },
	{ label: "a number", value: 1234 },
]) {
	test(`UUID_RE rejects what is not a canonical UUIDv7 (${label})`, async ({
		page,
		context,
	}) => {
		await givenAPage(page, context);
		await test.step(`Then UUID_RE rejects ${label}`, async () => {
			expect(
				await page.evaluate(
					async (value) => (await import("/js/uuid.js")).UUID_RE.test(value),
					value,
				),
			).toBe(false);
		});
	});
}

test("An id converts to its 16 bytes", async ({ page, context }) => {
	await givenAPage(page, context);
	let bytes;
	await test.step(`Given the id "${ID}"`, () => {});
	await test.step("When uuidToBytes() writes it into 16 bytes at the offset 0", async () => {
		bytes = await toBytes(page, ID);
	});
	await test.step("Then the bytes are 01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab", () => {
		expect(bytes).toEqual(ID_BYTES);
	});
});

test("uuidToBytes() writes only the 16 bytes at the offset", async ({
	page,
	context,
}) => {
	await givenAPage(page, context);
	let bytes;
	await test.step(`Given the id "${ID}"`, () => {});
	await test.step("And 20 bytes that are all ee", () => {});
	await test.step("When uuidToBytes() writes it at the offset 2", async () => {
		bytes = await toBytes(page, ID, { size: 20, off: 2, fill: 0xee });
	});
	await test.step("Then the bytes 2 to 17 are 01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab", () => {
		expect(bytes.slice(2, 18)).toEqual(ID_BYTES);
	});
	await test.step("And the bytes 0, 1, 18 and 19 are still ee", () => {
		expect([bytes[0], bytes[1], bytes[18], bytes[19]]).toEqual([
			0xee, 0xee, 0xee, 0xee,
		]);
	});
});

test("A new id and its bytes agree", async ({ page, context }) => {
	await givenAPage(page, context);
	let id;
	let bytes;
	await test.step("When uuidv7() makes an id for the milliseconds 0x0123456789ab", async () => {
		[id] = await makeIds(page, [[0x0123456789ab]]);
	});
	await test.step("And uuidToBytes() writes it into 16 bytes at the offset 0", async () => {
		bytes = await toBytes(page, id);
	});
	await test.step("Then the bytes as lowercase hex are the id without its hyphens", () => {
		expect(bytes.map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(
			id.replace(/-/g, ""),
		);
	});
	await test.step("And the bytes 0 to 5 are 01 23 45 67 89 ab", () => {
		expect(bytes.slice(0, 6)).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
	});
});
