// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1011: the scenarios of docs/specs/LCTYSP-1011_vector-store.feature that run in Node.js, written by hand. Each
// test has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two
// read side by side.
//
// encodeRecords and FULL_DIM of js/search/vectors.js are pure: they run in Node.js (node-unit.js), with no stand-in.
// The Scenarios of the store (createVectorStore(), whose worker /fuzzy_search.worker.js runs wasm and fetches the
// distribution files) run in the browser, in tests/unit/vectors.spec.js.

import { expect, publicUrl, scenario } from "./node-unit.js";

const { encodeRecords, FULL_DIM } = await import(
	publicUrl("js/search/vectors.js")
);

// the control block of registration: "lctyvLE0", 3072 as uint32 LE, a reserved 0 (LCTYSP-3006)
const CONTROL = "6c637479764c4530" + "000c0000" + "00000000";
const ID = "0190f3a1-7c2e-7abc-8def-0123456789ab";

/** A vector of n Float32 values that are all different and exact. */
const vector = (n, seed = 0) =>
	Array.from({ length: n }, (_, i) => (i - 300) / 8 + seed);

/** Bytes of Float32 LE as hex. */
const f32hex = (values) =>
	Buffer.from(Float32Array.from(values).buffer).toString("hex");

/** encodeRecords of items [{id, vec: values, view?}], as {hex, size, count} or {error}. */
function encode(items) {
	try {
		const { body, size, count } = encodeRecords(
			items.map(({ id, vec, view }) => ({
				id,
				vec: view
					? Float32Array.from({ length: view.length }, (_, i) => i).subarray(
							view.from,
							view.from + 768,
						)
					: Float32Array.from(vec),
			})),
		);
		const hex = Buffer.from(body.buffer, body.byteOffset, body.length).toString(
			"hex",
		);
		return { isUint8Array: body instanceof Uint8Array, hex, size, count };
	} catch (e) {
		return { error: e.message };
	}
}

scenario(
	"A record is the control block, the id and the vector",
	async ({ step }) => {
		const vec = vector(768);
		await step("Given a UUIDv7 id and a vector of 768 Float32 values", () => {
			expect(ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		});
		let result;
		await step("When encodeRecords encodes them", () => {
			result = encode([{ id: ID, vec }]);
		});
		await step(
			"Then it returns a body of 3,104 bytes, the size 3072 and the count 1",
			() => {
				expect(result.isUint8Array).toBe(true);
				expect(result.hex.length / 2).toBe(3104);
				expect(result.size).toBe(3072);
				expect(result.count).toBe(1);
			},
		);
		await step(
			"And the bytes 0 to 15 are 6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00",
			() => {
				expect(result.hex.slice(0, 32)).toBe(
					"6c637479764c4530000c000000000000",
				);
			},
		);
		await step("And the bytes 16 to 31 are the 16 bytes of the id", () => {
			expect(result.hex.slice(32, 64)).toBe(ID.replace(/-/g, ""));
		});
		await step("And the rest is the vector as Float32 LE", () => {
			expect(result.hex.slice(64)).toBe(f32hex(vec));
		});
	},
);

scenario("Records follow each other in the order given", async ({ step }) => {
	const other = "0190f3a1-7c2e-7abc-8def-ba9876543210";
	const items = [
		{ id: ID, vec: vector(768, 1) },
		{ id: other, vec: vector(768, 2) },
		{ id: ID, vec: vector(768, 3) },
	];
	await step(
		"Given three items, the first and the third with the same id",
		() => {
			expect(items[0].id).toBe(items[2].id);
		},
	);
	let result;
	await step("When encodeRecords encodes them", () => {
		result = encode(items);
	});
	await step(
		"Then it returns a body of 9,312 bytes, the size 3072 and the count 3",
		() => {
			expect(result.hex.length / 2).toBe(9312);
			expect(result.size).toBe(3072);
			expect(result.count).toBe(3);
		},
	);
	await step(
		"And each record of 3,104 bytes is the control block, the id and the vector of its item, in order",
		() => {
			items.forEach(({ id, vec }, i) => {
				expect(result.hex.slice(i * 6208, (i + 1) * 6208)).toBe(
					CONTROL + id.replace(/-/g, "") + f32hex(vec),
				);
			});
		},
	);
});

scenario("No items encode to an empty body", async ({ step }) => {
	let result;
	await step("When encodeRecords encodes no items", () => {
		result = encode([]);
	});
	await step(
		"Then it returns a body of 0 bytes, the size 3072 and the count 0",
		() => {
			expect(result).toEqual({
				isUint8Array: true,
				hex: "",
				size: 3072,
				count: 0,
			});
		},
	);
});

scenario(
	"A vector that is a view of a larger array is encoded from its own values",
	async ({ step }) => {
		let item;
		await step(
			"Given an item whose vector is the 768 values from the 11th of a Float32Array of 1,000",
			() => {
				// the array holds 0, 1, …, 999; the view starts at the value 10
				item = { id: ID, view: { length: 1000, from: 10 } };
			},
		);
		let result;
		await step("When encodeRecords encodes it", () => {
			result = encode([item]);
		});
		await step(
			"Then the bytes from 32 are those 768 values as Float32 LE",
			() => {
				expect(result.hex.length / 2).toBe(3104);
				expect(result.hex.slice(64)).toBe(
					f32hex(Array.from({ length: 768 }, (_, i) => i + 10)),
				);
			},
		);
	},
);

for (const dims of [256, 767, 769]) {
	scenario(
		`A vector that does not have 768 dimensions is rejected (${dims})`,
		async ({ step }) => {
			let item;
			await step(`Given an item whose vector has ${dims} values`, () => {
				item = { id: ID, vec: vector(dims) };
			});
			let result;
			await step("When encodeRecords encodes it", () => {
				result = encode([item]);
			});
			await step(`Then it throws "wrong dimensions (${dims} ≠ 768)"`, () => {
				expect(result).toEqual({ error: `wrong dimensions (${dims} ≠ 768)` });
			});
		},
	);
}

scenario("FULL_DIM is the dimension of registration", async ({ step }) => {
	await step("Then FULL_DIM is 768", () => {
		expect(FULL_DIM).toBe(768);
	});
});
