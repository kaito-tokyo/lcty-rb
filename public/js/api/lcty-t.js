// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser (LCTYSP-0009): every call starts one worker, lcty.v1/lcty.v1.t.worker.cjs of the site, posts
// it one operation and resolves to its answer. The worker keeps the browser's copy of GET /v1/tags (IndexedDB "lcty_v1_t",
// store "t_full") and sends the requests that change the tags, syncing the copy after them; this module never opens the
// database itself.
//
// In a tab the operations run one at a time, in the order they were called, so an older GET never overwrites a newer
// copy in this tab and a read after a change sees it. Changes not made through this browser (a file edited by hand,
// another browser) are seen at the next sync: every page runs forceSyncTags() whenever it is shown (js/ui/sidebar.js),
// and a save made on an older set fails with 412.

import { siteUrl } from "../site.js";

const WORKER_PATH = "lcty.v1/lcty.v1.t.worker.cjs"; // relative to the root of the site (LCTYSP-0005)

// tail: the last operation called in this tab; lastId: the id of the last message posted to a worker
const state = { tail: null, lastId: 0 };

// One worker, one operation: posts {id, op, endpoint (the site's v1/), payload} and resolves to the result of the
// answer with that id, or rejects with its error (with the HTTP status as status)
function runWorker(op, payload) {
	return new Promise((resolve, reject) => {
		state.lastId += 1;
		const id = state.lastId;
		const worker = new Worker(siteUrl(WORKER_PATH));
		worker.onmessage = ({ data }) => {
			if (data?.id !== id) return;
			worker.terminate();
			if (data.errorType) reject(errorOf(data, op));
			else resolve(data.result);
		};
		// A worker that could not be loaded (or threw outside an operation). Chromium prefixes "Uncaught "
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
			const text = (e.message || "").replace(/^Uncaught /, "");
			reject(new Error(text || "the tags worker failed"));
		};
		worker.postMessage({ id, op, endpoint: siteUrl("v1/").href, payload });
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
