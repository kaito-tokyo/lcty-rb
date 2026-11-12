// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// reply.js: what the pages call to make a reply's presentation from its text, the GFM parser (convert/gfm/) and the
// committed converter (convert/gfm/committed.js) with what the page gives them. The implementation carries one-line
// comments only; its documentation is this file.

import type { DecodeName } from "./gfm/gfm_blocks.js";

/**
 * The text of the named character reference &name;, as the browser's HTML parser reads it, or null when HTML has no
 * such name, and where there is no DOMParser (in Node.js, where a reference stays text).
 *
 * HTML's parser also reads a prefix of an unknown name that is a name of its own without the semicolon (&notit; as ¬
 * and "it;"), and leaves an unknown reference as it is. A name of HTML is one or two code points, and either of the
 * others is three or more, so a text of one or two code points is the name's and anything longer means there is none.
 * The names read are kept, 4096 at most.
 */
export function decodeName(name: string): ReturnType<DecodeName>;

/** The options of the committed converter in the page: the label of a code block's button, tr("selectAll"). */
export function replyOptions(): { selectAll: string };

/** The whole of text as LCTYSP-0017's output, an HTML string: gfmHtml with decodeName and replyOptions. */
export function replyHtml(text: string): string;
