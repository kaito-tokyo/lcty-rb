// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar's tag menu (LCTYSP-0009): the popover <lcty-sidebar> opens from its tag button (tagMenu, popovertarget,
// structure in /lcty.v1/lcty.v1.cjs) is filled here. It lists the tags in the order of their files; each tag is a
// button that puts it in the search box and a link "Edit" to its file's page, /t/NNNNN-<part>.html. Below the list are
// a button that opens the tags dialog (js/tags.js), for a new tag and for editing every tag at once, and a link to the
// reorder page /t/. Every element has a part in the block lcty-sidebar (lcty-sidebar__tag-menu-list, -item, -search,
// -edit, -empty, -foot, -foot-button; the foot's button and link are lcty-button too), exported by <lcty-c> as well.

import type { TagDef } from "../tag-names.js";

/**
 * The search query with the term tag:name added at its end, the terms joined by single spaces. A query that already
 * has a tag: term for the same tag (the same part, LCTYSP-0009: tag:C# and tag:c~23 are one tag) is given back with
 * its terms as they are, so choosing a tag twice adds it once. The other terms are kept, so tags combine (the search
 * wants every tag: term, LCTYSP-0007).
 */
export function addTagTerm(query: string, name: string): string;

/**
 * Fill menu (the sidebar's tagMenu) with the tags. Starts with no tags ("(No tags yet)"); show(defs) draws the list
 * anew, an invalid tag (a file without <lcty-t>) included: its page says why it cannot be edited. Choosing a tag hides
 * the menu and calls onSearch(the tag's display name). editButton is the foot's "Edit tags": it hides the menu, and the
 * caller wires it to open the tags dialog.
 */
export function initTagMenu(
	menu: HTMLElement,
	options: { onSearch: (name: string) => void },
): { show(defs: readonly TagDef[]): void; editButton: HTMLButtonElement };
