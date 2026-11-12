// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1012: the scenarios of docs/specs/LCTYSP-1012_embedding.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// js/search/embed.js needs no browser: it runs in Node.js (node-unit.js). Nothing it imports (api/storage.js,
// search/vectors.js and through them api/meta-db.js, convert/reply.js, i18n.js) touches a browser global when it is
// imported, and the functions used here only fetch. The module never reads location: "the page's origin" is only the
// origin its relative URLs (/v1/vectors/…) resolve against, which routeFetch() supplies (ORIGIN, as the test server's
// origin in a page), and a backend at /llm/ of it has the base_url ORIGIN + "/llm/". Every request is answered by the
// test through routeFetch(), which replaces the global fetch: the embedding model at /llm/v1/embeddings, and GET
// /v1/vectors/pending and PUT /v1/vectors by a fake of the server's vector DB (LCTYSP-3007) kept by the test: it lists
// the rounds still pending and registers the rounds of each PUT. The embedding of a text is 768 values whose first is
// the number the fake gave that text, so the records of a PUT body read back as texts. As fetch does, a request whose
// signal is already aborted is rejected with the signal's AbortError before it is sent.

import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const { embeddingConfig, embedQuery, createIndexer } = await import(
	publicUrl("js/search/embed.js")
);

const ORIGIN = "http://127.0.0.1:45290";
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

/** An HTTP response with a JSON body (as route.fulfill({ json }) answers). */
const json = (body, status = 200) => Response.json(body, { status });

/** An HTTP response with a text body. */
const text = (body, status) => new Response(body, { status });

// ---- Background ----

/**
 * The fakes, answering every request of the test t. fake.embedAnswer(body), fake.pendingAnswer() and fake.putAnswer()
 * replace the fakes' answers when set. Also holds the indexer's config (fake.cfg) and the messages given to onError.
 */
async function background(step, t) {
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
		cfg: null,
		errors: [],
	};
	fake.numberOf = (text) => {
		if (!fake.texts.includes(text)) fake.texts.push(text);
		return fake.texts.indexOf(text) + 1;
	};
	fake.embedding = (text) =>
		Array.from({ length: 768 }, (_, i) =>
			i === 0 ? fake.numberOf(text) : i === 1 ? 0.5 : 0,
		);
	const routes = [];
	routeFetch(
		t,
		async (request) => {
			// fetch rejects at once with an aborted signal: the request is never sent
			if (request.signal.aborted) throw request.signal.reason;
			const url = new URL(request.url);
			const route = routes.find((r) => r.match(request, url));
			if (!route) throw new TypeError(`not answered: ${request.url}`);
			return route.answer(request, url);
		},
		{ base: `${ORIGIN}/` },
	);
	await step(
		"Given POST /llm/v1/embeddings of the embedding model is answered by the test",
		() => {
			routes.push({
				match: (_, url) => url.pathname === "/llm/v1/embeddings",
				answer: async (request) => {
					const body = await request.json();
					fake.embeds.push({
						headers: Object.fromEntries(request.headers),
						body,
					});
					if (fake.embedAnswer) return fake.embedAnswer(body);
					return json({
						model: body.model,
						data: body.input.map((t, index) => ({
							index,
							embedding: fake.embedding(t),
						})),
					});
				},
			});
		},
	);
	await step(
		"And GET /v1/vectors/pending and PUT /v1/vectors are answered by the test, which registers the rounds it is sent",
		() => {
			routes.push({
				match: (_, url) => url.pathname === "/v1/vectors/pending",
				answer: (_, url) => {
					fake.pendings.push(url);
					if (fake.pendingAnswer) return fake.pendingAnswer();
					return json(fake.rounds);
				},
			});
			routes.push({
				match: (_, url) => url.pathname === "/v1/vectors",
				answer: async (request, url) => {
					const body = Buffer.from(await request.arrayBuffer());
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
						method: request.method,
						url,
						contentType: request.headers.get("content-type"),
						length: body.length,
						revs,
						records,
					});
					if (fake.putAnswer) return fake.putAnswer();
					if (!fake.neverRegister)
						fake.rounds = fake.rounds.filter(
							(r) => !revs.some(([id]) => id === r.id),
						);
					return json({ accepted: revs.length, stale: [] });
				},
			});
		},
	);
	return fake;
}

// ---- The module ----

/** A backend at path of the page's origin, and its config as fake.cfg. */
function backend(fake, path, model, apiKey) {
	const b = { base_url: ORIGIN + path, embedding_model: model };
	if (apiKey) b.api_key = apiKey;
	fake.cfg = embeddingConfig(b);
}

async function embed(fake, q, { aborted = false } = {}) {
	const controller = new AbortController();
	if (aborted) controller.abort();
	try {
		const v = await embedQuery(fake.cfg, q, controller.signal);
		return { isFloat32Array: v instanceof Float32Array, values: [...v] };
	} catch (e) {
		return { rejected: e.message, name: e.name };
	}
}

/** An indexer whose getConfig returns fake.cfg and whose onError keeps the messages in fake.errors. */
function makeIndexer(fake) {
	fake.indexer = createIndexer({
		getConfig: () => fake.cfg,
		onError: (e) => fake.errors.push(e.message),
	});
}

const kick = (fake) => fake.indexer.kick();

// ---- Steps shared by the scenarios ----

async function givenABackend(step, fake, path, apiKey) {
	const key = apiKey ? `the API key "${apiKey}"` : "no API key";
	await step(
		`Given a backend at ${path} of the page's origin with the embedding model "eg2" and ${key}`,
		() => backend(fake, path, "eg2", apiKey),
	);
}

async function whenEmbedQuery(step, fake, extra = "", options) {
	let result;
	await step(`When embedQuery embeds "cats"${extra}`, async () => {
		result = await embed(fake, "cats", options);
	});
	return result;
}

async function givenAnIndexer(step, fake, model = "eg2") {
	await step(`Given an indexer for the model "${model}"`, () => {
		backend(fake, "/llm/", model);
		makeIndexer(fake);
	});
}

async function givenPending(step, fake, rounds, text) {
	await step(`And ${text}`, () => {
		fake.rounds = rounds;
	});
}

async function whenKick(step, fake, again = false) {
	await step(again ? "When kick() runs again" : "When kick() runs", () =>
		kick(fake),
	);
}

async function thenOnError(step, fake, messages, keyword = "And") {
	const line =
		messages.length === 0
			? `${keyword} onError was not called`
			: `${keyword} onError was called once, with "${messages[0]}"`;
	await step(line, () => {
		expect(fake.errors).toEqual(messages);
	});
}

const inputs = (fake) => fake.embeds.map((e) => e.body.input);
const docs = (...parts) => parts.map((p) => DOC + p);
const putIds = (fake) =>
	fake.puts.map((p) => [...new Set(p.records.map((r) => r.id))]);
const hexId = (name) => rid(name).replace(/-/g, "");

/** The embeddings of the inputs of body, in order. */
const embeddingsOf = (fake, body) =>
	json({
		data: body.input.map((t, index) => ({
			index,
			embedding: fake.embedding(t),
		})),
	});

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
	scenario(
		`A backend without an embedding model has no config (${backendText})`,
		async ({ step, t }) => {
			await background(step, t);
			let result;
			await step(`When embeddingConfig is given ${backendText}`, () => {
				result = embeddingConfig(value);
			});
			await step("Then it returns null", () => {
				expect(result).toBeNull();
			});
		},
	);
}

scenario(
	"A backend with an embedding model has a config",
	async ({ step, t }) => {
		await background(step, t);
		let result;
		await step(
			'When embeddingConfig is given a backend whose embedding_model is "eg2"',
			() => {
				const b = { base_url: "http://127.0.0.1:8080", embedding_model: "eg2" };
				const cfg = embeddingConfig(b);
				result = {
					same: cfg.backend === b,
					keys: Object.keys(cfg),
					model: cfg.model,
				};
			},
		);
		await step('Then it returns the backend itself and the model "eg2"', () => {
			expect(result).toEqual({
				same: true,
				keys: ["backend", "model"],
				model: "eg2",
			});
		});
	},
);

// ---- Scenarios: embedQuery ----

scenario("A query is embedded with the query prefix", async ({ step, t }) => {
	const fake = await background(step, t);
	await givenABackend(step, fake, "/llm/", "test-key");
	const result = await whenEmbedQuery(step, fake);
	await step(
		'Then POST /llm/v1/embeddings was requested once, with the Content-Type application/json and the Authorization "Bearer test-key"',
		() => {
			expect(fake.embeds).toHaveLength(1);
			expect(fake.embeds[0].headers["content-type"]).toBe("application/json");
			expect(fake.embeds[0].headers.authorization).toBe("Bearer test-key");
		},
	);
	await step(
		'And its body is the model "eg2" and the input "task: search result | query: cats"',
		() => {
			expect(fake.embeds[0].body).toEqual({
				model: "eg2",
				input: [`${QUERY_PREFIX}cats`],
			});
		},
	);
	await step(
		"And it returns the embedding of that input as a Float32Array of 768 values",
		() => {
			expect(result).toEqual({
				isFloat32Array: true,
				values: fake.embedding(`${QUERY_PREFIX}cats`),
			});
		},
	);
});

for (const [title, path] of [
	["Without an API key no Authorization is sent", "/llm/"],
	["The slashes at the end of the base URL are dropped", "/llm///"],
]) {
	scenario(title, async ({ step, t }) => {
		const fake = await background(step, t);
		await givenABackend(step, fake, path);
		const result = await whenEmbedQuery(step, fake);
		await step(
			"Then POST /llm/v1/embeddings was requested once, without an Authorization",
			() => {
				expect(fake.embeds).toHaveLength(1);
				expect(fake.embeds[0].headers.authorization).toBeUndefined();
				expect(result.values).toHaveLength(768);
			},
		);
	});
}

for (const { answer, message, fulfill } of [
	{
		answer: 'the status 500 and the error message "model not loaded"',
		message: "model not loaded",
		fulfill: () => json({ error: { message: "model not loaded" } }, 500),
	},
	{
		answer: "the status 400 and an error without a message",
		message: "HTTP 400",
		fulfill: () => json({ error: {} }, 400),
	},
	{
		answer: "the status 503 and a body that is not JSON",
		message: "HTTP 503",
		fulfill: () => text("Unavailable", 503),
	},
	{
		answer: "the status 200 and no data",
		message: "HTTP 200",
		fulfill: () => json({ model: "eg2" }),
	},
	{
		answer: "an embedding of 256 values",
		message: "wrong dimensions (256 ≠ 768)",
		fulfill: () =>
			json({ data: [{ index: 0, embedding: Array(256).fill(0.1) }] }),
	},
]) {
	scenario(`A failed embedding rejects (${answer})`, async ({ step, t }) => {
		const fake = await background(step, t);
		await givenABackend(step, fake, "/llm/");
		await step(`And POST /llm/v1/embeddings answers with ${answer}`, () => {
			fake.embedAnswer = fulfill;
		});
		const result = await whenEmbedQuery(step, fake);
		await step(`Then it rejects with "${message}"`, () => {
			expect(result.rejected).toBe(message);
		});
	});
}

scenario("An aborted signal cancels the embedding", async ({ step, t }) => {
	const fake = await background(step, t);
	await givenABackend(step, fake, "/llm/");
	const result = await whenEmbedQuery(
		step,
		fake,
		" with a signal that is already aborted",
		{ aborted: true },
	);
	await step("Then it rejects with an AbortError", () => {
		expect(result.name).toBe("AbortError");
	});
	await step("And POST /llm/v1/embeddings was not requested", () => {
		expect(fake.embeds).toHaveLength(0);
	});
});

// ---- Scenarios: the indexer ----

scenario(
	"Without a config the indexer requests nothing",
	async ({ step, t }) => {
		const fake = await background(step, t);
		await step("Given an indexer whose getConfig returns null", () => {
			fake.cfg = null;
			makeIndexer(fake);
		});
		await givenPending(
			step,
			fake,
			[round("r1", ["hello"])],
			'a round "r1" is pending',
		);
		await whenKick(step, fake);
		await step("Then GET /v1/vectors/pending was not requested", () => {
			expect(fake.pendings).toHaveLength(0);
		});
		await step("And POST /llm/v1/embeddings was not requested", () => {
			expect(fake.embeds).toHaveLength(0);
		});
	},
);

scenario("A pending round is embedded and registered", async ({ step, t }) => {
	const fake = await background(step, t);
	await givenAnIndexer(step, fake);
	await givenPending(
		step,
		fake,
		[round("r1", ["hello"])],
		'a round "r1" of the rev "1111111111111111" is pending with the part "hello"',
	);
	await whenKick(step, fake);
	await step(
		"Then GET /v1/vectors/pending?model=eg2&limit=16 was requested twice",
		() => {
			expect(fake.pendings.map((u) => u.search)).toEqual([
				"?model=eg2&limit=16",
				"?model=eg2&limit=16",
			]);
		},
	);
	await step(
		'And POST /llm/v1/embeddings was requested once, with the model "eg2" and the input "title: none | text: hello"',
		() => {
			expect(fake.embeds.map((e) => e.body)).toEqual([
				{ model: "eg2", input: [`${DOC}hello`] },
			]);
		},
	);
	await step(
		"And one PUT /v1/vectors?model=eg2&magic=lctyvLE0&size=3072&entry_count=1&rev=<r1>:1111111111111111 was sent, as application/octet-stream",
		() => {
			expect(fake.puts).toHaveLength(1);
			const [put] = fake.puts;
			expect(put.method).toBe("PUT");
			expect(put.url.pathname).toBe("/v1/vectors");
			expect(put.url.search).toBe(
				`?model=eg2&magic=lctyvLE0&size=3072&entry_count=1&rev=${rid("r1")}:${REV}`,
			);
			expect(put.contentType).toBe("application/octet-stream");
		},
	);
	await step(
		'And its body is the record of "r1" with the embedding of "title: none | text: hello"',
		() => {
			expect(fake.puts[0].length).toBe(RECORD);
			expect(fake.puts[0].records).toEqual([
				{
					control: "6c637479764c4530000c000000000000",
					id: hexId("r1"),
					text: `${DOC}hello`,
				},
			]);
		},
	);
	await thenOnError(step, fake, []);
});

/** The records of a PUT as [id, text]. */
const records = (put) => put.records.map((r) => [r.id, r.text]);

scenario(
	"Every part of a round is a record of its id, in order",
	async ({ step, t }) => {
		const fake = await background(step, t);
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[round("r1", ["p1", "p2", "p3"])],
			'a round "r1" is pending with the parts "p1", "p2" and "p3"',
		);
		await whenKick(step, fake);
		await step(
			'Then one PUT was sent, with the entry_count 3 and the rev of "r1" only',
			() => {
				expect(fake.puts).toHaveLength(1);
				expect(fake.puts[0].url.searchParams.get("entry_count")).toBe("3");
				expect(fake.puts[0].revs).toEqual([[rid("r1"), REV]]);
			},
		);
		await step(
			'And its body is the records of "r1" with the embeddings of "p1", "p2" and "p3", in order',
			() => {
				expect(records(fake.puts[0])).toEqual(
					docs("p1", "p2", "p3").map((t) => [hexId("r1"), t]),
				);
			},
		);
	},
);

scenario("Small rounds are embedded together", async ({ step, t }) => {
	const fake = await background(step, t);
	const rounds = ["r1", "r2", "r3"].map((n) => round(n, [part(n, 100)]));
	await givenAnIndexer(step, fake);
	await givenPending(
		step,
		fake,
		rounds,
		'the rounds "r1", "r2" and "r3" of 100 characters each are pending, in that order',
	);
	await whenKick(step, fake);
	await step(
		'Then POST /llm/v1/embeddings was requested once, with the parts of "r1", "r2" and "r3", in order',
		() => {
			expect(inputs(fake)).toEqual([
				docs(part("r1", 100), part("r2", 100), part("r3", 100)),
			]);
		},
	);
	await step(
		'And one PUT was sent, with the entry_count 3 and the revs of "r1", "r2" and "r3", in order',
		() => {
			expect(fake.puts).toHaveLength(1);
			expect(fake.puts[0].url.searchParams.get("entry_count")).toBe("3");
			expect(fake.puts[0].revs).toEqual(rounds.map((r) => [r.id, REV]));
			expect(records(fake.puts[0])).toEqual(
				rounds.map((r) => [r.id.replace(/-/g, ""), DOC + r.parts[0]]),
			);
		},
	);
});

scenario(
	"Rounds are cut into batches of 6,000 characters in their order",
	async ({ step, t }) => {
		const fake = await background(step, t);
		const [r1, r2, r3] = [
			["r1", 4000],
			["r2", 3000],
			["r3", 2000],
		].map(([n, len]) => round(n, [part(n, len)]));
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[r1, r2, r3],
			'the rounds "r1" of 4,000 characters, "r2" of 3,000 and "r3" of 2,000 are pending, in that order',
		);
		await whenKick(step, fake);
		await step(
			'Then POST /llm/v1/embeddings was requested twice, with the parts of "r1", then of "r2" and "r3"',
			() => {
				expect(inputs(fake)).toEqual([
					docs(r1.parts[0]),
					docs(r2.parts[0], r3.parts[0]),
				]);
			},
		);
		await step('And two PUTs were sent, of "r1", then of "r2" and "r3"', () => {
			expect(putIds(fake)).toEqual([[hexId("r1")], [hexId("r2"), hexId("r3")]]);
		});
	},
);

scenario(
	"A round longer than a batch is embedded alone",
	async ({ step, t }) => {
		const fake = await background(step, t);
		const r1 = round("r1", [part("r1", 6000), part("r1b", 1000)]);
		const r2 = round("r2", [part("r2", 10)]);
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[r1, r2],
			'the round "r1" with parts of 6,000 and 1,000 characters and the round "r2" of 10 are pending, in that order',
		);
		await whenKick(step, fake);
		await step(
			'Then POST /llm/v1/embeddings was requested twice, with the parts of "r1", then of "r2"',
			() => {
				expect(inputs(fake)).toEqual([docs(...r1.parts), docs(...r2.parts)]);
			},
		);
		await step('And two PUTs were sent, of "r1", then of "r2"', () => {
			expect(putIds(fake)).toEqual([[hexId("r1")], [hexId("r2")]]);
		});
	},
);

scenario(
	"The embeddings are matched to the parts by their index",
	async ({ step, t }) => {
		const fake = await background(step, t);
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[round("r1", ["p1", "p2", "p3"])],
			'a round "r1" is pending with the parts "p1", "p2" and "p3"',
		);
		await step(
			"And POST /llm/v1/embeddings answers with the embeddings in reverse order, each with its index",
			() => {
				fake.embedAnswer = (body) =>
					json({
						data: body.input
							.map((t, index) => ({ index, embedding: fake.embedding(t) }))
							.reverse(),
					});
			},
		);
		await whenKick(step, fake);
		await step(
			'Then the PUT body is the records of "r1" with the embeddings of "p1", "p2" and "p3", in order',
			() => {
				expect(fake.puts).toHaveLength(1);
				expect(records(fake.puts[0])).toEqual(
					docs("p1", "p2", "p3").map((t) => [hexId("r1"), t]),
				);
			},
		);
	},
);

scenario(
	"When a batch fails, each round is embedded alone",
	async ({ step, t }) => {
		const fake = await background(step, t);
		const [r1, r2] = ["r1", "r2"].map((n) => round(n, [part(n, 100)]));
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[r1, r2],
			'the rounds "r1" and "r2" of 100 characters each are pending, in that order',
		);
		await step(
			"And POST /llm/v1/embeddings answers with the status 500 when it is given more than one input",
			() => {
				fake.embedAnswer = (body) =>
					body.input.length > 1
						? json({ error: { message: "busy" } }, 500)
						: embeddingsOf(fake, body);
			},
		);
		await whenKick(step, fake);
		await step(
			'Then POST /llm/v1/embeddings was requested three times: with the parts of "r1" and "r2", of "r1", of "r2"',
			() => {
				expect(inputs(fake)).toEqual([
					docs(r1.parts[0], r2.parts[0]),
					docs(r1.parts[0]),
					docs(r2.parts[0]),
				]);
			},
		);
		await step('And one PUT was sent, of "r1" and "r2"', () => {
			expect(putIds(fake)).toEqual([[hexId("r1"), hexId("r2")]]);
			expect(records(fake.puts[0])).toEqual([
				[hexId("r1"), DOC + r1.parts[0]],
				[hexId("r2"), DOC + r2.parts[0]],
			]);
		});
		await thenOnError(step, fake, []);
	},
);

scenario(
	"A round that fails alone is reported and skipped for the session",
	async ({ step, t }) => {
		const fake = await background(step, t);
		const [r1, r2] = ["r1", "r2"].map((n) => round(n, [part(n, 100)]));
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[r1, r2],
			'the rounds "r1" and "r2" of 100 characters each are pending, in that order',
		);
		await step(
			'And POST /llm/v1/embeddings answers with the status 500 and the error message "too large" when it is given the part of "r2"',
			() => {
				fake.embedAnswer = (body) =>
					body.input.includes(DOC + r2.parts[0])
						? json({ error: { message: "too large" } }, 500)
						: embeddingsOf(fake, body);
			},
		);
		await whenKick(step, fake);
		await step('Then one PUT was sent, of "r1"', () => {
			expect(putIds(fake)).toEqual([[hexId("r1")]]);
			expect(fake.puts[0].revs).toEqual([[r1.id, REV]]);
		});
		await thenOnError(step, fake, ["too large"]);
		const before = { embeds: 0, puts: 0, pendings: 0 };
		await step("When kick() runs again", async () => {
			before.embeds = fake.embeds.length;
			before.puts = fake.puts.length;
			before.pendings = fake.pendings.length;
			await kick(fake);
		});
		await step("Then GET /v1/vectors/pending was requested again", () => {
			expect(fake.pendings.length).toBe(before.pendings + 1);
		});
		await step(
			"But no more embeddings were requested and no more PUTs were sent",
			() => {
				expect(fake.embeds.length).toBe(before.embeds);
				expect(fake.puts.length).toBe(before.puts);
			},
		);
		await thenOnError(step, fake, ["too large"]);
	},
);

scenario(
	"A round the server keeps pending is sent once per pass",
	async ({ step, t }) => {
		const fake = await background(step, t);
		await givenAnIndexer(step, fake);
		await givenPending(
			step,
			fake,
			[round("r1", ["hello"])],
			'a round "r1" is pending with the part "hello", which the server never registers',
		);
		fake.neverRegister = true;
		await whenKick(step, fake);
		await step('Then one PUT was sent, of "r1"', () => {
			expect(putIds(fake)).toEqual([[hexId("r1")]]);
		});
		await step("And GET /v1/vectors/pending was requested twice", () => {
			expect(fake.pendings).toHaveLength(2);
		});
		await whenKick(step, fake, true);
		await step('Then two PUTs were sent, of "r1", then of "r1"', () => {
			expect(putIds(fake)).toEqual([[hexId("r1")], [hexId("r1")]]);
		});
	},
);

scenario(
	"Kicks while a pass runs cause one more pass after it",
	async ({ step, t }) => {
		const fake = await background(step, t);
		const held = [];
		const kicks = [];
		await givenAnIndexer(step, fake);
		await givenPending(step, fake, [], "nothing is pending");
		await step(
			"And GET /v1/vectors/pending is held until the test answers it",
			() => {
				fake.pendingAnswer = () => {
					if (held.length) return json([]);
					return new Promise((resolve) => held.push(resolve));
				};
			},
		);
		await step("When kick() is called three times", () => {
			for (let i = 0; i < 3; i++) kick(fake).then(() => kicks.push(i));
		});
		await step(
			"Then the second and the third call resolve at once",
			async () => {
				await expect.poll(() => kicks.length).toBe(2);
				expect(kicks).toEqual([1, 2]);
			},
		);
		await step(
			"And GET /v1/vectors/pending has been requested once",
			async () => {
				await expect.poll(() => held.length).toBe(1);
				expect(fake.pendings).toHaveLength(1);
			},
		);
		await step("When the request is answered with nothing pending", () => {
			held[0](json([]));
		});
		await step("Then the first call resolves", async () => {
			await expect.poll(() => kicks.length).toBe(3);
			expect(kicks).toEqual([1, 2, 0]);
		});
		await step("And GET /v1/vectors/pending was requested twice", () => {
			expect(fake.pendings).toHaveLength(2);
		});
	},
);

scenario("Each pass reads the config again", async ({ step, t }) => {
	const fake = await background(step, t);
	await givenAnIndexer(step, fake, "a");
	await givenPending(step, fake, [], "nothing is pending");
	await whenKick(step, fake);
	await step('And the config changes to the model "b"', () =>
		backend(fake, "/llm/", "b"),
	);
	await step("And kick() runs again", () => kick(fake));
	await step(
		'Then GET /v1/vectors/pending was requested with the model "a", then with the model "b"',
		() => {
			expect(fake.pendings.map((u) => u.searchParams.get("model"))).toEqual([
				"a",
				"b",
			]);
		},
	);
});

scenario(
	"A failed request for pending rounds is reported",
	async ({ step, t }) => {
		const fake = await background(step, t);
		await givenAnIndexer(step, fake);
		await step(
			'And GET /v1/vectors/pending answers with the status 500 and the body "boom"',
			() => {
				fake.pendingAnswer = () => text("boom", 500);
			},
		);
		await whenKick(step, fake);
		await thenOnError(step, fake, ["500 boom"], "Then");
		await step(
			"When GET /v1/vectors/pending answers with nothing pending",
			() => {
				fake.pendingAnswer = null;
				fake.rounds = [];
			},
		);
		await step("And kick() runs again", () => kick(fake));
		await step("Then GET /v1/vectors/pending was requested twice", () => {
			expect(fake.pendings).toHaveLength(2);
		});
		await thenOnError(step, fake, ["500 boom"]);
	},
);

scenario("A failed PUT is reported and ends the pass", async ({ step, t }) => {
	const fake = await background(step, t);
	await givenAnIndexer(step, fake);
	await givenPending(
		step,
		fake,
		[round("r1", ["hello"])],
		'a round "r1" is pending with the part "hello"',
	);
	await step(
		'And PUT /v1/vectors answers with the status 400 and the body "bad body"',
		() => {
			fake.putAnswer = () => text("bad body", 400);
		},
	);
	await whenKick(step, fake);
	await thenOnError(step, fake, ["400 bad body"], "Then");
	await step("And GET /v1/vectors/pending was requested once", () => {
		expect(fake.pendings).toHaveLength(1);
	});
});
