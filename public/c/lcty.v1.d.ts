// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Types and documentation for lcty.v1.js (LCTYSP-0005). The served script keeps no comments other than SPDX and
 * /*export*\/ to stay small, so its documentation lives here.
 *
 * - The source is the ES module public/c/lcty.v1.mjs (no imports; exported declarations start with `export`). The
 *   classic script public/c/lcty.v1.js is generated from it by the command in its head comment (each leading `export`
 *   becomes `/*export*\/`, and the last line `//?defineLctyV1CustomElements();` loses its `//?`) and committed. At
 *   startup chatty.rb copies it (with lcty.v1.css, nothing else) to data/c/, next to the conversation files: they
 *   belong to the user together (LCTYSP-0010).
 * - Every page loads it synchronously inside <head> (a conversation file on line 2, as lcty.v1.js; other pages as
 *   /c/lcty.v1.js), followed by lcty.v1.lang-ja.js (the Japanese texts, generated from public/c/lcty.v1.lang-ja.mjs).
 *   There is no inline script: lcty.v1.js defines the elements at its end. The conversation page's module
 *   lcty.v1.module.js is imported by <lcty-c> once the page has loaded; the rendering (the scroll position included)
 *   does not wait for it. The custom elements are defined before the body is parsed, so every
 *   element is created by the parser and the DOM structure is settled in a single pass.
 * - Each element builds its internal structure in Shadow DOM with DOM APIs in its constructor (a parser-created element may
 *   not get children or attributes there, but a shadow root is allowed). HTML strings (innerHTML) are not used. A small
 *   helper `$(el, attrs, ...children)` sets attributes (values are strings, as the DOM defines them; a boolean attribute is
 *   written as "" and an absent one is not written) and appends children. Inner elements are built as arguments of `$`;
 *   `append` is used only for the final shadow root.
 * - The conversation file's own elements stay in Light DOM and are shown through <slot> (dual recording, LCTYSP-0003).
 * - Styling comes from lcty.v1.css through ::part(); the part names below are BEM. The rules: LCTYSP-0005, Styling.
 * - Only DOM structure is defined here. Inner elements are exposed as fields, and every feature is attached to those
 *   fields by the modules loaded from the page entries (js/ui/lcty-elements.js, js/ui/sidebar.js, js/pages/*.js).
 */

/** Keys of the UI texts */
type LctyTextKey =
	| "newConversation"
	| "tags"
	| "settings"
	| "refreshList"
	| "searchPlaceholder"
	| "titleLabel"
	| "titlePlaceholder"
	| "proposeMemoryTitle"
	| "proposeMemory"
	| "delete"
	| "setupTags"
	| "systemPrompt"
	| "none"
	| "recompose"
	| "setupHint"
	| "undo"
	| "fork"
	| "regenerate"
	| "user"
	| "assistant"
	| "composerPlaceholder"
	| "send"
	| "stop"
	| "indexFailed"
	| "settingsLoadFailed"
	| "saveFailed"
	| "addTag"
	| "addTagOption"
	| "proposingMemory"
	| "memoryProposalFailed"
	| "confirmDelete"
	| "untitled"
	| "deleteFailed"
	| "tagsLoadFailed"
	| "convLoadFailed"
	| "messageCount"
	| "memoryHeading"
	| "searchTag"
	| "undefinedTag"
	| "removeTag"
	| "tagName"
	| "confirmDeleteTag"
	| "tagPromptLabel"
	| "memorySummary"
	| "badTagName"
	| "duplicateTagName"
	| "invalidTagFile"
	| "tagFileGone"
	| "tagNumbersFull"
	| "tagsChangedElsewhere"
	| "tagsSaved"
	| "saveFailedShort"
	| "tagsHint"
	| "reorderTags"
	| "tagOrderHeading"
	| "tagOrderHint"
	| "moveTagUp"
	| "moveTagDown"
	| "newTag"
	| "confirmDiscard"
	| "discardChanges"
	| "save"
	| "noMemoryYet"
	| "currentMemory"
	| "proposalPrompt1"
	| "proposalPrompt2"
	| "proposalPrompt3"
	| "proposalPrompt4"
	| "noDefinedTags"
	| "proposalNotJson"
	| "adopt"
	| "nothingToAdd"
	| "memoryAdded"
	| "nothingAdded"
	| "addFailed"
	| "memoryProposals"
	| "memoryProposalsHint"
	| "close"
	| "addAdopted"
	| "thinkingDone"
	| "thinkingNow"
	| "timingInput"
	| "timingOutput"
	| "timingFirst"
	| "timings"
	| "errorPrefix"
	| "stopped"
	| "selectAll"
	| "toEnd"
	| "generating"
	| "noConversations"
	| "noMatches"
	| "semanticUnavailable"
	| "searchFailed"
	| "listFailed"
	| "defaultValue"
	| "on"
	| "off"
	| "empty"
	| "settingsSaved"
	| "settingsSavedDefaults"
	| "settingsReset"
	| "connecting"
	| "connected"
	| "noModelList"
	| "missingModels"
	| "connectFailed"
	| "defaultsLoadFailed"
	| "noTagsYet"
	| "editTags"
	| "confirmCloseTags"
	| "forkTitle"
	| "forkFrom"
	| "forkInherits"
	| "createFailed"
	| "forkLoadFailed"
	| "newChatHeading"
	| "settingsHint"
	| "baseUrlLabel"
	| "apiKeyLabel"
	| "chatModelLabel"
	| "embeddingModelLabel"
	| "resetDefaults"
	| "testConnection";

/** The texts of one language. Untranslated items may be omitted (the caller's x-default text is used). */
type LctyDict = Readonly<Partial<Record<LctyTextKey, string>>>;

/**
 * UI texts. The language is <html lang>, matched exactly against the registered tags (write lang as registered).
 * x-default (English) is not a table: every caller passes it with the key, `LctyT._("send", "Send")`. Languages are
 * separate scripts that call addLang: lcty.v1.lang-<lang>.js is built from the JSON table
 * public/c/lcty.v1.lang-<lang>.json as `LctyT.addLang("<lang>", <the JSON>);`.
 */
declare const LctyT: {
	/** Registered tables by language tag (a null-prototype object). */
	readonly dicts: Record<string, LctyDict>;
	/** Registers a language table; dict is Object.freeze()d (the object you pass is frozen itself). */
	addLang(lang: string, dict: LctyDict): void;
	/**
	 * The text for key in lang (default <html lang>), or text (the x-default) when that language or key has none (an empty
	 * translation counts as none). Always pass text: leaving it out shows "undefined", so the missing text is visible.
	 */
	_(key: LctyTextKey, text: string, lang?: string): string;
};

/**
 * <lcty-c>: the whole conversation screen. It ends line 3 of a conversation file, so it is created before the body.
 *
 * Used only under /c/. What the frame needs to know is on its own attributes, written once when the conversation is
 * created: id ("c-" + the conversation id), data-setup-tags (the tags at creation) and data-created-at.
 * The system prompt is its first child, lcty-setup (data-instructions, or data-instructions-base64 when it has
 * unwritable characters).
 * The frame (<lcty-sidebar>, header, <slot>, composer, memory dialog) lives in Shadow DOM. Parts: lcty-c__header, __title, __tags, __tag (--unknown), __tag-name,
 * __tag-remove, __tag-picker, __propose-memory, __delete,
 * __spacer, __dock, __float, __to-end, __end, __composer, __memory; the dialog's lcty-memory__*; lcty-button for buttons; the
 * sidebar's and the composer's exported under their own names. The file's elements (lcty-setup, messages, lcty-cmd) are appended to Light DOM by the
 * parser and shown through the <slot> between the header and the composer; lcty-setup shows the system prompt itself.
 *
 * The frame's tree is decided here, and each piece follows one input (LCTYSP-0005): the title (the document's <title>,
 * read once), the tag chips (data-setup-tags: the tags at creation, for
 * now), and which chips are unknown and the picker's choices (data-tag-defs, the tag definitions, space-separated).
 * What shows before the first message is lcty.v1.css's (:has). Modules only set values, attributes and handlers.
 *
 * When it is connected it marks its own conversation as current in the sidebar's list (which <lcty-sidebar> fills
 * itself), and the first one imports the page's features, ./lcty.v1.module.js (resolved against lcty.v1.js), on the
 * window's load event (at once when the page has already loaded), so they never block rendering. Opened directly
 * (file://) the import fails and the page stays a static view.
 *
 * Above the composer floats "to the bottom" (#to-end, shown while the end is out of view) and a running <lcty-cmd>
 * (slot="float"). Scrolling: LCTYSP-0005, Layout of the conversation page.
 */
/**
 * <lcty-setup>: the system prompt, line 4 of a conversation file and the first child of <lcty-c>. Its Shadow DOM is a
 * collapsed <details> with the text, from data-instructions (or data-instructions-base64, UTF-8, when the text has
 * characters an attribute cannot hold). Parts: lcty-setup__details / __summary / __text. Hidden when empty or before the
 * first message (lcty.v1.css).
 */
declare class LctySetupElement extends HTMLElement {
	static readonly observedAttributes: readonly [
		"data-instructions",
		"data-instructions-base64",
	];
	/** The text of the system prompt */
	text: HTMLPreElement;
}

declare class LctyCElement extends HTMLElement {
	static readonly observedAttributes: readonly [
		"data-setup-tags",
		"data-tag-defs",
	];
	/** The sidebar (#sidebar), the same element every page has */
	sidebar: LctySidebarElement;
	/** Title input (#conv-title) */
	titleInput: HTMLInputElement;
	/** Tags of the conversation (#conv-tags): the chips and the picker; a module handles clicks on .tag-name / .tag-x here */
	tags: HTMLSpanElement;
	/** The chips (#conv-tag-list): span.tag-chip[data-tag] > span.tag-name + button.tag-x, one per tag at creation (data-setup-tags) */
	tagList: HTMLSpanElement;
	/** The tag picker: "+ Tag" and the defined tags not on the conversation (disabled when there is none) */
	tagPicker: HTMLSelectElement;
	/** "Propose memory" button (#propose-memory); hidden before the first message or without tags (lcty.v1.css); a module disables it */
	proposeMemoryButton: HTMLButtonElement;
	/** Delete button (#delete-chat) */
	deleteButton: HTMLButtonElement;
	/** The composer (#composer) */
	composer: LctyComposerElement;
	/** The memory proposal dialog (#memory-dialog) */
	memoryDialog: HTMLDialogElement;
	/** "To the bottom" (#to-end), floating above the composer; shown while the end (lcty-c__end) is more than 48 px below the view */
	toEndButton: HTMLButtonElement;
	/**
	 * The bottom dock (#dock, sticky): #float (floating above it: #to-end and <slot name="float"> for a running
	 * lcty-cmd) and the composer
	 */
	dock: HTMLDivElement;
}

/**
 * <lcty-conv-list>: the sidebar's conversation list (also search results), in <lcty-sidebar>'s Shadow DOM. Parts:
 * lcty-conv-list__items, __entry, __item (--current), __title, __snippet, __tags, __tag, __tag-name, __meta, __empty. Fires
 * select {detail: {id, chunkId}} (chunkId: the user message id of a matching round, for search results; fired on a plain
 * click of an item, which is a link: cancel it to stay instead of following the link) and
 * tag {detail: {name}} (a tag chip was clicked).
 */
interface LctyConvListItem {
	id: string;
	title?: string;
	updated_at_hint?: string;
	/** Shown as "· n messages" only when present */
	messages?: number;
	tags?: string[];
	snippet?: string;
	chunk_id?: string;
}
/**
 * Attributes: data-tag-defs (the references of the defined tags, space-separated) and data-tag-names (their display
 * names, in the same order): a tag chip shows the display name of its reference, or the reference itself.
 */
declare class LctyConvListElement extends HTMLElement {
	/** Show items; empty is what to show for zero items */
	show(items: LctyConvListItem[], empty?: string): void;
	/** Show items from a cache (the browser's copy of the meta) unless show() has already been called */
	showCached(items: LctyConvListItem[]): void;
	set items(v: LctyConvListItem[]);
	/** The current conversation's id (marked lcty-conv-list__item--current) */
	set current(id: string | null);
}

/**
 * <lcty-sidebar>: the sidebar shared by every page (the conversation page has it inside lcty-c's Shadow DOM, the
 * other pages put it in <body>). Its Shadow DOM holds the nav (new conversation, refresh, settings), the search box and the
 * conversation list. Search and selection are attached by js/ui/sidebar.js.
 *
 * Parts: lcty-sidebar__nav / __link (each link) / __new / __refresh / __settings / __search-box / __search /
 * __search-status / __list, and lcty-button (--primary) on the links.
 *
 * When it is in the document it fills its list from the browser's copy of every conversation's meta,
 * before any module has loaded: the localStorage snapshot lcty.meta.v1 synchronously (so it is there at the first paint),
 * or IndexedDB "lcty_c" (store "c_meta"; only read, never created) when there is none. It also sets its list's
 * data-tag-defs and data-tag-names from IndexedDB "lcty_t" (store "t_full", through js/lcty_t.worker.js). Named lcty-sidebar for
 * cross-document view transitions (lcty.v1.css).
 */
declare class LctySidebarElement extends HTMLElement {
	static readonly _: typeof LctyT._;
	/** "New conversation" link to /, opened in a new window (target="_blank" rel="noopener"; part lcty-sidebar__new) */
	newLink: HTMLAnchorElement;
	/** Opens the tags dialog (tag editor) attached by js/ui/sidebar.js (part lcty-sidebar__tags) */
	tagsButton: HTMLButtonElement;
	/**
	 * Fetches the list again, throwing the browser's copy of the meta away; attached by js/ui/sidebar.js
	 * (part lcty-sidebar__refresh)
	 */
	refreshButton: HTMLButtonElement;
	/** Opens the settings dialog attached by js/ui/sidebar.js (part lcty-sidebar__settings) */
	settingsButton: HTMLButtonElement;
	/** The links and buttons above the search box (part lcty-sidebar__nav) */
	nav: HTMLElement;
	/** Search box (part lcty-sidebar__search) */
	search: HTMLInputElement;
	/** Search status (part lcty-sidebar__search-status) */
	searchStatus: HTMLSpanElement;
	/** The search box and its status (part lcty-sidebar__search-box) */
	searchBox: HTMLDivElement;
	/** Conversation list (part lcty-sidebar__list) */
	list: LctyConvListElement;
}

/**
 * <lcty-message>: one message. Its Shadow DOM holds the head (who, and the action buttons for the role), a reply's
 * thinking, a <slot> (the presentation HTML in Light DOM) and the foot. Rebuilt when data-role changes. The thinking is
 * a collapsed <details> showing data-thinking (or data-thinking-base64, UTF-8): summary "Thinking (n characters)" and
 * the text; hidden when there is none. While a reply streams in a module writes the summary and the body, then sets
 * data-thinking. The foot shows, from attributes, why an incomplete reply ended (data-status, data-error: "Stopped" or
 * "Error: …") and an ⓘ when the message has data-timings or data-client. The ⓘ is a button that opens a popover
 * (popovertarget, just above it where anchor positioning is supported) whose text a module fills in, so nothing on
 * screen changes after the first paint. Hidden when it has neither.
 *
 * Parts: lcty-message__head / __who / __actions / __action (--undo, --fork, --regenerate; with lcty-button) /
 * __thinking / __thinking-summary / __thinking-body / __foot / __status / __info / __timings
 */
declare class LctyMessageElement extends HTMLElement {
	static readonly observedAttributes: readonly [
		"data-role",
		"data-status",
		"data-error",
		"data-timings",
		"data-client",
		"data-thinking",
		"data-thinking-base64",
	];
	/** Undo button (user messages only, else null) */
	undoButton: HTMLButtonElement | null;
	/** "Fork from here" button (user messages only, else null) */
	forkButton: HTMLButtonElement | null;
	/** Regenerate button (assistant messages only, else null) */
	regenerateButton: HTMLButtonElement | null;
	/** A reply's thinking (part lcty-message__thinking; assistant messages only, else null) */
	thinking: HTMLDetailsElement | null;
	/** Its summary (part lcty-message__thinking-summary) */
	thinkingSummary: HTMLElement | null;
	/** Its text (part lcty-message__thinking-body) */
	thinkingBody: HTMLDivElement | null;
	/** Who wrote it (part lcty-message__who) */
	who: HTMLSpanElement;
	/** Foot (part lcty-message__foot): statusText and info */
	foot: HTMLDivElement;
	/** Why an incomplete reply ended, from data-status / data-error (part lcty-message__status) */
	statusText: HTMLSpanElement;
	/** The ⓘ, shown with data-timings / data-client (part lcty-message__info); it opens timings */
	info: HTMLButtonElement;
	/** The popover with the timings, one item per line (part lcty-message__timings); its text is set by a module */
	timings: HTMLDivElement;
}

/**
 * <lcty-composer>: the message input. Sending and stopping are attached by js/ui/lcty-elements.js.
 *
 * Parts: lcty-composer__form / __input / __buttons / __send (with lcty-button--primary) / __stop (with lcty-button)
 */
declare class LctyComposerElement extends HTMLElement {
	/** The message (part lcty-composer__input) */
	input: HTMLTextAreaElement;
	/** Send button (part lcty-composer__send, type submit) */
	sendButton: HTMLButtonElement;
	/** Stop button (part lcty-composer__stop) */
	stopButton: HTMLButtonElement;
	/** The form (part lcty-composer__form) */
	form: HTMLFormElement;
}

/**
 * <lcty-t>: a tag file shown as a page (/t/NNNNN-<part>.html). It puts its sidebar before itself and the class "page"
 * on <body>, and its view first among its children; the children of the file are hidden (lcty.v1.css). Once they have
 * been parsed, the view shows the tag read-only with the tag editor's fields. /t/tag-file.js, imported once the page
 * has loaded, replaces the view with the editor.
 */
declare class LctyTElement extends HTMLElement {
	/** The sidebar, put before <lcty-t>: the same element every page has */
	sidebar: LctySidebarElement;
	/** What the page shows (div.tag-file-view, the first child of <lcty-t>) */
	view: HTMLDivElement;
	/** Shows the tag of the file (data-tag, <lcty-system>, <lcty-memory>) in the view, read-only */
	showFile(): void;
}

/**
 * Defines lcty-conv-list, lcty-sidebar, lcty-c, lcty-setup, lcty-message, lcty-composer and lcty-t in registry. lcty.v1.js
 * calls it at its end; importing lcty.v1.mjs defines nothing. The elements are created while the body is parsed, after
 * the language scripts in <head> have registered their texts.
 */
declare function defineLctyV1CustomElements(
	registry?: CustomElementRegistry,
): void;

interface HTMLElementTagNameMap {
	"lcty-c": LctyCElement;
	"lcty-setup": LctySetupElement;
	"lcty-sidebar": LctySidebarElement;
	"lcty-message": LctyMessageElement;
	"lcty-composer": LctyComposerElement;
	"lcty-t": LctyTElement;
}
