// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The types of gfm_inlines.js: the inlines of the document tree of GFM 0.29-gfm (LCTYSP-0017), and the whole tree once
// they are parsed, the blocks of gfm_blocks.d.ts with the inlines as what a paragraph, a heading and a table cell hold.

import type * as Blocks from "./gfm_blocks.js";
import type { DecodeName, LinkData, NodeOf } from "./gfm_blocks.js";

// The types of the inlines, numbered on from the blocks'
export const TEXT: 13;
export const SOFTBREAK: 14;
export const LINEBREAK: 15;
export const CODE: 16;
export const HTML_INLINE: 17;
export const EMPH: 18;
export const STRONG: 19;
export const DEL: 20;
export const LINK: 21;
export const IMAGE: 22;
/** The name of each type of node, blocks and inlines, by its number ("document", …, "text", …). */
export const TYPE_NAMES: readonly string[];

export type Text = NodeOf<typeof TEXT, null, never>;
export type Code = NodeOf<typeof CODE, null, never>;
export type HtmlInline = NodeOf<typeof HTML_INLINE, null, never>;
export type Break = NodeOf<typeof SOFTBREAK | typeof LINEBREAK, null, never>;
/** Emphasis, strong emphasis and strikethrough. */
export type Emphasis = NodeOf<
	typeof EMPH | typeof STRONG | typeof DEL,
	null,
	Inline
>;
/** A link or an image; an image's children are its description. */
export type Link = NodeOf<typeof LINK | typeof IMAGE, LinkData, Inline>;

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
	/** refmap holds the link reference definitions of the whole text, read by the block phase. */
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
