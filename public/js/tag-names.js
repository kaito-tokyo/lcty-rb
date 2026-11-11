// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tag names, tag file names t/NNNNN-<part>.html and references, with no imports (LCTYSP-0009).

/** The longest display name, in code points (after NFC). */
export const TAG_NAME_MAX = 40;
/** Categories Z (separators) and C (controls, format, private use, surrogates, unassigned), and these ASCII symbols. */
const FORBIDDEN_RE = /[\p{Z}\p{C}:;/"'`~\\|]/u;
/** Escaped in the file-name part as ~ and two lowercase hex digits. */
const ESCAPED_RE = /[!#$%&()*<>?[\]^{}]/g;
/** The largest order number: five digits. */
const MAX_NUMBER = 99999;

/** Why the display name cannot be used ("length" or "character"), or null, checked as it will be saved. */
export function tagNameError(name) {
	const n = String(name).normalize("NFC");
	const length = [...n].length;
	if (length < 1 || length > TAG_NAME_MAX) return "length";
	if (FORBIDDEN_RE.test(n)) return "character";
	return null;
}

/** The file-name part of a display name, also the tag's reference (C# → c~23, Ruby → ruby). */
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

/** The file names of tags edited in order: numbers kept, a new tag largest + 10; throws "full" past five digits. */
export function assignFileNames(tags) {
	let last = Math.max(
		0,
		...tags.filter((t) => t.file).map((t) => tagNumber(t.file)),
	);
	return tags.map((t) => {
		if (t.invalid) return t;
		let number = t.file ? tagNumber(t.file) : 0;
		if (!t.file) {
			last += 10;
			number = last;
		}
		if (number > MAX_NUMBER) throw new Error("full");
		return { ...t, file: tagFileName(number, tagPart(t.name)) };
	});
}

/** The file name of a tag file's page from its URL path (/t/00010-ruby.html): the last segment, decoded, NFC. */
export function tagFileOfPath(path) {
	const last = path.split("/").pop();
	try {
		return decodeURIComponent(last).normalize("NFC");
	} catch {
		return last;
	}
}

/** The same tags renumbered in the given order, 00010, 00020, … (the reorder page) */
export function renumber(tags) {
	return tags.map((t, i) => ({
		...t,
		file: tagFileName((i + 1) * 10, tagRef(t)),
	}));
}
