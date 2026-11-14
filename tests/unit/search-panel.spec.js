// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1019: the scenarios of docs/specs/LCTYSP-1019_search-panel.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read side by side.
//
// js/search/search-panel.js runs in a real browser on the test server's origin, on the empty unit page, with a real
// <lcty-conv-list> (from /c/lcty.v1.js), the real copies of the list (api/meta-db.js and api/lcty-t.js with their
// workers, lcty_c and lcty_t) and the real semantic search worker (/fuzzy_search.worker.js). The tab's /v1/rpc
// connection is a stand-in (window.rpc, answering window.lists) handed to readMetaDbFrom and
// readTagsOfConversationsFrom, and the notifications are passed to applyMetaBatch and applyTagBatch, so the workers
// store the copies as they do in a page; the same stand-in answers vectors.eg2_264.embed with the query vector
// (window.embedded keeps the texts it was asked). Every request is answered by a route the test sets (server.*), which
// also records it: the tags, the keyword search, the snippets, the rounds of the conversations and the vector pair
// (its JSON, and its rows and ids by Range; one-hot rows, so the query's scores are known).
// What the panel shows is read from the list (its links) and from the items it gave list.show(), kept in window.shown.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

/** The messages (UUIDv7) by the names the feature gives them: a round is the id of its user message. */
const R = {
	"r-a": "01900000-0000-7000-8000-00000000000a",
	"r-a1": "01900000-0000-7000-8000-0000000000a1",
	"r-a2": "01900000-0000-7000-8000-0000000000a2",
	"r-b": "01900000-0000-7000-8000-00000000000b",
	"r-c": "01900000-0000-7000-8000-00000000000c",
	"r-z": "01900000-0000-7000-8000-00000000000f",
	"m-a": "01900000-0000-7000-8000-0000000000aa",
};

/** A row of c_meta as c.list and c.batch.updated give it (LCTYSP-0014). */
function metaRow(cid, day) {
	return {
		cid,
		lang: "en",
		title: `Conversation ${cid}`,
		titleTypeId: "__40",
		updatedAt: `2026-11-0${day}T10:00:00.000Z`,
		createdAt: "2026-11-01T00:00:00.000Z",
	};
}

/** The conversations: [cid, day of updatedAt, number of elements, tags]. */
const CONVERSATIONS = [
	["b", 2, 2, ["x"]],
	["c", 1, 6, []],
	["a", 3, 4, ["w", "x", "y"]],
];

/** What c.list, c.recordcount.list and t.c.list answer at version for these conversations. */
function listsOf(version, convs) {
	return {
		"c.list": { version, items: convs.map(([cid, day]) => metaRow(cid, day)) },
		"c.recordcount.list": {
			version,
			items: convs.map(([cid, , count]) => ({ cid, count })),
		},
		"t.c.list": {
			version,
			items: convs.flatMap(([cid, , , tags]) =>
				tags.map((tag) => ({ tag, cid })),
			),
		},
	};
}

/** GET /v1/tags: "y" before "x" in the order of the files, so a conversation's tags are not shown by reference. */
const TAGS = [
	{ file: "00010-y.html", name: "y", ops: [], prompt: "", memory: [] },
	{ file: "00020-x.html", name: "x", ops: [], prompt: "", memory: [] },
];

const REV = 1763000000000;

/** The vector pair of these messages: record 0 is the header, record i + 1 the unit vector e_i and the id of the ith. */
function pairOf(ids) {
	const n = ids.length + 1;
	const dat = Buffer.alloc(n * 1056);
	const idx = Buffer.alloc(n * 16);
	ids.forEach((id, i) => {
		dat.writeFloatLE(1, (i + 1) * 1056 + i * 4);
		Buffer.from(id.replaceAll("-", ""), "hex").copy(idx, (i + 1) * 16);
	});
	return { json: { rev: REV, count: n, invalid: [] }, dat, idx };
}

/** The query vector, as vectors.eg2_264.embed answers it: (3, 2, 1, 0, …)/√14, scoring the rows 0.802, 0.535, 0.267. */
const QUERY = Buffer.from(
	Float32Array.from({ length: 256 }, (_, i) =>
		i < 3 ? (3 - i) / Math.sqrt(14) : 0,
	).buffer,
).toString("base64");

/** Answer a request for bytes of .dat or .idx by its Range, as the server does. */
function answerRange(route, body) {
	const headers = route.request().headers();
	if (headers["if-match"] && headers["if-match"] !== `"${REV}"`)
		return route.fulfill({ status: 412, body: "stale" });
	const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(headers.range ?? "") ?? [];
	if (first === undefined) return route.fulfill({ body });
	return route.fulfill({
		status: 206,
		contentType: "application/octet-stream",
		headers: { "Content-Range": `bytes ${first}-${last}/${body.length}` },
		body: body.subarray(Number(first), Number(last) + 1),
	});
}

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
			// The tab's /v1/rpc connection: answers what window.lists holds, and embeds a query with window.query
			window.lists = {};
			window.embedded = [];
			window.embedError = null;
			window.rpc = {
				call: async (method, params) => {
					if (method !== "vectors.eg2_264.embed")
						return structuredClone(window.lists[method]);
					window.embedded.push(params.text);
					if (window.embedError) throw window.embedError;
					return { vector: window.query };
				},
			};
		});
		await page.evaluate((q) => {
			window.query = q;
		}, QUERY);
	});
	const server = {
		tags: [],
		searches: [],
		snippets: [],
		conversations: 0,
		search: (route) => route.fulfill({ json: { results: [] } }),
		snippet: (route) => route.fulfill({ json: {} }),
		list: (route) => route.fulfill({ json: [] }),
		pair: pairOf([]),
		pairJson: (route) => route.fulfill({ json: server.pair.json }),
	};
	await test.step("And GET /v1/tags, POST /v1/search, POST /v1/snippets, GET /v1/conversations and the vector pair are answered by the test, and vectors.eg2_264.embed by the tab's connection", async () => {
		await context.route("**/v1/tags", (route) =>
			route.fulfill({
				headers: { ETag: '"t1"' },
				json: { tags: server.tags },
			}),
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
		await context.route("**/v1/vectors.eg2_264.json", (route) =>
			server.pairJson(route),
		);
		for (const ext of ["dat", "idx"])
			await context.route(`**/v1/vectors.eg2_264.${ext}`, (route) =>
				answerRange(route, server.pair[ext]),
			);
	});
	await test.step('And GET /v1/tags defines the tags "y" and then "x"', () => {
		server.tags = TAGS;
	});
	await test.step('And the lists of the tab\'s connection hold at the version "b007.1" "a" (4 elements, tags "w", "x" and "y", newest), "b" (2 elements, tag "x") and "c" (6 elements, no tags, oldest)', () =>
		holdLists(page, listsOf("b007.1", CONVERSATIONS)));
	return server;
}

/** What the stand-in of the tab's connection answers from now on. */
function holdLists(page, lists) {
	return page.evaluate((lists) => {
		window.lists = lists;
	}, lists);
}

/** Read the lists over the stand-in into the copies, as the sidebar does when the connection opens. */
function readLists(page, which = ["meta", "tags"]) {
	return page.evaluate(async (which) => {
		const [{ readMetaDbFrom }, { readTagsOfConversationsFrom }] =
			await Promise.all([
				import("/js/api/meta-db.js"),
				import("/js/api/lcty-t.js"),
			]);
		await Promise.all([
			which.includes("meta") && readMetaDbFrom(window.rpc),
			which.includes("tags") && readTagsOfConversationsFrom(window.rpc),
		]);
	}, which);
}

// ---- The panel ----

function createPanel(page) {
	return page.evaluate(async () => {
		const { createSearchPanel } = await import("/js/search/search-panel.js");
		window.panel = createSearchPanel({
			list: document.getElementById("list"),
			box: document.getElementById("box"),
			status: document.getElementById("status"),
			rpc: () => window.rpc,
			// The tab's notifications: window.notify(method, params) passes one to the panel
			onNotify: (method, fn) => {
				window.notified ??= {};
				window.notified[method] = fn;
				window.notify ??= (m, params) => window.notified[m]?.(params);
			},
		});
	});
}

/** Wait until list.show() has been called n times in all. */
function shownTimes(page, n) {
	return page.waitForFunction((n) => window.shown.length >= n, n);
}

// The lists are read before the panel is made, so refresh() is what shows them: list.show() has been called once
async function givenTheLoadedPanel(page, keyword = "Given") {
	await test.step(`${keyword} the lists have been read into the copies and refresh() has shown them`, async () => {
		await readLists(page);
		await createPanel(page);
		await page.evaluate(() => window.panel.refresh());
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

const embedded = (page) => page.evaluate(() => window.embedded);

async function givenTheRounds(server) {
	await test.step('And GET /v1/conversations gives "a" the round "r-a", "b" the round "r-b" and "c" the round "r-c"', () => {
		server.list = (route) =>
			route.fulfill({
				json: ["a", "b", "c"].map((c) => ({
					id: c,
					message_rounds: [[R[`r-${c}`], R[`r-${c}`]]],
				})),
			});
	});
}

async function givenSemanticSearch(server) {
	await givenTheRounds(server);
	await test.step('And the vector pair holds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267', () => {
		server.pair = pairOf([R["r-a"], R["r-b"], R["r-c"]]);
	});
}

// ---- Scenarios ----

test("Opening the panel waits for the first read of the lists, then lists the copies", async ({
	page,
	context,
}) => {
	await background(page, context);
	await test.step("Given createSearchPanel has made the panel", () =>
		createPanel(page));
	let first;
	await test.step("When refresh() is called before the lists have been read", async () => {
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
	await test.step("When the tab's connection reads c.list, c.recordcount.list and t.c.list into the copies", () =>
		readLists(page));
	await test.step('Then the list shows "a", "b" and "c", newest first', async () => {
		// Each copy that was stored shows the list again: wait for the one that has the tags too
		await expect
			.poll(async () => (await listItems(page)).map((i) => [i.id, i.tags]))
			.toEqual([
				["a", ["y", "x", "w"]],
				["b", ["x"]],
				["c", []],
			]);
	});
	await test.step('And each item has its title, its tags in the order of the tag files with the undefined "w" last, and its number of messages', async () => {
		expect(await listItems(page)).toEqual([
			{
				id: "a",
				href: "../c/a.html",
				title: "Conversation a",
				snippet: null,
				tags: ["y", "x", "w"],
				meta: "2026-11-03 10:00 · 4 messages",
				current: false,
			},
			{
				id: "b",
				href: "../c/b.html",
				title: "Conversation b",
				snippet: null,
				tags: ["x"],
				meta: "2026-11-02 10:00 · 2 messages",
				current: false,
			},
			{
				id: "c",
				href: "../c/c.html",
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
	await background(page, context);
	await test.step("Given the lists of the tab's connection hold no conversations", () =>
		holdLists(page, listsOf("b007.1", [])));
	await givenTheLoadedPanel(page, "And");
	await test.step('Then the list is shown empty with "No conversations yet"', async () => {
		expect(await listItems(page)).toEqual([]);
		expect(await emptyText(page)).toBe("No conversations yet");
	});
});

test("A change stored in the copies is shown at once", async ({
	page,
	context,
}) => {
	await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('When c.batch.updated puts "d" (3 elements, the newest) at the version "b007.2"', () =>
		page.evaluate(
			async ([row]) => {
				(await import("/js/api/meta-db.js")).applyMetaBatch({
					version: "b007.2",
					actorId: "someone",
					records: [
						{ store: "c_meta", op: "put", row },
						{ store: "c_recordcount", op: "put", row: { cid: "d", count: 3 } },
					],
				});
			},
			[metaRow("d", 4)],
		));
	await test.step('Then the list shows "d", "a", "b" and "c"', async () => {
		await expect.poll(() => listIds(page)).toEqual(["d", "a", "b", "c"]);
	});
	await test.step('When t.batch.updated gives "d" the tag "x" at the version "b007.2"', () =>
		page.evaluate(async () => {
			(await import("/js/api/lcty-t.js")).applyTagBatch({
				version: "b007.2",
				actorId: "someone",
				records: [
					{ store: "t_has_many_c", op: "put", row: { tag: "x", cid: "d" } },
				],
			});
		}));
	await test.step('Then the item "d" has the tag "x" and 3 messages', async () => {
		await expect
			.poll(async () =>
				(await listItems(page))
					.filter((i) => i.id === "d")
					.map(({ tags, meta }) => ({ tags, meta })),
			)
			.toEqual([{ tags: ["x"], meta: "2026-11-04 10:00 · 3 messages" }]);
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
				href: `../c/b.html#c-msg-${R["r-b"]}`,
				snippet: "snippet of r-b",
			},
			{
				id: "a",
				href: `../c/a.html#c-msg-${R["r-a"]}`,
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
	await test.step("And nothing was sent to POST /v1/snippets", () => {
		expect(server.snippets).toEqual([]);
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
	await givenSemanticSearch(server);
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
	await test.step('Then vectors.eg2_264.embed is asked for the text "hello"', async () => {
		expect(await embedded(page)).toEqual(["hello"]);
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

test("A reply's hit counts once for its round, with the better score", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And GET /v1/conversations gives "a" the round "r-a" with its reply "m-a", and "b" the round "r-b"', () => {
		server.list = (route) =>
			route.fulfill({
				json: [
					{
						id: "a",
						message_rounds: [
							[R["r-a"], R["r-a"]],
							[R["m-a"], R["r-a"]],
						],
					},
					{ id: "b", message_rounds: [[R["r-b"], R["r-b"]]] },
				],
			});
	});
	await test.step('And the vector pair holds "m-a", "r-b" and "r-a", which the query scores 0.802, 0.535 and 0.267', () => {
		server.pair = pairOf([R["m-a"], R["r-b"], R["r-a"]]);
	});
	await test.step("And POST /v1/search returns no rounds", () =>
		searchReturns(server, []));
	await whenSetQuerySearches(page, "hello");
	let items;
	await test.step('Then the list shows "a" with the round "r-a" and "b" with the round "r-b"', async () => {
		items = (await lastShown(page)).items;
		expect(items.map((i) => [i.id, i.chunk_id])).toEqual([
			["a", R["r-a"]],
			["b", R["r-b"]],
		]);
		expect(await listIds(page)).toEqual(["a", "b"]);
	});
	await test.step('And the sources of "a" are "semantic:0.802" and of "b" "semantic:0.535"', () => {
		expect(items.map((i) => i.sources)).toEqual([
			["semantic:0.802"],
			["semantic:0.535"],
		]);
	});
});

test("tag: filters limit the semantic hits to the conversations with the tags", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await givenSemanticSearch(server);
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
	await givenSemanticSearch(server);
	await test.step('When setQuery searches "hello" and then "world"', async () => {
		await setQuery(page, "hello");
		await setQuery(page, "world");
	});
	await test.step("Then GET /v1/conversations was fetched once", async () => {
		expect(server.conversations).toBe(1);
		expect(await embedded(page)).toEqual(["hello", "world"]);
	});
	await test.step('When the tab\'s connection reads c.list and c.recordcount.list again at the version "b007.2"', async () => {
		await holdLists(page, listsOf("b007.2", CONVERSATIONS));
		await readLists(page, ["meta"]);
	});
	await test.step("Then the search runs again and GET /v1/conversations is fetched again", async () => {
		await expect.poll(() => server.conversations).toBe(2);
		await expect
			.poll(() => server.searches.map((s) => s.q))
			.toEqual(["hello", "world", "world"]);
	});
});

test("A notification of the vector pair brings the copy up to date without the JSON", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheLoadedPanel(page);
	await test.step('And the tab\'s connection has the actorId "actor-1"', () =>
		page.evaluate(() => {
			window.rpc.actorId = "actor-1";
		}));
	await givenTheRounds(server);
	let json = 0;
	await test.step('And the vector pair holds "r-a" and "r-b", which the query scores 0.802 and 0.535', () => {
		server.pair = pairOf([R["r-a"], R["r-b"]]);
		server.pairJson = (route) => {
			json++;
			return route.fulfill({ json: server.pair.json });
		};
	});
	await test.step("And POST /v1/search returns no rounds", () =>
		searchReturns(server, []));
	await test.step('And setQuery has searched "hello"', () =>
		setQuery(page, "hello"));
	await test.step('And the vector pair now holds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267', () => {
		server.pair = pairOf([R["r-a"], R["r-b"], R["r-c"]]);
	});
	await test.step("When the tab's connection notifies vectors.eg2_264.changed with the summary of the pair", () =>
		page.evaluate(
			(summary) => window.notify("vectors.eg2_264.changed", summary),
			server.pair.json,
		));
	await test.step('And setQuery searches "world"', () =>
		setQuery(page, "world"));
	await thenTheListShows(
		page,
		["a", "b", "c"],
		'Then the list shows "a", "b" and "c"',
	);
	await test.step("And GET /v1/vectors.eg2_264.json was fetched once", () => {
		expect(json).toBe(1);
	});
});

for (const { failure, error, fail } of [
	{
		failure: 'vectors.eg2_264.embed answers the error 7 "no embedding server"',
		error: "no embedding server",
		fail: (_server, page) =>
			page.evaluate(async () => {
				const { RpcError } = await import("/js/api/rpc.js");
				window.embedError = new RpcError({
					code: 7,
					message: "no embedding server",
				});
			}),
	},
	{
		failure: "GET /v1/vectors.eg2_264.json answers with the status 503",
		error: "failed to fetch the vectors (HTTP 503)",
		fail: (server) => {
			server.pairJson = (route) => route.fulfill({ status: 503, body: "off" });
		},
	},
	{
		failure: 'GET /v1/conversations answers with the status 500 and "boom"',
		error: "500 boom",
		fail: (server) => {
			server.list = (route) => route.fulfill({ status: 500, body: "boom" });
		},
	},
]) {
	test(`Without semantic search the keyword results are shown with a notice (${failure})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheLoadedPanel(page);
		await givenTheRounds(server);
		await test.step(`And ${failure}`, () => fail(server, page));
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
