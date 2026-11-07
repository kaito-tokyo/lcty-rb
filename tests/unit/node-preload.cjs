// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Preloaded by `npm run test:node` (node --require) into each test file's process and into every Web Worker it starts
// (Node.js 26 with --experimental-web-worker, LCTYSP-1000). A worker answers its requests through the test, as
// context.route() catches a worker's requests in the browser:
//
// - In a worker, fetch() is replaced: each request is sent to the main thread on the BroadcastChannel below and
//   answered by the site of the test (siteFetch in node-unit.js, registered under the symbol ROUTE): the test's
//   handler, or else the file of public/. A worker's URLs are those siteUrl() gives in Node.js (file:…/public/…).
// - On the main thread, Worker is replaced by one that first requests its script from the same site, so a test sees
//   and can fail that request (a script that cannot be loaded is the worker's error event, as in a browser), then
//   starts the real worker from the file. Each worker is kept until endWorkers() (node-unit.js, after every test).
//
// It is CommonJS because only --require (not --import) also runs in classic workers, such as fuzzy_search.worker.js.

const { isMainThread } = require("node:worker_threads");

const ROUTE = Symbol.for("lcty.unit.route"); // (url, init) → Promise<Response>, set by node-unit.js
const WORKERS = Symbol.for("lcty.unit.workers"); // the workers started, ended by node-unit.js
const channel = new BroadcastChannel("lcty.unit.fetch");
channel.unref();

if (isMainThread) {
	// Requests of the workers: answered by the site of the test
	channel.onmessage = async ({ data }) => {
		if (data?.type !== "request") return;
		const { id, url, method, headers, body } = data;
		try {
			const route = globalThis[ROUTE];
			if (!route) throw new TypeError(`no route for ${url}`);
			const r = await route(url, { method, headers, body });
			channel.postMessage({
				type: "response",
				id,
				status: r.status,
				statusText: r.statusText,
				headers: [...r.headers],
				body: await r.arrayBuffer(),
			});
		} catch (e) {
			channel.postMessage({ type: "response", id, error: String(e?.message) });
		}
	};

	const NativeWorker = globalThis.Worker;
	if (NativeWorker) {
		globalThis[WORKERS] = new Set();
		globalThis.Worker = class Worker extends EventTarget {
			#worker = null;
			#queue = [];
			#ended = false;
			onmessage = null;
			onmessageerror = null;
			onerror = null;

			constructor(url, options) {
				super();
				globalThis[WORKERS].add(this);
				this.#start(String(url), options);
			}

			async #start(url, options) {
				let ok = false;
				try {
					const route = globalThis[ROUTE];
					ok = !route || (await route(url)).ok;
				} catch {}
				if (this.#ended) return;
				// a script that cannot be loaded: an error event without a message, as in a browser
				if (!ok) return this.#emit(new Event("error"));
				const w = new NativeWorker(url, options);
				w.onmessage = (e) => this.#emit(new MessageEvent("message", e));
				w.onmessageerror = (e) =>
					this.#emit(new MessageEvent("messageerror", e));
				w.onerror = (e) => {
					const event = new ErrorEvent("error", {
						message: e.message,
						error: e.error,
						cancelable: true,
					});
					this.#emit(event);
					if (event.defaultPrevented) e.preventDefault();
				};
				this.#worker = w;
				for (const args of this.#queue.splice(0)) w.postMessage(...args);
			}

			#emit(event) {
				this[`on${event.type}`]?.call(this, event);
				this.dispatchEvent(event);
			}

			postMessage(...args) {
				if (this.#ended) return;
				if (this.#worker) this.#worker.postMessage(...args);
				else this.#queue.push(args);
			}

			terminate() {
				this.#ended = true;
				this.#worker?.terminate();
				globalThis[WORKERS].delete(this);
			}
		};
	}
} else {
	// A worker: its requests go to the main thread
	const pending = new Map();
	let seq = 0;
	channel.onmessage = ({ data }) => {
		if (data?.type !== "response" || !pending.has(data.id)) return;
		pending.get(data.id)(data);
		pending.delete(data.id);
	};
	globalThis.fetch = async (input, init = {}) => {
		const request = input instanceof Request ? input : null;
		const url = String(request ? request.url : input);
		const method = init.method ?? request?.method ?? "GET";
		const headers = [...new Headers(init.headers ?? request?.headers ?? [])];
		const body =
			init.body !== undefined
				? await new Response(init.body).arrayBuffer()
				: undefined;
		const id = `${process.pid}:${Math.random()}:${++seq}`;
		const data = await new Promise((resolve) => {
			pending.set(id, resolve);
			channel.postMessage({ type: "request", id, url, method, headers, body });
		});
		// a request that fails without a response rejects, as fetch() does
		if (data.error !== undefined) throw new TypeError(data.error);
		return new Response(data.body, {
			status: data.status,
			statusText: data.statusText,
			headers: data.headers,
		});
	};
}
