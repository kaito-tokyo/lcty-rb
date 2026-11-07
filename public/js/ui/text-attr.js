// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Read a text string from attributes (dual recording. LCTYSP-0003).
// The source of truth is the attribute name. Only when it has characters XML cannot represent, name-base64 holds base64 of its UTF-8 bytes.

export function textAttr(el, name) {
	const b = el.getAttribute(`${name}-base64`);
	if (b == null) return el.getAttribute(name);
	try {
		const bin = atob(b);
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		// ignoreBOM: a leading U+FEFF is part of the text (byte-exact), not a byte order mark to drop
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		return null;
	}
}
