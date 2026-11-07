// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// UI texts (LCTYSP-0005). Every text a user sees goes through tr(): it looks the key up in LctyT (lcty.v1.js; the
// languages are lcty.v1.lang-<lang>.js, chosen by <html lang>) and falls back to the English x-default given with
// the key. Code outside this mechanism writes no Japanese.

/** The text for key in the page's language, or text (English). {name} placeholders are filled from vars. */
export function tr(key, text, vars = {}) {
	return LctyT._(key, text).replace(/\{(\w+)\}/g, (m, k) =>
		Object.hasOwn(vars, k) ? String(vars[k]) : m,
	);
}

/**
 * Localize static HTML under root: data-lcty-t="key" replaces an element's text, and data-lcty-t-placeholder /
 * data-lcty-t-title / data-lcty-t-aria-label="key" replace that attribute. The English written in the HTML is the
 * x-default.
 */
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
