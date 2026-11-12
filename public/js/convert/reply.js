// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// A reply's presentation from its text with the GFM parser and the committed converter, in the page (reply.d.ts).

import { tr } from "../i18n.js";
import { gfmHtml } from "./gfm/converter.js";

// the names read so far, as there are few in a text
const names = new Map();
const NAMES_MAX = 4096;

/** The text of &name; as the browser's HTML parser reads it, or null (reply.d.ts). */
export function decodeName(name) {
	let s = names.get(name);
	if (s !== undefined) return s;
	s = null;
	if (typeof DOMParser !== "undefined") {
		const t = new DOMParser().parseFromString(`&${name};`, "text/html").body
			.textContent;
		// a name of HTML is one or two code points; anything longer is the reference not read, or a prefix of it
		if ([...t].length <= 2) s = t;
	}
	if (names.size >= NAMES_MAX) names.clear();
	names.set(name, s);
	return s;
}

/** The options of the committed converter in the page: its button's label. */
export function replyOptions() {
	return { selectAll: tr("selectAll", "Select all") };
}

/** The whole of text as LCTYSP-0017's output, an HTML string. */
export function replyHtml(text) {
	return gfmHtml(text, decodeName, replyOptions());
}
