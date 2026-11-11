// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// UI texts: every text a user sees goes through tr(), with an English x-default (LCTYSP-0005).

/** The text for key in the page's language, or text (English), with {name} placeholders filled from vars. */
export function tr(key, text, vars = {}) {
	return LctyT._(key, text).replace(/\{(\w+)\}/g, (m, k) =>
		Object.hasOwn(vars, k) ? String(vars[k]) : m,
	);
}

/** Localize static HTML under root from its data-lcty-t and data-lcty-t-<attribute> keys. */
export function localize(root = document) {
	for (const el of root.querySelectorAll("[data-lcty-t]"))
		el.textContent = tr(el.dataset.lctyT, el.textContent);
	for (const attr of ["placeholder", "title", "aria-label"]) {
		for (const el of root.querySelectorAll(`[data-lcty-t-${attr}]`)) {
			el.setAttribute(
				attr,
				tr(el.getAttribute(`data-lcty-t-${attr}`), el.getAttribute(attr) || ""),
			);
		}
	}
}
