// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The elements of a conversation file of LCTYSP-0013 as the page builds them (fat client, thin server; LCTYSP-0012).

import { newMsgId } from "../common.js";
import { replyArticle, userArticle } from "../convert/article.js";
import { textAttr, textAttrOf } from "../convert/text-attr.js";

const PREFIX = {
	system: "sys-",
	memory: "mem-",
	user: "msg-u-",
	model: "msg-m-",
};
/** The text attributes: the integrity placeholder, which the server fills in, and the text (base64 when needed). */
function textAttrs(text) {
	return {
		"data-content-integrity": "sha384-",
		...textAttrOf("data-content", text),
	};
}

/** The attributes of an lcty-msg, in their one order. */
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

/** An element of the file built from its attributes and presentation, as the server writes it. */
export function elementOf(tag, attrs, innerHTML = "") {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	const t = document.createElement("template");
	t.innerHTML = innerHTML;
	el.append(t.content);
	return el;
}

/** An element another page wrote, its presentation made here from its text (LCTYSP-0012). */
export function elementFromAttrs(tag, attrs) {
	if (tag === "lcty-cmd") return elementOf(tag, attrs);
	const probe = document.createElement("div"); // only to read the text as textAttr does
	for (const k of ["data-content", "data-content-base64"])
		if (attrs[k] != null) probe.setAttribute(k, attrs[k]);
	const text = textAttr(probe, "data-content");
	if (text == null) return null;
	const user = tag === "lcty-msg" && attrs["data-role"] === "user";
	return elementOf(tag, attrs, user ? userArticle(text) : replyArticle(text));
}

const FILE_ELEMENTS = ":scope > :is(lcty-msg, lcty-thinking, lcty-cmd)";

/** The last element of the file in the document, or null before the first. */
export function lastElement(container) {
	const els = container.querySelectorAll(`${FILE_ELEMENTS}:not([data-draft])`);
	return els[els.length - 1] ?? null;
}

/** What the model is sent (LCTYSP-0013): {instructions, messages}. */
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
