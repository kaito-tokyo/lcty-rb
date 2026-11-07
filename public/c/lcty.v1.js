// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// `lcty.v1.js` MUST be committed on the repository after being generated from this file:
//   ruby -E UTF-8 -e 'puts ARGF.read.gsub(/^export/, "/*export*/").gsub(%r[^//\?], "")' lcty.v1.mjs >lcty.v1.js

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

/** <lcty-setup>: the system prompt (line 4 of a conversation file), shown by itself, collapsed (LCTYSP-005) */
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
				text = new TextDecoder("utf-8", { fatal: true }).decode(
					Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
				);
			} catch {
				text = "";
			}
		}
		this.text.textContent = text;
	}
}

/*export*/ class LctyCElement extends HTMLElement {
	// What each attribute decides (LCTYSP-005): data-setup-tags the chips (the tags at
	// creation; the current ones are not shown yet) and data-tag-defs which of them are unknown and the picker's choices
	static observedAttributes = ["data-setup-tags", "data-tag-defs"];

	// The frame of a conversation file. Styling, what shows before the first message, and scrolling: LCTYSP-005.

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

		// Tuning (LCTYSP-005): the × of a tag chip is a bare button; the floating area lets clicks through between its buttons
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

	// The conversation page's features (lcty.v1.module.js, next to this file) are imported once the page has loaded, so
	// they never block rendering. import() resolves against this script's URL. Opened directly (file://) the import fails
	// and the page stays a static view (LCTYSP-005).
	static #featuresRequested = false;
	static #importFeatures() {
		if (LctyCElement.#featuresRequested) return;
		LctyCElement.#featuresRequested = true;
		const run = () => import("./lcty.v1.module.js");
		if (document.readyState === "complete") run();
		else addEventListener("load", run, { once: true });
	}

	// The chips (data-setup-tags) and the picker's choices (data-tag-defs: the defined tags; until it is set nothing is
	// marked unknown and the picker has no choices)
	#tagsChanged() {
		const _ = LctyT._;
		const words = (name) =>
			(this.getAttribute(name) || "").split(/\s+/).filter(Boolean);
		const tags = words("data-setup-tags");
		const defs = this.hasAttribute("data-tag-defs")
			? words("data-tag-defs")
			: null;
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
							: _("searchTag", "Search tag:{name}").replace("{name}", name),
					},
					el("span", { class: "tag-name", part: "lcty-c__tag-name" }, name),
					el(
						"button",
						{
							type: "button",
							class: "tag-x",
							part: "lcty-c__tag-remove",
							"aria-label": _("removeTag", "Remove {name}").replace(
								"{name}",
								name,
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
			...choices.map((name) => el("option", { value: name }, name)),
		);
		this.tagPicker.disabled = defs !== null && choices.length === 0;
	}
}

/**
 * <lcty-conv-list>: the sidebar's conversation list (also search results), in <lcty-sidebar>'s Shadow DOM; its parts
 * are styled through lcty-sidebar::part(…) (LCTYSP-005). A page gives it items and the current conversation, and listens for
 * select {detail: {id, chunkId}} (search results carry chunkId, the user message id of the matching round; the items
 * are links, and a page cancels select to stay instead of following one) and
 * tag {detail: {name}} (a tag chip was clicked).
 */
/*export*/ class LctyConvListElement extends HTMLElement {
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
					// a link, so it can be opened in a new tab (the same URL as convUrl in js/common.js)
					const href = `/c/${encodeURIComponent(c.id)}.html${c.chunk_id ? `#c-msg-${c.chunk_id}` : ""}`;
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
								...c.tags.map((name) =>
									$(
										"span",
										"tag",
										{
											class: "tag-chip",
											"data-tag": name,
											title: _("searchTag", "Search tag:{name}").replace(
												"{name}",
												name,
											),
										},
										$("span", "tag-name", { class: "tag-name" }, name),
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

		// a new chat opens in a new window (tab), so the current conversation stays where it is
		this.newLink = $(
			document.createElement("a"),
			"new",
			{ href: "/", target: "_blank", rel: "noopener" },
			_("newConversation", "+ New chat"),
		);
		// opens the tags dialog (the tag editor, LCTYSP-009), attached by js/ui/sidebar.js
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
		// fetches the list again, throwing the browser's copy away; attached by js/ui/sidebar.js (LCTYSP-010)
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
		// opens the settings dialog, attached by js/ui/sidebar.js (LCTYSP-010)
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

	// The list is filled from the browser's copy of every conversation's meta as soon as the sidebar is in the document,
	// before any module has loaded (LCTYSP-010): from the localStorage snapshot (lcty.meta.v1) synchronously, so it is
	// there at the first paint, or else from IndexedDB ("lcty", store "c_meta"), asynchronously. The database is only
	// read: when it does not exist it is not created (/js/sync_c_meta.worker.js owns the schema). A module that has already
	// shown its own items wins.
	connectedCallback() {
		if (this.#filled) return;
		this.#filled = true;
		// The cached tags and count are tags_hint and messages_hint (as the server's index recorded them)
		const newestFirst = (items) =>
			items
				.filter((c) => c && typeof c === "object" && typeof c.id === "string") // broken entries are skipped
				.map((c) => ({ ...c, tags: c.tags_hint, messages: c.messages_hint }))
				// newest first by updated_at_hint, then by id: the same order as the module's list (LCTYSP-010)
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
		let snapshot = null;
		try {
			snapshot = JSON.parse(localStorage.getItem("lcty.meta.v1"));
		} catch {}
		// An empty or unusable snapshot (broken, or written by other code) is not trusted: the database is read instead
		const fromSnapshot = Array.isArray(snapshot) ? newestFirst(snapshot) : [];
		if (fromSnapshot.length) {
			try {
				this.list.showCached(fromSnapshot);
				return;
			} catch {}
		}
		let req;
		try {
			req = indexedDB.open("lcty");
		} catch {
			return;
		}
		req.onupgradeneeded = () => req.transaction.abort(); // no database yet: do not create one
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => db.close();
			if (!db.objectStoreNames.contains("c_meta")) {
				db.close();
				return;
			}
			const get = db.transaction("c_meta").objectStore("c_meta").getAll();
			get.onsuccess = () => {
				db.close();
				try {
					this.list.showCached(newestFirst(get.result));
				} catch {} // the module shows the list when it has loaded
			};
			get.onerror = () => db.close();
		};
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
				text = new TextDecoder("utf-8", { fatal: true }).decode(
					Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
				);
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

		// Tuning (LCTYSP-005): the textarea is the bare field inside the form's frame
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(
			"textarea { background: transparent; border: 0; outline: none; resize: none; padding: 4px 6px; max-height: 40vh; }",
		);
		this.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
		this.shadowRoot.append(this.form);
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
}

defineLctyV1CustomElements();
