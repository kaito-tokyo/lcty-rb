// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

"use strict";

/*export*/ const LctyT = {
	dicts: Object.create(null),
	addLang(lang, dict) {
		LctyT.dicts[lang] = Object.freeze(dict);
	},
	_(key, text, lang = document.documentElement.lang) {
		const dict = Object.hasOwn(LctyT.dicts, lang) && LctyT.dicts[lang];
		return String((Object.hasOwn(dict, key) && dict[key]) || text);
	},
};

/** <lcty-setup>: the system prompt (line 4 of a conversation file), shown by itself, collapsed (LCTYSP-0005) */
/*export*/ class LctySetupElement extends HTMLElement {
	static observedAttributes = ["data-instructions", "data-instructions-base64"];

	constructor() {
		super();
		this.text = document.createElement("pre");
		this.text.setAttribute("part", "lcty-setup__text");
		const summary = document.createElement("summary");
		summary.setAttribute("part", "lcty-setup__summary");
		summary.append(LctyT._("systemPrompt", "System prompt"));
		const details = document.createElement("details");
		details.setAttribute("part", "lcty-setup__details");
		details.append(summary, this.text);
		this.attachShadow({ mode: "open" }).append(details);
	}

	// data-instructions, or data-instructions-base64 (UTF-8) when the text has characters an attribute cannot hold
	attributeChangedCallback() {
		const base64 = this.getAttribute("data-instructions-base64");
		let text = this.getAttribute("data-instructions") || "";
		if (base64 != null) {
			try {
				text = new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true,
				}).decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
			} catch {
				text = "";
			}
		}
		this.text.textContent = text;
	}
}

/*export*/ class LctyCElement extends HTMLElement {
	// What each attribute decides (LCTYSP-0005): data-setup-tags the chips (the tags at
	// creation; the current ones are not shown yet) and data-tag-defs which of them are unknown and the picker's choices
	static observedAttributes = [
		"data-setup-tags",
		"data-tag-defs",
		"data-tag-names",
	];

	// The frame of a conversation file. Styling, what shows before the first message, and scrolling: LCTYSP-0005.

	constructor() {
		super();

		const _ = LctyT._;

		const $ = (el, attrs = {}, ...children) => {
			Object.entries(attrs).forEach((kv) => {
				el.setAttribute(...kv);
			});
			el.append(...children);
			return el;
		};

		this.sidebar = $(document.createElement("lcty-sidebar"), {
			id: "sidebar",
			part: "lcty-c__sidebar",
			// its parts (and its list's) under their own names: lcty-c::part(lcty-sidebar__nav) and so on
			exportparts:
				"lcty-button, lcty-button--primary, lcty-sidebar__nav, lcty-sidebar__link, lcty-sidebar__new, lcty-sidebar__refresh, lcty-sidebar__settings, lcty-sidebar__search-box, lcty-sidebar__search, lcty-sidebar__search-status, lcty-sidebar__list, lcty-conv-list__empty, lcty-conv-list__items, lcty-conv-list__entry, lcty-conv-list__item, lcty-conv-list__item--current, lcty-conv-list__title, lcty-conv-list__snippet, lcty-conv-list__tags, lcty-conv-list__tag, lcty-conv-list__tag-name, lcty-conv-list__meta",
		});
		this.titleInput = $(document.createElement("input"), {
			id: "conv-title",
			part: "lcty-c__title",
			type: "text",
			"aria-label": _("titleLabel", "Chat title"),
			placeholder: _("titlePlaceholder", "New chat"),
		});
		this.tagList = $(document.createElement("span"), {
			id: "conv-tag-list",
			part: "lcty-c__tag-list",
		});
		this.tagPicker = $(
			document.createElement("select"),
			{ part: "lcty-c__tag-picker", "aria-label": _("addTag", "Add a tag") },
			$(
				document.createElement("option"),
				{ value: "" },
				_("addTagOption", "+ Tag"),
			),
		);
		this.tags = $(
			document.createElement("span"),
			{ id: "conv-tags", part: "lcty-c__tags" },
			this.tagList,
			this.tagPicker,
		);
		this.proposeMemoryButton = $(
			document.createElement("button"),
			{
				id: "propose-memory",
				part: "lcty-c__propose-memory lcty-button",
				type: "button",
				title: _(
					"proposeMemoryTitle",
					"Ask the model to propose memory items for the tags from this chat",
				),
			},
			_("proposeMemory", "Propose memory"),
		);
		this.deleteButton = $(
			document.createElement("button"),
			{
				id: "delete-chat",
				part: "lcty-c__delete lcty-button lcty-button--danger",
				type: "button",
			},
			_("delete", "Delete"),
		);
		this.composer = $(document.createElement("lcty-composer"), {
			id: "composer",
			part: "lcty-c__composer",
			exportparts:
				"lcty-button, lcty-button--primary, lcty-composer__form, lcty-composer__input, lcty-composer__buttons, lcty-composer__send, lcty-composer__stop",
		});
		this.toEndButton = $(
			document.createElement("button"),
			{
				id: "to-end",
				part: "lcty-c__to-end lcty-button",
				type: "button",
				hidden: "",
			},
			_("toEnd", "Scroll to bottom"),
		);
		this.toEndButton.addEventListener("click", () =>
			window.scrollTo(0, document.scrollingElement.scrollHeight),
		);
		this.dock = $(
			document.createElement("div"),
			{ id: "dock", part: "lcty-c__dock" },
			$(
				document.createElement("div"),
				{ id: "float", part: "lcty-c__float" },
				this.toEndButton,
				$(document.createElement("slot"), { name: "float" }),
			),
			this.composer,
		);
		this.memoryDialog = $(document.createElement("dialog"), {
			id: "memory-dialog",
			part: "lcty-c__memory",
		});
		// the end of the page, watched for "to the bottom"
		this.end = $(document.createElement("div"), { part: "lcty-c__end" });

		// Tuning (LCTYSP-0005): the × of a tag chip is a bare button; the floating area lets clicks through between its buttons
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(
			'[part~="lcty-c__tag-remove"] { background: transparent; border: 0; padding: 0 0 0 2px; cursor: pointer; } [part~="lcty-c__float"] { pointer-events: none; } [part~="lcty-c__float"] > * { pointer-events: auto; }',
		);
		this.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
		this.shadowRoot.append(
			this.sidebar,
			$(
				document.createElement("header"),
				{ id: "conv-header", part: "lcty-c__header" },
				this.titleInput,
				this.tags,
				this.proposeMemoryButton,
				this.deleteButton,
			),
			document.createElement("slot"),
			$(document.createElement("div"), {
				id: "log-spacer",
				part: "lcty-c__spacer",
			}),
			this.dock,
			this.memoryDialog,
			this.end,
		);

		// The title is line 3 of the file and this element line 4, so it is already there; later changes are a module's
		this.titleInput.value = document.querySelector("title")?.textContent || "";

		// "To the bottom" is shown while the end of the page is more than 48 px below the view
		new IntersectionObserver(
			([e]) => (this.toEndButton.hidden = e.isIntersecting),
			{
				rootMargin: "0px 0px 48px 0px",
			},
		).observe(this.end);
	}

	attributeChangedCallback() {
		this.#tagsChanged();
	}

	// The parser has set the attributes by now: mark this conversation in the sidebar's list
	connectedCallback() {
		this.sidebar.list.current = this.id.replace(/^c-/, "");
		LctyCElement.#importFeatures();
	}

	// The conversation page's features (lcty.v1.async.mjs, next to this file in /lcty.v1/) are imported once the page has
	// loaded, so they never block rendering. import() resolves against this script's URL, which is /lcty.v1/lcty.v1.cjs:
	// a conversation file loads lcty.v1.js, which /c/ redirects here. Opened directly (file://) the import fails and the
	// page stays a static view (LCTYSP-0005).
	static #featuresRequested = false;
	static #importFeatures() {
		if (LctyCElement.#featuresRequested) return;
		LctyCElement.#featuresRequested = true;
		const run = () => import("./lcty.v1.async.mjs");
		if (document.readyState === "complete") run();
		else addEventListener("load", run, { once: true });
	}

	// The chips (data-setup-tags) and the picker's choices (data-tag-defs: the references of the defined tags, their
	// file-name parts; until it is set nothing is marked unknown and the picker has no choices). data-tag-names holds
	// their display names in the same order; a reference without one shows as itself (LCTYSP-0009)
	#tagsChanged() {
		const _ = LctyT._;
		const words = (name) =>
			(this.getAttribute(name) || "").split(/\s+/).filter(Boolean);
		const tags = words("data-setup-tags");
		const defs = this.hasAttribute("data-tag-defs")
			? words("data-tag-defs")
			: null;
		const names = words("data-tag-names");
		const label = (ref) => names[(defs || []).indexOf(ref)] || ref;
		const el = (tag, attrs, ...children) => {
			const e = document.createElement(tag);
			for (const kv of Object.entries(attrs)) e.setAttribute(...kv);
			e.append(...children);
			return e;
		};
		this.tagList.replaceChildren(
			...tags.map((name) => {
				const unknown = defs !== null && !defs.includes(name);
				return el(
					"span",
					{
						class: unknown ? "tag-chip unknown" : "tag-chip",
						part: unknown ? "lcty-c__tag lcty-c__tag--unknown" : "lcty-c__tag",
						"data-tag": name,
						title: unknown
							? _("undefinedTag", "Undefined tag")
							: _("searchTag", "Search tag:{name}").replace(
									"{name}",
									label(name),
								),
					},
					el(
						"span",
						{ class: "tag-name", part: "lcty-c__tag-name" },
						label(name),
					),
					el(
						"button",
						{
							type: "button",
							class: "tag-x",
							part: "lcty-c__tag-remove",
							"aria-label": _("removeTag", "Remove {name}").replace(
								"{name}",
								label(name),
							),
						},
						"×",
					),
				);
			}),
		);
		const choices = (defs || []).filter((name) => !tags.includes(name));
		this.tagPicker.replaceChildren(
			el("option", { value: "" }, _("addTagOption", "+ Tag")),
			...choices.map((name) => el("option", { value: name }, label(name))),
		);
		this.tagPicker.disabled = defs !== null && choices.length === 0;
	}
}

/**
 * <lcty-conv-list>: the sidebar's conversation list (also search results), in <lcty-sidebar>'s Shadow DOM; its parts
 * are styled through lcty-sidebar::part(…) (LCTYSP-0005). A page gives it items and the current conversation, and listens for
 * select {detail: {id, chunkId}} (search results carry chunkId, the user message id of the matching round; the items
 * are links, and a page cancels select to stay instead of following one) and
 * tag {detail: {name}} (a tag chip was clicked; name is what the chip shows).
 *
 * The items' tags are references (file-name parts, LCTYSP-0009). data-tag-defs holds the references of the defined
 * tags and data-tag-names their display names, in the same order, as on <lcty-c>: a chip shows the display name of its
 * reference, or the reference itself when it has none. Setting them redraws the items.
 */
/*export*/ class LctyConvListElement extends HTMLElement {
	static observedAttributes = ["data-tag-defs", "data-tag-names"];

	#items = [];

	#current = null;

	#empty = "";

	#shown = false;

	constructor() {
		super();
		this.addEventListener("click", (e) => {
			const tag = e.target.closest?.(".tag-name");
			if (tag) {
				e.stopPropagation();
				e.preventDefault(); // the chip is inside the item's link
				this.dispatchEvent(
					new CustomEvent("tag", { detail: { name: tag.textContent } }),
				);
				return;
			}
			const a = e.target.closest?.("a[data-id]");
			// a modified or non-primary click is the browser's (a new tab or window); a plain one is offered to the page
			// first, which cancels select when it handled it (otherwise the link is followed)
			if (
				!a ||
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			)
				return;
			const handled = !this.dispatchEvent(
				new CustomEvent("select", {
					cancelable: true,
					detail: { id: a.dataset.id, chunkId: a.dataset.chunk || null },
				}),
			);
			if (handled) e.preventDefault();
		});
	}

	/**
	 * items: [{id, title, updated_at_hint, messages?, tags?, snippet?, chunk_id?}]; empty: what to show for zero items.
	 * The count is shown only when an item has messages.
	 */
	show(items, empty = "") {
		this.#shown = true;
		this.#items = items || [];
		this.#empty = empty;
		this.#render();
	}

	attributeChangedCallback() {
		if (this.#items.length) this.#render();
	}

	/** The display name of a reference (data-tag-defs, data-tag-names), or the reference itself. */
	#label(ref) {
		const words = (name) =>
			(this.getAttribute(name) || "").split(/\s+/).filter(Boolean);
		return words("data-tag-names")[words("data-tag-defs").indexOf(ref)] || ref;
	}

	/** Show items from a cache (the browser's copy of the meta) unless show() has already been called. */
	showCached(items) {
		if (this.#shown) return;
		this.#items = items || [];
		this.#render();
	}

	set items(v) {
		this.show(v);
	}

	set current(id) {
		this.#current = id;
		for (const b of this.querySelectorAll("a[data-id]")) {
			const on = b.dataset.id === id;
			b.setAttribute(
				"part",
				on
					? "lcty-conv-list__item lcty-conv-list__item--current"
					: "lcty-conv-list__item",
			);
			if (on) b.setAttribute("aria-current", "true");
			else b.removeAttribute("aria-current");
		}
	}

	#render() {
		const _ = LctyT._;

		// part: the element names in the block lcty-conv-list (BEM: "item item--current" → lcty-conv-list__item …)
		const $ = (tag, part, attrs = {}, ...children) => {
			const el = document.createElement(tag);
			el.setAttribute(
				"part",
				part
					.split(" ")
					.map((p) => `lcty-conv-list__${p}`)
					.join(" "),
			);
			for (const kv of Object.entries(attrs)) el.setAttribute(...kv);
			el.append(...children);
			return el;
		};

		if (!this.#items.length && this.#empty) {
			this.replaceChildren($("p", "empty", {}, this.#empty));
			return;
		}
		this.replaceChildren(
			$(
				"ul",
				"items",
				{},
				...this.#items.map((c) => {
					const on = c.id === this.#current;
					// a link, so it can be opened in a new tab (the same file as convUrl in js/common.js, relative to the page,
					// which is one directory below the root: /c/ with the conversations, or /t/)
					const href = `../c/${encodeURIComponent(c.id)}.html${c.chunk_id ? `#c-msg-${c.chunk_id}` : ""}`;
					const b = $(
						"a",
						on ? "item item--current" : "item",
						{ href, "data-id": c.id },
						$("span", "title", {}, c.title || _("untitled", "(untitled)")),
					);
					if (c.chunk_id) b.dataset.chunk = c.chunk_id;
					if (on) b.setAttribute("aria-current", "true");
					if (c.snippet) b.append($("span", "snippet", {}, c.snippet));
					if (Array.isArray(c.tags) && c.tags.length) {
						b.append(
							$(
								"span",
								"tags",
								{},
								...c.tags.map((ref) =>
									$(
										"span",
										"tag",
										{
											class: "tag-chip",
											"data-tag": ref,
											title: _("searchTag", "Search tag:{name}").replace(
												"{name}",
												this.#label(ref),
											),
										},
										$(
											"span",
											"tag-name",
											{ class: "tag-name" },
											this.#label(ref),
										),
									),
								),
							),
						);
					}
					const date = String(c.updated_at_hint || "")
						.slice(0, 16)
						.replace("T", " ");
					const count =
						c.messages == null
							? ""
							: ` · ${_("messageCount", "{n} messages").replace("{n}", c.messages)}`;
					b.append($("span", "meta", {}, date + count));
					return $("li", "entry", {}, b);
				}),
			),
		);
	}
}

/*export*/ class LctySidebarElement extends HTMLElement {
	static _ = LctyT._;

	constructor() {
		super();

		const _ = LctySidebarElement._;

		// part: the element name in the block lcty-sidebar (BEM: "nav" → lcty-sidebar__nav)
		const $ = (el, part, attrs = {}, ...children) => {
			el.setAttribute("part", `lcty-sidebar__${part}`);
			for (const kv of Object.entries(attrs)) el.setAttribute(...kv);
			el.append(...children);
			return el;
		};

		// a new chat opens in a new window (tab), so the current conversation stays where it is. The pages that show the
		// sidebar are one directory below the root (/c/, /t/. LCTYSP-0005), so "../c/" is the new conversation page
		this.newLink = $(
			document.createElement("a"),
			"new",
			{ href: "../c/", target: "_blank", rel: "noopener" },
			_("newConversation", "+ New chat"),
		);
		// opens the tags dialog (the tag editor, LCTYSP-0009), attached by js/ui/sidebar.js
		this.tagsButton = $(
			document.createElement("button"),
			"tags",
			{
				type: "button",
				title: _("editTags", "Edit tags"),
				"aria-label": _("editTags", "Edit tags"),
			},
			_("tags", "Tags"),
		);
		// fetches the list again, throwing the browser's copy away; attached by js/ui/sidebar.js (LCTYSP-0010)
		this.refreshButton = $(
			document.createElement("button"),
			"refresh",
			{
				type: "button",
				title: _("refreshList", "Reload the list"),
				"aria-label": _("refreshList", "Reload the list"),
			},
			"↻",
		);
		// opens the settings dialog, attached by js/ui/sidebar.js (LCTYSP-0010)
		this.settingsButton = $(
			document.createElement("button"),
			"settings",
			{
				type: "button",
				title: _("settings", "Settings"),
				"aria-label": _("settings", "Settings"),
			},
			"⚙︎",
		);
		for (const a of [
			this.newLink,
			this.tagsButton,
			this.refreshButton,
			this.settingsButton,
		])
			a.part.add("lcty-sidebar__link", "lcty-button");
		this.newLink.part.add("lcty-button--primary");
		this.nav = $(
			document.createElement("nav"),
			"nav",
			{},
			this.newLink,
			this.tagsButton,
			this.refreshButton,
			this.settingsButton,
		);

		this.search = $(document.createElement("input"), "search", {
			type: "search",
			placeholder: _("searchPlaceholder", "Search chats"),
			"aria-label": _("searchPlaceholder", "Search chats"),
			autocomplete: "off",
		});
		this.searchStatus = $(document.createElement("span"), "search-status");
		this.searchBox = $(
			document.createElement("div"),
			"search-box",
			{},
			this.search,
			this.searchStatus,
		);

		this.list = $(document.createElement("lcty-conv-list"), "list");

		this.attachShadow({ mode: "open" }).append(
			this.nav,
			this.searchBox,
			this.list,
		);
	}

	#filled = false;

	// The display names of the list's tags, for the first paint too: the browser's copy of the tags (IndexedDB "lcty_v1_t",
	// store "t_full") through the worker that alone opens it (lcty.v1.t.worker.cjs, operation "get", which fetches
	// GET /v1/tags first when there is no copy yet; LCTYSP-0009), found from the page's URL like lcty.v1.c.worker.cjs
	// below.
	// The references are the tag files' names without the number and .html (tagRef in js/tag-names.js). The module sets
	// the same attributes when it has read the tags; whichever comes first, the second sets the same values.
	#loadTagNames() {
		let worker;
		try {
			worker = new Worker(
				new URL("../lcty.v1/lcty.v1.t.worker.cjs", document.baseURI),
			);
		} catch {
			return;
		}
		worker.onmessage = ({ data }) => {
			worker.terminate();
			const tags = data?.result?.tags;
			if (!Array.isArray(tags) || this.list.hasAttribute("data-tag-defs"))
				return;
			try {
				const refs = tags.map((t) => t.file.normalize("NFC").slice(6, -5));
				this.list.setAttribute(
					"data-tag-names",
					tags.map((t) => t.name).join(" "),
				);
				this.list.setAttribute("data-tag-defs", refs.join(" "));
			} catch {} // a broken copy: the chips keep their references
		};
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
		};
		worker.postMessage({
			id: 1,
			op: "get",
			endpoint: new URL("../v1/", document.baseURI).href,
		});
	}

	// The list is filled from the browser's copy of every conversation's meta as soon as the sidebar is in the document,
	// before any module has loaded (LCTYSP-0010): from IndexedDB ("lcty_v1_c", store "c_meta"), asynchronously, through the
	// worker that alone opens it (lcty.v1.c.worker.cjs, operation "get", which never creates the database; LCTYSP-0009). The worker is
	// found from the page's URL: every page is one directory below the root of the site (LCTYSP-0005). Opened directly
	// (file://) no worker can start, and the list stays empty. A module that has already shown its own items wins.
	connectedCallback() {
		if (this.#filled) return;
		this.#filled = true;
		this.#loadTagNames();
		// The cached tags and count are tags_hint and messages_hint (as the server's index recorded them)
		const newestFirst = (items) =>
			items
				.filter((c) => c && typeof c === "object" && typeof c.id === "string") // broken entries are skipped
				.map((c) => ({ ...c, tags: c.tags_hint, messages: c.messages_hint }))
				// newest first by updated_at_hint, then by id: the same order as the module's list (LCTYSP-0010)
				.sort((a, b) =>
					a.updated_at_hint !== b.updated_at_hint
						? a.updated_at_hint < b.updated_at_hint
							? 1
							: -1
						: a.id < b.id
							? 1
							: a.id > b.id
								? -1
								: 0,
				);
		let worker;
		try {
			worker = new Worker(
				new URL("../lcty.v1/lcty.v1.c.worker.cjs", document.baseURI),
			);
		} catch {
			return;
		}
		worker.onmessage = ({ data }) => {
			worker.terminate();
			if (!data?.result || data.result.stale) return;
			try {
				this.list.showCached(newestFirst(data.result.items));
			} catch {} // the module shows the list when it has loaded
		};
		worker.onerror = (e) => {
			e.preventDefault();
			worker.terminate();
		};
		worker.postMessage({
			id: 1,
			op: "get",
			endpoint: new URL("../v1/", document.baseURI).href,
		});
	}
}

/*export*/ class LctyMessageElement extends HTMLElement {
	static observedAttributes = [
		"data-role",
		"data-status",
		"data-error",
		"data-timings",
		"data-client",
		"data-thinking",
		"data-thinking-base64",
	];

	constructor() {
		super();
		this.attachShadow({ mode: "open" }).append(
			...this.#build(this.getAttribute("data-role")),
		);
		this.#showFoot();
	}

	attributeChangedCallback(name, old, value) {
		if (name === "data-role" && old !== value)
			this.shadowRoot.replaceChildren(...this.#build(value));
		if (name === "data-role" || name.startsWith("data-thinking"))
			this.#showThinking();
		this.#showFoot();
	}

	// The thinking of a reply, collapsed, from data-thinking (or data-thinking-base64, UTF-8, when the text has
	// characters an attribute cannot hold). Hidden when there is none. While a reply is generated a module writes the
	// summary and the body itself, then sets the attribute.
	#showThinking() {
		if (!this.thinking) return;
		const base64 = this.getAttribute("data-thinking-base64");
		let text = this.getAttribute("data-thinking") || "";
		if (base64 != null) {
			try {
				text = new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true,
				}).decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
			} catch {
				text = "";
			}
		}
		this.thinkingSummary.textContent = LctyT._(
			"thinkingDone",
			"Thinking ({n} characters)",
		).replace("{n}", text.length.toLocaleString());
		this.thinkingBody.textContent = text;
		this.thinking.hidden = !text;
	}

	// The foot: why an incomplete reply ended (data-status, data-error), and the ⓘ when there are timings (data-timings,
	// data-client), which opens a popover whose text a module fills in. Both come from attributes, so the foot is
	// settled at the first paint.
	#showFoot() {
		const _ = LctyT._;
		const error = this.getAttribute("data-error");
		const status =
			this.getAttribute("data-status") !== "incomplete"
				? ""
				: error
					? _("errorPrefix", "Error: {error}").replace("{error}", error)
					: _("stopped", "Stopped");
		if (this.statusText.textContent !== status)
			this.statusText.textContent = status;
		const info =
			this.hasAttribute("data-timings") || this.hasAttribute("data-client");
		if (this.info.hidden === info) this.info.hidden = !info;
		if (this.foot.hidden !== !(status || info))
			this.foot.hidden = !(status || info);
	}

	#build(role) {
		const _ = LctyT._;

		const $ = (el, attrs = {}, ...children) => {
			Object.entries(attrs).forEach((kv) => {
				el.setAttribute(...kv);
			});
			el.append(...children);
			return el;
		};

		const action = (name, label) =>
			$(
				document.createElement("button"),
				{
					type: "button",
					part: `lcty-message__action lcty-message__action--${name} lcty-button`,
				},
				label,
			);

		this.undoButton =
			role === "user" ? action("undo", _("undo", "Undo")) : null;
		this.forkButton =
			role === "user" ? action("fork", _("fork", "Fork from here")) : null;
		this.regenerateButton =
			role === "assistant"
				? action("regenerate", _("regenerate", "Regenerate"))
				: null;
		this.who = $(
			document.createElement("span"),
			{ part: "lcty-message__who" },
			role === "user"
				? _("user", "You")
				: role === "assistant"
					? _("assistant", "Assistant")
					: "",
		);
		this.statusText = $(document.createElement("span"), {
			part: "lcty-message__status",
		});
		// the ⓘ opens the timings in a popover (popovertarget, no script; a module fills it in)
		this.timings = $(document.createElement("div"), {
			id: "timings",
			part: "lcty-message__timings",
			popover: "auto",
		});
		this.info = $(
			document.createElement("button"),
			{
				type: "button",
				part: "lcty-message__info",
				popovertarget: "timings",
				"aria-label": _("timings", "Timings"),
				hidden: "",
			},
			"ⓘ",
		);
		this.foot = $(
			document.createElement("div"),
			{ part: "lcty-message__foot", hidden: "" },
			this.statusText,
			this.info,
			this.timings,
		);
		// a reply's thinking, between the head and the content (filled by #showThinking)
		this.thinkingSummary =
			role === "assistant"
				? $(document.createElement("summary"), {
						part: "lcty-message__thinking-summary",
					})
				: null;
		this.thinkingBody =
			role === "assistant"
				? $(document.createElement("div"), {
						part: "lcty-message__thinking-body",
					})
				: null;
		this.thinking =
			role === "assistant"
				? $(
						document.createElement("details"),
						{ part: "lcty-message__thinking", hidden: "" },
						this.thinkingSummary,
						this.thinkingBody,
					)
				: null;

		return [
			$(
				document.createElement("div"),
				{ part: "lcty-message__head" },
				this.who,
				$(
					document.createElement("span"),
					{ part: "lcty-message__actions" },
					...[this.undoButton, this.forkButton, this.regenerateButton].filter(
						Boolean,
					),
				),
			),
			...(this.thinking ? [this.thinking] : []),
			document.createElement("slot"),
			this.foot,
		];
	}
}

/*export*/ class LctyComposerElement extends HTMLElement {
	constructor() {
		super();

		const _ = LctyT._;

		const $ = (el, attrs = {}, ...children) => {
			Object.entries(attrs).forEach((kv) => {
				el.setAttribute(...kv);
			});
			el.append(...children);
			return el;
		};

		this.input = $(document.createElement("textarea"), {
			part: "lcty-composer__input",
			rows: "2",
			placeholder: _(
				"composerPlaceholder",
				"Message (Enter to send, Shift+Enter for a new line)",
			),
		});
		this.sendButton = $(
			document.createElement("button"),
			{
				type: "submit",
				part: "lcty-composer__send lcty-button lcty-button--primary",
			},
			_("send", "Send"),
		);
		this.stopButton = $(
			document.createElement("button"),
			{ type: "button", part: "lcty-composer__stop lcty-button" },
			_("stop", "Stop"),
		);
		this.form = $(
			document.createElement("form"),
			{ part: "lcty-composer__form" },
			this.input,
			$(
				document.createElement("div"),
				{ part: "lcty-composer__buttons" },
				this.sendButton,
				this.stopButton,
			),
		);

		// Tuning (LCTYSP-0005): the textarea is the bare field inside the form's frame
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(
			"textarea { background: transparent; border: 0; outline: none; resize: none; padding: 4px 6px; max-height: 40vh; }",
		);
		this.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
		this.shadowRoot.append(this.form);
	}
}

/**
 * <lcty-t>: a tag file shown as a page (/t/NNNNN-<part>.html. LCTYSP-0005, LCTYSP-0009). The file holds only the tag
 * (its name in data-tag, its <lcty-tagop>, <lcty-system> and <lcty-memory> children), so the frame makes it a page like
 * the others: it puts an <lcty-sidebar> before itself and the class "page" on <body> (the layout of the pages with a
 * sidebar), and holds the view, an element of its own that it puts first among its children. The children of the file
 * are hidden (lcty.v1.css); once they have been parsed the view shows them read-only, as the tag editor's fields.
 * The page's features (/t/tag-file.js, next to the tag file over HTTP) are imported once the page has loaded and
 * replace the view with the editor; opened directly (file://) the import fails and the page stays read-only. The module
 * is found from the page's URL, not from this script's, which is /lcty.v1/lcty.v1.cjs (/t/ redirects lcty.v1.js here).
 */
/*export*/ class LctyTElement extends HTMLElement {
	constructor() {
		super();
		this.view = document.createElement("div");
		this.view.className = "tag-file-view";
		this.sidebar = document.createElement("lcty-sidebar");
	}

	connectedCallback() {
		if (this.view.parentNode !== this) this.prepend(this.view);
		if (!this.sidebar.isConnected) {
			this.before(this.sidebar);
			document.body.classList.add("page");
		}
		if (!document.title) document.title = this.getAttribute("data-tag") || "";
		if (document.readyState === "loading")
			document.addEventListener("DOMContentLoaded", () => this.showFile(), {
				once: true,
			});
		else this.showFile();
		LctyTElement.#importFeatures();
	}

	static #featuresRequested = false;
	static #importFeatures() {
		if (LctyTElement.#featuresRequested) return;
		LctyTElement.#featuresRequested = true;
		const run = () => import(new URL("tag-file.js", document.baseURI).href);
		if (document.readyState === "complete") run();
		else addEventListener("load", run, { once: true });
	}

	// A text attribute, or its -base64 form (UTF-8) when the text has characters an attribute cannot hold
	static #text(el, name) {
		const base64 = el?.getAttribute(`${name}-base64`);
		if (base64 != null) {
			try {
				return new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true,
				}).decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
			} catch {
				return "";
			}
		}
		return el?.getAttribute(name) || "";
	}

	/** Shows the tag of the file in the view, read-only, with the tag editor's fields (the classes of js/tags.js) */
	showFile() {
		const _ = LctyT._;
		const $ = (tag, attrs = {}, ...children) => {
			const el = document.createElement(tag);
			for (const [k, v] of Object.entries(attrs)) {
				if (typeof v === "boolean") el[k] = v;
				else el.setAttribute(k, v);
			}
			el.append(...children);
			return el;
		};
		const text = LctyTElement.#text;
		const name = this.getAttribute("data-tag") || "";
		const prompt = text(
			this.querySelector(":scope > lcty-system"),
			"data-content",
		);
		const memory = [...this.querySelectorAll(":scope > lcty-memory")].map((m) =>
			text(m, "data-content"),
		);
		const chars = memory.reduce((s, m) => s + m.length, 0);
		const area = (value) => {
			const t = $("textarea", { rows: 2, readOnly: true });
			t.value = value;
			return t;
		};
		const promptArea = area(prompt);
		promptArea.rows = 3;
		this.view.replaceChildren(
			$("h2", {}, _("tags", "Tags")),
			$(
				"section",
				{ class: "tag-edit" },
				$(
					"div",
					{ class: "tag-edit-head" },
					$("input", {
						type: "text",
						value: name,
						"aria-label": _("tagName", "Tag name"),
						readOnly: true,
					}),
				),
				$(
					"label",
					{ class: "field" },
					$(
						"span",
						{},
						_(
							"tagPromptLabel",
							"System prompt (also write here what to remember)",
						),
					),
					promptArea,
				),
				$(
					"details",
					{ open: memory.length > 0 && memory.length <= 5 },
					$(
						"summary",
						{},
						_(
							"memorySummary",
							"Memory ({count} items, about {chars} characters)",
						)
							.replace("{count}", String(memory.length))
							.replace("{chars}", chars.toLocaleString()),
					),
					$(
						"ul",
						{ class: "mem-list" },
						...memory.map((m) => $("li", {}, area(m))),
					),
				),
			),
		);
	}
}

/*export*/ function defineLctyV1CustomElements(
	registry = globalThis.customElements,
) {
	registry.define("lcty-conv-list", LctyConvListElement);
	registry.define("lcty-sidebar", LctySidebarElement);
	registry.define("lcty-c", LctyCElement);
	registry.define("lcty-setup", LctySetupElement);
	registry.define("lcty-message", LctyMessageElement);
	registry.define("lcty-composer", LctyComposerElement);
	registry.define("lcty-t", LctyTElement);
}

/*mjs-ignore*/ defineLctyV1CustomElements();
