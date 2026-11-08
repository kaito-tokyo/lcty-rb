// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-2005: the scenarios of docs/specs/LCTYSP-2005_site-routing.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses, by its first column) and one test.step per line of it, so the
// two read side by side.
//
// The paths are requested with Playwright's request context, which follows redirects as a browser does; the answer is
// the last one, and its URL is where the path led (LCTYSP-0005).

import { createConversation, expect, test } from "./fixtures.js";

/** The answer to GET path after the redirects, as { status, type (without parameters), path (where it led) }. */
async function requested(request, path) {
	const res = await request.get(path);
	const url = new URL(res.url());
	return {
		res,
		status: res.status(),
		type: (res.headers()["content-type"] ?? "").split(";")[0].trim(),
		path: url.pathname + url.search,
	};
}

for (const [path, type] of [
	["/c/lcty.v1.js", "text/javascript"],
	["/c/lcty.v1.lang-ja.js", "text/javascript"],
	["/c/lcty.v1.css", "text/css"],
	["/t/lcty.v1.js", "text/javascript"],
	["/t/lcty.v1.lang-ja.js", "text/javascript"],
	["/t/lcty.v1.css", "text/css"],
]) {
	test(`The names a page loads next to itself lead to the files of /lcty.v1/ (${path})`, async ({
		request,
	}) => {
		let got;
		await test.step(`When ${path} is requested`, async () => {
			got = await requested(request, path);
		});
		await test.step("Then it leads to a path under /lcty.v1/", () => {
			expect(got.path).toMatch(/^\/lcty\.v1\/[^/]+$/);
		});
		await test.step(`And the answer is 200 with the type "${type}"`, () => {
			expect([got.status, got.type]).toEqual([200, type]);
		});
	});
}

for (const [path, target] of [
	["/c", "/c/"],
	["/c?q=ab", "/c/?q=ab"],
	["/t", "/t/"],
]) {
	test(`A directory without its slash leads to it, with its query (${path})`, async ({
		request,
	}) => {
		let got;
		await test.step(`When ${path} is requested`, async () => {
			got = await requested(request, path);
		});
		await test.step(`Then it leads to ${target}`, () => {
			expect(got.path).toBe(target);
		});
		await test.step('And the answer is 200 with the type "text/html"', () => {
			expect([got.status, got.type]).toEqual([200, "text/html"]);
		});
	});
}

test("A conversation file is served as it is", async ({ request }) => {
	let conv;
	let got;
	await test.step('Given a conversation titled "経路のテスト" made through the HTTP API', async () => {
		conv = await createConversation(request, { title: "経路のテスト" });
	});
	await test.step("When /c/<id>.html is requested", async () => {
		got = await requested(request, `/c/${conv.id}.html`);
	});
	await test.step('Then the answer is 200 with the type "text/html"', () => {
		expect([got.status, got.type]).toEqual([200, "text/html"]);
	});
	await test.step('And the body starts with "<!DOCTYPE html>" and holds the title "経路のテスト"', async () => {
		const body = await got.res.text();
		expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(body).toContain("経路のテスト");
	});
});

for (const path of [
	"/c/no-such-id.html",
	"/c/sub/no-such-id.html",
	"/c/notes.txt",
	"/t/00010-no-such-tag.html",
	"/t/notes.html",
]) {
	test(`What is not a page or a file of the site is 404 (${path})`, async ({
		request,
	}) => {
		let got;
		await test.step(`When ${path} is requested`, async () => {
			got = await requested(request, path);
		});
		await test.step("Then the answer is 404", () => {
			expect(got.status).toBe(404);
		});
	});
}
