// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1019: the scenarios of docs/specs/LCTYSP-1019_search-panel.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/search/search-panel.js runs in a real browser on the test server's origin, on the empty unit page, with a real
// <lcty-conv-list> (from /c/lcty.v1.js), the real copy of the meta (api/meta-db.js and its sync worker) and the real
// semantic search worker (/fuzzy_search.worker.js). Every request is answered by a route the test sets (server.*), which
// also records it: the meta, the keyword search, the snippets, the rounds of the conversations, the defaults, the
// distribution files (one-hot rows, so the query's scores are known) and the embeddings of the fake llama-server.
// What the panel shows is read from the list (its links) and from the items it gave list.show(), kept in window.shown.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const LLM_URL = "http://llm.test";
const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The rounds (user message ids, UUIDv7) by the names the feature gives them. */
const R = {
	"r-a": "01900000-0000-7000-8000-00000000000a",
	"r-a1": "01900000-0000-7000-8000-0000000000a1",
	"r-a2": "01900000-0000-7000-8000-0000000000a2",
	"r-b": "01900000-0000-7000-8000-00000000000b",
	"r-c": "01900000-0000-7000-8000-00000000000c",
	"r-z": "01900000-0000-7000-8000-00000000000f",
};

/** A conversation's meta as GET /v1/meta-all.json returns it (LCTYSP-0006). */
function meta(id, updated, tags, messages) {
	return {
		id,
		title: `Conversation ${id}`,
		created_at: "2026-11-01T00:00:00+09:00",
		updated_at_hint: updated,
		setup_tags: [],
		tags_hint: tags,
		messages_hint: messages,
	};
}

const COPY = [
	meta("b", "2026-11-02T10:00:00+09:00", ["x"], 2),
	meta("c", "2026-11-01T10:00:00+09:00", [], 6),
	meta("a", "2026-11-03T10:00:00+09:00", ["x", "y"], 4),
];

/** The distribution files of these rounds: row i is the unit vector e_i (256 × f32 LE and 32 zero bytes). */
function distribution(ids) {
	const dat = Buffer.alloc(ids.length * 1056);
	const idx = Buffer.alloc(ids.length * 16);
	ids.forEach((id, i) => {
		dat.writeFloatLE(1, i * 1056 + i * 4);
		Buffer.from(id.replaceAll("-", ""), "hex").copy(idx, i * 16);
	});
	return { dat, idx };
}

/** The query's embedding: 3, 2, 1 in the first dimensions, so it scores the rows 3/√14, 2/√14 and 1/√14. */
const QUERY_EMBEDDING = Array.from({ length: 768 }, (_, i) =>
	i < 3 ? 3 - i : 0,
);

// ---- Background ----

async function background(page, context) {
	await givenAPage(page, context);
	await test.step("And a search box, a status and a <lcty-conv-list> in the page", async () => {
		await page.evaluate(() => {
			document.body.innerHTML =
				'<input id="box" type="search"><span id="status"></span><lcty-conv-list id="list"></lcty-conv-list>';
			const list = document.getElementById("list");
			window.shown = [];
			const show = list.show.bind(list);
			list.show = (items, empty) => {
				window.shown.push({ items: structuredClone(items), empty });
				show(items, empty);
			};
			// The requests of the main thread, to see what was sent when (the routes see them a little later)
			window.fetched = [];
			const fetch = window.fetch.bind(window);
			window.fetch = (url, init) => {
				const entry = { url: String(url), done: false };
				window.fetched.push(entry);
				return fetch(url, init).finally(() => {
					entry.done = true;
				});
			};
			window.settings = null;
		});
	});
	const empty = distribution([]);
	const server = {
		copy: [],
		searches: [],
		snippets: [],
		conversations: 0,
		defaults: 0,
		embeddings: [],
		metaAll: (route) => route.fulfill({ json: server.copy }),
		search: (route) => route.fulfill({ json: { results: [] } }),
		snippet: (route) => route.fulfill({ json: {} }),
		list: (route) => route.fulfill({ json: [] }),
		defaultsAnswer: (route) =>
			route.fulfill({ json: { embedding_model: "emb" } }),
		files: empty,
		embed: (route) =>
			route.fulfill({
				headers: CORS,
				json: { data: [{ index: 0, embedding: QUERY_EMBEDDING }] },
			}),
	};
	await test.step("And GET /v1/meta-all.json, POST /v1/search, POST /v1/snippets, GET /v1/conversations, GET /v1/defaults.json, the distribution files and the embeddings of http://llm.test are answered by the test", async () => {
		await context.route("**/v1/meta-all.json", (route) =>
			server.metaAll(route),
		);
		await context.route("**/v1/search", (route) => {
			server.searches.push(route.request().postDataJSON());
			return server.search(route);
		});
		await context.route("**/v1/snippets", (route) => {
			server.snippets.push(route.request().postDataJSON());
			return server.snippet(route);
		});
		await context.route("**/v1/conversations", (route) => {
			server.conversations++;
			return server.list(route);
		});
		await context.route("**/v1/defaults.json", (route) => {
			server.defaults++;
			return server.defaultsAnswer(route);
		});
		for (const ext of ["dat", "idx"])
			await context.route(`**/v1/vectors.eg2_264.${ext}`, (route) =>
				route.fulfill({
					contentType: "application/octet-stream",
					headers: { ETag: `"${server.files.dat.length}"` },
					body: server.files[ext],
				}),
			);
		await context.route(`${LLM_URL}/**`, (route) => {
			const req = route.request();
			if (req.method() === "OPTIONS")
				return route.fulfill({ status: 204, headers: CORS });
			server.embeddings.push({ url: req.url(), body: req.postDataJSON() });
			return server.embed(route);
		});
	});
	await test.step('And the copy of the meta will hold "a" (tags "x" and "y", newest), "b" (tag "x") and "c" (no tags, oldest)', () => {
		server.copy = COPY;
	});
	return server;
}

// ---- The panel ----

function createPanel(page) {
	return page.evaluate(async () => {
		const { createSearchPanel } = await import("/js/search/search-panel.js");
		window.panel = createSearchPanel({
			list: document.getElementById("list"),
			box: document.getElementById("box"),
			status: document.getElementById("status"),
			getSettings: () => window.settings,
		});
	});
}

/** Wait until list.show() has been called n times in all. */
function shownTimes(page, n) {
	return page.waitForFunction((n) => window.shown.length >= n, n);
}

async function givenTheLoadedPanel(page) {
	await test.step("Given the panel has loaded the copy after a sync", async () => {
		await createPanel(page);
		await page.evaluate(async () => {
			await (await import("/js/api/meta-db.js")).resetMetaDb();
		});
		await shownTimes(page, 1);
	});
}

/** setQuery(q), and wait until the search has shown its result or said why it failed. */
async function setQuery(page, q) {
	const before = await page.evaluate(() => window.shown.length);
	await page.evaluate((q) => window.panel.setQuery(q), q);
	await page.waitForFunction(
		(before) =>
			window.shown.length > before ||
			document.getElementById("status").textContent.startsWith("Search failed"),
		before,
	);
}

async function whenSetQuerySearches(page, q) {
	await test.step(`When setQuery searches "${q}"`, () => setQuery(page, q));
}

/** The items the list shows (its links). */
function listItems(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll("#list a[data-id]")].map((a) => ({
			id: a.dataset.id,
			href: a.getAttribute("href"),
			title: a.querySelector('[part~="lcty-conv-list__title"]').textContent,
			snippet:
				a.querySelector('[part~="lcty-conv-list__snippet"]')?.textContent ??
				null,
			tags: [...a.querySelectorAll(".tag-name")].map((t) => t.textContent),
			meta: a.querySelector('[part~="lcty-conv-list__meta"]').textContent,
			current: a.getAttribute("aria-current") === "true",
		})),
	);
}

const listIds = async (page) => (await listItems(page)).map((i) => i.id);
const lastShown = (page) => page.evaluate(() => window.shown.at(-1));
const statusText = (page) =>
	page.evaluate(() => document.getElementById("status").textContent);
const emptyText = (page) =>
	page.evaluate(
		() =>
			document.querySelector('#list [part~="lcty-conv-list__empty"]')
				?.textContent ?? null,
	);

async function thenTheListShows(page, ids, line) {
	await test.step(line, async () => {
		expect(await listIds(page)).toEqual(ids);
	});
}

function searchReturns(server, rounds) {
	server.search = (route) =>
		route.fulfill({
			json: {
				results: rounds.map(([name, conv]) => ({
					id: R[name],
					conv_id: conv,
					snippet: `snippet of ${name}`,
				})),
			},
		});
}

// ---- Semantic search ----

async function givenSemanticSearch(server, page) {
	await test.step('And the settings have the embedding model "emb" at http://llm.test and GET /v1/defaults.json says "emb"', async () => {
		await page.evaluate((url) => {
			window.settings = {
				backends: [{ id: "local", base_url: url, embedding_model: "emb" }],
				default_backend: "local",
			};
		}, LLM_URL);
	});
	await test.step('And GET /v1/conversations maps the rounds "r-a" to "a", "r-b" to "b" and "r-c" to "c"', () => {
		server.list = (route) =>
			route.fulfill({
				json: [
					{ id: "a", message_ids: [R["r-a"]] },
					{ id: "b", message_ids: [R["r-b"]] },
					{ id: "c", message_ids: [R["r-c"]] },
				],
			});
	});
	await test.step('And the distribution files hold the rounds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267', () => {
		server.files = distribution([R["r-a"], R["r-b"], R["r-c"]]);
	});
}

// ---- Scenarios ----

test("Opening the panel waits for the first sync, then lists the copy", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given createSearchPanel has made the panel", () =>
		createPanel(page));
	let first;
	await test.step("When refresh() is called before there is a copy", async () => {
		// The list as refresh() left it, before the sync it asked for can run
		first = await page.evaluate(async () => {
			await window.panel.refresh();
			return {
				shown: window.shown[0],
				links: document.querySelectorAll("#list a").length,
				text: document.getElementById("list").textContent,
			};
		});
	});
	await test.step("Then the list is shown empty, with no message", () => {
		expect(first).toEqual({
			shown: { items: [], empty: "" },
			links: 0,
			text: "",
		});
	});
	await test.step('And after the sync the browser runs when idle, the list shows "a", "b" and "c", newest first', async () => {
		await shownTimes(page, 2);
		expect(await listIds(page)).toEqual(["a", "b", "c"]);
	});
	await test.step("And each item has its title, tags and number of messages", async () => {
		expect(await listItems(page)).toEqual([
			{
				id: "a",
				href: "/c/a.html",
				title: "Conversation a",
				snippet: null,
				tags: ["x", "y"],
				meta: "2026-11-03 10:00 · 4 messages",
				current: false,
			},
			{
				id: "b",
				href: "/c/b.html",
				title: "Conversation b",
				snippet: null,
				tags: ["x"],
				meta: "2026-11-02 10:00 · 2 messages",
				current: false,
			},
			{
				id: "c",
				href: "/c/c.html",
				title: "Conversation c",
				snippet: null,
				tags: [],
				meta: "2026-11-01 10:00 · 6 messages",
				current: false,
			},
		]);
	});
});

test("An empty copy says there are no conversations", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await test.step("Given the copy of the meta will hold no conversations", () => {
		server.copy = [];
	});
	await test.step("And the panel has loaded the copy after a sync", async () => {
		await createPanel(page);
		await page.evaluate(async () => {
			await (await import("/js/api/meta-db.js")).resetMetaDb();
		});
		await shownTimes(page, 1);
	});
	await test.step('Then the list is shown empty with "No conversations yet"', async () => {
		expect(await listItems(page)).toEqual([]);
		expect(await emptyText(page)).toBe("No conversations yet");
	});
});

test("The list marks the current conversation", async ({ page, context }) => {
	await background(page, context);
	await givenTheLoadedPanel(page);
	const currentIds = async () =>
		(await listItems(page)).filter((i) => i.current).map((i) => i.id);
	await test.step('When current is set to "b"', async () => {
		await page.evaluate(() => {
			window.panel.current = "b";
		});
	});
	await test.step('Then the item "b" is marked as current', async () => {
		expect(await currentIds()).toEqual(["b"]);
	});
	await test.step("When the list is shown again by a search", () =>
		setQuery(page, "tag:x"));
	await test.step('Then the item "b" is still marked as current', async () => {
		expect(await listIds(page)).toEqual(["a", "b"]);
		expect(await currentIds()).toEqual(["b"]);
	});
});

test("tag: alone lists the conversations with every tag, newest first", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await whenSetQuerySearches(page, "tag:x");
	await thenTheListShows(page, ["a", "b"], 'Then the list shows "a" and "b"');
	await whenSetQuerySearches(page, "tag:x tag:y");
	await thenTheListShows(page, ["a"], 'Then the list shows "a"');
	await test.step('And the box holds "tag:x tag:y", the status is empty and nothing was sent to POST /v1/search', async () => {
		expect(await page.locator("#box").inputValue()).toBe("tag:x tag:y");
		expect(await statusText(page)).toBe("");
		expect(server.searches).toEqual([]);
	});
});

test("A tag no conversation has finds nothing", async ({ page, context }) => {
	await background(page, context);
	await givenTheLoadedPanel(page);
	await whenSetQuerySearches(page, "tag:none");
	await test.step('Then the list is shown empty with "No matching conversations"', async () => {
		expect(await listItems(page)).toEqual([]);
		expect(await emptyText(page)).toBe("No matching conversations");
	});
});

test("Clicking a tag of an item searches that tag", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('When the tag "y" of the item "a" is clicked', async () => {
		const before = await page.evaluate(() => window.shown.length);
		await page
			.locator('#list a[data-id="a"] .tag-name', { hasText: "y" })
			.click();
		await shownTimes(page, before + 1);
	});
	await test.step('Then the box holds "tag:y"', async () => {
		expect(await page.locator("#box").inputValue()).toBe("tag:y");
	});
	await thenTheListShows(page, ["a"], 'And the list shows "a"');
	expect(page.url()).toContain("/__lcty_unit.html");
});

test("Clearing the box lists every conversation again", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And setQuery has searched "tag:y"', () =>
		setQuery(page, "tag:y"));
	await whenSetQuerySearches(page, "  ");
	await thenTheListShows(
		page,
		["a", "b", "c"],
		'Then the list shows "a", "b" and "c"',
	);
});

test("A keyword search shows the rounds the server found, in rank order", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And POST /v1/search returns the rounds "r-b" of "b" and "r-a" of "a" with snippets', () =>
		searchReturns(server, [
			["r-b", "b"],
			["r-a", "a"],
		]));
	await whenSetQuerySearches(page, "  hello   world  ");
	await test.step('Then POST /v1/search is sent the query "hello world", no tags and the limit 50', () => {
		expect(server.searches).toEqual([
			{ q: "hello world", tags: [], limit: 50 },
		]);
	});
	await test.step('And the list shows "b" and "a", each linked to its round with its snippet', async () => {
		expect(
			(await listItems(page)).map(({ id, href, snippet }) => ({
				id,
				href,
				snippet,
			})),
		).toEqual([
			{
				id: "b",
				href: `/c/b.html#c-msg-${R["r-b"]}`,
				snippet: "snippet of r-b",
			},
			{
				id: "a",
				href: `/c/a.html#c-msg-${R["r-a"]}`,
				snippet: "snippet of r-a",
			},
		]);
	});
	await test.step('And the sources of both are "keyword" and the status is empty', async () => {
		expect((await lastShown(page)).items.map((i) => i.sources)).toEqual([
			["keyword"],
			["keyword"],
		]);
		expect(await statusText(page)).toBe("");
	});
	await test.step("And nothing was sent to GET /v1/defaults.json or POST /v1/snippets", () => {
		expect([server.defaults, server.snippets]).toEqual([0, []]);
	});
});

test("A keyword search keeps the best round of each conversation in the list", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And POST /v1/search returns the rounds "r-a1" of "a", "r-z" of "z", which is not in the list, "r-a2" of "a" and "r-c" of "c"', () =>
		searchReturns(server, [
			["r-a1", "a"],
			["r-z", "z"],
			["r-a2", "a"],
			["r-c", "c"],
		]));
	await whenSetQuerySearches(page, "hello");
	await test.step('Then the list shows "a" with the round "r-a1" and "c" with the round "r-c"', async () => {
		expect(
			(await lastShown(page)).items.map((i) => [i.id, i.chunk_id]),
		).toEqual([
			["a", R["r-a1"]],
			["c", R["r-c"]],
		]);
		expect(await listIds(page)).toEqual(["a", "c"]);
	});
});

test("tag: filters are sent with the keyword search", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And POST /v1/search returns the rounds "r-a" of "a"', () =>
		searchReturns(server, [["r-a", "a"]]));
	await whenSetQuerySearches(page, "tag:x hello tag: tag:y");
	await test.step('Then POST /v1/search is sent the query "hello" and the tags "x" and "y"', () => {
		expect(server.searches).toEqual([
			{ q: "hello", tags: ["x", "y"], limit: 50 },
		]);
	});
});

test("A failed keyword search says why and keeps the list", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And POST /v1/search answers with the status 500 and "boom"', () => {
		server.search = (route) => route.fulfill({ status: 500, body: "boom" });
	});
	await whenSetQuerySearches(page, "hello");
	await test.step('Then the status says "Search failed: 500 boom"', async () => {
		expect(await statusText(page)).toBe("Search failed: 500 boom");
	});
	await thenTheListShows(
		page,
		["a", "b", "c"],
		'And the list still shows "a", "b" and "c"',
	);
});

test("Typing searches once the box has been still for 250 ms", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And POST /v1/search returns the rounds "r-a" of "a"', () =>
		searchReturns(server, [["r-a", "a"]]));
	let early;
	await test.step('When "hel" and then "hello" are typed into the box within 250 ms', async () => {
		early = await page.evaluate(async () => {
			const box = document.getElementById("box");
			const type = (v) => {
				box.value = v;
				box.dispatchEvent(new Event("input"));
			};
			const searches = () =>
				window.fetched.filter((f) => f.url.endsWith("/v1/search")).length;
			const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			type("hel");
			await wait(150);
			type("hello");
			await wait(150); // 300 ms after "hel", 150 ms after "hello"
			return searches();
		});
	});
	await test.step("Then nothing is sent to POST /v1/search before 250 ms have passed", () => {
		expect(early).toBe(0);
	});
	await test.step('And then one search is sent, for "hello"', async () => {
		await shownTimes(page, 2);
		expect(server.searches.map((s) => s.q)).toEqual(["hello"]);
	});
	await thenTheListShows(page, ["a"], 'And the list shows "a"');
});

test("An older search that ends later is dropped", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	await test.step('And POST /v1/search answers "first" late with the round "r-a" of "a" and "second" at once with the round "r-b" of "b"', () => {
		server.search = async (route) => {
			const { q } = route.request().postDataJSON();
			if (q === "first") await gate;
			const [name, conv] = q === "first" ? ["r-a", "a"] : ["r-b", "b"];
			await route.fulfill({
				json: { results: [{ id: R[name], conv_id: conv, snippet: name }] },
			});
		};
	});
	await test.step('When setQuery searches "first" and then "second"', async () => {
		await page.evaluate(() => {
			window.panel.setQuery("first");
			window.panel.setQuery("second");
		});
		await shownTimes(page, 2);
	});
	await test.step('And the answer to "first" arrives last', async () => {
		release();
		await page.waitForFunction(() => window.fetched.every((f) => f.done));
		await page.evaluate(
			() => new Promise((resolve) => setTimeout(resolve, 100)),
		);
	});
	await test.step('Then the list shows "b"', async () => {
		expect(await page.evaluate(() => window.shown.length)).toBe(2);
		expect(await listIds(page)).toEqual(["b"]);
	});
});

test("Clearing the box drops a search still in flight", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	await test.step('And POST /v1/search answers "hello" late with the round "r-a" of "a"', () => {
		server.search = async (route) => {
			await gate;
			await route.fulfill({
				json: { results: [{ id: R["r-a"], conv_id: "a", snippet: "r-a" }] },
			});
		};
	});
	await test.step('When setQuery searches "hello"', async () => {
		await page.evaluate(() => window.panel.setQuery("hello"));
		await expect.poll(() => server.searches.length).toBe(1);
	});
	await test.step("And setQuery clears the box before the answer arrives", async () => {
		await setQuery(page, "");
	});
	await test.step('And the answer to "hello" arrives', async () => {
		release();
		await page.waitForFunction(() => window.fetched.every((f) => f.done));
		await page.evaluate(
			() => new Promise((resolve) => setTimeout(resolve, 100)),
		);
	});
	await thenTheListShows(
		page,
		["a", "b", "c"],
		'Then the list still shows "a", "b" and "c"',
	);
	await test.step("And the status is empty", async () => {
		expect(await statusText(page)).toBe("");
	});
});

test("A semantic search is merged with the keyword search by RRF", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await givenSemanticSearch(server, page);
	await test.step('And POST /v1/search returns the round "r-b" of "b" with a snippet', () =>
		searchReturns(server, [["r-b", "b"]]));
	await test.step('And POST /v1/snippets returns snippets for "r-a" and "r-c"', () => {
		server.snippet = (route) =>
			route.fulfill({
				json: {
					[R["r-a"]]: { conv_id: "a", snippet: "found r-a" },
					[R["r-c"]]: { conv_id: "c", snippet: "found r-c" },
				},
			});
	});
	await whenSetQuerySearches(page, "hello");
	await test.step('Then the query "task: search result | query: hello" is embedded by http://llm.test/v1/embeddings with the model "emb"', () => {
		expect(server.embeddings).toEqual([
			{
				url: `${LLM_URL}/v1/embeddings`,
				body: { model: "emb", input: ["task: search result | query: hello"] },
			},
		]);
	});
	let items;
	await test.step('And the list shows "b", "a" and "c", in the order of 1/61 + 1/62, 1/61 and 1/63', async () => {
		items = (await lastShown(page)).items;
		expect(items.map((i) => i.id)).toEqual(["b", "a", "c"]);
		expect(items[0].score).toBeCloseTo(1 / 61 + 1 / 62, 12);
		expect(items[1].score).toBeCloseTo(1 / 61, 12);
		expect(items[2].score).toBeCloseTo(1 / 63, 12);
		expect(await listIds(page)).toEqual(["b", "a", "c"]);
	});
	await test.step('And the sources of "b" are "keyword" and "semantic:0.535", of "a" "semantic:0.802" and of "c" "semantic:0.267"', () => {
		expect(items.map((i) => i.sources)).toEqual([
			["keyword", "semantic:0.535"],
			["semantic:0.802"],
			["semantic:0.267"],
		]);
	});
	await test.step('And POST /v1/snippets is sent the rounds "r-a" and "r-c" with the query "hello", and their snippets are shown', async () => {
		expect(server.snippets).toEqual([
			{ ids: [R["r-a"], R["r-c"]], q: "hello" },
		]);
		expect((await listItems(page)).map((i) => i.snippet)).toEqual([
			"snippet of r-b",
			"found r-a",
			"found r-c",
		]);
	});
	await test.step("And the status is empty", async () => {
		expect(await statusText(page)).toBe("");
	});
});

test("tag: filters limit the semantic hits to the conversations with the tags", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await givenSemanticSearch(server, page);
	await test.step("And POST /v1/search returns no rounds", () =>
		searchReturns(server, []));
	await whenSetQuerySearches(page, "hello tag:x");
	await thenTheListShows(page, ["a", "b"], 'Then the list shows "a" and "b"');
});

test("The rounds of the conversations are fetched once until the list changes", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await givenSemanticSearch(server, page);
	await test.step('When setQuery searches "hello" and then "world"', async () => {
		await setQuery(page, "hello");
		await setQuery(page, "world");
	});
	await test.step("Then GET /v1/conversations was fetched once", () => {
		expect(server.conversations).toBe(1);
		expect(server.embeddings).toHaveLength(2);
	});
	await test.step("When a sync stores a new list", async () => {
		await page.evaluate(async () => {
			await (await import("/js/api/meta-db.js")).resetMetaDb();
		});
	});
	await test.step("Then the search runs again and GET /v1/conversations is fetched again", async () => {
		await expect.poll(() => server.conversations).toBe(2);
		await expect
			.poll(() => server.searches.map((s) => s.q))
			.toEqual(["hello", "world", "world"]);
	});
});

for (const { failure, error, fail } of [
	{
		failure: 'GET /v1/defaults.json says "other"',
		error: "the vectors are for other, not emb",
		fail: (server) => {
			server.defaultsAnswer = (route) =>
				route.fulfill({ json: { embedding_model: "other" } });
		},
	},
	{
		failure: 'the embeddings answer with the status 503 and "down"',
		error: "down",
		fail: (server) => {
			server.embed = (route) =>
				route.fulfill({
					status: 503,
					headers: CORS,
					json: { error: { message: "down" } },
				});
		},
	},
	{
		failure: 'GET /v1/defaults.json answers with the status 500 and "boom"',
		error: "500 boom",
		fail: (server) => {
			server.defaultsAnswer = (route) =>
				route.fulfill({ status: 500, body: "boom" });
		},
	},
]) {
	test(`Without semantic search the keyword results are shown with a notice (${failure})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheLoadedPanel(page);
		await test.step('And the settings have the embedding model "emb" at http://llm.test and GET /v1/defaults.json says "emb"', async () => {
			await page.evaluate((url) => {
				window.settings = {
					backends: [{ id: "local", base_url: url, embedding_model: "emb" }],
					default_backend: "local",
				};
			}, LLM_URL);
		});
		await test.step(`And ${failure}`, () => fail(server));
		await test.step('And POST /v1/search returns the rounds "r-a" of "a"', () =>
			searchReturns(server, [["r-a", "a"]]));
		await whenSetQuerySearches(page, "hello");
		await thenTheListShows(page, ["a"], 'Then the list shows "a"');
		await test.step(`And the status says "Semantic search is unavailable (${error}); searching by keywords only"`, async () => {
			expect(await statusText(page)).toBe(
				`Semantic search is unavailable (${error}); searching by keywords only`,
			);
		});
	});
}

test("Without an embedding model only the keywords are searched", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step("And the settings have no embedding model", async () => {
		await page.evaluate((url) => {
			window.settings = {
				backends: [{ id: "local", base_url: url, embedding_model: "" }],
				default_backend: "local",
			};
		}, LLM_URL);
	});
	await test.step('And POST /v1/search returns the rounds "r-a" of "a"', () =>
		searchReturns(server, [["r-a", "a"]]));
	await whenSetQuerySearches(page, "hello");
	await test.step('Then the list shows "a" and the status is empty', async () => {
		expect(await listIds(page)).toEqual(["a"]);
		expect(await statusText(page)).toBe("");
	});
	await test.step("And nothing was sent to GET /v1/defaults.json, GET /v1/conversations or the embeddings", () => {
		expect([server.defaults, server.conversations, server.embeddings]).toEqual([
			0,
			0,
			[],
		]);
	});
});
