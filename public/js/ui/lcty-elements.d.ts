// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Features of the conversation elements (LCTYSP-0005). The custom elements in /lcty.v1/lcty.v1.cjs build the DOM
// structure and expose their inner elements as fields (container.composer, composer.input, message.undoButton, …).
// Nothing is added to the elements here; handlers are attached directly to the exposed elements, and features are
// plain functions that operate on the DOM.
//
//   initConversationElements(container, handlers)   initializes elements from the conversation file and attaches
//                                                   handlers (once at startup)
//     handlers: { onSend(text), onStop(), onUndo(el), onFork(el), onRegenerate(el) }
//   messageOf(el)   the message of a <lcty-message> (read from attributes, or the one given when created on screen)
//   readMessages(container) / appendMessage / removeFrom
//   appendText / appendThinking / finishMessage   incremental rendering while generating
//   initComposer / setComposerValue / setComposerBusy / focusComposer
//
// Elements from the conversation file (dual recording. LCTYSP-0003) read the message from attributes and keep the
// saved presentation children as they are. Per-element state lives in WeakMaps made on first use (state).

/// <reference path="../../lcty.v1/lcty.v1.d.cts" />

/** Server timings of a reply (llama-server's `timings`), as kept in data-timings. */
export interface Timings {
	cache_n?: number;
	prompt_n?: number;
	prompt_ms?: number;
	predicted_n?: number;
	predicted_per_second?: number;
	[key: string]: unknown;
}

/** Timings measured by the page, as kept in data-client. */
export interface ClientTimings {
	/** Time to the first output, in milliseconds */
	ttft_ms?: number;
	[key: string]: unknown;
}

/** A message of a conversation file of LCTYSP-0003, as read from (or given to) a <lcty-message>. */
export interface Message {
	/** The bare id (UUIDv7); the element's id is "c-msg-<id>" (LCTYSP-0003) */
	id: string;
	role: "user" | "assistant" | string;
	/** data-at */
	at?: string;
	/** data-status ("completed" when absent on screen; "streaming" while it is generated) */
	status?: string;
	/** data-error */
	error?: string;
	/** data-inherited="true" */
	inherited?: boolean;
	/** data-timings (JSON) */
	timings?: Timings;
	/** data-client (JSON) */
	client?: ClientTimings;
	/** data-usage (JSON) */
	usage?: unknown;
	/** data-content (or data-content-base64) */
	content: string;
	/** data-thinking, assistant messages only */
	thinking?: string;
}

/** A message of a file of LCTYSP-0013, as readLctyMsgs gives it. */
export interface LctyMsgMessage {
	/** The bare id: the element's id without its "msg-u-" / "msg-m-" prefix */
	id: string;
	/** "model" is read as "assistant" */
	role: "user" | "assistant";
	at: string | undefined;
	content: string;
}

/** The handlers initConversationElements attaches. */
export interface ConversationHandlers {
	onSend?(text: string): void;
	onStop?(): void;
	onUndo?(el: LctyMessageElement): void;
	onFork?(el: LctyMessageElement): void;
	onRegenerate?(el: LctyMessageElement): void;
}

/**
 * The text of a reply's timings popover, one item per line, from its {timings, client} ("" when there is none): the
 * input tokens (cached / computed, and the prompt time), the output tokens and rate when predicted_n is known, and the
 * time to the first output when client.ttft_ms is known.
 */
export function describeTimings(m: Pick<Message, "timings" | "client">): string;

/**
 * The message of a <lcty-message>: read from its attributes (an element from the conversation file, LCTYSP-0003) the
 * first time, or the one given when it was created on screen. The result is cached per element.
 */
export function messageOf(el: LctyMessageElement): Message;

/** Append streamed text to a reply's body <article>; it is rendered incrementally, once per animation frame. */
export function appendText(el: LctyMessageElement, delta: string): void;

/**
 * Append streamed thinking to a reply. The text is kept here and written to the thinking view's summary and body (the
 * body only while it is open); nothing happens when the element has no thinking view.
 */
export function appendThinking(el: LctyMessageElement, delta: string): void;

/**
 * End of streaming. Renders the rest of the body, turns the streamed thinking into data-thinking, and reflects the
 * message's status ("completed" by default), timings, etc. in the element's attributes and foot.
 */
export function finishMessage(el: LctyMessageElement): void;

/** Messages on screen (including those from the conversation file). */
export function readMessages(container: LctyCElement): Message[];

/**
 * Whether the conversation file is in the format of LCTYSP-0013 (lcty-msg): one of LCTYSP-0003 always has an
 * <lcty-setup>, its first element, so a file without one (and without a <lcty-message>) is of LCTYSP-0013.
 */
export function isLctyMsgFile(container: Element): boolean;

/**
 * The messages of a file of LCTYSP-0013, as readMessages gives those of LCTYSP-0003: the user and model <lcty-msg>
 * as {id, role, at, content}, with the bare id and model as assistant. system, memory and the other elements are not
 * messages.
 */
export function readLctyMsgs(container: Element): LctyMsgMessage[];

/**
 * Append a message created on screen to the end of container (its head and foot are Shadow DOM in lcty.v1.cjs), wire
 * its buttons, and move the last-user mark. A finished reply is rendered at once; a streaming one ("streaming" status)
 * is filled by appendText / appendThinking and closed by finishMessage.
 */
export function appendMessage(
	container: LctyCElement,
	m: Message,
): LctyMessageElement;

/** Remove the messages from index on, and move the last-user mark. */
export function removeFrom(container: LctyCElement, index: number): void;

/** Set the composer's text and resize its input to fit. */
export function setComposerValue(
	composer: LctyComposerElement,
	v: string,
): void;

/** Mark the composer busy (nothing is sent while busy) or not; returns whether it is busy now. */
export function setComposerBusy(
	composer: LctyComposerElement,
	b: unknown,
): boolean;

/** Focus the composer's input. */
export function focusComposer(composer: LctyComposerElement): void;

/**
 * Initialize elements from the conversation file and attach handlers (once at startup): wires each message's buttons
 * and foot, renders replies that have no saved presentation HTML, marks the last user message, makes the code blocks'
 * "Select all" and the suggested next messages work, and attaches the composer (initComposer).
 */
export function initConversationElements(
	container: LctyCElement,
	h?: ConversationHandlers,
): void;

/**
 * Attach the composer's behavior (used by the conversation page and the new conversation page): Enter sends,
 * Shift+Enter inserts a newline, Enter during IME composition is ignored, nothing is sent while busy (or when the text
 * is blank), the stop button calls onStop, and the input grows with its text (up to 40% of the window's height).
 */
export function initComposer(
	composer: LctyComposerElement,
	handlers?: { onSend?(text: string): void; onStop?(): void },
): void;

// Internals:
//
// Streaming a reply (viewState / viewCommit / viewTail / viewFlush / viewSetText / viewAppend / viewFinish, the reply
// body <article>, LCTYSP-0018): the text is read as GFM a top-level block at a time. Each animation frame BlockWatch
// says when to try BlockParser's advance, and each block it takes is committed: its inlines are parsed and it is
// written once into the <article> by the committed converter, as DOM nodes (DomSink), so the <article> holds the
// committed blocks only. The rest of the text, the tail, is drawn in the content of its box (TailBox, tail-box.d.ts),
// right after the <article>, outside it, by markdown.js, a renderer of its own that only has to look right until its
// text is committed. The box is made with the first delta and follows the reply while the reader is at its end. An
// open code block in the tail is appended to a text node instead of being redrawn. At the end every block is committed
// and the box is removed. Each flush dispatches a bubbling "md-render" event. viewSetText renders a whole text at once with
// the committed converter and drops data-generator.
//
// Thinking (thoughtState / thoughtFlush / thoughtAppend / thoughtFinish): a reply's thinking view is part of
// <lcty-message> (its Shadow DOM, lcty.v1.cjs), built from data-thinking. While the reply streams in, the text is kept
// here and written to the view's summary ("Thinking… (n characters)") and body (the body only while it is open); at
// the end it becomes data-thinking and the element shows it itself (summary "Thinking (n characters)").
//
// renderFoot: the foot is the element's own (lcty.v1.cjs): it shows the end of an incomplete reply from data-status /
// data-error and the ⓘ from data-timings / data-client. A message made on screen gets those attributes here; the
// timings text goes into the popover the ⓘ opens, so filling it in after the first paint changes nothing on screen.
//
// Message list (<lcty-c>): the whole page (window) scrolls. Scrolling is the user's: nothing here scrolls the page but
// the tail's box following a reply the reader is at the end of (tail-box.d.ts).
// markLastUser: Undo shows only on the last user message; CSS cannot select it, so it is marked with data-last-user.
//
// initConversationElements: the thinking view is the element's own, from data-thinking (lcty.v1.cjs). Files written
// before that may still have a <lcty-thinking> child of their own (hidden by lcty.v1.css); it is dropped. Replies
// without saved presentation HTML of this renderer (data-generator other than "lcty.v1.gfm": none, as when created
// through the API directly, or "lcty.v1", markdown.js's before LCTYSP-0017) are rendered from the attribute. "Select
// all" on code blocks selects the code, to copy it with the browser's own copy (no clipboard API, which needs a secure
// context). Suggested next messages (<suggestion-for-user-turn> in a reply, button.suggestion) put their text into the
// composer to edit and send.
