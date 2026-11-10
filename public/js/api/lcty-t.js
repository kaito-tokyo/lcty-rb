// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser (LCTYSP-0009): every call posts one operation to the tab's worker,
// lcty.v1/lcty.v1.t.worker.cjs of the site (started by the first call), and resolves to its answer. The worker keeps the browser's copy of GET /v1/tags (IndexedDB "lcty_t",
// store "t_full") and sends the requests that change the tags, syncing the copy after them; this module never opens the
// database itself.
//
// In a tab the operations run one at a time, in the order they were called, so an older GET never overwrites a newer
// copy in this tab and a read after a change sees it. Changes not made through this browser (a file edited by hand,
// another browser) are seen at the next sync: every page runs forceSyncTags() whenever it is shown (js/ui/sidebar.js),
// and a save made on an older set fails with 412.
//
// The tags of conversations (store "t_has_many_c", which conversations each tag has) follow the server over the tab's
// /v1/rpc connection instead, as the copies of api/meta-db.js do (LCTYSP-0014): readTagsOfConversationsFrom(rpc)
// replaces them with t.c.list, applyTagBatch(params) writes a t.batch.updated, and readTagsOfConversations() reads them.

import { siteUrl } from "../site.js";
import { followCopies } from "./tab-rpc.js";

const WORKER_PATH = "lcty.v1/lcty.v1.t.worker.cjs"; // relative to the root of the site (LCTYSP-0005)

// tail: the last operation called in this tab; lastId: the id of the last message posted to the worker; worker: the
// tab's worker; pending: the operations posted to it and not answered yet, by id
const state = { tail: null, lastId: 0, worker: null, pending: new Map() };

// The tab's one worker, started by the first operation and kept for the life of the page: a worker started late, while
// the page is being left, fails to load (WebKit reports it as an error of the page). One that fails is dropped with
// the operations it had, and the next operation starts another.
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
	// A worker that could not be loaded (or threw outside an operation). Chromium prefixes "Uncaught "
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

// Post {id, op, endpoint (the site's v1/), payload} to the worker and resolve to the result of the answer with that id,
// or reject with its error (with the HTTP status as status)
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

/**
 * The tags from the browser's copy: {tags: [{file, name, ops, prompt, memory, invalid?}], etag}, file names NFC-normalized,
 * etag the ETag of the set they are. The first call in a browser fetches GET /v1/tags.
 */
export function getTags() {
	return run("get");
}

/**
 * Replace all tag files with tags. etag is the one getTags returned with the tags that were edited (sent as If-Match):
 * a change made elsewhere in between fails with an Error whose status is 412. Resolves to the new ETag. The copy is
 * synced afterwards, also on failure, so getTags then returns the server's set.
 */
export function putTags(tags, etag) {
	return run("put", { tags, etag });
}

/** Add a memory item ({text, source}) to the tag in file (00010-ruby.html); 404 when the file is gone. Then syncs. */
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

/**
 * The tags of every conversation from the copy: {byCid: Map(cid => [tag, …]), stale}, each conversation's tags ordered
 * by reference (the sidebar orders them by the tags' files). stale is true when the copy has never been filled.
 */
export async function readTagsOfConversations() {
	const { rows, stale } = await run("get_has_many");
	const byCid = new Map();
	for (const { tag, cid } of rows) {
		if (!byCid.has(cid)) byCid.set(cid, []);
		byCid.get(cid).push(tag);
	}
	return { byCid, stale };
}
