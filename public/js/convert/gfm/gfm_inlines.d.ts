// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// gfm_inlines.js: the inline phase of GFM 0.29-gfm (LCTYSP-0017), the inlines of its document tree, and the whole tree
// once they are parsed, the blocks of gfm_blocks.d.ts with the inlines as what a paragraph, a heading and a table cell
// hold. The implementation carries one-line comments only; its documentation is this file.
//
// The text of a leaf block becomes text, code spans, emphasis, strikethrough, links, images, autolinks, raw HTML and
// line breaks. It is done in three steps, so the tree is built once and never rearranged:
// 1. The text is read into a flat array of items: runs of text, delimiter runs (* _ ~), brackets, code spans, raw
//    HTML, autolinks and line breaks.
// 2. Emphasis and links are found with the delimiter and bracket stacks of the spec's "An algorithm for parsing nested
//    emphasis and links". A match does not move nodes: it marks the items, an opening run with the elements it opens
//    and a closing run with how many it closes, and a bracket as the start of a link.
// 3. The items are read once, in order, into the children of the leaf (build). Adjacent pieces of text are one text
//    node whose view is the pieces.
//
// The extended autolinks are found as GFM's reference finds them: www. and scheme:// while the text is read, email
// addresses in each text node, outside links, as it is built.

import type * as Blocks from "./gfm_blocks.js";
import type { DecodeName, LinkData, NodeOf } from "./gfm_blocks.js";

export type Text = NodeOf<"text", null, never>;
export type Code = NodeOf<"code", null, never>;
export type HtmlInline = NodeOf<"html_inline", null, never>;
export type Break = NodeOf<"softbreak" | "linebreak", null, never>;
/** Emphasis, strong emphasis and strikethrough. */
export type Emphasis = NodeOf<"emph" | "strong" | "del", null, Inline>;
/** A link or an image; an image's children are its description. */
export type Link = NodeOf<"link" | "image", LinkData, Inline>;

/** An inline: its offset is in the text of its leaf block's content. */
export type Inline = Text | Code | HtmlInline | Break | Emphasis | Link;

/** The document once its inlines are parsed. */
export type Document = Blocks.Document<Inline>;
export type Block = Blocks.Block<Inline>;
/** Any node of a parsed document. */
export type Node = Block | Inline;

export interface InlineOptions {
	/** Whether the extended autolinks are made (true by default). */
	autolink?: boolean;
}

/** The second phase of GFM's parsing: a leaf block's content as its inlines. */
export class InlineParser {
	/**
	 * refmap holds the link reference definitions of the whole text, read by the block phase. options.autolink: whether
	 * the extended autolinks of GFM are made (true by default; the spec's examples without the extension turn it off).
	 */
	constructor(
		decodeName: DecodeName,
		refmap: ReadonlyMap<string, LinkData>,
		options?: InlineOptions,
	);
	/** Parse content as the inlines of node, which becomes their parent. */
	parse(
		node: Blocks.Paragraph | Blocks.Heading | Blocks.TableCell,
		content: string,
	): void;
}

// How it works (gfm_inlines.js)
//
// A run of plain text goes up to the next character that may start something else, cut before the next place an
// extended autolink may start ("www." or "://"). Each of those places is looked for once, ahead of the position, and
// kept (nextSpecial, nextWww, nextScheme; -1 when there is none), so the runs cost their own length.
//
// An extended autolink starting at i of a text must have ended just past the first whitespace or < after it (runEnd).
// The autolink is looked for in the text up to there only, so each look costs its own length, not the rest of the text.
// Its domain is checked as GFM's check_domain checks it, and its end as autolink_delim finds it: trailing punctuation
// and an unmatched ) are taken off. An email address is found in each text node outside links once the node is built,
// as GFM's postprocess finds it, and the node is replaced by its pieces.
//
// A new inline node is made with no view and no children (inline), with the fields of every node in their order.
// Unicode whitespace of the spec is Zs, tab, LF, FF and CR; punctuation is the P* categories of 0.29 and the ASCII
// symbols. Character references and raw HTML are matched where the parser is, with sticky patterns.
