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
 *   drawn in it never lays out what is around it.
 * - While the box is there, the <article> is display: flow-root, so that its children's margins are inside it and
 *   its height is all that a commit adds above the box.
 * - It grows in steps: when the content is taller than the box, the box is made as tall as the content and a third of
 *   the view more.
 * - A commit does not move what is below: when the <article> grows, the box gives up as much, as far as the content
 *   still fits, so the reply's height stays.
 * - Following: from when at least 80% of the box is in view (of the view's height, when the box is taller than the
 *   view), the end of the content is kept in view, 16px above the composer of the <lcty-c> it is in (or the view's
 *   bottom). It stops when no part of the box is in view, or when the reader scrolls: a wheel, a touch move, a key that
 *   scrolls the page (arrows, Page Up and Down, Home, End, Space) pressed outside a field, or a press on the page's
 *   scroll bar. It starts again only when the box comes into view by 80% again, after it was less.
 */
export class TailBox {
	/** Make the box right after article, a reply's <article>, and start watching it. */
	constructor(article: HTMLElement);
	/** The box, div.md-tail. */
	readonly box: HTMLDivElement;
	/** Where the tail is drawn, div.md-tail-content. */
	readonly content: HTMLDivElement;
	/** Whether the page follows the reply now. */
	readonly following: boolean;
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
// content's end is brought into view there too, as layout is then clean. An IntersectionObserver on the box says how
// much of it is in view, at every 5%; nothing reads the scroll position.
//
// What scrolls is told apart by its input, not by the scroll: a scroll event cannot say who made it, and the page's
// own changes of height move the scroll position too. The listeners are added once, on the window, for every box. A
// scroll bar drawn over the page (macOS's) leaves no press on the page to see, so dragging it does not stop following.
