// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1009: the scenarios of docs/specs/LCTYSP-1009_storage-api.feature that need the browser (the sync of the meta,
// whose worker fetches GET /v1/meta-all.json), written by hand. Each test has the title of its Scenario (an Examples
// row is added in parentheses) and one test.step per line of it, so the two read side by side. The other Scenarios run
// in Node.js, in tests/unit/storage.test.js.
//
// js/api/storage.js runs in a real browser on the test server's origin. Every request to /v1/ is answered by a route
// (routes also catch the meta sync worker's GET /v1/meta-all.json, answered with an empty list), so the server's data
// does not matter. A call of the feature, such as appendLines("c1", []), is the function's name and JSON arguments.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const META_ALL = "/v1/meta-all.json";

// ---- Background, and the page ----

/**
 * Every request to /v1/ answered by answer(route), which the test sets, then a page on the server's origin.
 * requests: the requests other than GET /v1/meta-all.json, {method, url (path and query), contentType, body}, in
 * order; syncs: the times (Date.now()) GET /v1/meta-all.json was requested.
 */
async function background(page, context) {
	const server = {
		answer: (route) => route.fulfill({ json: { ok: true } }),
		requests: [],
		syncs: [],
	};
	await test.step("Given requests to /v1/ are answered by the test, which records them", async () => {
		await context.route(
			(url) => url.pathname.startsWith("/v1/"),
			(route) => {
				const req = route.request();
				const url = new URL(req.url());
				if (url.pathname === META_ALL) {
					server.syncs.push(Date.now());
					return route.fulfill({ json: [] });
				}
				const buffer = req.postDataBuffer();
				server.requests.push({
					at: Date.now(),
					method: req.method(),
					url: url.pathname + url.search,
					contentType: req.headers()["content-type"] ?? null,
					body: buffer ? buffer.toString("utf8") : null,
				});
				return server.answer(route);
			},
		);
	});
	await givenAPage(page, context);
	return server;
}

// ---- Calling the module, from the page ----

/** "name(args…)" → {name, args}, the arguments being JSON. */
function parseCall(call) {
	const m = /^(\w+)\((.*)\)$/s.exec(call);
	return { name: m[1], args: JSON.parse(`[${m[2]}]`) };
}

/** Call a function of storage.js in the page: {value} or {error: {name, message}}. */
function callStorage(page, name, args) {
	return page.evaluate(
		async ({ name, args }) => {
			const storage = await import("/js/api/storage.js");
			try {
				return { value: await storage[name](...args) };
			} catch (e) {
				return { error: { name: e.name, message: e.message } };
			}
		},
		{ name, args },
	);
}

async function whenCalled(page, call) {
	let result;
	await test.step(`When ${call} is called`, async () => {
		const { name, args } = parseCall(call);
		result = await callStorage(page, name, args);
	});
	return result;
}

async function givenTheServerAnswers(server, json) {
	await test.step(`Given the server answers ${JSON.stringify(json).replace(/([:,])/g, "$1 ")}`, () => {
		server.answer = (route) => route.fulfill({ json });
	});
}

async function thenTheSyncFetches(server) {
	await test.step("And the meta sync worker then fetches GET /v1/meta-all.json", async () => {
		await expect
			.poll(() => server.syncs.length, { timeout: 15000 })
			.toBeGreaterThan(0);
		expect(server.requests).toHaveLength(1);
		expect(server.syncs[0]).toBeGreaterThanOrEqual(server.requests[0].at);
	});
}

// ---- Scenarios: the sync of the meta ----

for (const call of [
	'createConversation({"id": "c1"}, [])',
	'appendLines("c1", [])',
	'popMessages("c1", 2)',
	'deleteConversation("c1")',
]) {
	test(`A change of conversations asks for a sync of the meta (${call})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await givenTheServerAnswers(server, { ok: true });
		const result = await whenCalled(page, call);
		await test.step("Then it resolves", () => {
			expect(result).toEqual({ value: { ok: true } });
		});
		await thenTheSyncFetches(server);
	});
}

for (const { answer, fulfill } of [
	{
		answer: "the server answers with the status 500",
		fulfill: (route) => route.fulfill({ status: 500, body: "boom" }),
	},
	{
		answer: "the request to the server fails without an answer",
		fulfill: (route) => route.abort("failed"),
	},
]) {
	test(`A change of conversations that fails still asks for a sync (${answer})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		await test.step(`Given ${answer}`, () => {
			server.answer = fulfill;
		});
		const result = await whenCalled(page, 'appendLines("c1", [])');
		await test.step("Then it rejects", () => {
			expect(result.error).toBeDefined();
		});
		await thenTheSyncFetches(server);
	});
}

test("Requests that do not change conversations do not ask for a sync", async ({
	page,
	context,
}) => {
	const server = await background(page, context);
	await givenTheServerAnswers(server, { ok: true });
	await test.step("When listConversations, getConversation, getDefaults, vectorsPending, putVectors, searchConversations and fetchSnippets are called", async () => {
		const results = await page.evaluate(async () => {
			const s = await import("/js/api/storage.js");
			return Promise.all([
				s.listConversations(),
				s.getConversation("c1"),
				s.getDefaults(),
				s.vectorsPending("eg"),
				s.putVectors("eg", [["r1", 1]], {
					body: new Uint8Array(8),
					size: 8,
					count: 1,
				}),
				s.searchConversations({ q: "x" }),
				s.fetchSnippets(["r1"], "x"),
			]);
		});
		expect(results).toHaveLength(7);
		expect(server.requests).toHaveLength(7);
	});
	await test.step("Then no GET /v1/meta-all.json is fetched within 3 seconds", async () => {
		await page.waitForTimeout(3000);
		expect(server.syncs).toEqual([]);
	});
});
