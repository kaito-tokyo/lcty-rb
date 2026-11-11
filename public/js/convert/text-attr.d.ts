// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// A text string as an attribute of the file, both ways (dual recording. LCTYSP-0003). The source of truth is the
// attribute name. Only when the text has characters XML cannot represent, name-base64 holds base64 of its UTF-8 bytes
// instead, and the text is kept byte-exact.
//
//   textAttr(el, name)          the text an element's attributes hold, or null
//   textAttrOf(name, text)      the attribute that holds text: {name: text} or {"name-base64": …}

/**
 * The text an element's attributes hold under name, or null.
 * When `<name>-base64` is present it wins: its base64 is decoded as strict UTF-8, and a leading U+FEFF is kept as part
 * of the text (byte-exact), not dropped as a byte order mark. Invalid base64 or UTF-8 gives null. Otherwise the plain
 * attribute name is returned (null when absent).
 */
export function textAttr(el: Element, name: string): string | null;

/**
 * The attribute that holds text under name: the text itself ({name: text}), or base64 of its UTF-8 bytes
 * ({"name-base64": …}) when XML cannot hold it. An attribute of the file cannot hold C0 controls other than tab, LF
 * and CR, nor U+FFFE / U+FFFF (LCTYSP-0003).
 */
export function textAttrOf(name: string, text: string): Record<string, string>;
