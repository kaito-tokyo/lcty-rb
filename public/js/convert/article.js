// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The presentation of a message, the <article> of the file, made from its text (LCTYSP-0013).

import { replyHtml } from "./reply.js";

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

/** The <article> of a reply, a thinking or a system message: the text rendered as GFM (reply.js). */
export function replyArticle(text) {
	return `<article>${replyHtml(text)}</article>`;
}
