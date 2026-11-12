// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tail's box of a reply streaming in: reserved, grown in steps, and followed at the reader's end (tail-box.d.ts).

// the part of the box in view that starts following, and the ratios the view is read at
const FOLLOW = 0.8;
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);
// the room between the content's end and the composer while following, in px
const MARGIN = 16;
const SCROLL_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End",
	" ",
]);

/** The height reserved at first, and added at each step: a third of the view. */
const part = () => Math.round(innerHeight / 3);

// the boxes on the page, which a scroll by the reader stops following
const boxes = new Set();
let listening = false;

/** Whether a key pressed in t is the field's or the control's, not the page's. */
function own(t, key) {
	if (!(t instanceof Element)) return false;
	if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
		return true;
	return key === " " && t.tagName === "BUTTON";
}

/** Listen once for the reader's own scrolls: a wheel, a touch, a key and the scroll bar. */
function listen() {
	if (listening) return;
	listening = true;
	const stop = () => {
		for (const b of boxes) b.unfollow();
	};
	addEventListener("wheel", stop, { passive: true });
	addEventListener("touchmove", stop, { passive: true });
	addEventListener("keydown", (e) => {
		if (SCROLL_KEYS.has(e.key) && !own(e.composedPath()[0], e.key)) stop();
	});
	addEventListener("pointerdown", (e) => {
		const root = document.documentElement;
		if (e.target === root && e.clientX >= root.clientWidth) stop();
	});
	// a scroll up the page did not make, such as a drag of a scroll bar drawn over the page, which gives no input
	addEventListener(
		"scroll",
		() => {
			for (const b of boxes) {
				if (b.following && scrollY < b.scrolled - 1) b.unfollow();
				b.scrolled = scrollY;
			}
		},
		{ passive: true },
	);
}

/** The tail's box after article: its content is where the tail is drawn. */
export class TailBox {
	constructor(article) {
		this.article = article;
		this.box = document.createElement("div");
		this.box.className = "md-tail";
		this.content = document.createElement("div");
		this.content.className = "md-tail-content";
		this.box.append(this.content);
		this.height = part();
		this.box.style.contain = "strict";
		// the browser's scroll anchoring would move the page as the tail is drawn again under it
		this.box.style.overflowAnchor = "none";
		this.box.style.height = `${this.height}px`;
		// the <article>'s margins inside it, so that its height is all a commit adds above the box
		article.style.display = "flow-root";
		article.after(this.box);
		// the heights last seen, the <article>'s null before the first
		this.articleHeight = null;
		this.contentHeight = 0;
		this.following = false;
		// where the page was scrolled to last, by the page or by the reader
		this.scrolled = scrollY;
		// whether coming into view by FOLLOW starts following: not again until the box has been out of it
		this.armed = true;
		this.resize = new ResizeObserver((entries) => this.resized(entries));
		this.resize.observe(this.content);
		this.resize.observe(article);
		this.view = new IntersectionObserver(([e]) => this.seen(e), {
			threshold: THRESHOLDS,
		});
		this.view.observe(this.box);
		boxes.add(this);
		listen();
	}

	/** The content's and the <article>'s new heights, read after the browser has laid them out. */
	resized(entries) {
		let gain = 0;
		for (const e of entries) {
			const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
			if (e.target === this.content) this.contentHeight = h;
			else {
				if (this.articleHeight !== null) gain += h - this.articleHeight;
				this.articleHeight = h;
			}
		}
		let next = this.height;
		// a commit: the box gives up what the <article> gained, as far as the content still fits
		if (gain > 0) next = Math.max(this.contentHeight, next - gain);
		if (this.contentHeight > next)
			next = Math.ceil(this.contentHeight) + part();
		if (next !== this.height) {
			this.height = next;
			this.box.style.height = `${next}px`;
		}
		if (this.following) this.toEnd();
	}

	/** How much of the box is in view: following starts at FOLLOW, and stops when none is. */
	seen(e) {
		const shown = e.isIntersecting ? e.intersectionRect.height : 0;
		if (shown === 0) {
			this.following = false;
			this.armed = true;
			return;
		}
		const whole = Math.min(
			e.boundingClientRect.height,
			e.rootBounds?.height ?? innerHeight,
		);
		if (shown < FOLLOW * whole) this.armed = true;
		else if (this.armed) {
			this.armed = false;
			this.following = true;
			this.toEnd();
		}
	}

	/** Put the content's end right above the composer. */
	toEnd() {
		const dock = this.article.closest("lcty-c")?.dock;
		const limit =
			(dock ? dock.getBoundingClientRect().top : innerHeight) - MARGIN;
		const end = this.content.getBoundingClientRect().bottom;
		// above the composer too, so that the room left in the box stays below the view
		if (Math.abs(end - limit) >= 1) {
			scrollBy(0, end - limit);
			this.scrolled = scrollY;
		}
	}

	/** Stop following, as the reader scrolled. */
	unfollow() {
		this.following = false;
	}

	/** Remove the box with the room left in it. */
	remove() {
		this.resize.disconnect();
		this.view.disconnect();
		boxes.delete(this);
		this.box.remove();
		this.article.style.removeProperty("display");
		if (this.article.style.length === 0) this.article.removeAttribute("style");
	}
}
