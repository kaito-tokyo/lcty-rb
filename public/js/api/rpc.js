// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The page's end of /v1/rpc: one WebSocket per tab, JSON-RPC 2.0 both ways (LCTYSP-0012, LCTYSP-0014).

import { siteUrl } from "../site.js";

/** An error answered by the server: code and data as JSON-RPC sends them (LCTYSP-0012). */
export class RpcError extends Error {
	constructor({ code, message, data }) {
		super(message);
		this.name = "RpcError";
		this.code = code;
		this.data = data;
	}
}

/** The URL of the site's /v1/rpc as a WebSocket URL (ws: for http:, wss: for https:). */
export function rpcUrl() {
	const url = siteUrl("v1/rpc");
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url;
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;

/** Open the connection and keep it open. */
export function connectRpc({
	url = rpcUrl(),
	onNotify = {},
	onRequest = {},
	onOpen = () => {},
	WebSocketImpl = globalThis.WebSocket,
	setTimeoutImpl = globalThis.setTimeout,
} = {}) {
	const receives = [...Object.keys(onNotify), ...Object.keys(onRequest)];
	const pending = new Map(); // id => { resolve, reject }
	let nextId = 0;
	let ws = null;
	let ready = null; // resolves once initialize has answered on the current socket
	let markReady = null;
	let closed = false;
	let delay = RETRY_MIN_MS;
	const client = { actorId: null, call, close };

	function send(msg) {
		ws.send(JSON.stringify(msg));
	}

	function request(method, params) {
		return new Promise((resolve, reject) => {
			nextId += 1;
			pending.set(nextId, { resolve, reject });
			send({ jsonrpc: "2.0", id: nextId, method, params });
		});
	}

	async function call(method, params = {}) {
		if (closed) throw new Error("the connection is closed");
		await ready;
		return request(method, params);
	}

	async function answer(msg) {
		const fn = Object.hasOwn(onRequest, msg.method) && onRequest[msg.method];
		try {
			if (!fn) throw new Error(`not received: ${msg.method}`);
			send({ jsonrpc: "2.0", id: msg.id, result: await fn(msg.params) });
		} catch (e) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32603, message: String(e?.message ?? e) },
			});
		}
	}

	function receive(text) {
		let msg;
		try {
			msg = JSON.parse(text);
		} catch {
			return;
		}
		if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return;
		if (typeof msg.method === "string") {
			if ("id" in msg) answer(msg);
			else if (Object.hasOwn(onNotify, msg.method))
				onNotify[msg.method](msg.params);
			return;
		}
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.error) p.reject(new RpcError(msg.error));
		else p.resolve(msg.result);
	}

	// A new promise for the next socket: requests sent until it is ready wait for it
	function notReady() {
		ready = new Promise((resolve) => (markReady = resolve));
	}

	function open() {
		ws = new WebSocketImpl(String(url));
		ws.onmessage = (e) => receive(e.data);
		ws.onopen = async () => {
			try {
				const r = await request("initialize", {
					capabilities: { receives },
				});
				client.actorId = r.actorId;
				delay = RETRY_MIN_MS;
				markReady();
				onOpen();
			} catch {
				ws.close();
			}
		};
		ws.onclose = () => {
			client.actorId = null;
			for (const p of pending.values())
				p.reject(new Error("the connection was lost"));
			pending.clear();
			if (closed) return;
			notReady();
			const wait = delay;
			delay = Math.min(delay * 2, RETRY_MAX_MS);
			setTimeoutImpl(open, wait);
		};
	}

	function close() {
		closed = true;
		ws?.close();
	}

	notReady();
	open();
	return client;
}
