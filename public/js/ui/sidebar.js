// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar shared by every page (LCTYSP-0005, LCTYSP-0007): <lcty-sidebar> and its <lcty-conv-list> (structure in
// /lcty.v1/lcty.v1.cjs) get the search box, the list's items and handlers, the tags dialog (LCTYSP-0009), the refresh
// button and the settings dialog (LCTYSP-0010) here.
//
// The list follows the server over the tab's /v1/rpc connection (LCTYSP-0014): initSidebar registers c.batch.updated
// and t.batch.updated and, whenever the connection opens, reads c.list, c.recordcount.list and t.c.list again. The
// page opens the connection (tabRpc()) once it has registered what it receives itself.

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
	// Every page has the sidebar: the browser's copy of the tag definitions is replaced with the server's (sync_full)
	// whenever the page is shown: at once when it loads, and again when it comes back from the back/forward cache
	// (pageshow with persisted), where no script runs anew (LCTYSP-0009). The lists of conversations follow /v1/rpc
	// instead, whose connection is opened again after the cache closed it.
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

/**
 * The list's tag chips show display names: data-tag-defs holds the references of the defined tags and data-tag-names
 * their names, in the same order (LCTYSP-0009). Names contain no whitespace.
 */
function showTagNames(list, defs) {
	list.setAttribute("data-tag-names", defs.map((t) => t.name).join(" "));
	list.setAttribute("data-tag-defs", defs.map(tagRef).join(" "));
}
