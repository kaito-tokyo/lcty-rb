// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tags (/tags. LCTYSP-009): edits tag definitions and memory.

import { getTags } from "../api/storage.js";
import { appIndexer, loadSettings, query, showToast } from "../common.js";
import { localize, tr } from "../i18n.js";
import { renderTagsEditor } from "../tags.js";
import { initSidebar } from "../ui/sidebar.js";

/** Starts /tags: called once by the page's entry (public/tags.js). */
export function initTagsPage() {
	localize();
	(async () => {
		try {
			const { tags } = await getTags();
			renderTagsEditor(query("#tags-editor"), {
				defs: tags,
				toast: showToast,
				onSaved: () => {},
			});
		} catch (e) {
			showToast(
				tr("tagsLoadFailed", "Failed to load the tags: {error}", {
					error: e.message,
				}),
			);
		}
	})();

	// The sidebar shared by every page (LCTYSP-005)
	{
		let appSettings = null;
		const indexer = appIndexer(() => appSettings);
		const sidebar = document.querySelector("lcty-sidebar");
		const sidebarPanel = initSidebar(sidebar, {
			getSettings: () => appSettings,
		});
		loadSettings().then(async (s) => {
			appSettings = s;
			await sidebarPanel.refresh();
			indexer.kick(); // Register any chunks that are not embedded yet
		});
	}
}
