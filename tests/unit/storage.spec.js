// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1009: the scenarios of docs/specs/LCTYSP-1009_storage-api.feature that need the browser (that a change starts
// no worker), written by hand. Each test has the title of its Scenario (an Examples row is added in parentheses) and one
// test.step per line of it, so the two read side by side. The other Scenarios run in Node.js, in
// tests/unit/storage.test.js.
//
// js/api/storage.js runs in a real browser on the test server's origin. Every request to /v1/ is answered by a route
// (a GET /v1/meta-all.json, which nothing should send any more, is counted apart), so the server's data does not
// matter. A call of the feature, such as appendLines("c1", []), is the function's name and JSON arguments.

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

// ---- Scenarios: a change of conversations ----

for (const call of [
	'createConversation({"id": "c1"}, [])',
	'appendLines("c1", [])',
	'popMessages("c1", 2)',
	'deleteConversation("c1")',
]) {
	test(`A change of conversations sends only its own request (${call})`, async ({
		page,
		context,
	}) => {
		const server = await background(page, context);
		const workers = [];
		page.on("worker", (w) => workers.push(w.url()));
		await givenTheServerAnswers(server, { ok: true });
		const result = await whenCalled(page, call);
		await test.step("Then it resolves", () => {
			expect(result).toEqual({ value: { ok: true } });
		});
		await test.step("And no other request is sent and no worker is started within 1 second", async () => {
			await page.waitForTimeout(1000);
			expect(server.requests).toHaveLength(1);
			expect(server.syncs).toEqual([]);
			expect(workers).toEqual([]);
		});
	});
}
