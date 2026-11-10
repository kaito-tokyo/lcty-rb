// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

import { getTags } from "../js/api/lcty-t.js";
import { RpcError } from "../js/api/rpc.js";
import {
	appendLines,
	deleteConversation,
	getConversation,
} from "../js/api/storage.js";
import {
	onTabNotify,
	onTabOpen,
	onTabRequest,
	tabRpc,
} from "../js/api/tab-rpc.js";
import {
	appIndexer,
	backendOf,
	loadSettings,
	nowIso,
	showToast,
} from "../js/common.js";
import { tr } from "../js/i18n.js";
import { stream } from "../js/llm/client.js";
import { buildRequest } from "../js/llm/history.js";
import { sortTags, tagRef } from "../js/tag-names.js";
import { openMemoryDialog, proposeMemory } from "../js/tags.js";
import { defineCommands } from "../js/ui/lcty-cmd.js";
// Element features (the structure comes from the custom elements in /lcty.v1/lcty.v1.cjs, which expose their inner elements as fields. LCTYSP-0005)
import {
	appendMessage,
	appendText,
	appendThinking,
	describeTimings,
	finishMessage,
	focusComposer,
	initConversationElements,
	isLctyMsgFile,
	readMessages,
	setComposerBusy,
	setComposerValue,
} from "../js/ui/lcty-elements.js";
import {
	cmdAttrs,
	elementOf,
	historyOf,
	lastElement,
	msgAttrs,
	replyArticle,
	thinkingAttrs,
	userArticle,
} from "../js/ui/lcty-msg.js";
// lcty.v1.async.mjs: the entry of the conversation page /c/<id>.html (LCTYSP-0005). Line 2 of a conversation file loads
// lcty.v1.js (redirected to lcty.v1.cjs: the custom elements, defined at its end) and lcty.v1.lang-ja.js (Japanese
// texts) and links lcty.v1.css. <lcty-c> imports this module once the page has loaded, so it never blocks rendering; it
// then attaches the event listeners and features the page needs. Served as it is from public/lcty.v1/, not bundled: the browser imports the modules
// in public/js/ through the paths below (../js/…, js/ of the site), so the features work over HTTP only.
//
// The conversation file itself (data/c/<id>.html), of LCTYSP-0013 (lcty-msg): the page writes it through /v1/rpc, one
// element at a time at its end, and puts into its document the same element it sent (LCTYSP-0012, LCTYSP-0014). A
// file of LCTYSP-0003 is shown read-only until lcty.rb convert converts it. New conversations are made on the new
// conversation page, /c/ next to it ("./", js/pages/new.js).
import { initSidebar } from "../js/ui/sidebar.js";
import { textAttr } from "../js/ui/text-attr.js";
import { UUID_RE } from "../js/uuid.js";

// The frame and the message list are <lcty-c> (built by lcty.v1.cjs during parsing. LCTYSP-0005). Its inner elements are taken from fields
const log = document.querySelector("lcty-c");
const { composer } = log;
// A file of LCTYSP-0003 is only shown: /v1/rpc refuses to write it (error 6), and the pages no longer write the HTTP API's
// lines. The title, the tags and deleting still work.
const former = !isLctyMsgFile(log);
const cid = log.id.replace(/^c-/, ""); // id="c-<conversation id>" (LCTYSP-0003)
// The lcty-cmd the new conversation page appended, which this tab runs as its own (js/pages/new.js)
const RUN_KEY = `lcty.run.${cid}`;

const state = {
	settings: null,
	conv: null, // { meta, title, messages, tags }
	busy: false,
	abort: null,
	tagDefs: [],
	tagDefsLoaded: false,
	outOfSync: false, // the file no longer follows the server (LCTYSP-0014): nothing more is written
	cmdId: null, // the lcty-cmd this page holds while it generates (answered to c.cmd.holds)
	writes: Promise.resolve(), // writes are sent one after another, each naming the last element of the one before
};

const backend = () => backendOf(state.settings);

// Sidebar: search and conversation list, shared by every page (<lcty-sidebar> inside the container. LCTYSP-0005, LCTYSP-0007)
const panel = initSidebar(log.sidebar, {
	getSettings: () => state.settings,
	// A round of this conversation: scroll to it instead of reloading
	onSelect: ({ id, chunkId }) => {
		if (id !== cid) return false;
		if (chunkId) focusMessage(chunkId);
		return true;
	},
	// The tags dialog saved new definitions: the tag picker and the memory button follow them
	onTagsSaved: (defs) => {
		state.tagDefs = defs;
		state.tagDefsLoaded = true;
		if (state.conv) renderTags();
	},
});
const indexer = appIndexer(() => state.settings);
const splitTags = (s) => (s || "").split(/\s+/).filter(Boolean);

// ---- Building the conversation ----

/**
 * The conversation as the features need it, from the document: {meta, title, tags, messages}. For a file of
 * LCTYSP-0013 the instructions and messages are what the model is sent (historyOf); for one of LCTYSP-0003 the
 * lcty-setup and the lcty-message elements.
 */
function convFromDom() {
	const d = log.dataset;
	const tags = state.conv?.tags ?? splitTags(d.setupTags);
	let instructions;
	let messages;
	if (former) {
		const setup = log.querySelector(":scope > lcty-setup");
		instructions = (setup && textAttr(setup, "data-instructions")) ?? "";
		messages = readMessages(log);
	} else ({ instructions, messages } = historyOf(log));
	return {
		meta: { id: cid, created_at: d.createdAt, instructions, tags },
		title:
			state.conv?.title ?? document.querySelector("title")?.textContent ?? "",
		tags,
		messages,
	};
}

// ---- Writing through /v1/rpc (LCTYSP-0012) ----

// The tab's one connection (api/tab-rpc.js), which the sidebar follows the lists over too. A file of LCTYSP-0003 is
// never written, so the page neither follows it nor answers for a lock.
if (!former) {
	onTabNotify("c.batch.updated", onBatch);
	// whether this page holds the lcty-cmd another page found at the end (LCTYSP-0014)
	onTabRequest("c.cmd.holds", ({ cid: c, id }) => ({
		holds: c === cid && state.cmdId === id,
	}));
	onTabOpen(subscribe);
}
const rpc = tabRpc();

/** Follow this conversation, and check that the document is still the file (LCTYSP-0014, Starting). */
async function subscribe() {
	try {
		const r = await rpc.call("c.subscribe", {
			cid,
			last: lastElement(log)?.id ?? null,
		});
		if (!r.current) outOfSync();
	} catch (e) {
		showToast(
			tr("saveFailed", "Failed to save: {error}", { error: e.message }),
		);
	}
}

// A change of this conversation made by another page: the document no longer follows the file (LCTYSP-0014). The
// page's own changes are already in its document; the sidebar follows the other records itself.
function onBatch({ actorId, records }) {
	if (actorId === rpc.actorId) return;
	if (records.some((r) => r.store === "c_html" && r.row.cid === cid))
		outOfSync();
}

/** The document no longer follows the file: nothing more is written, and the user is asked to reload (LCTYSP-0014). */
function outOfSync() {
	if (state.outOfSync) return;
	state.outOfSync = true;
	state.abort?.abort();
	disableComposer(
		tr(
			"outOfSync",
			"This conversation changed in another tab. Reload the page.",
		),
	);
	showToast(
		tr(
			"outOfSync",
			"This conversation changed in another tab. Reload the page.",
		),
	);
}

function disableComposer(placeholder) {
	composer.input.disabled = true;
	composer.sendButton.disabled = true;
	composer.input.placeholder = placeholder;
	log.toggleAttribute("data-read-only", true);
}

/**
 * Run write after the writes before it. A conflict or a lock it did not expect means another page wrote (LCTYSP-0014):
 * the page is out of sync. Any other failure is shown. Rejects as write did.
 */
function serial(write) {
	const run = state.writes.then(() => {
		if (state.outOfSync)
			throw new Error(
				tr(
					"outOfSync",
					"This conversation changed in another tab. Reload the page.",
				),
			);
		return write();
	});
	state.writes = run.catch(() => {});
	return run.catch((e) => {
		if (e instanceof RpcError && (e.code === 1 || e.code === 2)) outOfSync();
		else if (!state.outOfSync)
			showToast(
				tr("saveFailed", "Failed to save: {error}", { error: e.message }),
			);
		throw e;
	});
}

/** Append one element after the last one, and put it into the document as written. Returns the element. */
async function append(method, tag, attrs, innerHTML = "") {
	const r = await rpc.call(method, {
		cid,
		after: lastElement(log)?.id ?? null,
		attrs,
		...(tag === "lcty-cmd" ? {} : { innerHTML }),
	});
	const el = elementOf(tag, r.attrs, innerHTML);
	log.append(el);
	markLast();
	return el;
}

/** Remove the last element of the file, and from the document. */
async function unappend() {
	const el = lastElement(log);
	if (!el) return;
	await rpc.call("c.unappend", { cid, id: el.id });
	el.remove();
	markLast();
}

/** Change the title: the server fits it into the slot and answers it as written. */
async function setTitle(title) {
	const r = await rpc.call("c.update.title", { cid, title });
	state.conv.title = r.title;
	renderHeader();
	panel.refresh();
}

// Undo shows on the last user message only and regenerate on the last reply when it ends the conversation
// (lcty.v1.css): CSS cannot select them, so they are marked
function markLast() {
	const msgs = [
		...log.querySelectorAll(
			':scope > lcty-msg:is([data-role="user"], [data-role="model"])',
		),
	];
	const lastUser = msgs.findLast((m) => m.dataset.role === "user");
	const last = msgs[msgs.length - 1];
	for (const m of msgs) {
		m.toggleAttribute("data-last-user", m === lastUser);
		m.toggleAttribute(
			"data-last-model",
			m === last && m.dataset.role === "model" && lastElement(log) === m,
		);
	}
}

// ---- Rendering ----

// The header's tree is lcty.v1.cjs's (LctyCElement builds it from the conversation file's elements); this only sets
// values and attributes: the tag definitions (data-tag-defs) and what depends on the page's state.
function renderHeader() {
	log.titleInput.value = state.conv.title || "";
	showTitle(state.conv.title || "");
	renderTags();
}

// document.title writes into the document's first <title>, which here is the conversation file's own (line 2,
// LCTYSP-0003). So it gets exactly what the file's title line holds, nothing added: the page stays a mirror of the file.
function showTitle(title) {
	if (document.title !== title) document.title = title;
}

const knownTag = (ref) => state.tagDefs.some((t) => tagRef(t) === ref);

// Until the tag definitions have arrived the frame keeps its defaults: data-tag-defs is not set (an empty one would
// mean "no tags are defined") and nothing is disabled for want of them, so nothing turns grey and back. data-tag-defs
// holds the references of the defined tags (file-name parts) and data-tag-names their display names, in the same
// order; neither contains whitespace (LCTYSP-0009).
function renderTags() {
	if (state.tagDefsLoaded) {
		log.setAttribute("data-tag-defs", state.tagDefs.map(tagRef).join(" "));
		log.setAttribute(
			"data-tag-names",
			state.tagDefs.map((t) => t.name).join(" "),
		);
	}
	// A file of LCTYSP-0013 has no data-setup-tags, from which the frame draws its chips: they are the current tags
	if (!former) log.dataset.setupTags = state.conv.tags.join(" ");
	log.proposeMemoryButton.disabled =
		state.busy || (state.tagDefsLoaded && !state.conv.tags.some(knownTag));
}

// The tags are kept in lcty_t.sqlite, not in the file (LCTYSP-0009): the HTTP API's tags line, for either format
function setConvTags(tags) {
	const conv = state.conv;
	conv.tags = sortTags(state.tagDefs, tags);
	renderTags();
	appendLines(cid, [{ type: "tags", tags: conv.tags, at: nowIso() }])
		.then(() => panel.refresh())
		.catch((e) =>
			showToast(
				tr("saveFailed", "Failed to save: {error}", { error: e.message }),
			),
		);
}

log.tags.addEventListener("click", (e) => {
	const chip = e.target.closest(".tag-chip");
	if (!chip) return;
	const name = chip.dataset.tag;
	if (e.target.closest(".tag-x"))
		setConvTags(state.conv.tags.filter((x) => x !== name));
	// the shown name: tag:C# and tag:c~23 are one tag (LCTYSP-0009), and the name reads better
	else if (e.target.closest(".tag-name"))
		panel.setQuery(`tag:${e.target.closest(".tag-name").textContent}`);
});
log.tagPicker.addEventListener("change", () => {
	if (log.tagPicker.value)
		setConvTags([...state.conv.tags, log.tagPicker.value]);
});

function setBusy(b) {
	state.busy = b;
	setComposerBusy(composer, b);
	log.toggleAttribute("busy", b);
	if (state.conv) renderTags();
}

/** Scroll to the round matched by search (the user message id) and highlight it briefly. */
function focusMessage(msgId) {
	const el = document.getElementById(
		former ? `c-msg-${msgId}` : `msg-u-${msgId}`,
	);
	if (!el) return;
	el.scrollIntoView({ block: "start" });
	for (const t of [el, el.nextElementSibling]) {
		if (!t) continue;
		t.classList.remove("flash");
		void t.offsetWidth;
		t.classList.add("flash");
	}
}

// ---- Sending and generating ----

const canWrite = () => !former && !state.outOfSync && !state.busy;

async function onSend(text) {
	if (!canWrite() || lastElement(log)?.localName === "lcty-cmd") return;
	setBusy(true);
	try {
		await serial(async () => {
			const firstTitle = !state.conv.title;
			await append(
				"c.append.msg",
				"lcty-msg",
				msgAttrs("user", text, { at: nowIso() }),
				userArticle(text),
			);
			setComposerValue(composer, "");
			if (firstTitle) await setTitle(text.trim().split("\n")[0].slice(0, 30));
		});
	} catch {
		setBusy(false);
		return;
	}
	setBusy(false);
	startCommand();
}

/**
 * Take the lock (LCTYSP-0013): append an lcty-cmd send, which runs at once as this page's own (defineCommands below)
 * and generates the reply.
 */
function startCommand() {
	if (!canWrite()) return;
	return serial(async () => {
		const el = await append(
			"c.append.cmd",
			"lcty-cmd",
			cmdAttrs("send", nowIso()),
		);
		state.cmdId = el.id;
	}).catch(() => {});
}

/**
 * The title a reply proposes (LCTYSP-0003): its first line, when that is a level-1 Markdown heading ("# タイトル").
 * The system prompt asks for one on every reply, but it is optional; null when there is none.
 */
function titleFromReply(content) {
	const m = /^\s*#[ \t]+([^\n]*)/.exec(content || "");
	const title = m ? m[1].replace(/[ \t]+#+[ \t]*$/, "").trim() : "";
	return title || null;
}

/**
 * Generate a reply: the operation of this page's lcty-cmd send. The reply streams into a draft shown after the
 * lcty-cmd, which is never written. When it has finished, the lcty-cmd is removed and the thinking and the reply are
 * appended, then what was measured is recorded (c.stats.put). When it is stopped or fails, the lcty-cmd is replaced by
 * one with data-error, which stays until the user retries or removes it, and the draft is dropped.
 */
async function generate(cmd, controller) {
	state.cmdId = cmd.id;
	const { instructions, messages } = historyOf(log);
	const req = buildRequest({ instructions, messages });
	const msg = {
		role: "assistant",
		content: "",
		thinking: "",
		status: "streaming",
	};
	state.abort = controller;
	setBusy(true);
	const t0 = performance.now();
	let tFirst = null;
	let error = null;
	const draft = appendMessage(log, msg);
	draft.toggleAttribute("data-draft", true);
	try {
		for await (const ev of stream({
			backend: backend(),
			...req,
			signal: controller.signal,
		})) {
			if (ev.type === "text") {
				tFirst ??= performance.now();
				msg.content += ev.delta;
				appendText(draft, ev.delta);
			} else if (ev.type === "thinking") {
				tFirst ??= performance.now();
				msg.thinking += ev.delta;
				appendThinking(draft, ev.delta);
			} else if (ev.type === "done") {
				if (ev.incomplete) error = tr("incomplete", "The reply was cut off");
				msg.timings = ev.timings;
				msg.usage = ev.usage;
			} else if (ev.type === "error") throw new Error(ev.message);
		}
	} catch (e) {
		error = e.name === "AbortError" ? tr("stopped", "Stopped") : e.message;
	}
	if (controller.signal.aborted && !error) error = tr("stopped", "Stopped");
	finishMessage(draft);
	const at = nowIso();
	const client = {
		ttft_ms: tFirst == null ? null : Math.round(tFirst - t0),
		total_ms: Math.round(performance.now() - t0),
	};
	try {
		await serial(async () => {
			draft.remove();
			await unappend(); // the lcty-cmd
			state.cmdId = null;
			if (error != null) {
				await append("c.append.cmd", "lcty-cmd", cmdAttrs("send", at, error));
				return;
			}
			if (msg.thinking)
				await append(
					"c.append.thinking",
					"lcty-thinking",
					thinkingAttrs(msg.thinking, at),
					replyArticle(msg.thinking),
				);
			const reply = await append(
				"c.append.msg",
				"lcty-msg",
				msgAttrs("model", msg.content, { at }),
				replyArticle(msg.content),
			);
			await rpc.call("c.stats.put", {
				cid,
				id: reply.id,
				timings: msg.timings ?? null,
				usage: msg.usage ?? null,
				client,
			});
			showStats(reply, { timings: msg.timings, client });
			const heading = titleFromReply(msg.content);
			if (heading && heading !== state.conv.title) await setTitle(heading);
		});
	} catch {
		// shown by serial
	} finally {
		draft.remove();
		state.cmdId = null;
		state.abort = null;
		setBusy(false);
		panel.refresh();
		indexer.kick();
	}
}

// ---- What was measured of the replies (lcty_c.sqlite, LCTYSP-0013) ----

/** Show a reply's ⓘ with its timings (part of <lcty-msg>, lcty.v1.cjs), when there are any. */
function showStats(el, stats) {
	if (!el.foot) return;
	const text = describeTimings(stats);
	el.timings.textContent = text;
	el.foot.hidden = !text;
}

/** Read what was measured of every reply of the conversation, and show it. */
async function loadStats() {
	const { items } = await rpc.call("c.stats.list", { cid });
	for (const s of items) {
		const el = document.getElementById(s.id);
		if (el?.localName === "lcty-msg") showStats(el, s);
	}
}

// ---- A lock at the end that this page did not start (LCTYSP-0013, LCTYSP-0014) ----

// Wire Retry and Remove of an lcty-cmd that failed or that nobody holds: Remove takes it away, Retry also takes the lock
// again
function wireCmd(cmd) {
	cmd.removeButton.onclick = () => {
		if (canWrite()) serial(unappend).catch(() => {});
	};
	cmd.retryButton.onclick = () => {
		if (!canWrite()) return;
		serial(unappend)
			.then(() => startCommand())
			.catch(() => {});
	};
}

/** The lcty-cmd at the end when the page opens: run it (this tab made it), or ask who holds it. */
// Before <lcty-cmd> is defined: the lcty-cmd at the end runs only when this tab made it; any other one (but a failed one,
// which shows itself so) is marked stale, so it does not run. Returns it, or null.
function markLock() {
	const cmd = lastElement(log);
	if (cmd?.localName !== "lcty-cmd") return null;
	let mine = false;
	try {
		mine = sessionStorage.getItem(RUN_KEY) === cmd.id;
		sessionStorage.removeItem(RUN_KEY);
	} catch {}
	if (mine || cmd.hasAttribute("data-error")) return null; // runs, or shows itself as failed
	cmd.setAttribute("state", "stale");
	return cmd;
}

// Once it is defined (its label exists): ask whether another tab holds it (c.cmd.held)
async function checkLock(cmd) {
	cmd.label.textContent = tr("cmdStale", "A reply was left unfinished");
	const { held } = await rpc.call("c.cmd.held", { cid, id: cmd.id });
	if (held) {
		cmd.setAttribute("state", "held");
		cmd.label.textContent = tr(
			"cmdHeld",
			"A reply is being made in another tab",
		);
	} else cmd.label.textContent = tr("cmdStale", "A reply was left unfinished");
}

// ---- Undo, regenerate, fork (LCTYSP-0004) ----

/** Remove the last turn: every element from the last user message on, one at a time from the end. */
function onUndo(userEl) {
	if (!canWrite()) return;
	const text = textAttr(userEl, "data-content") ?? "";
	serial(async () => {
		while (lastElement(log) && lastElement(log) !== userEl) await unappend();
		await unappend();
		setComposerValue(composer, text);
		focusComposer(composer);
	}).catch(() => {});
}

/** Generate the last reply again: remove what follows the last user message, then take the lock. */
function onRegenerate() {
	if (!canWrite()) return;
	const users = log.querySelectorAll(':scope > lcty-msg[data-role="user"]');
	const lastUser = users[users.length - 1];
	if (!lastUser) return;
	serial(async () => {
		while (lastElement(log) && lastElement(log) !== lastUser) await unappend();
	})
		.then(() => startCommand())
		.catch(() => {});
}

function onFork(userEl) {
	if (state.busy) return;
	const i = historyOf(log).messages.findIndex(
		(m) => `msg-u-${m.id}` === userEl.id,
	);
	if (i < 0) return;
	location.href = `./?fork=${encodeURIComponent(cid)}&at=${i}`;
}

// The buttons of the messages: one listener for all, since the page appends messages as it goes
log.addEventListener("click", (e) => {
	const path = e.composedPath();
	const el = path.find((n) => n.localName === "lcty-msg");
	if (!el || former) return;
	if (path.includes(el.undoButton)) onUndo(el);
	else if (path.includes(el.forkButton)) onFork(el);
	else if (path.includes(el.regenerateButton)) onRegenerate();
});

// ---- Memory proposals (LCTYSP-0009) ----

async function onProposeMemory() {
	if (state.busy) return;
	const conv = convFromDom();
	const btn = log.proposeMemoryButton;
	state.abort = new AbortController();
	setBusy(true);
	btn.textContent = tr("proposingMemory", "Proposing…");
	try {
		const { proposals, tags } = await proposeMemory({
			conv,
			backend: backend(),
			defs: state.tagDefs,
			signal: state.abort.signal,
		});
		const last = conv.messages[conv.messages.length - 1];
		openMemoryDialog({
			dialog: log.memoryDialog,
			proposals,
			tags,
			source: { conv_id: cid, msg_id: last?.id },
			toast: showToast,
			onDone: async () => (state.tagDefs = (await getTags()).tags),
		});
	} catch (e) {
		if (e.name !== "AbortError")
			showToast(
				tr("memoryProposalFailed", "Failed to propose memory: {error}", {
					error: e.message,
				}),
			);
	} finally {
		btn.textContent = tr("proposeMemory", "Propose memory");
		state.abort = null;
		setBusy(false);
	}
}

// ---- Events ----

log.proposeMemoryButton.addEventListener("click", onProposeMemory);
log.titleInput.addEventListener("change", (e) => {
	const title = e.target.value.trim();
	if (title === state.conv.title || former || state.outOfSync) return;
	serial(() => setTitle(title)).catch(() => {});
});
log.deleteButton.addEventListener("click", async () => {
	if (
		!confirm(
			tr("confirmDelete", 'Delete "{title}"?', {
				title: state.conv.title || tr("untitled", "(untitled)"),
			}),
		)
	)
		return;
	state.abort?.abort();
	try {
		await state.writes;
		await deleteConversation(cid);
		location.href = "./";
	} catch (e) {
		showToast(
			tr("deleteFailed", "Failed to delete: {error}", { error: e.message }),
		);
	}
});
// Leaving the page while generating loses the partial reply (LCTYSP-0005)
window.addEventListener("beforeunload", (e) => {
	if (!state.busy) return;
	e.preventDefault();
	e.returnValue = "";
});

// ---- Startup ----

(async () => {
	// The layout is settled by lcty.v1.cjs and the scroll position is the browser's; the module only wires the elements
	// up. The messages (feet, thinking summaries) and the header are prepared synchronously, before the settings and
	// the tags are waited for.
	if (!log.id)
		return showToast(
			tr(
				"convLoadFailed",
				"Could not read the conversation file (<lcty-c> has no id)",
			),
		);
	state.conv = convFromDom();
	initConversationElements(log, {
		onSend: (text) => onSend(text),
		onStop: () => state.abort?.abort(),
	});
	if (former)
		disableComposer(
			tr(
				"formerReadOnly",
				"This conversation is in the former format. Convert it with lcty.rb convert to continue it.",
			),
		);
	markLast();
	renderHeader();
	// #msg-u-<UUIDv7> (#c-msg-<UUIDv7> in a file of LCTYSP-0003); a bare #<UUIDv7> from older links still works
	const hashId = decodeURIComponent(location.hash.slice(1)).replace(
		/^(?:c-msg-|msg-u-)/,
		"",
	);
	if (UUID_RE.test(hashId)) focusMessage(hashId);
	state.settings = await loadSettings();
	if (!state.settings) return;
	try {
		// The current tags (lcty_t.sqlite), which the file does not have
		state.conv.tags = (await getConversation(cid)).tags;
	} catch (e) {
		showToast(
			tr("tagsLoadFailed", "Failed to load the tags: {error}", {
				error: e.message,
			}),
		);
	}
	try {
		state.tagDefs = (await getTags()).tags;
		state.tagDefsLoaded = true;
	} catch (e) {
		showToast(
			tr("tagsLoadFailed", "Failed to load the tags: {error}", {
				error: e.message,
			}),
		);
	}
	renderHeader(); // again, with the tag definitions (the tag picker)
	if (!former) {
		loadStats().catch((e) => console.warn("c.stats.list failed", e));
		// Commands (<lcty-cmd>, LCTYSP-0004): defining the element now upgrades the one at the end of the file; it runs
		// only when this tab made it (the new conversation page); one that failed or that nobody holds shows Retry and
		// Remove. send generates a reply to the last user message.
		const stale = markLock();
		defineCommands({ send: (cmd, controller) => generate(cmd, controller) });
		for (const cmd of log.querySelectorAll(":scope > lcty-cmd")) wireCmd(cmd);
		new MutationObserver((changes) => {
			for (const c of changes)
				for (const n of c.addedNodes)
					if (n.localName === "lcty-cmd") wireCmd(n);
		}).observe(log, { childList: true });
		if (stale)
			checkLock(stale).catch((e) =>
				showToast(
					tr("saveFailed", "Failed to save: {error}", { error: e.message }),
				),
			);
	}
	panel.current = cid;
	panel.refresh();
	indexer.kick();
})();
