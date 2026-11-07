// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1012: the scenarios of docs/specs/LCTYSP-1012_embedding.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by
// side.
//
// js/search/embed.js runs in a real browser on the test server's origin, on the empty page of unit-page.js. The
// embedding model is a route at /llm/v1/embeddings of the same origin (the backend's base_url is <origin>/llm/), and
// GET /v1/vectors/pending and PUT /v1/vectors are answered by a fake of the server's vector DB (LCTYSP-3007) kept by
// the test: it lists the rounds still pending and registers the rounds of each PUT. The embedding of a text is 768
// values whose first is the number the fake gave that text, so the records of a PUT body read back as texts.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const DOC = "title: none | text: ";
const QUERY_PREFIX = "task: search result | query: ";
const REV = "1111111111111111";
const RECORD = 3104;

/** The UUIDv7 of a round's name ("r1" → 019a0000-0000-7000-8000-000000007231). */
function rid(name) {
	const hex = Buffer.from(name).toString("hex").padStart(12, "0");
	return `019a0000-0000-7000-8000-${hex}`;
}

/** A part of n characters that starts with the round's name. */
const part = (name, n) => `${name}:`.padEnd(n, "x");

/** A pending round as GET /v1/vectors/pending lists it. */
const round = (name, parts, rev = REV) => ({ id: rid(name), rev, parts });

// ---- Background ----

/**
 * The page with the module loaded (window.lctyEmbed) and the fakes. fake.embedAnswer(route, body), fake.pendingAnswer
 * and fake.putAnswer replace the fakes' answers when set.
 */
async function background(page, context) {
	const fake = {
		texts: [],
		embeds: [],
		embedAnswer: null,
		rounds: [],
		neverRegister: false,
		pendings: [],
		pendingAnswer: null,
		puts: [],
		putAnswer: null,
	};
	fake.numberOf = (text) => {
		if (!fake.texts.includes(text)) fake.texts.push(text);
		return fake.texts.indexOf(text) + 1;
	};
	fake.embedding = (text) =>
		Array.from({ length: 768 }, (_, i) =>
			i === 0 ? fake.numberOf(text) : i === 1 ? 0.5 : 0,
		);
	await givenAPage(page, context);
	await page.evaluate(async () => {
		window.lctyEmbed = await import("/js/search/embed.js");
		window.lctyErrors = [];
	});
	await test.step("And POST /llm/v1/embeddings of the embedding model is answered by the test", async () => {
		await context.route("**/llm/v1/embeddings", (route) => {
			const request = route.request();
			const body = JSON.parse(request.postData());
			fake.embeds.push({ headers: request.headers(), body });
			if (fake.embedAnswer) return fake.embedAnswer(route, body);
			return route.fulfill({
				json: {
					model: body.model,
					data: body.input.map((t, index) => ({
						index,
						embedding: fake.embedding(t),
					})),
				},
			});
		});
	});
	await test.step("And GET /v1/vectors/pending and PUT /v1/vectors are answered by the test, which registers the rounds it is sent", async () => {
		await context.route(/\/v1\/vectors\/pending\?/, (route) => {
			fake.pendings.push(new URL(route.request().url()));
			if (fake.pendingAnswer) return fake.pendingAnswer(route);
			return route.fulfill({ json: fake.rounds });
		});
		await context.route(/\/v1\/vectors\?/, (route) => {
			const request = route.request();
			const url = new URL(request.url());
			const body = request.postDataBuffer() || Buffer.alloc(0);
			const records = [];
			for (let off = 0; off < body.length; off += RECORD) {
				records.push({
					control: body.subarray(off, off + 16).toString("hex"),
					id: body.subarray(off + 16, off + 32).toString("hex"),
					text: fake.texts[body.readFloatLE(off + 32) - 1],
				});
			}
			const revs = url.searchParams
				.get("rev")
				.split(",")
				.map((r) => r.split(":"));
			fake.puts.push({
				method: request.method(),
				url,
				contentType: request.headers()["content-type"],
				length: body.length,
				revs,
				records,
			});
			if (fake.putAnswer) return fake.putAnswer(route);
			if (!fake.neverRegister)
				fake.rounds = fake.rounds.filter(
					(r) => !revs.some(([id]) => id === r.id),
				);
			return route.fulfill({
				json: { accepted: revs.length, stale: [] },
			});
		});
	});
	return fake;
}

// ---- The module, from the page ----

/** A backend at path of the page's origin. */
function backend(page, path, model, apiKey) {
	return page.evaluate(
		({ path, model, apiKey }) => {
			const b = { base_url: location.origin + path, embedding_model: model };
			if (apiKey) b.api_key = apiKey;
			window.lctyCfg = window.lctyEmbed.embeddingConfig(b);
		},
		{ path, model, apiKey },
	);
}

function embedQuery(page, q, { aborted = false } = {}) {
	return page.evaluate(
		async ({ q, aborted }) => {
			const controller = new AbortController();
			if (aborted) controller.abort();
			try {
				const v = await window.lctyEmbed.embedQuery(
					window.lctyCfg,
					q,
					controller.signal,
				);
				return {
					isFloat32Array: v instanceof Float32Array,
					values: [...v],
				};
			} catch (e) {
				return { rejected: e.message, name: e.name };
			}
		},
		{ q, aborted },
	);
}

/** An indexer whose getConfig returns window.lctyCfg and whose onError keeps the messages. */
function makeIndexer(page) {
	return page.evaluate(() => {
		window.lctyIndexer = window.lctyEmbed.createIndexer({
			getConfig: () => window.lctyCfg,
			onError: (e) => window.lctyErrors.push(e.message),
		});
	});
}

function kick(page) {
	return page.evaluate(() => window.lctyIndexer.kick());
}

function errors(page) {
	return page.evaluate(() => window.lctyErrors);
}

// ---- Steps shared by the scenarios ----

async function givenABackend(page, path, apiKey) {
	const key = apiKey ? `the API key "${apiKey}"` : "no API key";
	await test.step(`Given a backend at ${path} of the page's origin with the embedding model "eg2" and ${key}`, () =>
		backend(page, path, "eg2", apiKey));
}

async function whenEmbedQuery(page, extra = "", options) {
	let result;
	await test.step(`When embedQuery embeds "cats"${extra}`, async () => {
		result = await embedQuery(page, "cats", options);
	});
	return result;
}

async function givenAnIndexer(page, model = "eg2") {
	await test.step(`Given an indexer for the model "${model}"`, async () => {
		await backend(page, "/llm/", model);
		await makeIndexer(page);
	});
}

async function givenPending(fake, rounds, text) {
	await test.step(`And ${text}`, () => {
		fake.rounds = rounds;
	});
}

async function whenKick(page, again = false) {
	await test.step(again ? "When kick() runs again" : "When kick() runs", () =>
		kick(page),
	);
}

async function thenOnError(page, messages, keyword = "And") {
	const line =
		messages.length === 0
			? `${keyword} onError was not called`
			: `${keyword} onError was called once, with "${messages[0]}"`;
	await test.step(line, async () => {
		expect(await errors(page)).toEqual(messages);
	});
}

const inputs = (fake) => fake.embeds.map((e) => e.body.input);
const docs = (...parts) => parts.map((p) => DOC + p);
const putIds = (fake) =>
	fake.puts.map((p) => [...new Set(p.records.map((r) => r.id))]);
const hexId = (name) => rid(name).replace(/-/g, "");

// ---- Scenarios: embeddingConfig ----

for (const { backendText, value } of [
	{ backendText: "null", value: null },
	{
		backendText: "a backend without embedding_model",
		value: { base_url: "http://127.0.0.1:8080" },
	},
	{
		backendText: "a backend whose embedding_model is empty",
		value: { base_url: "http://127.0.0.1:8080", embedding_model: "" },
	},
]) {
	test(`A backend without an embedding model has no config (${backendText})`, async ({
		page,
		context,
	}) => {
		await background(page, context);
		let result;
		await test.step(`When embeddingConfig is given ${backendText}`, async () => {
			result = await page.evaluate(
				(b) => window.lctyEmbed.embeddingConfig(b),
				value,
			);
		});
		await test.step("Then it returns null", () => {
			expect(result).toBeNull();
		});
	});
}

test("A backend with an embedding model has a config", async ({
	page,
	context,
}) => {
	await background(page, context);
	let result;
	await test.step('When embeddingConfig is given a backend whose embedding_model is "eg2"', async () => {
		result = await page.evaluate(() => {
			const b = { base_url: "http://127.0.0.1:8080", embedding_model: "eg2" };
			const cfg = window.lctyEmbed.embeddingConfig(b);
			return {
				same: cfg.backend === b,
				keys: Object.keys(cfg),
				model: cfg.model,
			};
		});
	});
	await test.step('Then it returns the backend itself and the model "eg2"', () => {
		expect(result).toEqual({
			same: true,
			keys: ["backend", "model"],
			model: "eg2",
		});
	});
});

// ---- Scenarios: embedQuery ----

test("A query is embedded with the query prefix", async ({ page, context }) => {
	const fake = await background(page, context);
	await givenABackend(page, "/llm/", "test-key");
	const result = await whenEmbedQuery(page);
	await test.step('Then POST /llm/v1/embeddings was requested once, with the Content-Type application/json and the Authorization "Bearer test-key"', () => {
		expect(fake.embeds).toHaveLength(1);
		expect(fake.embeds[0].headers["content-type"]).toBe("application/json");
		expect(fake.embeds[0].headers.authorization).toBe("Bearer test-key");
	});
	await test.step('And its body is the model "eg2" and the input "task: search result | query: cats"', () => {
		expect(fake.embeds[0].body).toEqual({
			model: "eg2",
			input: [`${QUERY_PREFIX}cats`],
		});
	});
	await test.step("And it returns the embedding of that input as a Float32Array of 768 values", () => {
		expect(result).toEqual({
			isFloat32Array: true,
			values: fake.embedding(`${QUERY_PREFIX}cats`),
		});
	});
});

for (const [title, path] of [
	["Without an API key no Authorization is sent", "/llm/"],
	["The slashes at the end of the base URL are dropped", "/llm///"],
]) {
	test(title, async ({ page, context }) => {
		const fake = await background(page, context);
		await givenABackend(page, path);
		const result = await whenEmbedQuery(page);
		await test.step("Then POST /llm/v1/embeddings was requested once, without an Authorization", () => {
			expect(fake.embeds).toHaveLength(1);
			expect(fake.embeds[0].headers.authorization).toBeUndefined();
			expect(result.values).toHaveLength(768);
		});
	});
}

for (const { answer, message, fulfill } of [
	{
		answer: 'the status 500 and the error message "model not loaded"',
		message: "model not loaded",
		fulfill: (route) =>
			route.fulfill({
				status: 500,
				json: { error: { message: "model not loaded" } },
			}),
	},
	{
		answer: "the status 400 and an error without a message",
		message: "HTTP 400",
		fulfill: (route) => route.fulfill({ status: 400, json: { error: {} } }),
	},
	{
		answer: "the status 503 and a body that is not JSON",
		message: "HTTP 503",
		fulfill: (route) => route.fulfill({ status: 503, body: "Unavailable" }),
	},
	{
		answer: "the status 200 and no data",
		message: "HTTP 200",
		fulfill: (route) => route.fulfill({ json: { model: "eg2" } }),
	},
	{
		answer: "an embedding of 256 values",
		message: "wrong dimensions (256 ≠ 768)",
		fulfill: (route) =>
			route.fulfill({
				json: { data: [{ index: 0, embedding: Array(256).fill(0.1) }] },
			}),
	},
]) {
	test(`A failed embedding rejects (${answer})`, async ({ page, context }) => {
		const fake = await background(page, context);
		await givenABackend(page, "/llm/");
		await test.step(`And POST /llm/v1/embeddings answers with ${answer}`, () => {
			fake.embedAnswer = fulfill;
		});
		const result = await whenEmbedQuery(page);
		await test.step(`Then it rejects with "${message}"`, () => {
			expect(result.rejected).toBe(message);
		});
	});
}

test("An aborted signal cancels the embedding", async ({ page, context }) => {
	const fake = await background(page, context);
	await givenABackend(page, "/llm/");
	const result = await whenEmbedQuery(
		page,
		" with a signal that is already aborted",
		{ aborted: true },
	);
	await test.step("Then it rejects with an AbortError", () => {
		expect(result.name).toBe("AbortError");
	});
	await test.step("And POST /llm/v1/embeddings was not requested", () => {
		expect(fake.embeds).toHaveLength(0);
	});
});

// ---- Scenarios: the indexer ----

test("Without a config the indexer requests nothing", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await test.step("Given an indexer whose getConfig returns null", async () => {
		await page.evaluate(() => {
			window.lctyCfg = null;
		});
		await makeIndexer(page);
	});
	await givenPending(fake, [round("r1", ["hello"])], 'a round "r1" is pending');
	await whenKick(page);
	await test.step("Then GET /v1/vectors/pending was not requested", () => {
		expect(fake.pendings).toHaveLength(0);
	});
	await test.step("And POST /llm/v1/embeddings was not requested", () => {
		expect(fake.embeds).toHaveLength(0);
	});
});

test("A pending round is embedded and registered", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[round("r1", ["hello"])],
		'a round "r1" of the rev "1111111111111111" is pending with the part "hello"',
	);
	await whenKick(page);
	await test.step("Then GET /v1/vectors/pending?model=eg2&limit=16 was requested twice", () => {
		expect(fake.pendings.map((u) => u.search)).toEqual([
			"?model=eg2&limit=16",
			"?model=eg2&limit=16",
		]);
	});
	await test.step('And POST /llm/v1/embeddings was requested once, with the model "eg2" and the input "title: none | text: hello"', () => {
		expect(fake.embeds.map((e) => e.body)).toEqual([
			{ model: "eg2", input: [`${DOC}hello`] },
		]);
	});
	await test.step("And one PUT /v1/vectors?model=eg2&magic=lctyvLE0&size=3072&entry_count=1&rev=<r1>:1111111111111111 was sent, as application/octet-stream", () => {
		expect(fake.puts).toHaveLength(1);
		const [put] = fake.puts;
		expect(put.method).toBe("PUT");
		expect(put.url.pathname).toBe("/v1/vectors");
		expect(put.url.search).toBe(
			`?model=eg2&magic=lctyvLE0&size=3072&entry_count=1&rev=${rid("r1")}:${REV}`,
		);
		expect(put.contentType).toBe("application/octet-stream");
	});
	await test.step('And its body is the record of "r1" with the embedding of "title: none | text: hello"', () => {
		expect(fake.puts[0].length).toBe(RECORD);
		expect(fake.puts[0].records).toEqual([
			{
				control: "6c637479764c4530000c000000000000",
				id: hexId("r1"),
				text: `${DOC}hello`,
			},
		]);
	});
	await thenOnError(page, []);
});

/** The records of a PUT as [id, text]. */
const records = (put) => put.records.map((r) => [r.id, r.text]);

test("Every part of a round is a record of its id, in order", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[round("r1", ["p1", "p2", "p3"])],
		'a round "r1" is pending with the parts "p1", "p2" and "p3"',
	);
	await whenKick(page);
	await test.step('Then one PUT was sent, with the entry_count 3 and the rev of "r1" only', () => {
		expect(fake.puts).toHaveLength(1);
		expect(fake.puts[0].url.searchParams.get("entry_count")).toBe("3");
		expect(fake.puts[0].revs).toEqual([[rid("r1"), REV]]);
	});
	await test.step('And its body is the records of "r1" with the embeddings of "p1", "p2" and "p3", in order', () => {
		expect(records(fake.puts[0])).toEqual(
			docs("p1", "p2", "p3").map((t) => [hexId("r1"), t]),
		);
	});
});

test("Small rounds are embedded together", async ({ page, context }) => {
	const fake = await background(page, context);
	const rounds = ["r1", "r2", "r3"].map((n) => round(n, [part(n, 100)]));
	await givenAnIndexer(page);
	await givenPending(
		fake,
		rounds,
		'the rounds "r1", "r2" and "r3" of 100 characters each are pending, in that order',
	);
	await whenKick(page);
	await test.step('Then POST /llm/v1/embeddings was requested once, with the parts of "r1", "r2" and "r3", in order', () => {
		expect(inputs(fake)).toEqual([
			docs(part("r1", 100), part("r2", 100), part("r3", 100)),
		]);
	});
	await test.step('And one PUT was sent, with the entry_count 3 and the revs of "r1", "r2" and "r3", in order', () => {
		expect(fake.puts).toHaveLength(1);
		expect(fake.puts[0].url.searchParams.get("entry_count")).toBe("3");
		expect(fake.puts[0].revs).toEqual(rounds.map((r) => [r.id, REV]));
		expect(records(fake.puts[0])).toEqual(
			rounds.map((r) => [r.id.replace(/-/g, ""), DOC + r.parts[0]]),
		);
	});
});

test("Rounds are cut into batches of 6,000 characters in their order", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	const [r1, r2, r3] = [
		["r1", 4000],
		["r2", 3000],
		["r3", 2000],
	].map(([n, len]) => round(n, [part(n, len)]));
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[r1, r2, r3],
		'the rounds "r1" of 4,000 characters, "r2" of 3,000 and "r3" of 2,000 are pending, in that order',
	);
	await whenKick(page);
	await test.step('Then POST /llm/v1/embeddings was requested twice, with the parts of "r1", then of "r2" and "r3"', () => {
		expect(inputs(fake)).toEqual([
			docs(r1.parts[0]),
			docs(r2.parts[0], r3.parts[0]),
		]);
	});
	await test.step('And two PUTs were sent, of "r1", then of "r2" and "r3"', () => {
		expect(putIds(fake)).toEqual([[hexId("r1")], [hexId("r2"), hexId("r3")]]);
	});
});

test("A round longer than a batch is embedded alone", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	const r1 = round("r1", [part("r1", 6000), part("r1b", 1000)]);
	const r2 = round("r2", [part("r2", 10)]);
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[r1, r2],
		'the round "r1" with parts of 6,000 and 1,000 characters and the round "r2" of 10 are pending, in that order',
	);
	await whenKick(page);
	await test.step('Then POST /llm/v1/embeddings was requested twice, with the parts of "r1", then of "r2"', () => {
		expect(inputs(fake)).toEqual([docs(...r1.parts), docs(...r2.parts)]);
	});
	await test.step('And two PUTs were sent, of "r1", then of "r2"', () => {
		expect(putIds(fake)).toEqual([[hexId("r1")], [hexId("r2")]]);
	});
});

test("The embeddings are matched to the parts by their index", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[round("r1", ["p1", "p2", "p3"])],
		'a round "r1" is pending with the parts "p1", "p2" and "p3"',
	);
	await test.step("And POST /llm/v1/embeddings answers with the embeddings in reverse order, each with its index", () => {
		fake.embedAnswer = (route, body) =>
			route.fulfill({
				json: {
					data: body.input
						.map((t, index) => ({ index, embedding: fake.embedding(t) }))
						.reverse(),
				},
			});
	});
	await whenKick(page);
	await test.step('Then the PUT body is the records of "r1" with the embeddings of "p1", "p2" and "p3", in order', () => {
		expect(fake.puts).toHaveLength(1);
		expect(records(fake.puts[0])).toEqual(
			docs("p1", "p2", "p3").map((t) => [hexId("r1"), t]),
		);
	});
});

test("When a batch fails, each round is embedded alone", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	const [r1, r2] = ["r1", "r2"].map((n) => round(n, [part(n, 100)]));
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[r1, r2],
		'the rounds "r1" and "r2" of 100 characters each are pending, in that order',
	);
	await test.step("And POST /llm/v1/embeddings answers with the status 500 when it is given more than one input", () => {
		fake.embedAnswer = (route, body) =>
			body.input.length > 1
				? route.fulfill({ status: 500, json: { error: { message: "busy" } } })
				: route.fulfill({
						json: {
							data: body.input.map((t, index) => ({
								index,
								embedding: fake.embedding(t),
							})),
						},
					});
	});
	await whenKick(page);
	await test.step('Then POST /llm/v1/embeddings was requested three times: with the parts of "r1" and "r2", of "r1", of "r2"', () => {
		expect(inputs(fake)).toEqual([
			docs(r1.parts[0], r2.parts[0]),
			docs(r1.parts[0]),
			docs(r2.parts[0]),
		]);
	});
	await test.step('And one PUT was sent, of "r1" and "r2"', () => {
		expect(putIds(fake)).toEqual([[hexId("r1"), hexId("r2")]]);
		expect(records(fake.puts[0])).toEqual([
			[hexId("r1"), DOC + r1.parts[0]],
			[hexId("r2"), DOC + r2.parts[0]],
		]);
	});
	await thenOnError(page, []);
});

test("A round that fails alone is reported and skipped for the session", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	const [r1, r2] = ["r1", "r2"].map((n) => round(n, [part(n, 100)]));
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[r1, r2],
		'the rounds "r1" and "r2" of 100 characters each are pending, in that order',
	);
	await test.step('And POST /llm/v1/embeddings answers with the status 500 and the error message "too large" when it is given the part of "r2"', () => {
		fake.embedAnswer = (route, body) =>
			body.input.includes(DOC + r2.parts[0])
				? route.fulfill({
						status: 500,
						json: { error: { message: "too large" } },
					})
				: route.fulfill({
						json: {
							data: body.input.map((t, index) => ({
								index,
								embedding: fake.embedding(t),
							})),
						},
					});
	});
	await whenKick(page);
	await test.step('Then one PUT was sent, of "r1"', () => {
		expect(putIds(fake)).toEqual([[hexId("r1")]]);
		expect(fake.puts[0].revs).toEqual([[r1.id, REV]]);
	});
	await thenOnError(page, ["too large"]);
	const before = { embeds: 0, puts: 0, pendings: 0 };
	await test.step("When kick() runs again", async () => {
		before.embeds = fake.embeds.length;
		before.puts = fake.puts.length;
		before.pendings = fake.pendings.length;
		await kick(page);
	});
	await test.step("Then GET /v1/vectors/pending was requested again", () => {
		expect(fake.pendings.length).toBe(before.pendings + 1);
	});
	await test.step("But no more embeddings were requested and no more PUTs were sent", () => {
		expect(fake.embeds.length).toBe(before.embeds);
		expect(fake.puts.length).toBe(before.puts);
	});
	await thenOnError(page, ["too large"]);
});

test("A round the server keeps pending is sent once per pass", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[round("r1", ["hello"])],
		'a round "r1" is pending with the part "hello", which the server never registers',
	);
	fake.neverRegister = true;
	await whenKick(page);
	await test.step('Then one PUT was sent, of "r1"', () => {
		expect(putIds(fake)).toEqual([[hexId("r1")]]);
	});
	await test.step("And GET /v1/vectors/pending was requested twice", () => {
		expect(fake.pendings).toHaveLength(2);
	});
	await whenKick(page, true);
	await test.step('Then two PUTs were sent, of "r1", then of "r1"', () => {
		expect(putIds(fake)).toEqual([[hexId("r1")], [hexId("r1")]]);
	});
});

test("Kicks while a pass runs cause one more pass after it", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	const held = [];
	await givenAnIndexer(page);
	await givenPending(fake, [], "nothing is pending");
	await test.step("And GET /v1/vectors/pending is held until the test answers it", () => {
		fake.pendingAnswer = (route) => {
			if (held.length) return route.fulfill({ json: [] });
			held.push(route);
		};
	});
	await test.step("When kick() is called three times", async () => {
		await page.evaluate(() => {
			window.lctyKicks = [];
			for (let i = 0; i < 3; i++)
				window.lctyIndexer.kick().then(() => window.lctyKicks.push(i));
		});
	});
	await test.step("Then the second and the third call resolve at once", async () => {
		await page.waitForFunction(() => window.lctyKicks.length === 2);
		expect(await page.evaluate(() => window.lctyKicks)).toEqual([1, 2]);
	});
	await test.step("And GET /v1/vectors/pending has been requested once", async () => {
		await expect.poll(() => held.length).toBe(1);
		expect(fake.pendings).toHaveLength(1);
	});
	await test.step("When the request is answered with nothing pending", async () => {
		await held[0].fulfill({ json: [] });
	});
	await test.step("Then the first call resolves", async () => {
		await page.waitForFunction(() => window.lctyKicks.length === 3);
		expect(await page.evaluate(() => window.lctyKicks)).toEqual([1, 2, 0]);
	});
	await test.step("And GET /v1/vectors/pending was requested twice", () => {
		expect(fake.pendings).toHaveLength(2);
	});
});

test("Each pass reads the config again", async ({ page, context }) => {
	const fake = await background(page, context);
	await givenAnIndexer(page, "a");
	await givenPending(fake, [], "nothing is pending");
	await whenKick(page);
	await test.step('And the config changes to the model "b"', () =>
		backend(page, "/llm/", "b"));
	await test.step("And kick() runs again", () => kick(page));
	await test.step('Then GET /v1/vectors/pending was requested with the model "a", then with the model "b"', () => {
		expect(fake.pendings.map((u) => u.searchParams.get("model"))).toEqual([
			"a",
			"b",
		]);
	});
});

test("A failed request for pending rounds is reported", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await givenAnIndexer(page);
	await test.step('And GET /v1/vectors/pending answers with the status 500 and the body "boom"', () => {
		fake.pendingAnswer = (route) =>
			route.fulfill({ status: 500, body: "boom" });
	});
	await whenKick(page);
	await thenOnError(page, ["500 boom"], "Then");
	await test.step("When GET /v1/vectors/pending answers with nothing pending", () => {
		fake.pendingAnswer = null;
		fake.rounds = [];
	});
	await test.step("And kick() runs again", () => kick(page));
	await test.step("Then GET /v1/vectors/pending was requested twice", () => {
		expect(fake.pendings).toHaveLength(2);
	});
	await thenOnError(page, ["500 boom"]);
});

test("A failed PUT is reported and ends the pass", async ({
	page,
	context,
}) => {
	const fake = await background(page, context);
	await givenAnIndexer(page);
	await givenPending(
		fake,
		[round("r1", ["hello"])],
		'a round "r1" is pending with the part "hello"',
	);
	await test.step('And PUT /v1/vectors answers with the status 400 and the body "bad body"', () => {
		fake.putAnswer = (route) =>
			route.fulfill({ status: 400, body: "bad body" });
	});
	await whenKick(page);
	await thenOnError(page, ["400 bad body"], "Then");
	await test.step("And GET /v1/vectors/pending was requested once", () => {
		expect(fake.pendings).toHaveLength(1);
	});
});
