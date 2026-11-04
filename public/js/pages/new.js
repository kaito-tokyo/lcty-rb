// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// New conversation (/, the top page. LCTYSP-004, LCTYSP-005). Plain HTML (the creation card in public/index.html) plus
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
import { composeDraft, sortTags, tagChip } from "../tags.js";
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
		thinking: $("#setup-thinking"),
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

	const panel = initSidebar(sidebar, { getSettings: () => state.settings });
	const indexer = appIndexer(() => state.settings);

	// ---- Tags and the system prompt draft (LCTYSP-009) ----

	function renderTags() {
		const picker = form.tags;
		if (!state.tagDefs.length) {
			const link = document.createElement("a");
			link.href = "/tags";
			link.textContent = tr("tags", "Tags");
			picker.replaceChildren(
				tr("noTagsBefore", "(No tags yet. Create them on the "),
				link,
				tr("noTagsAfter", " page.)"),
			);
		} else {
			picker.replaceChildren(
				...state.tagDefs.map((t) => {
					const chip = tagChip(t.name, { onClick: () => toggleTag(t.name) });
					chip.classList.toggle("on", state.tags.includes(t.name));
					return chip;
				}),
			);
		}
		const ta = form.instructions; // Fit the height so the whole draft is visible
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight + 2, window.innerHeight * 0.5)}px`;
		form.recomposeButton.hidden = !(
			state.dirty &&
			state.tags.length &&
			ta.value !== composeDraft(state.tagDefs, state.tags)
		);
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

	// ---- Fork (/?fork=<id>&at=<n>. LCTYSP-004) ----

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
		form.thinking.checked = !!src.meta.thinking;
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
			thinking: form.thinking.checked,
			tags: state.tags,
		};
		const title = state.fork
			? state.fork.title
			: text.trim().split("\n")[0].slice(0, 30);
		const lines = [
			{ type: "title", title, at },
			...(state.fork ? state.fork.messages.map(toLine) : []),
			toLine({ id: newMsgId(), role: "user", content: text, at }),
			{ type: "cmd", op: "send", at }, // command tag: generate the reply on the conversation page (LCTYSP-004)
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
		form.thinking.checked = !!state.settings?.default_thinking;
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
