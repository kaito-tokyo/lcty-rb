// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// New conversation page (/): creates the conversation file and moves to it (LCTYSP-0004, LCTYSP-0005, LCTYSP-0013).

import { getTags } from "../api/lcty-t.js";
import { appendLines, getConversation } from "../api/storage.js";
import { tabRpc } from "../api/tab-rpc.js";
import {
	appIndexer,
	convUrl,
	loadSettings,
	newConvId,
	nowIso,
	showToast,
} from "../common.js";
import { replyArticle, userArticle } from "../convert/article.js";
import { localize, tr } from "../i18n.js";
import { sortTags, tagRef } from "../tag-names.js";
import { composeDraft } from "../tags.js";
import {
	focusComposer,
	initComposer,
	setComposerBusy,
	setComposerValue,
} from "../ui/lcty-elements.js";
import { cmdAttrs, msgAttrs } from "../ui/lcty-msg.js";
import { initSidebar } from "../ui/sidebar.js";

const TITLE_MAX_SIZE = 512; // bytes of the title slot, as the files of LCTYSP-0003 have (LCTYSP-0013)

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
	tabRpc(); // the sidebar follows the lists over it (LCTYSP-0014)
	const indexer = appIndexer(() => state.settings);

	// ---- Tags and the system prompt draft (LCTYSP-0009) ----

	// The ⚙︎ at the end of the tag list opens the same tags dialog as the sidebar's tag menu (js/tags.js)
	const tagsButton = document.createElement("button");
	tagsButton.type = "button";
	tagsButton.title = tr("editTags", "Edit tags");
	tagsButton.setAttribute("aria-label", tr("editTags", "Edit tags"));
	tagsButton.textContent = "⚙︎";
	tagsButton.addEventListener("click", () => panel.openTagsDialog());

	function renderTags() {
		const picker = form.tags;
		// One checkbox per tag definition, then ⚙︎; rebuilt only when the definitions change
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

	// After saving: drop the chosen tags that no longer exist and recompose an untouched draft
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

	// Create the conversation through /v1/rpc, ending with the lcty-cmd send (LCTYSP-0012, LCTYSP-0013)
	async function create(id, title, text, at) {
		const rpc = tabRpc(); // the tab's connection, which the sidebar uses too
		await rpc.call("c.create", {
			cid: id,
			createdAt: at,
			title,
			lang: document.documentElement.lang || "en",
			titleMaxSize: TITLE_MAX_SIZE,
			lctyVersion: "v1",
		});
		let after = null;
		const append = async (method, attrs, innerHTML) => {
			await rpc.call(method, { cid: id, after, attrs, innerHTML });
			after = attrs.id;
		};
		const instructions = form.instructions.value;
		if (instructions)
			await append(
				"c.append.msg",
				msgAttrs("system", instructions),
				replyArticle(instructions),
			);
		for (const m of state.fork?.messages ?? []) {
			const role = m.role === "assistant" ? "model" : "user";
			await append(
				"c.append.msg",
				msgAttrs(role, m.content, { at: m.at || at }),
				role === "user" ? userArticle(m.content) : replyArticle(m.content),
			);
		}
		await append(
			"c.append.msg",
			msgAttrs("user", text, { at }),
			userArticle(text),
		);
		const cmd = cmdAttrs("send", at);
		await rpc.call("c.append.cmd", { cid: id, after, attrs: cmd });
		try {
			sessionStorage.setItem(`lcty.run.${id}`, cmd.id);
		} catch {}
		if (state.tags.length)
			await appendLines(id, [{ type: "tags", tags: state.tags, at }]);
	}

	async function send(text) {
		if (state.sending) return;
		state.sending = true;
		setComposerBusy(composer, true);
		const id = newConvId();
		const at = nowIso();
		const title = state.fork
			? state.fork.title
			: text.trim().split("\n")[0].slice(0, 30);
		try {
			await create(id, title, text, at);
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
