// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// committed.js: the committed converter of LCTYSP-0018, which writes a committed block, or a whole document, as the
// output of LCTYSP-0017. The implementation carries one-line comments only; its documentation is this file.
//
// It reads the document tables the parsers share (gfm_blocks.d.ts, gfm_inlines.d.ts) and never writes them, and
// shares no code for writing HTML with the tail converter, which is its own module. Its output goes to a sink: the
// same walk writes the saved form, an HTML string (HtmlSink), or the page's DOM, built with the DOM's methods and no
// innerHTML (DomSink), so the two never differ.

import type { NodeTable, Row, SpanStore } from "./gfm_blocks.js";

/** What the converter reads: the tables of a parsed document and the text they were parsed from. */
export interface CommittedDocument {
	source: string;
	nodes: NodeTable;
	spans: SpanStore;
	/** The label of a code block's button ("Select all" when not given; the page gives tr("selectAll")). */
	selectAll?: string;
}

/** Where the output goes: an element opened and closed, an element without content, and text. */
export interface Sink {
	/** Open an element; attrs are its attributes as name, value, name, value, … in their order, or null. */
	start(tag: string, attrs?: readonly string[] | null): void;
	/** An element without content (br, hr). */
	empty(tag: string): void;
	/** Text, as it is: the sink escapes it. */
	text(s: string): void;
	/** Close the element last opened. */
	end(tag: string): void;
}

/**
 * The output as HTML in LCTYSP-0017's one form: names in lowercase, attribute values in double quotes in the order
 * given, br and hr without a closing slash, nothing between the elements. Text escapes & < >, and an attribute's value
 * also ".
 */
export class HtmlSink implements Sink {
	constructor();
	/** The HTML written so far. */
	html: string;
	start(tag: string, attrs?: readonly string[] | null): void;
	empty(tag: string): void;
	text(s: string): void;
	end(tag: string): void;
}

/** The output as DOM nodes, appended to parent in order, made with createElement, setAttribute and append. */
export class DomSink implements Sink {
	constructor(parent: Element | DocumentFragment);
	start(tag: string, attrs?: readonly string[] | null): void;
	empty(tag: string): void;
	text(s: string): void;
	end(tag: string): void;
}

/**
 * Write node of doc, a committed block (or the document, row 0, for every block of it), into sink as LCTYSP-0017's
 * output.
 */
export function writeCommitted(
	doc: CommittedDocument,
	node: Row,
	sink: Sink,
): void;

// How it works (committed.js)
//
// The walk is one switch on the type of each row, blocks and inlines alike, as the tables of LCTYSP-0017 give them. A
// paragraph is written without <p> in an item of a tight list (its list's B_D). A task list item's box (the item's
// B_C) is written as the first inline of its first paragraph, a span and a space. A code block's language is the first
// word of its info string (B_STR), and its code its lines, each with its line end. An HTML block is a paragraph of its
// lines as text, a <br> between two. A table writes <tbody> only when it has a body row, and a cell's alignment
// (B_A) as its class.
//
// Inline raw HTML is text, but for a suggested next message: an inline of raw HTML that is the opening tag
// <suggestion-for-user-turn>, in any case, outside a link, takes the text after it up to its closing tag, or to the end
// of the line, or of the leaf, when there is none. That text is read from the leaf's content as the inline parser read
// it (subject), so it is plain text, its Markdown as written; it is trimmed, and an empty one writes nothing. The
// inlines it took are not written.
//
// A link or an image is <a> when its destination's scheme is http, https or mailto and it is not inside another link
// being written; otherwise only its text (an image's: its alt text, the plain text of its description). A strong right
// inside a strong writes its contents alone.
