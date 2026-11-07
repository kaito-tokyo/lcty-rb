// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tags in the browser (LCTYSP-0009): every call starts one worker, js/lcty_t.worker.js of the site, posts it one
// operation and resolves to its answer. The worker keeps the browser's copy of GET /v1/tags (IndexedDB "lcty_t",
// store "t_full") and sends the requests that change the tags, syncing the copy after them; this module never opens
// the database itself.
//
// In a tab the operations run one at a time, in the order they were called, so an older GET never overwrites a newer
// copy in this tab and a read after a change sees it. Changes not made through this browser (a file edited by hand,
// another browser) are seen at the next sync: pages request one when they load (requestTagsSync), and a save made on
// an older set fails with 412.

import { siteUrl } from "../site.js";

const WORKER_PATH = "js/lcty_t.worker.js"; // relative to the root of the site (LCTYSP-0005)
const IDLE_TIMEOUT_MS = 10000; // run by then even if the browser never becomes idle
const FALLBACK_DELAY_MS = 1000; // where requestIdleCallback is missing

// tail: the last operation called in this tab; scheduled: a requested sync waits for idle time
const state = { tail: null, scheduled: false };

// One worker, one operation: resolves to its result, rejects with its error (with the HTTP status as status)
function runWorker(message) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(siteUrl(WORKER_PATH), { type: "module" });
		worker.onmessage = ({ data }) => {
			worker.terminate();
			if (data && "error" in data) {
				const e = new Error(data.error);
				e.status = data.status;
				reject(e);
			} else resolve(data?.result);
		};
		// A worker that could not be loaded (or threw outside an operation). Chromium prefixes "Uncaught "
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
			const text = (e.message || "").replace(/^Uncaught /, "");
			reject(new Error(text || "the tags worker failed"));
		};
		worker.postMessage(message);
	});
}

// Run the operation after the ones called before it, whether they succeeded or not
function run(message) {
	const task = (state.tail ?? Promise.resolve())
		.catch(() => {})
		.then(() => runWorker(message));
	state.tail = task;
	return task;
}

/**
 * The tags from the browser's copy: {tags: [{file, name, ops, prompt, memory}], etag}, file names NFC-normalized,
 * etag the ETag of the set they are. The first call in a browser fetches GET /v1/tags.
 */
export function getTags() {
	return run({ op: "get" });
}

/**
 * Replace all tag files with tags. etag is the one getTags returned with the tags that were edited (sent as If-Match):
 * a change made elsewhere in between fails with an Error whose status is 412. Resolves to the new ETag. The copy is
 * synced afterwards, also on failure, so getTags then returns the server's set.
 */
export function putTags(tags, etag) {
	return run({ op: "put", tags, etag });
}

/** Add a memory item ({text, source}) to the tag in file (00010-ruby.html); 404 when the file is gone. Then syncs. */
export function addMemory(file, body) {
	return run({ op: "addMemory", file, body });
}

/** Sync the copy now: resolves when GET /v1/tags has been stored, rejects with the worker's error. */
export function syncTags() {
	return run({ op: "sync" });
}

/** Sync the copy when the browser is idle: pages call it when they load, to see changes not made in this browser. */
export function requestTagsSync() {
	if (state.scheduled) return;
	state.scheduled = true;
	const go = () => {
		state.scheduled = false;
		syncTags().catch((e) => console.warn("the tags could not be synced", e));
	};
	if (typeof requestIdleCallback === "function")
		requestIdleCallback(go, { timeout: IDLE_TIMEOUT_MS });
	else setTimeout(go, FALLBACK_DELAY_MS);
}
