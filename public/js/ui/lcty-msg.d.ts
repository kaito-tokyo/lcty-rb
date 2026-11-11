// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The elements of a conversation file of LCTYSP-0013 as the page builds them (fat client, thin server): the attributes
// of each, in their one order, and its presentation, the <article>. The server checks them and writes them as sent
// (/v1/rpc, LCTYSP-0012); the page puts the same element into its document, so the two never differ.
//
//   msgAttrs / thinkingAttrs / cmdAttrs   the attributes of an element, ready for c.append.*
//   elementOf(tag, attrs, innerHTML)       the element itself, for the document
//   elementFromAttrs(tag, attrs)           an element another page wrote, its presentation made here from its text
//   lastElement(container)                 the last element of the file in the document (null before the first)
//   historyOf(container)                   {instructions, messages}: what the model is sent (LCTYSP-0013)
//
// Turning a text into the forms it is kept in, its attribute and its <article>, is in js/convert/.

/** The roles of an lcty-msg; each has its id prefix (sys-, mem-, msg-u-, msg-m-). */
export type MsgRole = "system" | "memory" | "user" | "model";

/** The attributes of an element of the file, attribute name to value. */
export type Attrs = Record<string, string>;

/**
 * The attributes of an lcty-msg, in their one order: data-role, id (the role's prefix and id, a new UUIDv7 by
 * default), data-at (user and model), data-template and data-tag when given, and the text: the integrity placeholder
 * data-content-integrity="sha384-", which the server fills in, and data-content (data-content-base64 when needed).
 */
export function msgAttrs(
	role: MsgRole,
	text: string,
	opts?: { id?: string; at?: string; template?: string; tag?: string },
): Attrs;

/** The attributes of an lcty-thinking: a new id ("think-<UUIDv7>"), data-at and the text (as for msgAttrs). */
export function thinkingAttrs(text: string, at: string): Attrs;

/** The attributes of an lcty-cmd: a new id ("cmd-<UUIDv7>"), data-op, data-at, and data-error when it failed. */
export function cmdAttrs(op: string, at: string, error?: string | null): Attrs;

/** An element of the file from its attributes and presentation (innerHTML, "" by default), as the server writes it. */
export function elementOf(
	tag: string,
	attrs: Attrs,
	innerHTML?: string,
): HTMLElement;

/**
 * An element another page wrote, from the tag and attributes of its c_html record: no HTML comes over /v1/rpc
 * (LCTYSP-0012), so the presentation is made here from the text, as for the page's own: a user message's article is
 * its text alone, the others' its Markdown. An lcty-cmd has none. Null when the text cannot be read.
 */
export function elementFromAttrs(tag: string, attrs: Attrs): HTMLElement | null;

/**
 * The last element of the file (lcty-msg, lcty-thinking or lcty-cmd) in the document, or null before the first; what
 * is not written (data-draft) is skipped.
 */
export function lastElement(container: ParentNode): Element | null;

/**
 * What the model is sent (LCTYSP-0013): the system and memory messages, joined by blank lines, as the instructions, and
 * the user and model messages as user and assistant (with their bare ids). Thinking and commands are never sent.
 */
export function historyOf(container: ParentNode): {
	instructions: string;
	messages: { id: string; role: "user" | "assistant"; content: string }[];
};
