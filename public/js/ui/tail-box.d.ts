// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// tail-box.js: the tail's box of a reply streaming in (LCTYSP-0018, "The tail's box"), and following the reply while
// the reader is at its end (LCTYSP-0005, "Scrolling is the user's"). lcty-elements.js makes one for each reply as it
// streams in and draws the tail in its content. The implementation carries one-line comments only; its documentation
// is this file.

/**
 * The tail's box, a div.md-tail right after a reply's <article>, with one child, div.md-tail-content, where the tail
 * is drawn.
 *
 * - The box is reserved: its height is set here, a third of the view's at first, and it is contain: strict, so what is
 *   drawn in it never lays out what is around it, and overflow-anchor: none, so that the browser's scroll anchoring
 *   never moves the page for what is drawn in it.
 * - While the box is there, the <article> is display: flow-root, so that its children's margins are inside it and
 *   its height is all that a commit adds above the box.
 * - It grows in steps: when the content is taller than the box, the box is made as tall as the content and a third of
 *   the view more.
 * - A commit does not move what is below: when the <article> grows, the box gives up as much, as far as the content
 *   still fits, so the reply's height stays.
 * - Following: from when at least 80% of the box is in view (of the view's height, when the box is taller than the
 *   view), the end of the content is kept three lines above the composer of the <lcty-c> it is in (or the view's
 *   bottom), from above as from below, so that the room left in the box stays below the view. A line is the line
 *   height of the <lcty-c> (of the <article> outside one), read once, the first time the box follows; it is the room
 *   lcty.v1.css leaves below the messages, so the reply stays where it is when it ends. It stops when no part of the
 *   box is in view, or when the reader scrolls: a wheel, a touch move, a key that scrolls the page (arrows, Page Up
 *   and Down, Home, End, Space) pressed outside a field, a press on the page's scroll bar, or a scroll up that the box
 *   did not make. It starts again by itself only when the box comes into view by 80% again, after it was less.
 * - "Auto-scroll": in an <lcty-c>, its followCheck is checked exactly while the box follows, and the reader turns
 *   following on and off with it. Checking it follows at once from the end of the reply, wherever the page is;
 *   unchecking it stops, and following does not start again by itself for the rest of the reply, even when the box
 *   comes into view by 80% again: only checking it again does. Checked before the reply's text begins (while it
 *   thinks), the box follows from when it is made.
 */
export class TailBox {
	/** Make the box right after article, a reply's <article>, and start watching it. */
	constructor(article: HTMLElement);
	/** The box, div.md-tail. */
	readonly box: HTMLDivElement;
	/** Where the tail is drawn, div.md-tail-content. */
	readonly content: HTMLDivElement;
	/** The <lcty-c> the reply is in, whose followCheck shows and sets following; null outside one. */
	readonly frame:
		| (HTMLElement & { dock: HTMLElement; followCheck: HTMLInputElement })
		| null;
	/** Whether the page follows the reply now; setting it checks or unchecks the frame's "Auto-scroll". */
	following: boolean;
	/** Follow from the end of the reply (true) or stop (false), as the reader checked or unchecked "Auto-scroll". */
	follow(on: boolean): void;
	/** Stop following, as the reader scrolled. */
	unfollow(): void;
	/** Remove the box with the room left in it, give the <article> back its display, and stop watching it. */
	remove(): void;
}

// How it works
//
// The heights are read without forcing a layout. A ResizeObserver on the content and on the <article> reports their
// heights after the browser has laid the frame out; the box's new height is set in that callback, so the browser lays
// the page out once more before it paints, and the frame never shows the content cut off. While following, the
// content's end is put in its place there too, as layout is then clean. An IntersectionObserver on the box says how
// much of it is in view, at every 5%.
//
// The reader's scrolls are told apart mostly by their input, as a scroll event cannot say who made it. A scroll bar
// drawn over the page (macOS's) leaves no input to see, so a scroll event is read too: while following, a scroll up
// from where the box last left the page (scrolled, set after each scroll the box makes) stops it. A scroll down is let
// be, as the page's own growth may make one, and following brings the content's end back to its place. The listeners
// are added once, on the window, for every box. "Auto-scroll" is listened to on the frame's followCheck itself, by
// each box from when it is made to when it is removed: a change event is not composed, so it never leaves the frame's
// Shadow DOM for the window.
