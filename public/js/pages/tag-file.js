// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The page of a tag file, /t/NNNNN-<part>.html: the tag editor for that tag alone (LCTYSP-0005, LCTYSP-0009).

import { getTags } from "../api/lcty-t.js";
import { tabRpc } from "../api/tab-rpc.js";
import { loadSettings, showToast } from "../common.js";
import { tr } from "../i18n.js";
import { tagFileOfPath } from "../tag-names.js";
import { renderTagsEditor } from "../tags.js";
import { initSidebar } from "../ui/sidebar.js";

/** Starts the page: called once by its entry (public/t/tag-file.js). */
export function initTagFilePage() {
	const frame = document.querySelector("lcty-t");
	if (!frame) return;
	const file = tagFileOfPath(location.pathname);
	const state = { settings: null, editor: null };
	const heading = document.createElement("h2");
	heading.textContent = tr("tags", "Tags");
	const body = document.createElement("div");

	const panel = initSidebar(frame.sidebar, {
		getSettings: () => state.settings,
		// The tags dialog saved: show this tag as it is now (it may have been renamed or deleted there)
		onTagsSaved: () => load(),
	});
	tabRpc(); // the sidebar follows the lists over it (LCTYSP-0014)

	async function load() {
		let tags;
		let etag;
		try {
			({ tags, etag } = await getTags());
		} catch (e) {
			showToast(
				tr("tagsLoadFailed", "Failed to load the tags: {error}", {
					error: e.message,
				}),
			);
			return; // the read-only view stays
		}
		frame.view.replaceChildren(heading, body);
		state.editor = renderTagsEditor(body, {
			defs: tags,
			etag,
			file,
			toast: showToast,
			onSaved: (_defs, saved) => {
				if (saved.file === file) return;
				// The page is the file: a new name is a new file, and a deleted tag has none
				location.replace(
					saved.file === null ? "./" : encodeURIComponent(saved.file),
				);
			},
		});
	}

	addEventListener("beforeunload", (e) => {
		if (state.editor?.isDirty()) e.preventDefault();
	});

	(async () => {
		state.settings = await loadSettings();
		// The page edits the set, so it reads it after initSidebar's sync_full (LCTYSP-0009)
		await load();
		panel.refresh();
	})();
}
