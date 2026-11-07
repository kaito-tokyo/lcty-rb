// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1004: the scenarios of docs/specs/LCTYSP-1004_common.feature that need no browser, written by hand. Each test
// has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read
// side by side. The Scenarios that need the page (query(), showToast(), the settings in localStorage and the indexer)
// are in common.spec.js.
//
// js/common.js runs in Node.js (node-unit.js). The time zone is process.env.TZ, which Node.js reads again when it is
// set, and the time is fixed with the Date of the test's mock timers; both are put back when the test ends.

import { expect, publicUrl, scenario } from "./node-unit.js";

const { backendOf, convUrl, newConvId, newMsgId, nowIso } = await import(
	publicUrl("js/common.js")
);
const { UUID_RE } = await import(publicUrl("js/uuid.js"));

const NOW = "2026-11-04T01:23:05.678Z";
/** The conversation ids the server accepts (ID_RE of lib/config.rb). */
const SERVER_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** Fix the time at NOW for the rest of the test t. */
function fixTheTime(t) {
	t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
}

/** Set the time zone to zone for the rest of the test t. */
function setTheZone(t, zone) {
	const original = process.env.TZ;
	process.env.TZ = zone;
	t.after(() => {
		if (original === undefined) delete process.env.TZ;
		else process.env.TZ = original;
	});
}

async function givenTheZoneAndTime(step, t, zone) {
	await step(`Given the time zone is ${zone} and the time is ${NOW}`, () => {
		setTheZone(t, zone);
		fixTheTime(t);
		expect(Date.now()).toBe(Date.parse(NOW));
	});
}

// ---- Times and ids ----

for (const { zone, iso } of [
	{ zone: "Asia/Tokyo", iso: "2026-11-04T10:23:05+09:00" },
	{ zone: "UTC", iso: "2026-11-04T01:23:05+00:00" },
	{ zone: "Asia/Kolkata", iso: "2026-11-04T06:53:05+05:30" },
	{ zone: "America/St_Johns", iso: "2026-11-03T21:53:05-03:30" },
]) {
	scenario(
		`nowIso() writes the local time with the offset of the time zone (${zone})`,
		async ({ step, t }) => {
			await givenTheZoneAndTime(step, t, zone);
			let got;
			await step("When nowIso() is called", () => {
				got = nowIso();
			});
			await step(`Then it returns "${iso}"`, () => {
				expect(got).toBe(iso);
			});
			await step("And Date.parse of it is 2026-11-04T01:23:05Z", () => {
				expect(Date.parse(got)).toBe(Date.parse("2026-11-04T01:23:05Z"));
			});
		},
	);
}

for (const { zone, start } of [
	{ zone: "Asia/Tokyo", start: "20261104-102305-" },
	{ zone: "America/St_Johns", start: "20261103-215305-" },
]) {
	scenario(
		`newConvId() is made of the local time and four random hex digits (${zone})`,
		async ({ step, t }) => {
			await givenTheZoneAndTime(step, t, zone);
			let id;
			await step("When newConvId() is called", () => {
				id = newConvId();
			});
			await step(
				`Then it matches "${start}" followed by four lowercase hex digits`,
				() => {
					expect(id).toMatch(new RegExp(`^${start}[0-9a-f]{4}$`));
				},
			);
			await step("And it is a valid conversation id of the server", () => {
				expect(id).toMatch(SERVER_ID_RE);
			});
		},
	);
}

scenario(
	"Conversation ids made in the same second differ by their random digits",
	async ({ step, t }) => {
		let ids;
		await step("Given the time is fixed", () => {
			fixTheTime(t);
		});
		await step("When newConvId() is called 20 times", () => {
			ids = Array.from({ length: 20 }, () => newConvId());
		});
		await step("Then all of them start with the same time", () => {
			expect(new Set(ids.map((id) => id.slice(0, 16))).size).toBe(1);
		});
		await step("And their hex digits are not all the same", () => {
			expect(new Set(ids.map((id) => id.slice(16))).size).toBeGreaterThan(1);
		});
	},
);

scenario("newMsgId() is a UUIDv7 for now", async ({ step }) => {
	let made;
	await step("When newMsgId() is called", () => {
		const before = Date.now();
		const id = newMsgId();
		made = { before, id, after: Date.now() };
	});
	await step("Then UUID_RE accepts it", () => {
		expect(UUID_RE.test(made.id)).toBe(true);
	});
	await step(
		"And the milliseconds in its first 48 bits are between those before and after the call",
		() => {
			const ms = Number.parseInt(made.id.replace(/-/g, "").slice(0, 12), 16);
			expect(ms).toBeGreaterThanOrEqual(made.before);
			expect(ms).toBeLessThanOrEqual(made.after);
		},
	);
});

// ---- backendOf() and convUrl() ----

const show = (v) => (v === undefined ? "undefined" : `"${v}"`);

for (const { label, def, id, backend } of [
	{ label: "the id given", def: "a", id: "b", backend: "b" },
	{ label: "the default without an id", def: "b", id: undefined, backend: "b" },
	{ label: "the default for an empty id", def: "b", id: "", backend: "b" },
	{ label: "the first for an unknown id", def: "b", id: "zzz", backend: "a" },
	{
		label: "the first for an unknown default",
		def: "zzz",
		id: undefined,
		backend: "a",
	},
]) {
	scenario(`backendOf() picks a backend (${label})`, async ({ step }) => {
		let settings;
		let got;
		await step(
			`Given the settings have the backends "a" and "b" and the default backend ${show(def)}`,
			() => {
				settings = {
					backends: [
						{ id: "a", model: "model-a" },
						{ id: "b", model: "model-b" },
					],
					default_backend: def,
				};
			},
		);
		await step(`When backendOf() is called with the id ${show(id)}`, () => {
			got = backendOf(settings, id);
		});
		await step(`Then it returns the backend ${show(backend)}`, () => {
			expect(got).toEqual({ id: backend, model: `model-${backend}` });
		});
	});
}

scenario("backendOf() returns undefined without backends", async ({ step }) => {
	let settings;
	let got;
	await step("Given the settings have no backends", () => {
		settings = { backends: [], default_backend: "local" };
	});
	await step("When backendOf() is called without an id", () => {
		got = backendOf(settings);
	});
	await step("Then it returns undefined", () => {
		expect(got).toBeUndefined();
	});
});

for (const { label, id, msgId, url } of [
	{
		label: "a conversation",
		id: "20261104-102300-a1b2",
		msgId: undefined,
		url: "/c/20261104-102300-a1b2.html",
	},
	{
		label: "an empty message id",
		id: "20261104-102300-a1b2",
		msgId: "",
		url: "/c/20261104-102300-a1b2.html",
	},
	{
		label: "a message",
		id: "20261104-102300-a1b2",
		msgId: "0190f3a1-7c2e-7abc-8def-0123456789ab",
		url: "/c/20261104-102300-a1b2.html#c-msg-0190f3a1-7c2e-7abc-8def-0123456789ab",
	},
	{
		label: "an id that needs escapes",
		id: "a b/c?d#e",
		msgId: undefined,
		url: "/c/a%20b%2Fc%3Fd%23e.html",
	},
]) {
	scenario(
		`convUrl() links to a conversation or one of its messages (${label})`,
		async ({ step }) => {
			let got;
			await step(
				`When convUrl() is called with ${show(id)} and ${show(msgId)}`,
				() => {
					got = convUrl(id, msgId);
				},
			);
			await step(`Then it returns "${url}"`, () => {
				expect(got).toBe(url);
			});
		},
	);
}
