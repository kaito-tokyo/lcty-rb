// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar shared by every page (LCTYSP-0005, LCTYSP-0007): <lcty-sidebar> and its <lcty-conv-list> (structure in
// /c/lcty.v1.js, built from public/c/lcty.v1.js) get the search box, the list's items and handlers, the tags dialog
// (LCTYSP-0009), the refresh button and the settings dialog (LCTYSP-0010) here.

import { forceSyncTags, getTags } from "../api/lcty-t.js";
import { forceSyncMetaDb, resetMetaDb } from "../api/meta-db.js";
import { showToast } from "../common.js";
import { tr } from "../i18n.js";
import { createSearchPanel } from "../search/search-panel.js";
import { tagRef } from "../tag-names.js";
import { initTagsDialog } from "../tags.js";
import { initSettingsDialog } from "./settings-dialog.js";

/**
 * @param {LctySidebarElement} sidebar
 * @param {object} o
 * @param {() => object} o.getSettings
 * @param {(detail: {id: string, chunkId: string | null}) => boolean | void} [o.onSelect]
 *   called when a conversation is chosen; return true when it was handled (otherwise the item's link is followed)
 * @param {(defs: object[]) => void} [o.onTagsSaved] called with the new tag definitions after the tags dialog saved them
 * @returns the search panel ({refresh, setQuery, current, …})
 */
export function initSidebar(sidebar, { getSettings, onSelect, onTagsSaved }) {
	const panel = createSearchPanel({
		list: sidebar.list,
		box: sidebar.search,
		status: sidebar.searchStatus,
		getSettings,
	});
	// The items are links: the browser follows one unless the page handled the choice
	sidebar.list.addEventListener("select", (e) => {
		if (onSelect?.(e.detail)) e.preventDefault();
	});
	// The browser's copy of the meta is thrown away and fetched again; the list is shown again when it has been stored
	// (onMetaDbChange in the search panel)
	const refresh = sidebar.refreshButton;
	refresh.addEventListener("click", async () => {
		refresh.disabled = true;
		try {
			await resetMetaDb();
		} catch (e) {
			showToast(
				tr("listFailed", "Failed to load the list: {error}", {
					error: e.message,
				}),
			);
		} finally {
			refresh.disabled = false;
		}
	});
	initTagsDialog(sidebar.tagsButton, {
		toast: showToast,
		onSaved: (defs) => {
			showTagNames(sidebar.list, defs);
			onTagsSaved?.(defs);
		},
	});
	getTags()
		.then(({ tags }) => showTagNames(sidebar.list, tags))
		.catch(() => {}); // the chips keep their references
	// Every page has the sidebar: the browser's copies of the tags and of the meta are replaced with the server's
	// (force_sync) whenever the page is shown: at once when it loads, and again when it comes back from the back/forward
	// cache (pageshow with persisted), where no script runs anew (LCTYSP-0009, LCTYSP-0010)
	const forceSync = () => {
		forceSyncTags()
			.then(getTags)
			.then(({ tags }) => showTagNames(sidebar.list, tags))
			.catch((e) => console.warn("the tags could not be synced", e));
		forceSyncMetaDb().catch((e) =>
			console.warn("the meta of the conversations could not be synced", e),
		);
	};
	forceSync();
	addEventListener("pageshow", (e) => {
		if (e.persisted) forceSync();
	});
	initSettingsDialog(sidebar.settingsButton);
	return panel;
}

/**
 * The list's tag chips show display names: data-tag-defs holds the references of the defined tags and data-tag-names
 * their names, in the same order (LCTYSP-0009). Names contain no whitespace.
 */
function showTagNames(list, defs) {
	list.setAttribute("data-tag-names", defs.map((t) => t.name).join(" "));
	list.setAttribute("data-tag-defs", defs.map(tagRef).join(" "));
}
