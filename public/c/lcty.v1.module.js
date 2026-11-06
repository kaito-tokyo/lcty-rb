// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

import {
	appendLines,
	deleteConversation,
	getConversation,
	getTags,
	popMessages,
	toLine,
} from "../js/api/storage.js";
import {
	appIndexer,
	backendOf,
	loadSettings,
	newMsgId,
	nowIso,
	showToast,
} from "../js/common.js";
import { tr } from "../js/i18n.js";
import { stream } from "../js/llm/client.js";
import { buildRequest } from "../js/llm/history.js";
import { openMemoryDialog, proposeMemory, sortTags } from "../js/tags.js";
import { appendCommand, defineCommands } from "../js/ui/lcty-cmd.js";
// Element features (the structure comes from the custom elements in /c/lcty.v1.js, which expose their inner elements as fields. LCTYSP-005)
import {
	appendMessage,
	appendText,
	appendThinking,
	finishMessage,
	focusComposer,
	initConversationElements,
	messageOf,
	readMessages,
	removeFrom,
	setComposerBusy,
	setComposerValue,
} from "../js/ui/lcty-elements.js";
// lcty.v1.module.js: the entry of the conversation page /c/<id>.html (LCTYSP-005). Line 1 of a conversation file loads
// lcty.v1.css, lcty.v1.js (the custom elements), lcty.v1.lang-ja.js (Japanese texts), the inline
// defineLctyV1CustomElements() and this module, which runs after the body is parsed and attaches the event listeners
// and features the page needs. Bundled into data/c/ at startup with every module it imports.
//
// The conversation file itself (data/c/<id>.html); the conversation is rebuilt from the elements in <lcty-c>. New
// conversations are made on / (js/pages/new.js). Saving is append-only; the one exception is popping the last turn
// (LCTYSP-004).
import { initSidebar } from "../js/ui/sidebar.js";
import { textAttr } from "../js/ui/text-attr.js";
import { UUID_RE } from "../js/uuid.js";

// The frame and the message list are <lcty-c> (built by lcty.v1.js during parsing. LCTYSP-005). Its inner elements are taken from fields
const log = document.querySelector("lcty-c");
const { composer } = log;

const state = {
	settings: null,
	conv: null, // { meta, title, messages, tags }
	persisted: false, // Whether the file has been read (always true once started: the file exists before this page opens)
	busy: false,
	abort: null,
	running: null,
	tagDefs: [],
	tagDefsLoaded: false,
};

const backend = () => backendOf(state.settings);

// Sidebar: search and conversation list, shared by every page (<lcty-sidebar> inside the container. LCTYSP-005, LCTYSP-007)
const panel = initSidebar(log.sidebar, {
	getSettings: () => state.settings,
	// A round of this conversation: scroll to it instead of reloading
	onSelect: ({ id, chunkId }) => {
		if (id !== state.conv?.meta.id || !state.persisted) return false;
		if (chunkId) focusMessage(chunkId);
		return true;
	},
});
const indexer = appIndexer(() => state.settings);
const lastIndex = (msgs, role) => {
	for (let i = msgs.length - 1; i >= 0; i--)
		if (msgs[i].role === role) return i;
	return -1;
};
const splitTags = (s) => (s || "").split(/\s+/).filter(Boolean);

// ---- Building the conversation ----

/** Build the conversation from the elements of the conversation file (LCTYSP-003). */
function convFromDom() {
	// The meta is <lcty-c>'s attributes and the first lcty-setup, written once at creation (LCTYSP-003)
	if (!log.id) return null;
	const d = log.dataset;
	const setup = log.querySelector(":scope > lcty-setup");
	const meta = {
		id: log.id.replace(/^c-/, ""), // id="c-<conversation id>" (LCTYSP-003)
		created_at: d.createdAt,
		thinking: d.thinking === "true",
		instructions: (setup && textAttr(setup, "data-instructions")) ?? "",
	};
	// The tags at creation are data-setup-tags. The current tags are not in the file (tags.sqlite, LCTYSP-009): they
	// start as the tags at creation and are loaded from the server at startup (loadConvTags)
	meta.tags = splitTags(d.setupTags);
	return {
		meta,
		title: document.querySelector("title")?.textContent || "", // the <title> on line 2, in the head (LCTYSP-003)
		tags: meta.tags,
		messages: readMessages(log),
	};
}

// ---- Saving (serialized; each line's content is fixed at call time) ----

let saveChain = Promise.resolve();
function enqueue(task) {
	saveChain = saveChain
		.then(task)
		.catch((e) =>
			showToast(
				tr("saveFailed", "Failed to save: {error}", { error: e.message }),
			),
		);
	return saveChain;
}

/** Append lines to the conversation file. */
function persist(lines) {
	const id = state.conv.meta.id;
	const snapshot = structuredClone(lines);
	return enqueue(() => appendLines(id, snapshot));
}

function pop(from) {
	const id = state.conv.meta.id;
	return enqueue(() => popMessages(id, from));
}

// ---- Rendering ----

// The header's tree is lcty.v1.js's (LctyCElement builds it from the conversation file's elements); this only sets
// values and attributes: the tag definitions (data-tag-defs) and what depends on the page's state.
function renderHeader() {
	log.titleInput.value = state.conv.title || "";
	showTitle(state.conv.title || "");
	renderTags();
}

// document.title writes into the document's first <title>, which here is the conversation file's own (line 2,
// LCTYSP-003). So it gets exactly what the file's title line holds, nothing added: the page stays a mirror of the file.
function showTitle(title) {
	if (document.title !== title) document.title = title;
}

const knownTag = (name) => state.tagDefs.some((t) => t.name === name);

// Until the tag definitions have arrived the frame keeps its defaults: data-tag-defs is not set (an empty one would
// mean "no tags are defined") and nothing is disabled for want of them, so nothing turns grey and back.
function renderTags() {
	if (state.tagDefsLoaded)
		log.setAttribute(
			"data-tag-defs",
			state.tagDefs.map((t) => t.name).join(" "),
		);
	log.proposeMemoryButton.disabled =
		state.busy || (state.tagDefsLoaded && !state.conv.tags.some(knownTag));
}

function setConvTags(tags) {
	const conv = state.conv;
	conv.tags = sortTags(state.tagDefs, tags);
	const line = { type: "tags", tags: conv.tags, at: nowIso() }; // the server keeps it in tags.sqlite, not in the file
	renderTags();
	if (state.persisted) persist([line]).then(() => panel.refresh());
}

log.tags.addEventListener("click", (e) => {
	const chip = e.target.closest(".tag-chip");
	if (!chip) return;
	const name = chip.dataset.tag;
	if (e.target.closest(".tag-x"))
		setConvTags(state.conv.tags.filter((x) => x !== name));
	else if (e.target.closest(".tag-name")) panel.setQuery(`tag:${name}`);
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
	const el = [...log.querySelectorAll(":scope > lcty-message")].find(
		(c) => messageOf(c).id === msgId,
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

async function onSend(text) {
	if (state.busy) return;
	const conv = state.conv;
	const firstTitle = !conv.title;
	if (firstTitle) conv.title = text.trim().split("\n")[0].slice(0, 30);
	const user = { id: newMsgId(), role: "user", content: text, at: nowIso() };
	conv.messages.push(user);
	appendMessage(log, user);
	setComposerValue(composer, "");
	renderHeader();
	const lines = [toLine(user)];
	if (firstTitle)
		lines.unshift({ type: "title", title: conv.title, at: nowIso() });
	persist(lines);
	appendCommand(log, "send"); // in memory only: generates now, nothing to resume after the page closes (LCTYSP-004)
}

/**
 * The title a reply proposes (LCTYSP-003): its first line, when that is a level-1 Markdown heading ("# タイトル").
 * The system prompt asks for one on every reply, but it is optional; null when there is none.
 */
function titleFromReply(content) {
	const m = /^\s*#[ \t]+([^\n]*)/.exec(content || "");
	const title = m ? m[1].replace(/[ \t]+#+[ \t]*$/, "").trim() : "";
	return title || null;
}

/** Generate a reply (the send command runs this). controller aborts it: the command's stop button and the composer's both do. */
async function generate(controller = new AbortController()) {
	const conv = state.conv;
	const req = buildRequest({ ...conv.meta, messages: conv.messages }); // built before the generating assistant message is added
	const msg = {
		id: newMsgId(),
		role: "assistant",
		content: "",
		thinking: "",
		status: "streaming",
	};

	state.abort = controller;
	setBusy(true);
	const t0 = performance.now();
	let tFirst = null;

	const iter = stream({
		backend: backend(),
		...req,
		signal: state.abort.signal,
	});
	let next = iter.next();
	conv.messages.push(msg);
	const el = appendMessage(log, msg);

	const run = (async () => {
		try {
			for (;;) {
				const { value: ev, done } = await next;
				if (done) break;
				if (ev.type === "text") {
					tFirst ??= performance.now();
					msg.content += ev.delta;
					appendText(el, ev.delta);
				} else if (ev.type === "thinking") {
					tFirst ??= performance.now();
					msg.thinking += ev.delta;
					appendThinking(el, ev.delta);
				} else if (ev.type === "done") {
					msg.status = ev.incomplete ? "incomplete" : "completed";
					if (ev.timings) msg.timings = ev.timings;
					if (ev.usage) msg.usage = ev.usage;
				} else if (ev.type === "error") {
					throw new Error(ev.message);
				}
				next = iter.next();
			}
			if (msg.status === "streaming") msg.status = "incomplete";
		} catch (e) {
			msg.status = "incomplete";
			if (e.name !== "AbortError") msg.error = e.message;
		} finally {
			if (!msg.thinking) delete msg.thinking;
			msg.client = {
				ttft_ms: tFirst == null ? null : Math.round(tFirst - t0),
				total_ms: Math.round(performance.now() - t0),
			};
			msg.at = nowIso();
			finishMessage(el);
			const lines = [toLine(msg)];
			const heading = titleFromReply(msg.content);
			if (heading && heading !== conv.title) {
				conv.title = heading;
				lines.push({ type: "title", title: heading, at: msg.at });
				renderHeader();
			}
			const saved = persist(lines);
			state.abort = null;
			state.running = null;
			setBusy(false);
			saved.then(() => {
				panel.current = state.conv.meta.id;
				panel.refresh();
				indexer.kick();
			});
		}
	})();
	state.running = run;
	await run;
}

// ---- Undo, regenerate, fork (LCTYSP-004) ----

function onUndo() {
	if (state.busy) return;
	const msgs = state.conv.messages;
	const i = lastIndex(msgs, "user");
	if (i < 0) return;
	const text = msgs[i].content;
	pop(i);
	msgs.length = i;
	removeFrom(log, i);
	renderHeader();
	setComposerValue(composer, text);
	focusComposer(composer);
}

async function onRegenerate() {
	if (state.busy) return;
	const msgs = state.conv.messages;
	const i = msgs.length - 1;
	if (i < 0 || msgs[i].role !== "assistant") return;
	pop(i);
	msgs.length = i;
	removeFrom(log, i);
	appendCommand(log, "send"); // in memory only (LCTYSP-004)
}

async function onFork(message) {
	if (state.busy) return;
	const i = state.conv.messages.indexOf(message);
	if (i < 0) return;
	await saveChain;
	location.href = `/?fork=${encodeURIComponent(state.conv.meta.id)}&at=${i}`;
}

// ---- Memory proposals (LCTYSP-009) ----

async function onProposeMemory() {
	if (state.busy || !state.persisted) return;
	const conv = state.conv;
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
			source: { conv_id: conv.meta.id, msg_id: last?.id },
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

// Composer and message buttons (attached by initConversationElements at startup)
const handlers = {
	onSend: (text) => onSend(text),
	onStop: () => state.abort?.abort(),
	onUndo: () => onUndo(),
	onRegenerate: () => onRegenerate(),
	onFork: (el) => onFork(messageOf(el)),
};
log.proposeMemoryButton.addEventListener("click", onProposeMemory);
log.titleInput.addEventListener("change", (e) => {
	const title = e.target.value.trim();
	if (title === state.conv.title) return;
	state.conv.title = title;
	showTitle(title);
	persist([{ type: "title", title, at: nowIso() }]).then(() => panel.refresh());
});
log.deleteButton.addEventListener("click", async () => {
	const conv = state.conv;
	if (
		!confirm(
			tr("confirmDelete", 'Delete "{title}"?', {
				title: conv.title || tr("untitled", "(untitled)"),
			}),
		)
	)
		return;
	state.abort?.abort();
	try {
		await saveChain;
		await deleteConversation(conv.meta.id);
		location.href = "/";
	} catch (e) {
		showToast(
			tr("deleteFailed", "Failed to delete: {error}", { error: e.message }),
		);
	}
});
// Leaving the page while generating loses the partial reply (LCTYSP-005)
window.addEventListener("beforeunload", (e) => {
	if (!state.busy) return;
	e.preventDefault();
	e.returnValue = "";
});

// ---- Startup ----

(async () => {
	// The layout is settled by lcty.v1.js and the scroll position is the browser's; the module only wires the elements
	// up. The messages (feet, thinking summaries) and the header are
	// prepared synchronously, before the settings and the tags are waited for.
	state.conv = convFromDom();
	if (!state.conv)
		return showToast(
			tr(
				"convLoadFailed",
				"Could not read the conversation file (<lcty-c> has no id)",
			),
		);
	state.persisted = true;
	initConversationElements(log, handlers);
	renderHeader();
	// #c-msg-<UUIDv7> (the message element's id); a bare #<UUIDv7> from older links still works
	const hashId = decodeURIComponent(location.hash.slice(1)).replace(
		/^c-msg-/,
		"",
	);
	if (UUID_RE.test(hashId)) focusMessage(hashId);
	state.settings = await loadSettings();
	if (!state.settings) return;
	try {
		// The current tags (tags.sqlite), which the file does not have
		state.conv.tags = (await getConversation(state.conv.meta.id)).tags;
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
	// Commands (<lcty-cmd>, LCTYSP-004): defining the element now upgrades the ones in the file; one that is still the last
	// element (a conversation just created on /, or a creation that was interrupted) runs. send generates a reply to the
	// last user message.
	defineCommands({
		send: async (cmd, controller) => {
			const msgs = state.conv.messages;
			if (state.busy || msgs[msgs.length - 1]?.role !== "user") return;
			await generate(controller);
		},
	});
	panel.current = state.persisted ? state.conv.meta.id : null;
	panel.refresh();
	indexer.kick();
})();
