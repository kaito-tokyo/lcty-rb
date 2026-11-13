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

/// <reference path="../../lcty.v1/lcty.v1.d.cts" />

import type { Tag } from "../../lcty.v1/lcty.v1.t.worker.cjs";
import type { SearchPanel } from "../search/search-panel.js";

/**
 * Attach the sidebar's features to sidebar: the search panel, the list's handlers, the refresh button (reads the lists
 * again; a toast when it fails), the tags dialog, the tag names of the list's chips and the settings dialog.
 *
 * Every page has the sidebar: the browser's copy of the tag definitions is replaced with the server's (sync_full)
 * whenever the page is shown: at once when it loads, and again when it comes back from the back/forward cache
 * (pageshow with persisted), where no script runs anew (LCTYSP-0009). The lists of conversations follow /v1/rpc
 * instead, whose connection is opened again after the cache closed it.
 *
 * @param sidebar the <lcty-sidebar>
 * @param o.onSelect called when a conversation is chosen; return true when it was handled (otherwise the item's link
 *   is followed)
 * @param o.onTagsSaved called with the new tag definitions after the tags dialog saved them
 * @returns the search panel ({refresh, setQuery, current, …})
 */
export function initSidebar(
	sidebar: LctySidebarElement,
	o: {
		onSelect?: (detail: {
			id: string;
			chunkId: string | null;
		}) => boolean | undefined;
		onTagsSaved?: (defs: Tag[]) => void;
	},
): SearchPanel;

// Internals: showTagNames(list, defs): the list's tag chips show display names: data-tag-defs holds the references
// of the defined tags and data-tag-names their names, in the same order (LCTYSP-0009). Names contain no whitespace.
