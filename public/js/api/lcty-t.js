// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser, run by the tab's worker lcty.v1.t.worker.cjs (LCTYSP-0009, LCTYSP-0014, LCTYSP-0005).

import { siteUrl } from "../site.js";
import { followCopies } from "./tab-rpc.js";

const WORKER_PATH = "lcty.v1/lcty.v1.t.worker.cjs"; // relative to the root of the site (LCTYSP-0005)

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
		workerOf().postMessage({
			id,
			op,
			endpoint: siteUrl("v1/").href,
			payload,
		});
	});
}

// The Error of an answer {errorType, error?, errorMessage?, status}, with the HTTP status (or null) as status
function errorOf(data, op) {
	const e =
		data.errorType === "error" && data.error instanceof Error
			? data.error
			: new Error(
					data.errorType === "unknownOperation"
						? `unknown operation: ${op}`
						: String(data.errorMessage ?? data.error),
				);
	e.status = data.status ?? null;
	return e;
}
// Run the operation after the ones called before it, whether they succeeded or not
function run(op, payload) {
	const task = (state.tail ?? Promise.resolve())
		.catch(() => {})
		.then(() => runWorker(op, payload));
	state.tail = task;
	return task;
}

/** The tags and their ETag from the browser's copy. */
export function getTags() {
	return run("get");
}

/** Replace all tag files with tags, if the set is still the one of etag. */
export function putTags(tags, etag) {
	return run("put", { tags, etag });
}

/** Add a memory item to the tag in file, then sync the copy. */
export function addMemory(file, body) {
	return run("addMemory", { file, body });
}

/** Replace the copy with GET /v1/tags now (sync_full): resolves when it has been stored, rejects with the error. */
export function forceSyncTags() {
	return run("sync_full");
}

// ---- The tags of conversations (t_has_many_c) ----

const listeners = [];
const hasMany = followCopies({
	lists: [["t.c.list", "t_has_many_c"]],
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

/** Call fn whenever this tab has stored a change of the tags of conversations. */
export function onTagsOfConversationsChange(fn) {
	listeners.push(fn);
}

/** Read t.c.list over rpc and replace the copy; resolves when it is stored, rejects with the error. */
export function readTagsOfConversationsFrom(rpc) {
	return hasMany.readAll(rpc);
}

/** Write the records of one t.batch.updated (after a list being read, if any); a failure is only logged. */
export function applyTagBatch(params) {
	hasMany.onBatch(params);
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
