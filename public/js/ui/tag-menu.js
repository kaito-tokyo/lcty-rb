// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The sidebar's tag menu: each tag to search by or to edit on its file's page (LCTYSP-0009).

import { tr } from "../i18n.js";
import { siteUrl } from "../site.js";
import { tagPart } from "../tag-names.js";

// An element with its part in the block lcty-sidebar (BEM: "tag-menu-item" → lcty-sidebar__tag-menu-item)
function el(tag, part, attrs = {}, ...children) {
	const e = document.createElement(tag);
	e.setAttribute("part", `lcty-sidebar__${part}`);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
	e.append(...children);
	return e;
}

/** The query with tag:name added, unless it already has a tag: term for the same tag. */
export function addTagTerm(query, name) {
	const terms = query.split(/\s+/).filter(Boolean);
	const part = tagPart(name);
	const has = terms.some(
		(t) => t.startsWith("tag:") && tagPart(t.slice(4)) === part,
	);
	return (has ? terms : [...terms, `tag:${name}`]).join(" ");
}

/** Fill menu with the tags; returns show(defs) and the button that opens the tags dialog. */
export function initTagMenu(menu, { onSearch }) {
	const list = el("ul", "tag-menu-list");
	const editAll = el(
		"button",
		"tag-menu-foot-button",
		{ type: "button" },
		tr("editTags", "Edit tags"),
	);
	editAll.part.add("lcty-button");
	editAll.addEventListener("click", () => menu.hidePopover());
	const reorder = el(
		"a",
		"tag-menu-foot-button",
		{ href: siteUrl("t/").href },
		tr("reorderTags", "Change the order"),
	);
	reorder.part.add("lcty-button");
	const foot = el("div", "tag-menu-foot", {}, editAll, reorder);

	const show = (defs) => {
		list.replaceChildren(
			...defs.map((t) => {
				const search = el(
					"button",
					"tag-menu-search",
					{
						type: "button",
						title: tr("searchByTag", "Find the chats tagged {name}", {
							name: t.name,
						}),
					},
					t.name,
				);
				search.addEventListener("click", () => {
					menu.hidePopover();
					onSearch(t.name);
				});
				const edit = el(
					"a",
					"tag-menu-edit",
					{
						href: siteUrl(`t/${encodeURIComponent(t.file)}`).href,
						"aria-label": tr("editTagNamed", "Edit {name}", { name: t.name }),
					},
					tr("edit", "Edit"),
				);
				return el("li", "tag-menu-item", {}, search, edit);
			}),
		);
		menu.replaceChildren(
			defs.length
				? list
				: el("p", "tag-menu-empty", {}, tr("noTagsYet", "(No tags yet)")),
			foot,
		);
	};
	show([]);
	return { show, editButton: editAll };
}
