// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tab's one connection to /v1/rpc, shared by the parts of the page (LCTYSP-0014).

import { connectRpc } from "./rpc.js";

const state = { notify: new Map(), request: {}, open: [], client: null };

function refuseLate() {
	if (state.client) throw new Error("the tab's connection is already open");
}

/** Call fn(params) for every notification method the server sends. */
export function onTabNotify(method, fn) {
	refuseLate();
	if (!state.notify.has(method)) state.notify.set(method, []);
	state.notify.get(method).push(fn);
}

/** Answer the server's request method with fn(params). */
export function onTabRequest(method, fn) {
	refuseLate();
	state.request[method] = fn;
}

/** Call fn(rpc) whenever the connection has opened, the first time and after every reconnection. */
export function onTabOpen(fn) {
	refuseLate();
	state.open.push(fn);
}

// Every listener runs, whatever an earlier one threw
function each(fns, ...args) {
	for (const fn of fns) {
		try {
			fn(...args);
		} catch (e) {
			console.warn(e);
		}
	}
}

/** The tab's connection, opened by the first call with what was registered. */
export function tabRpc(options = {}) {
	state.client ??= connectRpc({
		...options,
		onNotify: Object.fromEntries(
			[...state.notify].map(([method, fns]) => [
				method,
				(params) => each(fns, params),
			]),
		),
		onRequest: state.request,
		onOpen: () => each(state.open, state.client),
	});
	return state.client;
}

/** Follow copies kept in a worker: full reads replace them, notifications apply to them (LCTYSP-0014). */
export function followCopies({ lists, run, onChange }) {
	let reading = 0;
	let held = [];
	const changed = (applied) => {
		if (applied) onChange();
	};
	const applyNow = (params) =>
		run("apply", params).then(
			(r) => changed(r?.applied?.length > 0),
			(e) => console.warn("a change could not be stored", e),
		);
	return {
		/** Read every list over rpc and replace the copies; resolves when the worker has stored them. */
		async readAll(rpc) {
			reading += 1;
			const writes = [];
			// A failed write is reported by Promise.all below, never as an unhandled rejection
			const write = (w) => {
				w.catch(() => {});
				writes.push(w);
			};
			try {
				for (const [method, store] of lists) {
					const { version, items } = await rpc.call(method);
					write(run("replace", { store, version, rows: items }));
				}
			} finally {
				reading -= 1;
				if (reading === 0) {
					const later = held;
					held = [];
					for (const params of later) write(applyNow(params));
				}
			}
			const results = await Promise.all(writes);
			changed(results.some((r) => r?.applied === true));
		},
		/** A notification: applied at once, or after the lists being read. */
		onBatch(params) {
			if (reading > 0) held.push(params);
			else applyNow(params);
		},
	};
}
