// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar shared by every page (LCTYSP-0005, LCTYSP-0007, LCTYSP-0009, LCTYSP-0010, LCTYSP-0014).

import {
	applyTagBatch,
	forceSyncTags,
	getTags,
	readTagsOfConversationsFrom,
} from "../api/lcty-t.js";
import { applyMetaBatch, readMetaDbFrom } from "../api/meta-db.js";
import { onTabNotify, onTabOpen, tabRpc } from "../api/tab-rpc.js";
import { showToast } from "../common.js";
import { tr } from "../i18n.js";
import { createSearchPanel } from "../search/search-panel.js";
import { tagRef } from "../tag-names.js";
import { initTagsDialog } from "../tags.js";
import { initSettingsDialog } from "./settings-dialog.js";

/** Attach the sidebar's features to sidebar and return its search panel. */
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
	// The copies follow the server: notifications change them, and every (re)connection reads them whole
	onTabNotify("c.batch.updated", applyMetaBatch);
	onTabNotify("t.batch.updated", applyTagBatch);
	const readLists = (rpc) =>
		Promise.all([readMetaDbFrom(rpc), readTagsOfConversationsFrom(rpc)]);
	onTabOpen((rpc) =>
		readLists(rpc).catch((e) =>
			console.warn("the list of conversations could not be read", e),
		),
	);
	// The lists are read again now; the list is shown again when they have been stored (in the search panel)
	const refresh = sidebar.refreshButton;
	refresh.addEventListener("click", async () => {
		refresh.disabled = true;
		try {
			await readLists(tabRpc());
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
	// The tag definitions are synced whenever the page is shown, also from the back/forward cache (LCTYSP-0009)
	const forceSync = () => {
		forceSyncTags()
			.then(getTags)
			.then(({ tags }) => showTagNames(sidebar.list, tags))
			.catch((e) => console.warn("the tags could not be synced", e));
	};
	forceSync();
	addEventListener("pageshow", (e) => {
		if (e.persisted) forceSync();
	});
	initSettingsDialog(sidebar.settingsButton);
	return panel;
}

/** Give the list the defined tags' references and names, so its tag chips show display names (LCTYSP-0009). */
function showTagNames(list, defs) {
	list.setAttribute("data-tag-names", defs.map((t) => t.name).join(" "));
	list.setAttribute("data-tag-defs", defs.map(tagRef).join(" "));
}
