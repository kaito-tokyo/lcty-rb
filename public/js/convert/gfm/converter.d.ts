// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The types of converter.js (LCTYSP-0017); the document tree's are gfm_blocks.d.ts's and gfm_inlines.d.ts's.

import type * as Blocks from "./gfm_blocks.js";
import type { DecodeName, LinkData } from "./gfm_blocks.js";
import type { Document, InlineOptions } from "./gfm_inlines.js";

export type ParseOptions = InlineOptions;

/** The first phase of text, advanced to its end: the document, the definitions, and the leaves to parse. */
export function parseBlocks(
	text: string,
	decodeName: DecodeName,
): {
	doc: Blocks.Document;
	refmap: ReadonlyMap<string, LinkData>;
	leaves: (Blocks.Paragraph | Blocks.Heading | Blocks.TableCell)[];
};

/** The document tree of text, in both phases: its blocks, and the inlines of each paragraph, heading and table cell. */
export function parseGfm(
	text: string,
	decodeName: DecodeName,
	options?: ParseOptions,
): Document;

/**
 * The weak half of reading a stream, for BlockParser's advance: whether a head may have ended its first block. It
 * reads each complete line once and may say yes when the block has not ended; the client resets it for each new head.
 */
export class BlockWatch {
	constructor();
	/** Look at a new head. */
	reset(): void;
	/** Whether a line of head not read yet may end its first block (true at the first such line). */
	mayEnd(head: string): boolean;
}
