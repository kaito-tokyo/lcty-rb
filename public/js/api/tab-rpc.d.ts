// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tab's one connection to /v1/rpc (LCTYSP-0014), shared by the parts of the page: the sidebar follows the lists
// over it, and the conversation page writes its conversation over it.
//
//   onTabNotify(method, fn)    fn(params) for every notification method (any number of them per method)
//   onTabRequest(method, fn)   fn(params) answers the server's request method (one per method)
//   onTabOpen(fn)              fn(rpc) whenever the connection has opened (again): read what is needed anew
//   tabRpc()                   the connection, opened by the first call
//
// The methods the page receives are declared in initialize, so every part registers before the page calls tabRpc();
// registering later is refused.

import type { ConnectRpcOptions, RpcClient } from "./rpc.js";

/**
 * Call fn(params) for every notification method the server sends; any number of functions per method, each run
 * whatever an earlier one threw. Throws when the tab's connection is already open.
 */
export function onTabNotify(
	method: string,
	fn: (params: unknown) => void,
): void;

/**
 * Answer the server's request method with fn(params) (one per method: a later one replaces it). Throws when the tab's
 * connection is already open.
 */
export function onTabRequest(
	method: string,
	fn: (params: unknown) => unknown,
): void;

/**
 * Call fn(rpc) whenever the connection has opened, the first time and after every reconnection: read what is needed
 * anew. Throws when the tab's connection is already open.
 */
export function onTabOpen(fn: (rpc: RpcClient) => void): void;

/**
 * The tab's connection, opened by the first call with what was registered (connectRpc in api/rpc.js). options go to
 * connectRpc (url, WebSocketImpl and setTimeoutImpl, for the tests); they are ignored once the connection exists.
 */
export function tabRpc(
	options?: Omit<ConnectRpcOptions, "onNotify" | "onRequest" | "onOpen">,
): RpcClient;

/** What followCopies returns. */
export interface FollowedCopies {
	/** Read every list over rpc and replace the copies; resolves when the worker has stored them. */
	readAll(rpc: Pick<RpcClient, "call">): Promise<void>;
	/** A notification: applied at once, or after the lists being read. */
	onBatch(params: object): void;
}

/**
 * Follow copies kept in a worker (LCTYSP-0014): full reads replace them, notifications apply to them. run(op, payload)
 * posts one operation to the worker, in the tab's order; lists are [method, store] pairs read on every (re)connection.
 * Notifications that arrive while the lists are being read are held and applied after them, so a change is never
 * written before the full read it follows. onChange is called once the worker has stored something.
 *
 * In readAll, a write that fails while the next list is read (a worker cut off by leaving the page) is reported by the
 * final Promise.all, or not at all when a read failed: never as an unhandled rejection. A notification that cannot be
 * stored is only logged.
 */
export function followCopies(options: {
	lists: [method: string, store: string][];
	run: (op: "replace" | "apply", payload: object) => Promise<unknown>;
	onChange: () => void;
}): FollowedCopies;

// Internals:
//
// state: notify holds the notification functions by method, request the request function by method, open the onTabOpen
// functions, and client the connection once tabRpc() has opened it (refuseLate() throws from then on).
//
// each(fns, ...args): every listener runs, whatever an earlier one threw (a throw is logged).
