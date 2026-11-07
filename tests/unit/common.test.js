// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1004: the scenarios of docs/specs/LCTYSP-1004_common.feature that need no browser, written by hand. Each test
// has the title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read
// side by side. The Scenarios that need the page (query(), showToast() and the toasts of loadSettings() and of the
// indexer) are in common.spec.js.
//
// js/common.js runs in Node.js (node-unit.js). The time zone is process.env.TZ, which Node.js reads again when it is
// set, and the time is fixed with the Date of the test's mock timers; both are put back when the test ends. The settings
// are stored in Node.js's own localStorage, empty at the start of every Scenario (node-unit.js), and every request the
// module makes (GET /v1/defaults.json, GET /v1/vectors/pending) is answered by the test (routeFetch).

import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const {
	appIndexer,
	backendOf,
	convUrl,
	loadSettings,
	mergeSettings,
	newConvId,
	newMsgId,
	nowIso,
	storeSettings,
} = await import(publicUrl("js/common.js"));
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

for (const { label, id, msgId, path } of [
	{
		label: "a conversation",
		id: "20261104-102300-a1b2",
		msgId: undefined,
		path: "c/20261104-102300-a1b2.html",
	},
	{
		label: "an empty message id",
		id: "20261104-102300-a1b2",
		msgId: "",
		path: "c/20261104-102300-a1b2.html",
	},
	{
		label: "a message",
		id: "20261104-102300-a1b2",
		msgId: "0190f3a1-7c2e-7abc-8def-0123456789ab",
		path: "c/20261104-102300-a1b2.html#c-msg-0190f3a1-7c2e-7abc-8def-0123456789ab",
	},
	{
		label: "an id that needs escapes",
		id: "a b/c?d#e",
		msgId: undefined,
		path: "c/a%20b%2Fc%3Fd%23e.html",
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
			await step(`Then it returns the URL of "${path}" on the site`, () => {
				// the root of the site is public/ in Node.js (js/site.js)
				expect(got).toBe(new URL(path, publicUrl("")).href);
			});
		},
	);
}

// ---- Settings ----

const SETTINGS_KEY = "lcty.settings.v1";

async function givenStored(step, raw, label = raw) {
	await step(`Given localStorage "${SETTINGS_KEY}" holds ${label}`, () => {
		if (raw === null) localStorage.removeItem(SETTINGS_KEY);
		else localStorage.setItem(SETTINGS_KEY, raw);
	});
}

async function thenStored(step, raw) {
	await step(`And localStorage "${SETTINGS_KEY}" holds ${raw}`, () => {
		expect(localStorage.getItem(SETTINGS_KEY)).toBe(raw);
	});
}

/** "Given the defaults …" (or "And the defaults …"), "When storeSettings() is given …", "Then it returns …". */
async function storeSettingsSteps(step, { first, defaults, values, returns }) {
	let got;
	await step(`${first} the defaults ${defaults.label}`);
	await step(`When storeSettings() is given ${values.label}`, () => {
		got = storeSettings(values.value, defaults.value);
	});
	await step(`Then it returns ${returns.label}`, () => {
		expect(got).toEqual(returns.value);
	});
}

scenario(
	"storeSettings() stores only the values that differ from the defaults",
	async ({ step }) => {
		await storeSettingsSteps(step, {
			first: "Given",
			defaults: {
				label: '{ base_url: "http://d", model: "m", api_key: "k" }',
				value: { base_url: "http://d", model: "m", api_key: "k" },
			},
			values: {
				label: '{ base_url: "http://d", model: "other", api_key: "k" }',
				value: { base_url: "http://d", model: "other", api_key: "k" },
			},
			returns: { label: '{ model: "other" }', value: { model: "other" } },
		});
		await thenStored(step, '{"model":"other"}');
	},
);

scenario(
	"storeSettings() ignores the keys the defaults do not have",
	async ({ step }) => {
		await storeSettingsSteps(step, {
			first: "Given",
			defaults: { label: '{ model: "m" }', value: { model: "m" } },
			values: {
				label: '{ model: "other", unknown: "x" }',
				value: { model: "other", unknown: "x" },
			},
			returns: { label: '{ model: "other" }', value: { model: "other" } },
		});
		await thenStored(step, '{"model":"other"}');
	},
);

scenario(
	"storeSettings() keeps the default of a key the values do not have",
	async ({ step }) => {
		await storeSettingsSteps(step, {
			first: "Given",
			defaults: {
				label: '{ model: "m", api_key: "k" }',
				value: { model: "m", api_key: "k" },
			},
			values: { label: '{ api_key: "" }', value: { api_key: "" } },
			returns: { label: '{ api_key: "" }', value: { api_key: "" } },
		});
		await thenStored(step, '{"api_key":""}');
	},
);

scenario(
	"storeSettings() removes the stored changes when nothing differs",
	async ({ step }) => {
		await givenStored(step, '{"model":"other"}');
		await storeSettingsSteps(step, {
			first: "And",
			defaults: { label: '{ model: "m" }', value: { model: "m" } },
			values: { label: '{ model: "m" }', value: { model: "m" } },
			returns: { label: "{}", value: {} },
		});
		await step(`And localStorage has no "${SETTINGS_KEY}"`, () => {
			expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
		});
	},
);

scenario(
	"storeSettings() replaces the stored changes as a whole",
	async ({ step }) => {
		await givenStored(step, '{"model":"other"}');
		await storeSettingsSteps(step, {
			first: "And",
			defaults: {
				label: '{ model: "m", api_key: "k" }',
				value: { model: "m", api_key: "k" },
			},
			values: {
				label: '{ model: "m", api_key: "mine" }',
				value: { model: "m", api_key: "mine" },
			},
			returns: { label: '{ api_key: "mine" }', value: { api_key: "mine" } },
		});
		await thenStored(step, '{"api_key":"mine"}');
	},
);

scenario(
	"mergeSettings() overlays the defaults with the stored changes",
	async ({ step }) => {
		await givenStored(step, '{"model":"other"}');
		let got;
		await step(
			'When mergeSettings() is given the defaults { base_url: "http://d", model: "m" }',
			() => {
				got = mergeSettings({ base_url: "http://d", model: "m" });
			},
		);
		await step(
			'Then it returns { base_url: "http://d", model: "other" }',
			() => {
				expect(got).toEqual({ base_url: "http://d", model: "other" });
			},
		);
	},
);

scenario(
	"mergeSettings() ignores unknown keys and values of another type",
	async ({ step }) => {
		let got;
		await step(
			'When mergeSettings() is given the defaults { model: "m", count: 3 } and the changes { model: 5, count: 4, unknown: "x" }',
			() => {
				got = mergeSettings(
					{ model: "m", count: 3 },
					{ model: 5, count: 4, unknown: "x" },
				);
			},
		);
		await step('Then it returns { model: "m", count: 4 }', () => {
			expect(got).toEqual({ model: "m", count: 4 });
		});
	},
);

for (const { label, raw } of [
	{ label: "not JSON", raw: "not JSON" },
	{ label: "null", raw: "null" },
	{ label: '["model"]', raw: '["model"]' },
	{ label: '"model"', raw: '"model"' },
	{ label: "nothing", raw: null },
]) {
	scenario(
		`mergeSettings() uses the defaults when the stored changes cannot be read (${label})`,
		async ({ step }) => {
			await givenStored(step, raw, label);
			let got;
			await step(
				'When mergeSettings() is given the defaults { model: "m" }',
				() => {
					got = mergeSettings({ model: "m" });
				},
			);
			await step('Then it returns { model: "m" }', () => {
				expect(got).toEqual({ model: "m" });
			});
		},
	);
}

scenario(
	"loadSettings() makes the backend of the pages from the defaults and the stored changes",
	async ({ step, t }) => {
		await step(
			'Given GET /v1/defaults.json returns { base_url: "http://d", api_key: "k", model: "m", embedding_model: "e" }',
			() => {
				routeFetch(t, (request) =>
					new URL(request.url).pathname === "/v1/defaults.json"
						? Response.json({
								base_url: "http://d",
								api_key: "k",
								model: "m",
								embedding_model: "e",
							})
						: undefined,
				);
			},
		);
		await step(
			`And localStorage "${SETTINGS_KEY}" holds {"model":"other"}`,
			() => {
				localStorage.setItem(SETTINGS_KEY, '{"model":"other"}');
			},
		);
		let got;
		await step("When loadSettings() is called", async () => {
			got = await loadSettings();
		});
		await step(
			'Then it returns the one backend "local" of the default backend "local", with the model "other" and the rest of the defaults',
			() => {
				expect(got).toEqual({
					backends: [
						{
							id: "local",
							label: "llama-server",
							base_url: "http://d",
							api: "responses",
							api_key: "k",
							model: "other",
							embedding_model: "e",
							extra: {},
						},
					],
					default_backend: "local",
				});
			},
		);
	},
);

// ---- appIndexer() ----

/** The settings of the pages with one backend whose embedding model is model. */
function settingsWith(model) {
	return {
		backends: [
			{
				id: "local",
				label: "llama-server",
				base_url: "http://127.0.0.1:9",
				api: "responses",
				api_key: "",
				model: "chat",
				embedding_model: model,
				extra: {},
			},
		],
		default_backend: "local",
	};
}

/** GET /v1/vectors/pending answered with no rounds for the rest of the test t; returns the paths and queries asked. */
function routePending(t) {
	const urls = [];
	routeFetch(t, (request) => {
		const url = new URL(request.url);
		if (url.pathname !== "/v1/vectors/pending") return undefined;
		urls.push(`${url.pathname}${url.search}`);
		return Response.json([]);
	});
	return urls;
}

scenario("The indexer does nothing without settings", async ({ step, t }) => {
	let urls;
	await step("Given GET /v1/vectors/pending is answered by the test", () => {
		urls = routePending(t);
	});
	await step(
		"When the indexer of appIndexer() with no settings is kicked",
		() => appIndexer(() => null).kick(),
	);
	await step("Then no request is sent to /v1/vectors/pending", () => {
		expect(urls).toEqual([]);
	});
});

scenario(
	"The indexer does nothing without an embedding model",
	async ({ step, t }) => {
		let urls;
		await step("Given GET /v1/vectors/pending is answered by the test", () => {
			urls = routePending(t);
		});
		await step(
			'When the indexer of appIndexer() with settings whose embedding model is "" is kicked',
			() => appIndexer(() => settingsWith("")).kick(),
		);
		await step("Then no request is sent to /v1/vectors/pending", () => {
			expect(urls).toEqual([]);
		});
	},
);

scenario(
	"The indexer reads the settings at every kick",
	async ({ step, t }) => {
		let urls;
		let settings = null;
		let indexer;
		await step("Given GET /v1/vectors/pending returns no rounds", () => {
			urls = routePending(t);
		});
		await step("And the indexer of appIndexer() has no settings", () => {
			indexer = appIndexer(() => settings);
		});
		await step(
			'When it is kicked, then given settings whose embedding model is "embed" and kicked again',
			async () => {
				await indexer.kick();
				settings = settingsWith("embed");
				await indexer.kick();
			},
		);
		await step(
			"Then GET /v1/vectors/pending?model=embed&limit=16 is sent once",
			() => {
				expect(urls).toEqual(["/v1/vectors/pending?model=embed&limit=16"]);
			},
		);
	},
);
