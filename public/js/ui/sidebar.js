// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar shared by every page (LCTYSP-005, LCTYSP-007): <lcty-sidebar> and its <lcty-conv-list> (structure in
// /c/lcty.v1.js, built from public/c/lcty.v1.js) get the search box and the list's items and handlers here.

import { convUrl } from "../common.js";
import { createSearchPanel } from "../search/search-panel.js";

/**
 * @param {LctySidebarElement} sidebar
 * @param {object} o
 * @param {() => object} o.getSettings
 * @param {(detail: {id: string, chunkId: string | null}) => boolean | void} [o.onSelect]
 *   called when a conversation is chosen; return true when it was handled (otherwise the page navigates to it)
 * @returns the search panel ({refresh, setQuery, current, …})
 */
export function initSidebar(sidebar, { getSettings, onSelect }) {
	const panel = createSearchPanel({
		list: sidebar.list,
		box: sidebar.search,
		status: sidebar.searchStatus,
		getSettings,
	});
	sidebar.list.addEventListener("select", (e) => {
		if (onSelect?.(e.detail)) return;
		location.href = convUrl(e.detail.id, e.detail.chunkId);
	});
	return panel;
}
