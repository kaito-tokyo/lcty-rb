// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// UI texts (LCTYSP-0005). Every text a user sees goes through tr(): it looks the key up in LctyT (lcty.v1.cjs; the
// languages are lcty.v1.lang-<lang>.cjs, chosen by <html lang>) and falls back to the English x-default given with
// the key. Code outside this mechanism writes no Japanese.

/**
 * The text for key in the page's language (looked up with the global LctyT._(key, text)), or text (English, the
 * x-default). {name} placeholders are filled from vars; a placeholder whose name vars does not have is left as it is.
 */
export function tr(
	key: string,
	text: string,
	vars?: Record<string, unknown>,
): string;

/**
 * Localize static HTML under root (document by default): data-lcty-t="key" replaces an element's text, and
 * data-lcty-t-placeholder / data-lcty-t-title / data-lcty-t-aria-label="key" replace that attribute. The English
 * written in the HTML is the x-default.
 */
export function localize(root?: ParentNode): void;
