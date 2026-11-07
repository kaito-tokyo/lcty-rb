// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1007: the scenarios of docs/specs/LCTYSP-1007_responses-stream.feature, written by hand. Each test has the
// title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by
// side.
//
// js/llm/responses.js and js/llm/client.js need no browser: they run in Node.js (node-unit.js). llama-server is
// http://llm.test, answered by the test through routeFetch(), which replaces the global fetch; every Scenario sets
// exactly the reply it needs, and the handler records each POST. The handler does what fetch does around a server: a
// request whose signal is already aborted is rejected with the signal's AbortError before it reaches llama-server, an
// abort while it waits rejects it the same way, a request that fails without a response is a TypeError (as Node's and
// the browsers' fetch throw it), and a response carries the reason phrase of its status as statusText, as an HTTP
// response does. Node's fetch has no CORS: the answers still carry the CORS headers, but no preflight is ever made.

import { STATUS_CODES } from "node:http";
import { expect, publicUrl, routeFetch, scenario } from "./node-unit.js";

const { streamResponses } = await import(publicUrl("js/llm/responses.js"));
const { stream } = await import(publicUrl("js/llm/client.js"));

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

/** An HTTP response of llama-server: the status with its reason phrase, the CORS headers and headers. */
const respond = (body, { status = 200, headers = {} } = {}) =>
	new Response(body, {
		status,
		statusText: STATUS_CODES[status],
		headers: { ...CORS, ...headers },
	});

const respondJson = (json, status) =>
	respond(JSON.stringify(json), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const streamOf = (events) => () =>
	respond(sse(events), { headers: { "Content-Type": "text/event-stream" } });

// ---- Background ----

/**
 * llama-server answered by answer(request), which the test sets (by default a short reply). requests are the POSTs
 * that arrived: {method, url, headers, body}.
 */
async function background(step, t) {
	const llm = {
		answer: streamOf([textDelta("ok"), completed()]),
		requests: [],
		arrived: null,
	};
	let arrive;
	llm.arrived = new Promise((r) => {
		arrive = r;
	});
	await step(
		"Given POST http://llm.test/v1/responses is answered by the test, with CORS",
		() => {
			routeFetch(t, async (request) => {
				const { signal } = request;
				// fetch rejects at once with an aborted signal: the request is never sent
				if (signal.aborted) throw signal.reason;
				llm.requests.push({
					method: request.method,
					url: request.url,
					headers: Object.fromEntries(request.headers),
					body: await request.json(),
				});
				arrive();
				const aborted = new Promise((_, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				});
				return Promise.race([llm.answer(request), aborted]);
			});
		},
	);
	return llm;
}

// ---- The stream ----

const BACKEND = { base_url: LLM, model: "gemma" };

/**
 * Stream a reply with opts ({backend, instructions, input, extraBody}). via: "responses" calls streamResponses,
 * "client" stream() of client.js. The signal is that of controller (made here unless a step made it). Resolves to
 * {events, error: {name, message} | null, thrownAtCall}.
 */
async function startStream(
	opts,
	{ via = "responses", controller = new AbortController() } = {},
) {
	const fn = via === "client" ? stream : streamResponses;
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
}

async function whenTheReplyIsStreamed(
	step,
	opts,
	line = "When the reply is streamed",
	options,
) {
	let result;
	await step(line, async () => {
		result = await startStream(opts, options);
	});
	return result;
}

async function thenItYieldsNothing(step, result) {
	await step("And it yields nothing", () => {
		expect(result.events).toEqual([]);
	});
}

// ---- Scenarios ----

scenario(
	"The request is a POST of the conversation as JSON",
	async ({ step, t }) => {
		const llm = await background(step, t);
		let opts;
		await step(
			'Given the instructions "Be brief" and the input [{"role": "user", "content": "Hi"}]',
			() => {
				opts = { backend: BACKEND, instructions: "Be brief", input: INPUT };
			},
		);
		await whenTheReplyIsStreamed(step, opts);
		await step(
			'Then one POST http://llm.test/v1/responses is sent with the Content-Type "application/json"',
			() => {
				expect(llm.requests).toHaveLength(1);
				expect(llm.requests[0].method).toBe("POST");
				expect(llm.requests[0].url).toBe(`${LLM}/v1/responses`);
				expect(llm.requests[0].headers["content-type"]).toBe(
					"application/json",
				);
			},
		);
		await step("And it has no Authorization header", () => {
			expect(llm.requests[0].headers.authorization).toBeUndefined();
		});
		await step(
			'And its body is exactly {"model": "gemma", "stream": true, "input": [{"role": "user", "content": "Hi"}], "instructions": "Be brief"}',
			() => {
				expect(llm.requests[0].body).toStrictEqual({
					model: "gemma",
					stream: true,
					input: INPUT,
					instructions: "Be brief",
				});
			},
		);
	},
);

for (const { base_url, url } of [
	{ base_url: "http://llm.test/", url: "http://llm.test/v1/responses" },
	{ base_url: "http://llm.test///", url: "http://llm.test/v1/responses" },
	{
		base_url: "http://llm.test/proxy/",
		url: "http://llm.test/proxy/v1/responses",
	},
]) {
	scenario(
		`The endpoint is the base URL without its trailing slashes (${base_url})`,
		async ({ step, t }) => {
			const llm = await background(step, t);
			let opts;
			await step(`Given the backend's base_url is "${base_url}"`, () => {
				opts = { backend: { ...BACKEND, base_url }, input: INPUT };
			});
			await whenTheReplyIsStreamed(step, opts);
			await step(`Then one POST ${url} is sent`, () => {
				expect(llm.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
					`POST ${url}`,
				]);
			});
		},
	);
}

scenario("An API key is sent as a Bearer token", async ({ step, t }) => {
	const llm = await background(step, t);
	let opts;
	await step(`Given the backend's api_key is "secret-key"`, () => {
		opts = { backend: { ...BACKEND, api_key: "secret-key" }, input: INPUT };
	});
	await whenTheReplyIsStreamed(step, opts);
	await step(
		'Then the request has the Authorization header "Bearer secret-key"',
		() => {
			expect(llm.requests).toHaveLength(1);
			expect(llm.requests[0].headers.authorization).toBe("Bearer secret-key");
		},
	);
});

scenario(
	'Without a model the request names the model "default"',
	async ({ step, t }) => {
		const llm = await background(step, t);
		let opts;
		await step("Given a backend without a model", () => {
			opts = { backend: { base_url: LLM }, input: INPUT };
		});
		await whenTheReplyIsStreamed(step, opts);
		await step('Then the body\'s model is "default"', () => {
			expect(llm.requests[0].body.model).toBe("default");
		});
	},
);

scenario("Empty instructions are left out", async ({ step, t }) => {
	const llm = await background(step, t);
	let opts;
	await step('Given the instructions ""', () => {
		opts = { backend: BACKEND, instructions: "", input: INPUT };
	});
	await whenTheReplyIsStreamed(step, opts);
	await step("Then the body has no instructions", () => {
		expect(llm.requests[0].body).not.toHaveProperty("instructions");
	});
});

scenario(
	"backend.extra and extraBody add parameters, extraBody last",
	async ({ step, t }) => {
		const llm = await background(step, t);
		const opts = { backend: { ...BACKEND }, input: INPUT };
		await step(
			'Given the backend\'s extra is {"temperature": 0.5, "top_k": 40}',
			() => {
				opts.backend.extra = { temperature: 0.5, top_k: 40 };
			},
		);
		await step(
			'And the extraBody {"top_k": 1, "response_format": {"type": "json_object"}}',
			() => {
				opts.extraBody = { top_k: 1, response_format: { type: "json_object" } };
			},
		);
		await whenTheReplyIsStreamed(step, opts);
		await step(
			'Then the body has "temperature" 0.5, "top_k" 1 and "response_format" {"type": "json_object"}',
			() => {
				expect(llm.requests[0].body).toStrictEqual({
					temperature: 0.5,
					top_k: 1,
					response_format: { type: "json_object" },
					model: "gemma",
					stream: true,
					input: INPUT,
				});
			},
		);
	},
);

scenario(
	"extra and extraBody cannot replace model, stream or input",
	async ({ step, t }) => {
		const llm = await background(step, t);
		const opts = { backend: { ...BACKEND }, input: INPUT };
		await step(
			'Given the backend\'s extra is {"model": "other", "stream": false, "input": "x"}',
			() => {
				opts.backend.extra = { model: "other", stream: false, input: "x" };
			},
		);
		await step(
			'And the extraBody {"model": "another", "stream": false, "input": "y"}',
			() => {
				opts.extraBody = { model: "another", stream: false, input: "y" };
			},
		);
		await whenTheReplyIsStreamed(step, opts);
		await step(
			'Then the body\'s model is "gemma", its stream is true and its input is the one given',
			() => {
				expect(llm.requests[0].body).toStrictEqual({
					model: "gemma",
					stream: true,
					input: INPUT,
				});
			},
		);
	},
);

scenario(
	"Reply text arrives as text events and the stream ends with done",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams the text deltas "Hel" and "lo" and then response.completed with usage and timings',
			() => {
				llm.answer = streamOf([
					textDelta("Hel"),
					textDelta("lo"),
					completed({ response: { usage: USAGE }, timings: TIMINGS }),
				]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step(
			'Then it yields {"type": "text", "delta": "Hel"}, {"type": "text", "delta": "lo"}',
			() => {
				expect(result.error).toBeNull();
				expect(result.events.slice(0, 2)).toEqual([
					{ type: "text", delta: "Hel" },
					{ type: "text", delta: "lo" },
				]);
			},
		);
		await step(
			'And then {"type": "done"} with the usage and the timings of response.completed',
			() => {
				expect(result.events[2]).toEqual({
					type: "done",
					usage: USAGE,
					timings: TIMINGS,
				});
			},
		);
		await step("And nothing after it", () => {
			expect(result.events).toHaveLength(3);
		});
	},
);

scenario(
	"Thinking arrives as thinking events, apart from the text",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams the thinking delta "Let me see", the text delta "Yes" and then response.completed',
			() => {
				llm.answer = streamOf([
					thinkingDelta("Let me see"),
					textDelta("Yes"),
					completed(),
				]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step(
			'Then it yields {"type": "thinking", "delta": "Let me see"}, {"type": "text", "delta": "Yes"}, {"type": "done"}',
			() => {
				expect(result).toEqual({
					events: [
						{ type: "thinking", delta: "Let me see" },
						{ type: "text", delta: "Yes" },
						{ type: "done" },
					],
					error: null,
					thrownAtCall: false,
				});
			},
		);
	},
);

scenario(
	"An incomplete response ends with done marked incomplete",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams the text delta "Hel" and then response.incomplete with usage and timings',
			() => {
				llm.answer = streamOf([
					textDelta("Hel"),
					{
						type: "response.incomplete",
						response: { usage: USAGE },
						timings: TIMINGS,
					},
				]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step('Then it yields {"type": "text", "delta": "Hel"}', () => {
			expect(result.error).toBeNull();
			expect(result.events[0]).toEqual({ type: "text", delta: "Hel" });
		});
		await step(
			'And then {"type": "done", "incomplete": true} with the usage and the timings of response.incomplete',
			() => {
				expect(result.events.slice(1)).toEqual([
					{ type: "done", incomplete: true, usage: USAGE, timings: TIMINGS },
				]);
			},
		);
	},
);

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
	scenario(
		`A failure in the stream ends it with an error event (${event})`,
		async ({ step, t }) => {
			const llm = await background(step, t);
			const events = [textDelta("Hel"), data];
			await step(
				`Given the reply streams the text delta "Hel" and then ${event}`,
				() => {
					llm.answer = streamOf(events);
				},
			);
			await step('And then the text delta "lo"', () => {
				events.push(textDelta("lo"));
			});
			const result = await whenTheReplyIsStreamed(step, {
				backend: BACKEND,
				input: INPUT,
			});
			await step(
				`Then it yields {"type": "text", "delta": "Hel"}, {"type": "error", "message": "${message}"}`,
				() => {
					expect(result.error).toBeNull();
					expect(result.events.slice(0, 2)).toEqual([
						{ type: "text", delta: "Hel" },
						{ type: "error", message },
					]);
				},
			);
			await step("And nothing after it", () => {
				expect(result.events).toHaveLength(2);
			});
		},
	);
}

scenario(
	"Events after response.completed are not read",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams response.completed and then the text delta "late"',
			() => {
				llm.answer = streamOf([completed(), textDelta("late")]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step('Then it yields only {"type": "done"}', () => {
			expect(result.error).toBeNull();
			expect(result.events).toEqual([{ type: "done" }]);
		});
	},
);

scenario("[DONE] ends the stream without a done event", async ({ step, t }) => {
	const llm = await background(step, t);
	await step(
		'Given the reply streams the text delta "a", then the data [DONE], then the text delta "b"',
		() => {
			llm.answer = streamOf([
				textDelta("a"),
				{ raw: "[DONE]" },
				textDelta("b"),
				completed(),
			]);
		},
	);
	const result = await whenTheReplyIsStreamed(step, {
		backend: BACKEND,
		input: INPUT,
	});
	await step('Then it yields only {"type": "text", "delta": "a"}', () => {
		expect(result.error).toBeNull();
		expect(result.events).toEqual([{ type: "text", delta: "a" }]);
	});
});

scenario(
	"A stream that ends without response.completed yields only its deltas",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams the text delta "a" and then ends',
			() => {
				llm.answer = streamOf([textDelta("a")]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step('Then it yields only {"type": "text", "delta": "a"}', () => {
			expect(result.error).toBeNull();
			expect(result.events).toEqual([{ type: "text", delta: "a" }]);
		});
	},
);

scenario(
	"Other events and data that is not JSON are skipped",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams response.created, the data "not json", response.output_text.done, the text delta "a" and response.completed',
			() => {
				llm.answer = streamOf([
					{ type: "response.created", response: { id: "r1" } },
					{ raw: "not json" },
					{ type: "response.output_text.done", text: "whole" },
					textDelta("a"),
					completed(),
				]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step(
			'Then it yields {"type": "text", "delta": "a"}, {"type": "done"}',
			() => {
				expect(result.error).toBeNull();
				expect(result.events).toEqual([
					{ type: "text", delta: "a" },
					{ type: "done" },
				]);
			},
		);
	},
);

scenario(
	"The type in the data decides, not the SSE event name",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			'Given the reply streams the SSE event "response.completed" whose data is a text delta "a", and then response.completed',
			() => {
				llm.answer = streamOf([
					{ event: "response.completed", data: textDelta("a") },
					completed(),
				]);
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step(
			'Then it yields {"type": "text", "delta": "a"}, {"type": "done"}',
			() => {
				expect(result.error).toBeNull();
				expect(result.events).toEqual([
					{ type: "text", delta: "a" },
					{ type: "done" },
				]);
			},
		);
	},
);

for (const { status, body, error, answer } of [
	{
		status: 400,
		body: 'the JSON error message "model not found"',
		error: "HTTP 400: model not found",
		answer: () => respondJson({ error: { message: "model not found" } }, 400),
	},
	{
		status: 500,
		body: "a JSON body without an error",
		error: "HTTP 500: Internal Server Error",
		answer: () => respondJson({ detail: "x" }, 500),
	},
	{
		status: 503,
		body: 'the text "busy"',
		error: "HTTP 503: Service Unavailable",
		answer: () =>
			respond("busy", {
				status: 503,
				headers: { "Content-Type": "text/plain" },
			}),
	},
]) {
	scenario(
		`A response that is not OK is thrown with its status (${status})`,
		async ({ step, t }) => {
			const llm = await background(step, t);
			await step(
				`Given llama-server answers with the status ${status} and ${body}`,
				() => {
					llm.answer = answer;
				},
			);
			const result = await whenTheReplyIsStreamed(step, {
				backend: BACKEND,
				input: INPUT,
			});
			await step(`Then it throws the error "${error}"`, () => {
				expect(result.error).toEqual({ name: "Error", message: error });
			});
			await thenItYieldsNothing(step, result);
		},
	);
}

scenario(
	"A request that fails without a response is thrown as a TypeError",
	async ({ step, t }) => {
		const llm = await background(step, t);
		await step(
			"Given the request to llama-server fails without a response",
			() => {
				llm.answer = () => {
					throw new TypeError("fetch failed");
				};
			},
		);
		const result = await whenTheReplyIsStreamed(step, {
			backend: BACKEND,
			input: INPUT,
		});
		await step("Then it throws a TypeError", () => {
			expect(result.error?.name).toBe("TypeError");
		});
		await thenItYieldsNothing(step, result);
	},
);

scenario(
	"An aborted signal stops the request before it is sent",
	async ({ step, t }) => {
		const llm = await background(step, t);
		const controller = new AbortController();
		await step("Given a signal that is already aborted", () => {
			controller.abort();
		});
		const result = await whenTheReplyIsStreamed(
			step,
			{ backend: BACKEND, input: INPUT },
			"When the reply is streamed with it",
			{ controller },
		);
		await step("Then it throws an AbortError", () => {
			expect(result.error?.name).toBe("AbortError");
			expect(result.events).toEqual([]);
		});
		await step("And no request reaches llama-server", () => {
			expect(llm.requests).toEqual([]);
		});
	},
);

scenario(
	"Aborting while waiting for the response stops the request",
	async ({ step, t }) => {
		const llm = await background(step, t);
		const controller = new AbortController();
		await step("Given llama-server does not answer", () => {
			llm.answer = () => new Promise(() => {}); // never answered: only the abort ends the request
		});
		let run;
		await step("When the reply is streamed with a signal", () => {
			run = startStream({ backend: BACKEND, input: INPUT }, { controller });
		});
		await step(
			"And the signal is aborted once the request has arrived",
			async () => {
				await llm.arrived;
				controller.abort();
			},
		);
		const result = await run;
		await step("Then it throws an AbortError", () => {
			expect(result.error?.name).toBe("AbortError");
		});
		await thenItYieldsNothing(step, result);
	},
);

for (const { api, backend } of [
	{ api: "not set", backend: BACKEND },
	{ api: '"responses"', backend: { ...BACKEND, api: "responses" } },
]) {
	scenario(
		`client.js streams through the Responses API (${api})`,
		async ({ step, t }) => {
			const llm = await background(step, t);
			let opts;
			await step(`Given the backend's api is ${api}`, () => {
				opts = { backend, input: INPUT };
			});
			const result = await whenTheReplyIsStreamed(
				step,
				opts,
				"When the reply is streamed through stream() of client.js",
				{ via: "client" },
			);
			await step("Then one POST http://llm.test/v1/responses is sent", () => {
				expect(llm.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
					`POST ${LLM}/v1/responses`,
				]);
			});
			await step(
				'And it yields {"type": "text", "delta": "ok"}, {"type": "done"}',
				() => {
					expect(result.error).toBeNull();
					expect(result.events).toEqual([
						{ type: "text", delta: "ok" },
						{ type: "done" },
					]);
				},
			);
		},
	);
}

scenario("client.js refuses an api it does not know", async ({ step, t }) => {
	const llm = await background(step, t);
	let opts;
	await step('Given the backend\'s api is "chat"', () => {
		opts = { backend: { ...BACKEND, api: "chat" }, input: INPUT };
	});
	const result = await whenTheReplyIsStreamed(
		step,
		opts,
		"When stream() of client.js is called",
		{ via: "client" },
	);
	await step('Then it throws the error "unsupported api: chat" at once', () => {
		expect(result.thrownAtCall).toBe(true);
		expect(result.error).toEqual({
			name: "Error",
			message: "unsupported api: chat",
		});
	});
	await step("And no request reaches llama-server", () => {
		expect(llm.requests).toEqual([]);
	});
});
