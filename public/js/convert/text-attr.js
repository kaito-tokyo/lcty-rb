// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// A text string as an attribute of the file, both ways (dual recording. LCTYSP-0003). The source of truth is the
// attribute name. Only when the text has characters XML cannot represent, name-base64 holds base64 of its UTF-8 bytes
// instead, and the text is kept byte-exact.
//
//   textAttr(el, name)          the text an element's attributes hold, or null
//   textAttrOf(name, text)      the attribute that holds text: {name: text} or {"name-base64": …}

// C0 controls other than tab, LF and CR, and U+FFFE / U+FFFF: an attribute of the file cannot hold them (LCTYSP-0003)
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters looked for
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

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

/** The attribute that holds text under name: the text itself, or base64 of its UTF-8 bytes when XML cannot hold it. */
export function textAttrOf(name, text) {
	if (!XML_FORBIDDEN.test(text)) return { [name]: text };
	const bytes = new TextEncoder().encode(text);
	return { [`${name}-base64`]: btoa(String.fromCharCode(...bytes)) };
}
