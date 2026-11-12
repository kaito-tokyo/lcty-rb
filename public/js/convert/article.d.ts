// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The presentation of a message, the <article> of the file, from its text (LCTYSP-0013): the second of the two forms a
// message is kept in, made from the first, the text of its attributes (convert/text-attr.js).
//
//   userArticle(text)    the <article> of a user message: its text alone, escaped
//   replyArticle(text)   the <article> of the others: the text rendered as GFM (convert/reply.js)

/**
 * The <article> of a user message: its text alone (LCTYSP-0013), with &, <, > and CR escaped (CR as &#13;, so it
 * survives in the file).
 */
export function userArticle(text: string): string;

/** The <article> of a reply, a thinking or a system message: the text rendered as GFM, LCTYSP-0017 (reply.js). */
export function replyArticle(text: string): string;
