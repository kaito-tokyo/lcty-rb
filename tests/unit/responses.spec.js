// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1007: the scenarios of docs/specs/LCTYSP-1007_responses-stream.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one test.step per line of it, so the two read
// side by side.
//
// streamResponses and stream() run in a real browser on the test server's origin. llama-server is http://llm.test,
// answered by a route with CORS headers (as tests/ui/fixtures.js does), so every Scenario sets exactly the reply it
// needs; the route records each POST.

import { expect, test } from "@playwright/test";
import { givenAPage } from "./unit-page.js";

const LLM = "http://llm.test";
const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};
const INPUT = [{ role: "user", content: "Hi" }];
const USAGE = { input_tokens: 10, output_tokens: 5 };
const TIMINGS = { prompt_n: 10, predicted_n: 5, predicted_per_second: 50 };

// ---- The stream llama-server sends ----

const textDelta = (delta) => ({ type: "response.output_text.delta", delta });
const thinkingDelta = (delta) => ({
	type: "response.reasoning_text.delta",
	delta,
});
const completed = (extra = {}) => ({ type: "response.completed", ...extra });

/**
 * A Responses API stream: each event is an object (sent with its type as the SSE event name, as llama-server does),
 * {raw: "…"} (sent as the data as it is) or {event, data} (an SSE event name other than the data's type).
 */
function sse(events) {
	return events
		.map((e) => {
			if (e.raw !== undefined) return `data: ${e.raw}\n\n`;
			if (e.event !== undefined)
				return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
			return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
		})
		.join("");
}

const streamOf = (events) => (route) =>
	route.fulfill({
		headers: { ...CORS, "Content-Type": "text/event-stream" },
		body: sse(events),
	});

// ---- Background ----

/**
 * A page on the server's origin, and llama-server answered by answer(route), which the test sets (by default a short
 * reply). requests are the POSTs that arrived: {method, url, headers, body}.
 */
async function background(page, context) {
	const llm = {
		answer: streamOf([textDelta("ok"), completed()]),
		requests: [],
		preflights: 0,
		arrived: null,
	};
	let arrive;
	llm.arrived = new Promise((r) => {
		arrive = r;
	});
	await givenAPage(page, context);
	await test.step("And POST http://llm.test/v1/responses is answered by the test, with CORS", async () => {
		await context.route(`${LLM}/**`, async (route) => {
			const req = route.request();
			if (req.method() === "OPTIONS") {
				llm.preflights++;
				return route.fulfill({ status: 204, headers: CORS });
			}
			const headers = await req.allHeaders();
			llm.requests.push({
				method: req.method(),
				url: req.url(),
				headers,
				body: req.postDataJSON(),
			});
			arrive();
			return llm.answer(route);
		});
	});
	return llm;
}

// ---- The stream, from the page ----

const BACKEND = { base_url: LLM, model: "gemma" };

/**
 * Stream a reply in the page with opts ({backend, instructions, input, extraBody}). via: "responses" calls
 * streamResponses, "client" stream() of client.js. The signal is that of window.lctyAbort (made here unless a step
 * made it). abort: "later" returns at once, leaving the result to window.lctyRun. Resolves to
 * {events, error: {name, message} | null, thrownAtCall}.
 */
function startStream(page, opts, { via = "responses", abort } = {}) {
	return page.evaluate(
		async ({ opts, via, abort }) => {
			const mod =
				via === "client"
					? await import("/js/llm/client.js")
					: await import("/js/llm/responses.js");
			const fn = via === "client" ? mod.stream : mod.streamResponses;
			window.lctyAbort ??= new AbortController(); // a Given step may have made it
			const controller = window.lctyAbort;
			const run = async () => {
				const events = [];
				let iterator;
				try {
					iterator = fn({ ...opts, signal: controller.signal });
				} catch (e) {
					return {
						events,
						error: { name: e.name, message: e.message },
						thrownAtCall: true,
					};
				}
				try {
					for await (const ev of iterator) events.push(ev);
				} catch (e) {
					return {
						events,
						error: { name: e.name, message: e.message },
						thrownAtCall: false,
					};
				}
				return { events, error: null, thrownAtCall: false };
			};
			window.lctyRun = run();
			if (abort !== "later") return window.lctyRun;
			return null;
		},
		{ opts, via, abort },
	);
}

async function whenTheReplyIsStreamed(
	page,
	opts,
	line = "When the reply is streamed",
	options,
) {
	let result;
	await test.step(line, async () => {
		result = await startStream(page, opts, options);
	});
	return result;
}

async function thenItYieldsNothing(result) {
	await test.step("And it yields nothing", () => {
		expect(result.events).toEqual([]);
	});
}

// ---- Scenarios ----

test("The request is a POST of the conversation as JSON", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	let opts;
	await test.step('Given the instructions "Be brief" and the input [{"role": "user", "content": "Hi"}]', () => {
		opts = { backend: BACKEND, instructions: "Be brief", input: INPUT };
	});
	await whenTheReplyIsStreamed(page, opts);
	await test.step('Then one POST http://llm.test/v1/responses is sent with the Content-Type "application/json"', () => {
		expect(llm.requests).toHaveLength(1);
		expect(llm.requests[0].method).toBe("POST");
		expect(llm.requests[0].url).toBe(`${LLM}/v1/responses`);
		expect(llm.requests[0].headers["content-type"]).toBe("application/json");
	});
	await test.step("And it has no Authorization header", () => {
		expect(llm.requests[0].headers.authorization).toBeUndefined();
	});
	await test.step('And its body is exactly {"model": "gemma", "stream": true, "input": [{"role": "user", "content": "Hi"}], "instructions": "Be brief"}', () => {
		expect(llm.requests[0].body).toStrictEqual({
			model: "gemma",
			stream: true,
			input: INPUT,
			instructions: "Be brief",
		});
	});
});

for (const { base_url, url } of [
	{ base_url: "http://llm.test/", url: "http://llm.test/v1/responses" },
	{ base_url: "http://llm.test///", url: "http://llm.test/v1/responses" },
	{
		base_url: "http://llm.test/proxy/",
		url: "http://llm.test/proxy/v1/responses",
	},
]) {
	test(`The endpoint is the base URL without its trailing slashes (${base_url})`, async ({
		page,
		context,
	}) => {
		const llm = await background(page, context);
		let opts;
		await test.step(`Given the backend's base_url is "${base_url}"`, () => {
			opts = { backend: { ...BACKEND, base_url }, input: INPUT };
		});
		await whenTheReplyIsStreamed(page, opts);
		await test.step(`Then one POST ${url} is sent`, () => {
			expect(llm.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
				`POST ${url}`,
			]);
		});
	});
}

test("An API key is sent as a Bearer token", async ({ page, context }) => {
	const llm = await background(page, context);
	let opts;
	await test.step(`Given the backend's api_key is "secret-key"`, () => {
		opts = { backend: { ...BACKEND, api_key: "secret-key" }, input: INPUT };
	});
	await whenTheReplyIsStreamed(page, opts);
	await test.step('Then the request has the Authorization header "Bearer secret-key"', () => {
		expect(llm.requests).toHaveLength(1);
		expect(llm.requests[0].headers.authorization).toBe("Bearer secret-key");
	});
});

test('Without a model the request names the model "default"', async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	let opts;
	await test.step("Given a backend without a model", () => {
		opts = { backend: { base_url: LLM }, input: INPUT };
	});
	await whenTheReplyIsStreamed(page, opts);
	await test.step('Then the body\'s model is "default"', () => {
		expect(llm.requests[0].body.model).toBe("default");
	});
});

test("Empty instructions are left out", async ({ page, context }) => {
	const llm = await background(page, context);
	let opts;
	await test.step('Given the instructions ""', () => {
		opts = { backend: BACKEND, instructions: "", input: INPUT };
	});
	await whenTheReplyIsStreamed(page, opts);
	await test.step("Then the body has no instructions", () => {
		expect(llm.requests[0].body).not.toHaveProperty("instructions");
	});
});

test("backend.extra and extraBody add parameters, extraBody last", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	const opts = { backend: { ...BACKEND }, input: INPUT };
	await test.step('Given the backend\'s extra is {"temperature": 0.5, "top_k": 40}', () => {
		opts.backend.extra = { temperature: 0.5, top_k: 40 };
	});
	await test.step('And the extraBody {"top_k": 1, "response_format": {"type": "json_object"}}', () => {
		opts.extraBody = { top_k: 1, response_format: { type: "json_object" } };
	});
	await whenTheReplyIsStreamed(page, opts);
	await test.step('Then the body has "temperature" 0.5, "top_k" 1 and "response_format" {"type": "json_object"}', () => {
		expect(llm.requests[0].body).toStrictEqual({
			temperature: 0.5,
			top_k: 1,
			response_format: { type: "json_object" },
			model: "gemma",
			stream: true,
			input: INPUT,
		});
	});
});

test("extra and extraBody cannot replace model, stream or input", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	const opts = { backend: { ...BACKEND }, input: INPUT };
	await test.step('Given the backend\'s extra is {"model": "other", "stream": false, "input": "x"}', () => {
		opts.backend.extra = { model: "other", stream: false, input: "x" };
	});
	await test.step('And the extraBody {"model": "another", "stream": false, "input": "y"}', () => {
		opts.extraBody = { model: "another", stream: false, input: "y" };
	});
	await whenTheReplyIsStreamed(page, opts);
	await test.step('Then the body\'s model is "gemma", its stream is true and its input is the one given', () => {
		expect(llm.requests[0].body).toStrictEqual({
			model: "gemma",
			stream: true,
			input: INPUT,
		});
	});
});

test("Reply text arrives as text events and the stream ends with done", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams the text deltas "Hel" and "lo" and then response.completed with usage and timings', () => {
		llm.answer = streamOf([
			textDelta("Hel"),
			textDelta("lo"),
			completed({ response: { usage: USAGE }, timings: TIMINGS }),
		]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields {"type": "text", "delta": "Hel"}, {"type": "text", "delta": "lo"}', () => {
		expect(result.error).toBeNull();
		expect(result.events.slice(0, 2)).toEqual([
			{ type: "text", delta: "Hel" },
			{ type: "text", delta: "lo" },
		]);
	});
	await test.step('And then {"type": "done"} with the usage and the timings of response.completed', () => {
		expect(result.events[2]).toEqual({
			type: "done",
			usage: USAGE,
			timings: TIMINGS,
		});
	});
	await test.step("And nothing after it", () => {
		expect(result.events).toHaveLength(3);
	});
});

test("Thinking arrives as thinking events, apart from the text", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams the thinking delta "Let me see", the text delta "Yes" and then response.completed', () => {
		llm.answer = streamOf([
			thinkingDelta("Let me see"),
			textDelta("Yes"),
			completed(),
		]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields {"type": "thinking", "delta": "Let me see"}, {"type": "text", "delta": "Yes"}, {"type": "done"}', () => {
		expect(result).toEqual({
			events: [
				{ type: "thinking", delta: "Let me see" },
				{ type: "text", delta: "Yes" },
				{ type: "done" },
			],
			error: null,
			thrownAtCall: false,
		});
	});
});

test("An incomplete response ends with done marked incomplete", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams the text delta "Hel" and then response.incomplete with usage and timings', () => {
		llm.answer = streamOf([
			textDelta("Hel"),
			{
				type: "response.incomplete",
				response: { usage: USAGE },
				timings: TIMINGS,
			},
		]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields {"type": "text", "delta": "Hel"}', () => {
		expect(result.error).toBeNull();
		expect(result.events[0]).toEqual({ type: "text", delta: "Hel" });
	});
	await test.step('And then {"type": "done", "incomplete": true} with the usage and the timings of response.incomplete', () => {
		expect(result.events.slice(1)).toEqual([
			{ type: "done", incomplete: true, usage: USAGE, timings: TIMINGS },
		]);
	});
});

for (const { event, message, data } of [
	{
		event: 'an error event with the message "context full"',
		message: "context full",
		data: { type: "error", error: { message: "context full" } },
	},
	{
		event: 'response.failed with the response\'s error "overloaded"',
		message: "overloaded",
		data: {
			type: "response.failed",
			response: { error: { message: "overloaded" } },
		},
	},
	{
		event: "response.failed without a message",
		message: "unknown error",
		data: { type: "response.failed", response: {} },
	},
]) {
	test(`A failure in the stream ends it with an error event (${event})`, async ({
		page,
		context,
	}) => {
		const llm = await background(page, context);
		const events = [textDelta("Hel"), data];
		await test.step(`Given the reply streams the text delta "Hel" and then ${event}`, () => {
			llm.answer = streamOf(events);
		});
		await test.step('And then the text delta "lo"', () => {
			events.push(textDelta("lo"));
		});
		const result = await whenTheReplyIsStreamed(page, {
			backend: BACKEND,
			input: INPUT,
		});
		await test.step(`Then it yields {"type": "text", "delta": "Hel"}, {"type": "error", "message": "${message}"}`, () => {
			expect(result.error).toBeNull();
			expect(result.events.slice(0, 2)).toEqual([
				{ type: "text", delta: "Hel" },
				{ type: "error", message },
			]);
		});
		await test.step("And nothing after it", () => {
			expect(result.events).toHaveLength(2);
		});
	});
}

test("Events after response.completed are not read", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams response.completed and then the text delta "late"', () => {
		llm.answer = streamOf([completed(), textDelta("late")]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields only {"type": "done"}', () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual([{ type: "done" }]);
	});
});

test("[DONE] ends the stream without a done event", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams the text delta "a", then the data [DONE], then the text delta "b"', () => {
		llm.answer = streamOf([
			textDelta("a"),
			{ raw: "[DONE]" },
			textDelta("b"),
			completed(),
		]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields only {"type": "text", "delta": "a"}', () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual([{ type: "text", delta: "a" }]);
	});
});

test("A stream that ends without response.completed yields only its deltas", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams the text delta "a" and then ends', () => {
		llm.answer = streamOf([textDelta("a")]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields only {"type": "text", "delta": "a"}', () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual([{ type: "text", delta: "a" }]);
	});
});

test("Other events and data that is not JSON are skipped", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams response.created, the data "not json", response.output_text.done, the text delta "a" and response.completed', () => {
		llm.answer = streamOf([
			{ type: "response.created", response: { id: "r1" } },
			{ raw: "not json" },
			{ type: "response.output_text.done", text: "whole" },
			textDelta("a"),
			completed(),
		]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields {"type": "text", "delta": "a"}, {"type": "done"}', () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual([
			{ type: "text", delta: "a" },
			{ type: "done" },
		]);
	});
});

test("The type in the data decides, not the SSE event name", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step('Given the reply streams the SSE event "response.completed" whose data is a text delta "a", and then response.completed', () => {
		llm.answer = streamOf([
			{ event: "response.completed", data: textDelta("a") },
			completed(),
		]);
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step('Then it yields {"type": "text", "delta": "a"}, {"type": "done"}', () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual([
			{ type: "text", delta: "a" },
			{ type: "done" },
		]);
	});
});

for (const { status, body, error, fulfill } of [
	{
		status: 400,
		body: 'the JSON error message "model not found"',
		error: "HTTP 400: model not found",
		fulfill: (route) =>
			route.fulfill({
				status: 400,
				headers: CORS,
				json: { error: { message: "model not found" } },
			}),
	},
	{
		status: 500,
		body: "a JSON body without an error",
		error: "HTTP 500: Internal Server Error",
		fulfill: (route) =>
			route.fulfill({ status: 500, headers: CORS, json: { detail: "x" } }),
	},
	{
		status: 503,
		body: 'the text "busy"',
		error: "HTTP 503: Service Unavailable",
		fulfill: (route) =>
			route.fulfill({
				status: 503,
				headers: { ...CORS, "Content-Type": "text/plain" },
				body: "busy",
			}),
	},
]) {
	test(`A response that is not OK is thrown with its status (${status})`, async ({
		page,
		context,
	}) => {
		const llm = await background(page, context);
		await test.step(`Given llama-server answers with the status ${status} and ${body}`, () => {
			llm.answer = fulfill;
		});
		const result = await whenTheReplyIsStreamed(page, {
			backend: BACKEND,
			input: INPUT,
		});
		await test.step(`Then it throws the error "${error}"`, () => {
			expect(result.error).toEqual({ name: "Error", message: error });
		});
		await thenItYieldsNothing(result);
	});
}

test("A request that fails without a response is thrown as a TypeError", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step("Given the request to llama-server fails without a response", () => {
		llm.answer = (route) => route.abort("failed");
	});
	const result = await whenTheReplyIsStreamed(page, {
		backend: BACKEND,
		input: INPUT,
	});
	await test.step("Then it throws a TypeError", () => {
		expect(result.error?.name).toBe("TypeError");
	});
	await thenItYieldsNothing(result);
});

test("An aborted signal stops the request before it is sent", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	await test.step("Given a signal that is already aborted", () =>
		page.evaluate(() => {
			window.lctyAbort = new AbortController();
			window.lctyAbort.abort();
		}));
	const result = await whenTheReplyIsStreamed(
		page,
		{ backend: BACKEND, input: INPUT },
		"When the reply is streamed with it",
	);
	await test.step("Then it throws an AbortError", () => {
		expect(result.error?.name).toBe("AbortError");
		expect(result.events).toEqual([]);
	});
	await test.step("And no request reaches llama-server", async () => {
		await page.waitForTimeout(200);
		expect(llm.requests).toEqual([]);
		expect(llm.preflights).toBe(0);
	});
});

test("Aborting while waiting for the response stops the request", async ({
	page,
	context,
}) => {
	const llm = await background(page, context);
	let held = null;
	await test.step("Given llama-server does not answer", () => {
		llm.answer = (route) => {
			held = route; // answered after the test, so the request stays open
		};
	});
	await whenTheReplyIsStreamed(
		page,
		{ backend: BACKEND, input: INPUT },
		"When the reply is streamed with a signal",
		{ abort: "later" },
	);
	await test.step("And the signal is aborted once the request has arrived", async () => {
		await llm.arrived;
		await page.evaluate(() => window.lctyAbort.abort());
	});
	const result = await page.evaluate(() => window.lctyRun);
	await test.step("Then it throws an AbortError", () => {
		expect(result.error?.name).toBe("AbortError");
	});
	await thenItYieldsNothing(result);
	await held?.abort().catch(() => {});
});

for (const { api, backend } of [
	{ api: "not set", backend: BACKEND },
	{ api: '"responses"', backend: { ...BACKEND, api: "responses" } },
]) {
	test(`client.js streams through the Responses API (${api})`, async ({
		page,
		context,
	}) => {
		const llm = await background(page, context);
		let opts;
		await test.step(`Given the backend's api is ${api}`, () => {
			opts = { backend, input: INPUT };
		});
		const result = await whenTheReplyIsStreamed(
			page,
			opts,
			"When the reply is streamed through stream() of client.js",
			{ via: "client" },
		);
		await test.step("Then one POST http://llm.test/v1/responses is sent", () => {
			expect(llm.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
				`POST ${LLM}/v1/responses`,
			]);
		});
		await test.step('And it yields {"type": "text", "delta": "ok"}, {"type": "done"}', () => {
			expect(result.error).toBeNull();
			expect(result.events).toEqual([
				{ type: "text", delta: "ok" },
				{ type: "done" },
			]);
		});
	});
}

test("client.js refuses an api it does not know", async ({ page, context }) => {
	const llm = await background(page, context);
	let opts;
	await test.step('Given the backend\'s api is "chat"', () => {
		opts = { backend: { ...BACKEND, api: "chat" }, input: INPUT };
	});
	const result = await whenTheReplyIsStreamed(
		page,
		opts,
		"When stream() of client.js is called",
		{ via: "client" },
	);
	await test.step('Then it throws the error "unsupported api: chat" at once', () => {
		expect(result.thrownAtCall).toBe(true);
		expect(result.error).toEqual({
			name: "Error",
			message: "unsupported api: chat",
		});
	});
	await test.step("And no request reaches llama-server", async () => {
		await page.waitForTimeout(200);
		expect(llm.requests).toEqual([]);
	});
});
