// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Markdown → HTML (pure functions, no DOM).
//
// For streaming rendering it is split into scanBlocks(), which cuts text into blocks,
// and renderBlock(), which turns one block into HTML (LCTYSP-0005).
// Supported: paragraphs / headings / rules / code blocks / quotes / lists (nested) / tables /
//            bold, italic, strikethrough, inline code, links, bare-URL autolinks and suggested next messages
//            (<suggestion-for-user-turn>text</suggestion-for-user-turn>, rendered as a button).
//
// Safety: text is always escaped and only http / https / mailto links are allowed.

/** The kinds of block scanBlocks() cuts text into. */
export type BlockKind =
	| "para"
	| "heading"
	| "hr"
	| "fence"
	| "quote"
	| "list"
	| "table";

/** A block of the source, as scanBlocks() returns it. */
export interface Block {
	kind: BlockKind;
	/** Offset of the block's first line in the source. */
	start: number;
	/** Offset just past the block's last line (including its newline). */
	end: number;
	/** The block's lines, without their line endings (a trailing CR is dropped). */
	lines: string[];
	/** Where the block was finalized, or null while it may still change. */
	completeAt: number | null;
	/** Whether the block and every block before it are finalized. */
	complete: boolean;
	/** For a list: whether the last line added was blank. */
	blank?: boolean;
}

/** Options of rendering. tight: render a paragraph without its <p> (the items of a tight list). */
export interface RenderOptions {
	tight?: boolean;
}

/**
 * Split src into blocks.
 * With final=false, a last line that does not end with a newline never finalizes a block
 * (a line still being written may change the decision). Finalized blocks have complete=true.
 * complete is contiguous from the start (once false, everything after is false).
 */
export function scanBlocks(src: string, final?: boolean): Block[];

/** Render the whole of src as HTML (all blocks, finalized). */
export function renderMarkdown(src: string, opts?: RenderOptions): string;

/**
 * Parts of a code block (also used for incremental rendering while streaming): its language (the first word of the
 * info string, or ""), its code (the fence's indentation removed from each line), and whether the closing fence is
 * there yet.
 */
export function fenceParts(block: Pick<Block, "lines">): {
	lang: string;
	code: string;
	closed: boolean;
};

/** The HTML of a code block: a bar with the language and a "Select all" button, then the escaped code. */
export function codeBlockHTML(lang: string, code: string): string;

/** The HTML of one block. */
export function renderBlock(b: Block, opts?: RenderOptions): string;

// Internals:
// renderList(): a blank line inside an item (outside code blocks) makes it a loose list (hasBlank). A different marker
// starts a new list (e.g. "-" after "1.").
// scanBlocks(): inside a list, a non-indented line that is not structural and does not follow a blank line is a lazy
// continuation line (it continues the previous item).
// emphasis(): *** is replaced before ** and *, so the tags nest.
// inlineText(): <suggestion-for-user-turn>text</suggestion-for-user-turn> is a suggested next user message, shown where
// it is written as a button. The text runs to the closing tag or, when it is missing (still streaming, or forgotten),
// to the end of the line. An empty one shows nothing.
// inlineText(): a bare URL stops at a NUL, which marks a held piece of HTML. The text is already escaped, so the URL
// also stops before an escaped ", < or > (&quot; &lt; &gt;).
