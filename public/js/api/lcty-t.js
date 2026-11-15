// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser, kept by the tab's worker lcty.v1.t.worker.cjs and written over /v1/rpc (LCTYSP-0009, LCTYSP-0014).

import { siteUrl } from "../site.js";
import { followCopies, tabRpc } from "./tab-rpc.js";

const WORKER_PATH = "lcty.v1/lcty.v1.t.worker.cjs"; // relative to the root of the site (LCTYSP-0005)

/** The code of the RPC error of a save made on a set of tags that has changed since it was read. */
export const TAGS_CHANGED = 8;

// The tab's last operation, last message id, worker, and operations not answered yet
const state = { tail: null, lastId: 0, worker: null, pending: new Map() };

// The tab's one worker, started by the first operation and kept for the life of the page
function workerOf() {
	if (state.worker) return state.worker;
	const worker = new Worker(siteUrl(WORKER_PATH));
	worker.onmessage = ({ data }) => {
		if (typeof data?.id !== "number") return;
		const p = state.pending.get(data.id);
		if (!p) return;
		state.pending.delete(data.id);
		if (data.errorType) p.reject(errorOf(data, p.op));
		else p.resolve(data.result);
	};
	// A worker that could not be loaded (or threw outside an operation)
	worker.onerror = (e) => {
		e.preventDefault();
		worker.terminate();
		if (state.worker === worker) state.worker = null;
		const text = (e.message || "").replace(/^Uncaught /, "");
		const error = new Error(text || "the tags worker failed");
		for (const p of state.pending.values()) p.reject(error);
		state.pending.clear();
	};
	state.worker = worker;
	return worker;
}

// Post one message to the worker and resolve to the answer with its id, or reject with its error
function runWorker(op, payload) {
	return new Promise((resolve, reject) => {
		state.lastId += 1;
		const id = state.lastId;
		state.pending.set(id, { op, resolve, reject });
		workerOf().postMessage({ id, op, payload });
	});
}

// The Error of an answer {errorType, error?, errorMessage?}
function errorOf(data, op) {
	if (data.errorType === "error" && data.error instanceof Error)
		return data.error;
	return new Error(
		data.errorType === "unknownOperation"
			? `unknown operation: ${op}`
			: String(data.errorMessage ?? data.error),
	);
}

// Run the operation after the ones called before it, whether they succeeded or not
function run(op, payload) {
	const task = (state.tail ?? Promise.resolve())
		.catch(() => {})
		.then(() => runWorker(op, payload));
	state.tail = task;
	return task;
}

// ---- The copies: the tag definitions (t_full, t_set) and the tags of conversations (t_has_many_c) ----

const listeners = [];
const copies = followCopies({
	lists: [
		["t.list", "t_full"],
		["t.c.list", "t_has_many_c"],
	],
	run,
	onChange: () => {
		for (const fn of listeners) {
			try {
				fn();
			} catch (e) {
				console.warn(e);
			}
		}
	},
});

/** Call fn whenever this tab has stored a change of the tags (their definitions or the tags of conversations). */
export function onTagsChange(fn) {
	listeners.push(fn);
}

/** Read t.list and t.c.list over rpc and replace the copies; resolves when they are stored, rejects with the error. */
export function readTagsFrom(rpc) {
	return copies.readAll(rpc);
}

/** Write the records of one t.batch.updated (after the lists being read, if any); a failure is only logged. */
export function applyTagBatch(params) {
	copies.onBatch(params);
}

/** Read the copies again over the tab's connection now: resolves when they are stored, rejects with the error. */
export function forceSyncTags() {
	return readTagsFrom(tabRpc());
}

/** The copy of the tag definitions as it is, never read over the connection: {tags, etag, stale}. */
export function readTagDefs() {
	return run("get");
}

/** The tags and their ETag from the browser's copy, read over the tab's connection first when there is none. */
export async function getTags() {
	let copy = await run("get");
	if (copy.stale) {
		await forceSyncTags();
		copy = await run("get");
	}
	return { tags: copy.tags, etag: copy.etag };
}

// A change over the tab's connection; when it fails the copies are read again, since the server's set may have changed
async function change(method, params) {
	try {
		return await tabRpc().call(method, params);
	} catch (e) {
		await forceSyncTags().catch(() => {});
		throw e;
	}
}

/** Replace all tag files with tags, if the set is still the one of etag; resolves to the new ETag. */
export async function putTags(tags, etag) {
	return (await change("t.replace", { tags, etag })).etag;
}

/** Add a memory item ({text, source}) to the tag in file; resolves to the item as written. */
export async function addMemory(file, { text, source }) {
	return (await change("t.memory.add", { file, text, source })).item;
}

/** The tags of every conversation from the copy, by cid. */
export async function readTagsOfConversations() {
	const { rows, stale } = await run("get_has_many");
	const byCid = new Map();
	for (const { tag, cid } of rows) {
		if (!byCid.has(cid)) byCid.set(cid, []);
		byCid.get(cid).push(tag);
	}
	return { byCid, stale };
}
