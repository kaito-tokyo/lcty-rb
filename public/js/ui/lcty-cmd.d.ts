// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// <lcty-cmd>: a command tag as a command object (LCTYSP-0003, LCTYSP-0004, LCTYSP-0005). Unlike the elements in
// lcty.v1.cjs (structure only), a command is behavior itself, so it is defined here.
//
//   <lcty-cmd data-op="send" data-at="…"></lcty-cmd>
//
// When a command becomes the last element of <lcty-c>, it runs its operation (data-op) and is responsible for it: while
// running it floats above the composer (slot="float" of <lcty-c>) with a spinner and a stop button, and can be aborted.
// It never scrolls the page. A command is added either
//   - to the file as well (when a conversation is created): opening the conversation again runs it while it is still
//     the last element, so an interrupted creation resumes; or
//   - only in memory (sending, regenerating): it runs now, and nothing is left to resume after the page closes.
// A command followed by other elements (its result) has already run and stays hidden. Unknown operations do nothing.
// The state is an attribute in the DOM only (never saved): running / done / aborted / failed / unknown. A command that
// has a state already, or a data-error (a failed one of LCTYSP-0013, written so), never runs: the page decides what it
// shows (stale: a lock nobody holds; held: one another tab holds; failed), with the label, and "Retry" and "Remove"
// (retryButton, removeButton), which the page wires, shown for failed and stale.

/**
 * The <lcty-cmd> element. Its class is created when the element is defined (defineCommands), so the module only
 * declares; it is not exported. Its Shadow DOM is a box (part lcty-cmd__box) of a spinner (lcty-cmd__spinner), the
 * label and the three buttons.
 */
export interface LctyCmdElement extends HTMLElement {
	/** The label (part lcty-cmd__label), "Generating…" at first; "Stopped: <error>" for one with data-error */
	label: HTMLSpanElement;
	/** Aborts the running operation (part lcty-cmd__stop lcty-button) */
	stopButton: HTMLButtonElement;
	/** "Retry", wired by the page, shown for failed and stale (part lcty-cmd__retry lcty-button) */
	retryButton: HTMLButtonElement;
	/** "Remove", wired by the page, shown for failed and stale (part lcty-cmd__remove lcty-button) */
	removeButton: HTMLButtonElement;
	/**
	 * Run the operation (once: while it runs, or after it has run, it does nothing). Resolves when it has finished,
	 * been aborted or failed; the state becomes done, aborted or failed (unknown when no operation has its data-op).
	 * An operation that throws is logged, not rethrown.
	 */
	run(): Promise<void>;
	/** Abort the running operation (no-op when it is not running). */
	abort(): void;
}

/** An operation: runs for cmd and is aborted through controller.signal. */
export type CommandOp = (
	cmd: LctyCmdElement,
	controller: AbortController,
) => Promise<void>;

/**
 * Register the operations (op name → operation) and define <lcty-cmd> (once). Call it once the page is ready to run
 * them: commands already in the document are upgraded at this moment, and the last one runs.
 */
export function defineCommands(table: Record<string, CommandOp>): void;

/**
 * Add a command in memory only (not to the file) at the end of container, with data-op and data-at (now); it runs at
 * once when <lcty-cmd> is defined.
 */
export function appendCommand(container: Element, op: string): LctyCmdElement;

// Internals: connectedCallback runs the command only when it has no state and no data-error and is the last element
// of an <lcty-c>; one with data-error gets state "failed" and the label "Stopped: <error>"; one followed by other
// elements gets state "done" (already followed by its result).
