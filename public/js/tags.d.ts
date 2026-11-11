// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tags and memory (LCTYSP-0009). A tag is a file t/NNNNN-<part>.html on the server: {file, name, ops, prompt,
// memory}. NNNNN is the draft order, <part> is derived from the display name here (all Unicode handling is the
// browser's; the server only checks file names mechanically), and conversations refer to a tag by its part.
//  - (the name rules, file names and references are in tag-names.js)
//  - composeDraft: builds a system prompt draft from the chosen tags (deterministic)
//  - renderTagsEditor / initTagsDialog: editor for tag definitions and memory, in the tags dialog opened from the
//    sidebar (and, for one tag, on the page of its tag file)
//  - proposeMemory / openMemoryDialog: gets memory proposals from a conversation and adds only the approved ones

import type { Backend } from "./common.js";
import type { TagDef } from "./tag-names.js";

/** A memory proposal: the display name and the file of its tag, and the text to add. */
export interface MemoryProposal {
	tag: string;
	file: string;
	text: string;
}

/**
 * The system prompt draft (LCTYSP-0009): for each chosen tag (selected holds references) in file order, its prompt
 * followed by a "# Memory (name)" bullet list of its memory; blank prompts and items are left out, and the parts are
 * joined with blank lines.
 */
export function composeDraft(
	defs: readonly TagDef[],
	selected: Iterable<string>,
): string;

/**
 * Draws the editor for tag definitions (name, prompt, memory) into container: defs and etag are what GET /v1/tags
 * returned. The order is changed on the reorder page (/t/), not here. Calls onSaved(new definitions, {file}) after
 * saving; toast shows a message. Returns { isDirty }: whether there are unsaved edits.
 *
 * With file (the page of a tag file, LCTYSP-0009), only the tag in that file is shown and there is no "+ New tag"; the
 * rest of the set is sent back as it is. Deleting it saves at once. onSaved's file is the tag's file after the save
 * (a new name gives a new file), or null when it was deleted.
 *
 * Saving checks every name (tagNameError) and that the names are unique as parts, and fails with a message when a new
 * tag would need a number past five digits. A save that fails with 412 (the tags were changed in another tab
 * meanwhile) takes the new state, and the user redoes the edit on it; when that state cannot be loaded, the edits are
 * kept and saving again gets 412 until the tags can be loaded.
 */
export function renderTagsEditor(
	container: Element,
	options: {
		defs: readonly TagDef[];
		etag: string | null;
		onSaved: (
			defs: TagDef[],
			saved: { file: string | null | undefined },
		) => void;
		toast: (msg: string) => void;
		file?: string;
	},
): { isDirty(): boolean };

/**
 * Builds the tags dialog (a modal <dialog id="tags-dialog"> in <body>, so lcty.v1.css styles it on every page) and
 * wires button to open it; the sidebar's tag button opens it on every page. onSaved(new definitions) is called after
 * each save. Returns open(), for other buttons that open the same dialog.
 *
 * Closing with unsaved edits asks first (the close button, Esc and a click on the backdrop). Opening reads the saved
 * definitions again from the browser's copy (another tab of this browser may have changed them meanwhile; a change
 * made elsewhere makes the save fail with 412, which loads the new set); when they cannot be loaded, toast shows why
 * and the dialog stays closed.
 */
export function initTagsDialog(
	button: Element,
	options: {
		onSaved: (
			defs: TagDef[],
			saved: { file: string | null | undefined },
		) => void;
		toast: (msg: string) => void;
	},
): () => Promise<void>;

/**
 * Memory proposals (LCTYSP-0009). As a continuation of the current conversation, appends one temporary user message
 * asking for proposals (not saved to the conversation). The prefix is identical to the previous state, so the cache
 * applies. The conversation's tags are references; the model sees and answers with the display names of the defined
 * ones (constrained by a JSON schema), and each proposal carries the file of its tag. An invalid tag (a file without
 * <lcty-t>) takes no memory, so it is left out like an undefined one.
 *
 * Rejects when the conversation has no defined tags, when the stream reports an error, and when the reply is not a
 * JSON object whose proposals, when present, is a list; entries that are not proposals for one of the tags with a
 * non-blank text are skipped. Resolves to {proposals: [{tag, file, text}], tags: [{name, file}], timings}.
 */
export function proposeMemory(options: {
	conv: { tags: string[]; meta: Record<string, unknown>; messages: unknown[] };
	backend: Backend;
	defs: readonly TagDef[];
	signal?: AbortSignal;
}): Promise<{
	proposals: MemoryProposal[];
	tags: { name: string; file: string }[];
	timings: unknown;
}>;

/**
 * A dialog (#memory-dialog by default) to accept / edit and accept / discard each proposal, and to move it to another
 * of tags. Adds the approved ones with source, then closes, calls onDone and shows a toast; a failure is shown in the
 * dialog. Every element has a part (BEM, the block lcty-memory): the dialog is in <lcty-c>'s Shadow DOM, styled from
 * the page with lcty-c::part(…).
 */
export function openMemoryDialog(options: {
	dialog?: HTMLDialogElement;
	proposals: readonly MemoryProposal[];
	tags: readonly { name: string; file: string }[];
	source: unknown;
	onDone: () => void;
	toast: (msg: string) => void;
}): void;

// Internals:
// - el(tag, props, ...children) builds an element: class, dataset, on* listeners, and other props as attributes (true
//   as "", and undefined, null and false left out).
// - renderTagsEditor: reset() takes work anew (after a reload or a save), and the tag shown on a tag file's page is
//   found again by its file. A file without <lcty-t> (invalid) is shown with its name, not editable; saving sends it
//   back and the server keeps it. Names that differ only in case or in the escaped form are one tag (one file); an
//   invalid tag's part is its file's. Blank memory items are left out of what is sent; the editor keeps them until the
//   save succeeds. After the save the shown tag's file is taken from the sent tags, which are in the order of work.
//   The saved values (timestamps etc.) are then read again with GET, whose ETag is the one they were read with; when
//   that fails, what was sent is kept, with the ETag PUT returned.
// - proposalSchema(tags) is the JSON schema of the reply: {proposals: [{tag (one of tags), text}]}.
// - proposalPrompt(defs, tags) is the temporary user message: the instructions and the current memory of each tag.
