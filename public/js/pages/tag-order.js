// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tag reorder page, /t/: moves the tags and saves them renumbered (LCTYSP-0005, LCTYSP-0009).

import { getTags, putTags } from "../api/lcty-t.js";
import { tabRpc } from "../api/tab-rpc.js";
import { loadSettings, showToast } from "../common.js";
import { localize, tr } from "../i18n.js";
import { renumber } from "../tag-names.js";
import { initSidebar } from "../ui/sidebar.js";

/** Starts /t/: called once by the page's entry (public/t/index.js). */
export function initTagOrderPage() {
	localize();
	const $ = (s) => document.querySelector(s);
	const list = $("#tag-order");
	const status = $("#tag-order-status");
	const saveButton = $("#tag-order-save");
	const resetButton = $("#tag-order-reset");
	const sidebar = document.querySelector("lcty-sidebar");

	// saved and work are the tags that can be moved; invalid is sent back as it is
	const state = {
		settings: null,
		saved: [],
		work: [],
		invalid: [],
		etag: null,
	};
	const panel = initSidebar(sidebar, {
		getSettings: () => state.settings,
		// The tags dialog saved: show its set (it may have added, renamed or deleted tags)
		onTagsSaved: () => load(),
	});
	tabRpc(); // the sidebar follows the lists over it (LCTYSP-0014)

	const dirty = () =>
		JSON.stringify(state.work.map((t) => t.file)) !==
		JSON.stringify(state.saved.map((t) => t.file));

	const move = (i, j) => {
		[state.work[i], state.work[j]] = [state.work[j], state.work[i]];
		render();
	};

	function render() {
		const button = (label, aria, disabled, onclick) => {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = label;
			b.setAttribute("aria-label", aria);
			b.disabled = disabled;
			b.addEventListener("click", onclick);
			return b;
		};
		list.replaceChildren(
			...state.work.map((t, i) => {
				const li = document.createElement("li");
				li.className = "tag-order-item";
				li.dataset.file = t.file;
				// The name is a link to the tag's file, the page that edits it (next to this page)
				const name = document.createElement("a");
				name.className = "tag-chip";
				name.href = encodeURIComponent(t.file);
				name.textContent = t.name;
				li.append(
					name,
					button(
						"↑",
						tr("moveTagUp", "Move {name} up", { name: t.name }),
						i === 0,
						() => move(i - 1, i),
					),
					button(
						"↓",
						tr("moveTagDown", "Move {name} down", { name: t.name }),
						i === state.work.length - 1,
						() => move(i, i + 1),
					),
				);
				return li;
			}),
		);
		if (!state.work.length)
			list.replaceChildren(tr("noTagsYet", "(No tags yet)"));
		saveButton.disabled = !dirty();
		resetButton.disabled = !dirty();
	}

	async function load() {
		try {
			const { tags, etag } = await getTags();
			state.saved = tags.filter((t) => !t.invalid);
			state.invalid = tags.filter((t) => t.invalid);
			state.etag = etag;
		} catch (e) {
			status.textContent = tr(
				"tagsLoadFailed",
				"Failed to load the tags: {error}",
				{ error: e.message },
			);
			return;
		}
		state.work = [...state.saved];
		render();
	}

	saveButton.addEventListener("click", async () => {
		const tags = [...renumber(state.work), ...state.invalid];
		saveButton.disabled = true;
		try {
			state.etag = await putTags(tags, state.etag);
		} catch (e) {
			if (e.status === 412) {
				await load();
				status.textContent = tr(
					"tagsChangedElsewhere",
					"The tags were changed elsewhere, so they were loaded again. Make the edit again.",
				);
			} else {
				status.textContent = tr("saveFailedShort", "Could not save: {error}", {
					error: e.message,
				});
				saveButton.disabled = false;
			}
			return;
		}
		status.textContent = "";
		await load();
		showToast(tr("tagsSaved", "Tags saved"));
	});

	resetButton.addEventListener("click", () => {
		state.work = [...state.saved];
		status.textContent = "";
		render();
	});

	addEventListener("beforeunload", (e) => {
		if (dirty()) e.preventDefault();
	});

	(async () => {
		state.settings = await loadSettings();
		// The page edits the set, so it reads it after initSidebar's sync_full (LCTYSP-0009)
		await load();
		panel.refresh();
	})();
}
