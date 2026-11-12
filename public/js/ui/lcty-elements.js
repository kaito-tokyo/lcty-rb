// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Features of the conversation elements: plain functions on the elements lcty.v1.cjs builds (LCTYSP-0005, LCTYSP-0003).

import { DomSink, writeCommitted } from "../convert/gfm/committed.js";
import { BlockWatch, parseGfm } from "../convert/gfm/converter.js";
import { BlockParser } from "../convert/gfm/gfm_blocks.js";
import { InlineParser } from "../convert/gfm/gfm_inlines.js";
import {
	codeBlockHTML,
	fenceParts,
	renderBlock,
	scanBlocks,
} from "../convert/markdown.js";
import { decodeName, replyOptions } from "../convert/reply.js";
import { textAttr } from "../convert/text-attr.js";
import { tr } from "../i18n.js";

const GENERATOR = "lcty.v1.gfm"; // The renderer that produced the saved presentation HTML (data-generator)

// ---- Streaming a reply (its <article> the committed blocks, the tail after it. LCTYSP-0018) ----

// Module state. The maps are made on first use, so the module only declares
const state = {
	viewMap: null,
	thoughtMap: null,
	messageMap: null,
	handlers: {},
};

/** reply body <article> => its stream (viewState) */
function views() {
	state.viewMap ??= new WeakMap();
	return state.viewMap;
}

function viewState(view) {
	let s = views().get(view);
	if (!s) {
		const parser = new BlockParser(decodeName);
		s = {
			text: "",
			// where the tail starts in text: what is before it is committed
			head: 0,
			done: false,
			raf: 0,
			parser,
			inlines: new InlineParser(decodeName, parser.refmap),
			watch: new BlockWatch(),
			doc: null,
			tail: null,
			fence: null,
		};
		views().set(view, s);
	}
	return s;
}

/** Commit the blocks the tail has ended, each written once into the <article>. */
function viewCommit(view, s) {
	const { parser } = s;
	let head = s.text.slice(s.head);
	for (;;) {
		if (!s.done && !s.watch.mayEnd(head)) return;
		const step = parser.advance(head, s.done, s.head);
		if (step === undefined) continue;
		s.watch.reset();
		if (step[1] === undefined) {
			s.head = s.text.length;
			return;
		}
		for (const leaf of step[3])
			s.inlines.parseLeaf(s.text, parser.nodes, parser.spans, leaf);
		if (step[2] !== -1) {
			s.doc ??= { nodes: parser.nodes, spans: parser.spans, ...replyOptions() };
			s.doc.source = s.text;
			writeCommitted(s.doc, step[2], new DomSink(view));
		}
		head = step[0];
		s.head = s.text.length - head.length;
	}
}

/** Draw the tail after the <article> with markdown.js, a renderer of its own (LCTYSP-0018). */
function viewTail(view, s) {
	const text = s.text.slice(s.head);
	if (s.done || text.trim() === "") {
		s.tail?.remove();
		s.tail = null;
		s.fence = null;
		return;
	}
	if (!s.tail) {
		s.tail = document.createElement("div");
		s.tail.className = "md-tail";
		view.after(s.tail);
	}
	const blocks = scanBlocks(text, false);
	if (blocks.length === 1 && blocks[0].kind === "fence") {
		// an open code block grows at its end: its code is appended to a text node
		const block = blocks[0];
		const start = s.head + block.start;
		const { lang, code } = fenceParts(block);
		let f = s.fence;
		if (!f || f.start !== start || f.lang !== lang || code.length < f.len) {
			s.tail.innerHTML = codeBlockHTML(lang, "");
			const node = document.createTextNode("");
			s.tail.querySelector("code").append(node);
			f = s.fence = { start, lang, node, len: 0 };
		}
		if (code.length > f.len) {
			f.node.appendData(code.slice(f.len));
			f.len = code.length;
		}
	} else {
		s.fence = null;
		s.tail.innerHTML = blocks.map((b) => renderBlock(b)).join("");
	}
}

function viewFlush(view, s) {
	viewCommit(view, s);
	viewTail(view, s);
	view.dispatchEvent(new Event("md-render", { bubbles: true }));
}

function viewCancel(s) {
	if (s.raf) cancelAnimationFrame(s.raf);
	s.raf = 0;
}

/** Render all at once */
function viewSetText(view, text) {
	view.removeAttribute("data-generator");
	const old = views().get(view);
	if (old) {
		viewCancel(old);
		old.tail?.remove();
	}
	views().delete(view);
	view.replaceChildren();
	const source = text ?? "";
	const { nodes, spans } = parseGfm(source, decodeName);
	writeCommitted(
		{ source, nodes, spans, ...replyOptions() },
		0,
		new DomSink(view),
	);
	view.dispatchEvent(new Event("md-render", { bubbles: true }));
}

function viewAppend(view, delta) {
	if (!delta) return;
	const s = viewState(view);
	s.text += delta;
	if (!s.raf) {
		s.raf = requestAnimationFrame(() => {
			s.raf = 0;
			viewFlush(view, s);
		});
	}
}

function viewFinish(view) {
	const s = viewState(view);
	s.done = true;
	viewCancel(s);
	viewFlush(view, s);
	views().delete(view);
}

// ---- Thinking (while a reply is generated) ----

/** <lcty-message> => { text, rendered, raf, node } while it streams */
function thoughts() {
	state.thoughtMap ??= new WeakMap();
	return state.thoughtMap;
}

function thoughtState(el) {
	let s = thoughts().get(el);
	if (!s) {
		s = { text: "", rendered: 0, raf: 0, node: document.createTextNode("") };
		thoughts().set(el, s);
		el.thinkingBody.replaceChildren(s.node);
		el.thinking.addEventListener("toggle", () => thoughtFlush(el, s));
	}
	return s;
}

function thoughtFlush(el, s) {
	const n = s.text.length;
	el.thinking.hidden = n === 0;
	el.thinkingSummary.textContent = tr(
		"thinkingNow",
		"Thinking… ({n} characters)",
		{ n: n.toLocaleString() },
	);
	if (el.thinking.open && s.rendered < n) {
		s.node.appendData(s.text.slice(s.rendered));
		s.rendered = n;
		el.dispatchEvent(new Event("md-render", { bubbles: true }));
	}
}

function thoughtAppend(el, delta) {
	if (!delta || !el.thinking) return;
	const s = thoughtState(el);
	s.text += delta;
	if (!s.raf) {
		s.raf = requestAnimationFrame(() => {
			s.raf = 0;
			thoughtFlush(el, s);
		});
	}
}

// The end of streaming: the text becomes data-thinking, which the element shows (summary "Thinking (n characters)")
function thoughtFinish(el) {
	const s = thoughts().get(el);
	if (!s) return;
	if (s.raf) cancelAnimationFrame(s.raf);
	thoughts().delete(el);
	if (s.text) el.setAttribute("data-thinking", s.text);
	else el.removeAttribute("data-thinking");
}

// ---- Messages (<lcty-message>) ----

function fmtSec(ms) {
	return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

/** The text of a reply's timings popover, one item per line, from its {timings, client} ("" when there is none). */
export function describeTimings(m) {
	const parts = [];
	const t = m.timings;
	if (t) {
		const total = (t.cache_n ?? 0) + (t.prompt_n ?? 0);
		parts.push(
			tr(
				"timingInput",
				"Input {total} tok (cached {cache} / computed {prompt}, {time})",
				{
					total: total.toLocaleString(),
					cache: (t.cache_n ?? 0).toLocaleString(),
					prompt: (t.prompt_n ?? 0).toLocaleString(),
					time: fmtSec(t.prompt_ms ?? 0),
				},
			),
		);
		if (t.predicted_n != null)
			parts.push(
				tr("timingOutput", "Output {n} tok, {rate} tok/s", {
					n: t.predicted_n.toLocaleString(),
					rate: (t.predicted_per_second ?? 0).toFixed(1),
				}),
			);
	}
	if (m.client?.ttft_ms != null)
		parts.push(
			tr("timingFirst", "First output after {time}", {
				time: fmtSec(m.client.ttft_ms),
			}),
		);
	return parts.join("\n"); // one item per line in the popover
}

function jsonAttr(el, name) {
	const v = el.getAttribute(name);
	if (v == null) return undefined;
	try {
		return JSON.parse(v);
	} catch {
		return undefined;
	}
}

/** Build the message object from the attributes of a <lcty-message> from the conversation file (LCTYSP-0003). */
function messageFromAttributes(el) {
	const d = el.dataset;
	const m = { id: el.id.replace(/^c-msg-/, ""), role: d.role, at: d.at }; // id="c-msg-<UUIDv7>" (LCTYSP-0003)
	if (d.status) m.status = d.status;
	if (d.error) m.error = d.error;
	if (d.inherited === "true") m.inherited = true;
	for (const [k, attr] of [
		["timings", "data-timings"],
		["client", "data-client"],
		["usage", "data-usage"],
	]) {
		const v = jsonAttr(el, attr);
		if (v !== undefined) m[k] = v;
	}
	m.content = textAttr(el, "data-content") ?? "";
	if (m.role === "assistant") {
		const r = textAttr(el, "data-thinking");
		if (r != null) m.thinking = r;
	}
	return m;
}

/** <lcty-message> => message */
function messagesOf() {
	state.messageMap ??= new WeakMap();
	return state.messageMap;
}

export function messageOf(el) {
	let m = messagesOf().get(el);
	if (!m) {
		m = messageFromAttributes(el);
		messagesOf().set(el, m);
	}
	return m;
}

// Give the element's own foot its attributes and the ⓘ popover its timings text.
function renderFoot(el) {
	const m = messageOf(el);
	const set = (name, v) =>
		v == null ? el.removeAttribute(name) : el.setAttribute(name, v);
	set("data-error", m.error ?? null);
	set("data-timings", m.timings ? JSON.stringify(m.timings) : null);
	set("data-client", m.client ? JSON.stringify(m.client) : null);
	const t = describeTimings(m);
	if (el.timings.textContent !== t) el.timings.textContent = t;
}

// Attach click handlers to the message's buttons (only those its role has)
function wireMessage(el) {
	if (el.undoButton) el.undoButton.onclick = () => state.handlers.onUndo?.(el);
	if (el.forkButton) el.forkButton.onclick = () => state.handlers.onFork?.(el);
	if (el.regenerateButton)
		el.regenerateButton.onclick = () => state.handlers.onRegenerate?.(el);
}

/** Append a message created on screen to the end of container (the head and foot are Shadow DOM in lcty.v1.cjs). */
function addMessage(container, m) {
	const el = document.createElement("lcty-message");
	messagesOf().set(el, m);
	if (m.id) el.id = `c-msg-${m.id}`;
	el.dataset.role = m.role; // the head and buttons are built for the role here
	wireMessage(el);
	el.dataset.status = m.status || "completed";
	if (m.role === "user") {
		const body = document.createElement("div");
		body.className = "user-text";
		body.textContent = m.content;
		el.append(body);
	} else {
		// the thinking view is the element's own (data-thinking); only the content is a child
		if (m.thinking && m.status !== "streaming")
			el.setAttribute("data-thinking", m.thinking);
		el.append(document.createElement("article"));
	}
	container.append(el);
	if (m.role === "assistant" && m.status !== "streaming")
		viewSetText(el.querySelector(":scope > article"), m.content || "");
	renderFoot(el);
	return el;
}

export function appendText(el, delta) {
	viewAppend(el.querySelector(":scope > article"), delta);
}

export function appendThinking(el, delta) {
	thoughtAppend(el, delta);
}

/** End of streaming. Reflect the message's status, timings, etc. */
export function finishMessage(el) {
	viewFinish(el.querySelector(":scope > article"));
	thoughtFinish(el);
	el.dataset.status = messageOf(el).status || "completed";
	renderFoot(el);
}

// ---- Message list (<lcty-c>) ----

function messageEls(container) {
	return [...container.querySelectorAll(":scope > lcty-message")];
}

/** Messages on screen (including those from the conversation file). */
export function readMessages(container) {
	return messageEls(container).map(messageOf);
}

/** Whether the conversation file is in the format of LCTYSP-0013 (lcty-msg) rather than LCTYSP-0003. */
export function isLctyMsgFile(container) {
	return !container.querySelector(":scope > lcty-setup, :scope > lcty-message");
}

/** The messages of a file of LCTYSP-0013, as readMessages gives those of LCTYSP-0003. */
export function readLctyMsgs(container) {
	return [
		...container.querySelectorAll(
			':scope > lcty-msg:is([data-role="user"], [data-role="model"])',
		),
	].map((el) => ({
		id: el.id.replace(/^msg-[um]-/, ""),
		role: el.dataset.role === "model" ? "assistant" : "user",
		at: el.dataset.at,
		content: textAttr(el, "data-content") ?? "",
	}));
}

// Undo shows only on the last user message (CSS cannot select it, so mark it with an attribute).
function markLastUser(container) {
	const users = container.querySelectorAll(
		":scope > lcty-message[data-role=user]",
	);
	for (let i = 0; i < users.length; i++)
		users[i].toggleAttribute("data-last-user", i === users.length - 1);
}

export function appendMessage(container, m) {
	const el = addMessage(container, m);
	markLastUser(container);
	return el;
}

/** Remove the messages from index on. */
export function removeFrom(container, index) {
	for (const el of messageEls(container).slice(index)) el.remove();
	markLastUser(container);
}

// ---- Composer (<lcty-composer>) ----

// The composer's inside is Shadow DOM (lcty.v1.cjs); its textarea is exposed as composer.input
function textareaOf(composer) {
	return composer.input;
}

function resize(composer) {
	const ta = textareaOf(composer);
	ta.style.height = "auto";
	ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`;
}

export function setComposerValue(composer, v) {
	textareaOf(composer).value = v;
	resize(composer);
}
export function setComposerBusy(composer, b) {
	return composer.toggleAttribute("busy", !!b);
}
export function focusComposer(composer) {
	return textareaOf(composer).focus();
}

// ---- Startup ----

/** Initialize elements from the conversation file and attach handlers (once at startup). */
export function initConversationElements(container, h = {}) {
	state.handlers = h;
	for (const el of messageEls(container)) {
		wireMessage(el);
		renderFoot(el);
		// Drop the <lcty-thinking> child that older files may still have
		el.querySelector(":scope > lcty-thinking")?.remove();
		// Replies without saved presentation HTML are rendered from the attribute
		const view = el.querySelector(":scope > article");
		if (view && view.getAttribute("data-generator") !== GENERATOR)
			viewSetText(view, messageOf(el).content);
	}
	markLastUser(container);
	// Suggested next messages (<suggestion-for-user-turn> in a reply): put the text into the composer to edit and send
	container.addEventListener("click", (e) => {
		const btn = e.target.closest?.(
			":is(lcty-message, lcty-msg) > article button.suggestion",
		);
		if (!btn) return;
		setComposerValue(container.composer, btn.textContent);
		textareaOf(container.composer).focus();
	});
	container.addEventListener("click", (e) => {
		const btn = e.target.closest?.(
			":is(lcty-message, lcty-msg) > article .codebar button.select",
		);
		if (!btn) return;
		const code = btn.closest(".codeblock")?.querySelector("code");
		if (code) getSelection().selectAllChildren(code);
	});
	initComposer(container.composer, {
		onSend: (text) => state.handlers.onSend?.(text),
		onStop: () => state.handlers.onStop?.(),
	});
}

/** Attach the composer's behavior (used by the conversation page and the new conversation page). */
export function initComposer(composer, { onSend, onStop } = {}) {
	const send = () => {
		const text = composer.input.value;
		if (!text.trim() || composer.hasAttribute("busy")) return;
		onSend?.(text);
	};
	composer.form.onsubmit = (e) => {
		e.preventDefault();
		send();
	};
	composer.input.onkeydown = (e) => {
		if (
			e.key === "Enter" &&
			!e.shiftKey &&
			!e.isComposing &&
			e.keyCode !== 229
		) {
			e.preventDefault();
			send();
		}
	};
	composer.input.oninput = () => resize(composer);
	composer.stopButton.onclick = () => onStop?.();
}
