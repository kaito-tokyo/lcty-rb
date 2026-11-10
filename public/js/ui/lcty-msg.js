// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The elements of a conversation file of LCTYSP-0013 as the page builds them (fat client, thin server): the attributes
// of each, in their one order, and its presentation, the <article>. The server checks them and writes them as sent
// (/v1/rpc, LCTYSP-0012); the page puts the same element into its document, so the two never differ.
//
//   msgAttrs / thinkingAttrs / cmdAttrs   the attributes of an element, ready for c.append.*
//   userArticle / replyArticle            the <article> of a user message and of the others (Markdown)
//   elementOf(tag, attrs, innerHTML)       the element itself, for the document
//   lastElement(container)                 the last element of the file in the document (null before the first)
//   historyOf(container)                   {instructions, messages}: what the model is sent (LCTYSP-0013)

import { newMsgId } from "../common.js";
import { renderMarkdown } from "./markdown.js";
import { textAttr } from "./text-attr.js";

const PREFIX = {
	system: "sys-",
	memory: "mem-",
	user: "msg-u-",
	model: "msg-m-",
};
// C0 controls other than tab, LF and CR, and U+FFFE / U+FFFF: an attribute of the file cannot hold them (LCTYSP-0003)
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters looked for
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

/** The text attributes: the integrity placeholder, which the server fills in, and the text (base64 when needed). */
function textAttrs(text) {
	if (!XML_FORBIDDEN.test(text))
		return { "data-content-integrity": "sha384-", "data-content": text };
	const bytes = new TextEncoder().encode(text);
	return {
		"data-content-integrity": "sha384-",
		"data-content-base64": btoa(String.fromCharCode(...bytes)),
	};
}

/**
 * The attributes of an lcty-msg: data-role, id (the role's prefix and id, a new UUIDv7 by default), data-at (user and
 * model), data-template and data-tag when given, and the text.
 */
export function msgAttrs(
	role,
	text,
	{ id = newMsgId(), at, template, tag } = {},
) {
	const a = { "data-role": role, id: `${PREFIX[role]}${id}` };
	if (at) a["data-at"] = at;
	if (template) a["data-template"] = template;
	if (tag) a["data-tag"] = tag;
	return { ...a, ...textAttrs(text) };
}

/** The attributes of an lcty-thinking: a new id, data-at and the text. */
export function thinkingAttrs(text, at) {
	return { id: `think-${newMsgId()}`, "data-at": at, ...textAttrs(text) };
}

/** The attributes of an lcty-cmd: a new id, data-op, data-at, and data-error when it failed. */
export function cmdAttrs(op, at, error) {
	const a = { id: `cmd-${newMsgId()}`, "data-op": op, "data-at": at };
	if (error != null) a["data-error"] = error;
	return a;
}

const escapeText = (s) =>
	s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\r", "&#13;");

/** The <article> of a user message: its text alone (LCTYSP-0013). */
export function userArticle(text) {
	return `<article>${escapeText(text)}</article>`;
}

/** The <article> of a reply, a thinking or a system message: the text rendered as Markdown (markdown.js). */
export function replyArticle(text) {
	return `<article>${renderMarkdown(text)}</article>`;
}

/** An element of the file built from its attributes and presentation, as the server writes it. */
export function elementOf(tag, attrs, innerHTML = "") {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	const t = document.createElement("template");
	t.innerHTML = innerHTML;
	el.append(t.content);
	return el;
}

const FILE_ELEMENTS = ":scope > :is(lcty-msg, lcty-thinking, lcty-cmd)";

/** The last element of the file in the document, or null before the first; what is not written (data-draft) is skipped. */
export function lastElement(container) {
	const els = container.querySelectorAll(`${FILE_ELEMENTS}:not([data-draft])`);
	return els[els.length - 1] ?? null;
}

/**
 * What the model is sent (LCTYSP-0013): the system and memory messages, joined by blank lines, as the instructions, and
 * the user and model messages as user and assistant. Thinking and commands are never sent.
 */
export function historyOf(container) {
	const instructions = [];
	const messages = [];
	for (const el of container.querySelectorAll(":scope > lcty-msg")) {
		const content = textAttr(el, "data-content") ?? "";
		const role = el.dataset.role;
		if (role === "system" || role === "memory") instructions.push(content);
		else if (role === "user" || role === "model")
			messages.push({
				id: el.id.replace(/^msg-[um]-/, ""),
				role: role === "model" ? "assistant" : "user",
				content,
			});
	}
	return { instructions: instructions.join("\n\n"), messages };
}
