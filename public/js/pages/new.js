// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// New conversation (/, the top page. LCTYSP-0004, LCTYSP-0005). Plain HTML (the creation card in public/index.html) plus
// the interactive components <lcty-sidebar> and <lcty-composer>. Sending decides the conversation id, creates the file (meta, tags, title and
// the first message; for a fork also the inherited messages), ending with the command tag <lcty-cmd data-op="send">, and
// moves to /c/<id>.html, which generates the reply because the file ends with that command.
// With ?fork=<id>&at=<n> it forks; ?q=… puts a query into the sidebar's search box.

import {
	createConversation,
	getConversation,
	getTags,
	toLine,
} from "../api/storage.js";
import {
	appIndexer,
	convUrl,
	loadSettings,
	newConvId,
	newMsgId,
	nowIso,
	showToast,
} from "../common.js";
import { localize, tr } from "../i18n.js";
import { sortTags, tagRef } from "../tag-names.js";
import { composeDraft } from "../tags.js";
import {
	focusComposer,
	initComposer,
	setComposerBusy,
	setComposerValue,
} from "../ui/lcty-elements.js";
import { initSidebar } from "../ui/sidebar.js";

/** Starts /: called once by the page's entry (public/index.js). */
export function initNewPage() {
	localize();
	const $ = (s) => document.querySelector(s);
	// The creation card's fields (plain elements in public/index.html)
	const form = {
		forkNote: $("#fork-note"),
		tags: $("#setup-tags"),
		instructions: $("#setup-instructions"),
		recomposeButton: $("#setup-recompose"),
	};
	const composer = $(".new-card > lcty-composer");
	const sidebar = document.querySelector("lcty-sidebar");

	const state = {
		settings: null,
		tagDefs: [],
		tags: [], // chosen tags
		dirty: false, // whether the system prompt was edited by hand (then choosing tags no longer replaces it)
		fork: null, // { id, at, title, messages } for ?fork=
		sending: false,
	};

	const panel = initSidebar(sidebar, {
		getSettings: () => state.settings,
		onTagsSaved: tagsSaved,
	});
	const indexer = appIndexer(() => state.settings);

	// ---- Tags and the system prompt draft (LCTYSP-0009) ----

	// The ⚙︎ at the end of the tag list opens the same tags dialog as the sidebar's tag button (js/tags.js)
	const tagsButton = document.createElement("button");
	tagsButton.type = "button";
	tagsButton.title = tr("editTags", "Edit tags");
	tagsButton.setAttribute("aria-label", tr("editTags", "Edit tags"));
	tagsButton.textContent = "⚙︎";
	tagsButton.addEventListener("click", () => sidebar.tagsButton.click());

	function renderTags() {
		const picker = form.tags;
		// One checkbox per tag definition, then ⚙︎, laid out as inline content separated by spaces (no CSS of its own).
		// Rebuilt only when the definitions change, so focus stays on the box
		const names = JSON.stringify(state.tagDefs.map((t) => [t.file, t.name]));
		if (picker.dataset.names !== names) {
			picker.dataset.names = names;
			const items = state.tagDefs.length
				? state.tagDefs.map((t) => {
						// the value is the reference a conversation keeps: the file-name part
						const box = document.createElement("input");
						box.type = "checkbox";
						box.value = tagRef(t);
						box.addEventListener("change", () => toggleTag(tagRef(t)));
						const label = document.createElement("label");
						if (t.prompt) label.title = t.prompt;
						// the name as a chip, the same look as the sidebar's tags
						const chip = document.createElement("span");
						chip.className = "tag-chip";
						chip.textContent = t.name;
						label.append(box, chip);
						return label;
					})
				: [tr("noTagsYet", "(No tags yet)")];
			picker.replaceChildren(
				...[...items, tagsButton].flatMap((e, i) => (i ? [" ", e] : [e])),
			);
		}
		for (const box of picker.querySelectorAll("input[type=checkbox]"))
			box.checked = state.tags.includes(box.value);
		const ta = form.instructions; // Fit the height so the whole draft is visible
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight + 2, window.innerHeight * 0.5)}px`;
		form.recomposeButton.hidden = !(
			state.dirty &&
			state.tags.length &&
			ta.value !== composeDraft(state.tagDefs, state.tags)
		);
	}

	// After saving: the chosen tags that no longer exist are dropped (tags never defined, e.g. from a fork, stay), and an
	// untouched draft is composed again from the new prompts and memory
	function tagsSaved(defs) {
		const before = new Set(state.tagDefs.map(tagRef));
		const after = new Set(defs.map(tagRef));
		state.tagDefs = defs;
		state.tags = sortTags(
			defs,
			state.tags.filter((n) => !before.has(n) || after.has(n)),
		);
		if (!state.dirty)
			form.instructions.value = composeDraft(state.tagDefs, state.tags);
		renderTags();
	}

	function toggleTag(name) {
		const next = state.tags.includes(name)
			? state.tags.filter((t) => t !== name)
			: [...state.tags, name];
		state.tags = sortTags(state.tagDefs, next);
		if (!state.dirty)
			form.instructions.value = composeDraft(state.tagDefs, state.tags);
		renderTags();
	}

	form.instructions.addEventListener("input", () => {
		state.dirty =
			form.instructions.value !== composeDraft(state.tagDefs, state.tags);
		renderTags();
	});
	form.recomposeButton.addEventListener("click", () => {
		form.instructions.value = composeDraft(state.tagDefs, state.tags);
		state.dirty = false;
		renderTags();
	});

	// ---- Fork (/?fork=<id>&at=<n>. LCTYSP-0004) ----

	async function loadFork(params) {
		const src = await getConversation(params.get("fork"));
		const at = Number(params.get("at"));
		state.fork = {
			id: src.meta.id,
			at,
			title: tr("forkTitle", "{title} (fork)", {
				title: src.title || tr("untitled", "(untitled)"),
			}),
			messages: src.messages
				.slice(0, at)
				.map((m) => ({ ...m, inherited: true })),
		};
		state.tags = [...(src.tags || [])];
		state.dirty = true; // keep the source's system prompt as it is
		form.instructions.value = src.meta.instructions || "";
		const a = document.createElement("a");
		a.href = convUrl(src.meta.id);
		a.textContent = src.title || tr("untitled", "(untitled)");
		form.forkNote.replaceChildren(
			tr("forkFrom", "Forked from: "),
			a,
			tr("forkInherits", " (inherits the first {n} messages)", { n: at }),
		);
		form.forkNote.hidden = false;
		document.title = `${state.fork.title} - local-chatty`;
		return src.messages[at]?.content || "";
	}

	// ---- Sending: decide the id, create the file, move to the conversation page ----

	async function send(text) {
		if (state.sending) return;
		state.sending = true;
		setComposerBusy(composer, true);
		const id = newConvId();
		const at = nowIso();
		const meta = {
			id,
			created_at: at,
			instructions: form.instructions.value,
			tags: state.tags,
		};
		const title = state.fork
			? state.fork.title
			: text.trim().split("\n")[0].slice(0, 30);
		const lines = [
			{ type: "title", title, at },
			...(state.fork ? state.fork.messages.map(toLine) : []),
			toLine({ id: newMsgId(), role: "user", content: text, at }),
			{ type: "cmd", op: "send", at }, // command tag: generate the reply on the conversation page (LCTYSP-0004)
		];
		try {
			await createConversation(meta, lines);
			location.href = convUrl(id);
		} catch (e) {
			showToast(
				tr("createFailed", "Could not create the conversation: {error}", {
					error: e.message,
				}),
			);
			state.sending = false;
			setComposerBusy(composer, false);
		}
	}

	initComposer(composer, { onSend: send });

	// ---- Startup ----

	(async () => {
		state.settings = await loadSettings();
		try {
			state.tagDefs = (await getTags()).tags;
		} catch (e) {
			showToast(
				tr("tagsLoadFailed", "Failed to load the tags: {error}", {
					error: e.message,
				}),
			);
		}
		const params = new URLSearchParams(location.search);
		let draft = "";
		if (params.has("fork")) {
			try {
				draft = await loadFork(params);
			} catch (e) {
				showToast(
					tr(
						"forkLoadFailed",
						"Could not load the source conversation: {error}",
						{ error: e.message },
					),
				);
			}
		}
		renderTags();
		setComposerValue(composer, draft);
		focusComposer(composer);
		const q = params.get("q"); // older links to the search page
		if (q) {
			sidebar.search.value = q;
			sidebar.search.dispatchEvent(new Event("input"));
		}
		panel.refresh();
		indexer.kick();
	})();
}
