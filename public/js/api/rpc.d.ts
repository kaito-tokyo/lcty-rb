// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The page's end of /v1/rpc (LCTYSP-0012, LCTYSP-0014): one WebSocket per tab, JSON-RPC 2.0 both ways.
//
//   const rpc = connectRpc({ receives, onNotify, onRequest, onOpen })
//   await rpc.call(method, params)   the result, or a rejection with an RpcError (code, data) or a lost connection
//   rpc.actorId                      the connection's actorId (null until initialize has answered)
//
// When the socket opens the client sends initialize with the methods the page receives (the keys of onNotify and
// onRequest), then calls onOpen(). Requests sent before that wait for it. A notification goes to onNotify[method]; a
// request of the server to onRequest[method], whose result (or a thrown error) is the answer. When the socket closes,
// every request still waiting is rejected and the client opens a new one, waiting longer each time it fails (from
// 1 s up to 30 s); it never replays what it missed: onOpen is called again, and the page reads what it needs anew.

/** An error answered by the server: code and data as JSON-RPC sends them (LCTYSP-0012). */
export class RpcError extends Error {
	constructor(error: { code: number; message: string; data?: unknown });
	name: "RpcError";
	code: number;
	data: unknown;
}

/** The URL of the site's /v1/rpc as a WebSocket URL (ws: for http:, wss: for https:). */
export function rpcUrl(): URL;

/** The options of connectRpc. WebSocketImpl and setTimeoutImpl are for the tests. */
export interface ConnectRpcOptions {
	/** The URL to connect to; rpcUrl() by default. */
	url?: URL | string;
	/** The notifications the page receives, by method. */
	onNotify?: Record<string, (params: unknown) => void>;
	/**
	 * The server's requests the page answers, by method: the result (awaited) is the answer, and a thrown error is
	 * answered as code -32603 with its message. A request of a method not here is answered with that error too.
	 */
	onRequest?: Record<string, (params: unknown) => unknown>;
	/** Called whenever initialize has answered on a new socket (the first time and after every reconnection). */
	onOpen?: () => void;
	WebSocketImpl?: typeof WebSocket;
	setTimeoutImpl?: typeof setTimeout;
}

/** The connection connectRpc returns. */
export interface RpcClient {
	/** The connection's actorId: null until initialize has answered, and again while the socket is closed. */
	actorId: string | null;
	/**
	 * Send a request (params {} by default) once the current socket is ready, and resolve to its result. Rejects with
	 * an RpcError for an error answer, with "the connection was lost" when the socket closes first, and with "the
	 * connection is closed" after close().
	 */
	call(method: string, params?: object): Promise<unknown>;
	/** Close the connection for good: it is not reopened. */
	close(): void;
}

/**
 * Open the connection and keep it open: reopened after every close, waiting from 1 s, doubled after every failure, up
 * to 30 s (reset once initialize answers). WebSocketImpl and setTimeoutImpl are for the tests.
 */
export function connectRpc(options?: ConnectRpcOptions): RpcClient;

// Internals:
//
// RETRY_MIN_MS / RETRY_MAX_MS: the first and the longest wait before reopening the socket (1 s and 30 s).
//
// pending maps a request id to its { resolve, reject }. ready is a promise that resolves once initialize has answered
// on the current socket; notReady() makes a new one for the next socket, so requests sent until it is ready wait for
// it. A socket whose initialize fails is closed, which reconnects. receive(text) ignores messages that are not JSON
// objects and answers to unknown ids.
