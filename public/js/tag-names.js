// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tag names, tag file names and references (LCTYSP-0009). A tag is a file t/NNNNN-<part>.html on the server; NNNNN is
// the draft order and <part> is derived from the display name here: all Unicode handling is the browser's, and the
// server only checks file names mechanically. Conversations refer to a tag by its part. No imports, so search and
// the reorder page can use it without the rest of js/tags.js.

/** The longest display name, in code points (after NFC). */
export const TAG_NAME_MAX = 40;
/** Categories Z (separators) and C (controls, format, private use, surrogates, unassigned), and these ASCII symbols. */
const FORBIDDEN_RE = /[\p{Z}\p{C}:;/"'`~\\|]/u;
/** Escaped in the file-name part as ~ and two lowercase hex digits. */
const ESCAPED_RE = /[!#$%&()*<>?[\]^{}]/g;
/** The largest order number: five digits. */
const MAX_NUMBER = 99999;

/**
 * Why the display name cannot be used, or null. The name is checked as it will be saved: NFC, then 1 to TAG_NAME_MAX
 * code points, with no character of the categories Z and C and none of : ; / " ' ` ~ \ |.
 */
export function tagNameError(name) {
	const n = String(name).normalize("NFC");
	const length = [...n].length;
	if (length < 1 || length > TAG_NAME_MAX) return "length";
	if (FORBIDDEN_RE.test(n)) return "character";
	return null;
}

/**
 * The file-name part of a display name, which is also how conversations refer to the tag: NFC, lowercase (final sigma
 * as sigma), NFC again, then the ASCII symbols that mean something to shells, URLs, globs or Windows escaped as ~xx.
 * C# → c~23, Ruby → ruby. Applying it to a part gives the same part.
 */
export function tagPart(name) {
	const part = String(name)
		.normalize("NFC")
		.toLowerCase()
		.replaceAll("ς", "σ")
		.normalize("NFC");
	return part.replace(
		ESCAPED_RE,
		(c) => `~${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
	);
}

/** NNNNN-<part>.html */
export function tagFileName(number, part) {
	return `${String(number).padStart(5, "0")}-${part}.html`;
}

/** The order number of a tag file name */
export function tagNumber(file) {
	return Number.parseInt(file.slice(0, 5), 10);
}

/** The reference to the tag of a definition: the part of its file name (without the number and .html) */
export function tagRef(def) {
	return def.file.normalize("NFC").slice(6, -5);
}

/** The display name of a reference: the name of its tag file, or the reference itself for an undefined tag */
export function tagDisplayName(defs, ref) {
	return defs.find((d) => tagRef(d) === ref)?.name ?? ref;
}

/** Sort references by the order of the tag files (undefined tags go last, in the given order). */
export function sortTags(defs, refs) {
	const order = new Map(defs.map((t, i) => [tagRef(t), i]));
	return [...new Set(refs)].sort(
		(a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9),
	);
}

/**
 * The file names of tags edited in order: a tag keeps its number (the order is changed on the reorder page) and takes
 * the part of its name; a new tag gets the number after the largest (largest + 10). Throws "full" when that would need
 * more than five digits.
 */
export function assignFileNames(tags) {
	let last = Math.max(
		0,
		...tags.filter((t) => t.file).map((t) => tagNumber(t.file)),
	);
	return tags.map((t) => {
		let number = t.file ? tagNumber(t.file) : 0;
		if (!t.file) {
			last += 10;
			number = last;
		}
		if (number > MAX_NUMBER) throw new Error("full");
		return { ...t, file: tagFileName(number, tagPart(t.name)) };
	});
}

/** The same tags renumbered in the given order, 00010, 00020, … (the reorder page) */
export function renumber(tags) {
	return tags.map((t, i) => ({
		...t,
		file: tagFileName((i + 1) * 10, tagRef(t)),
	}));
}
