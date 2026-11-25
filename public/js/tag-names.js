// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tag names, tag file names t/<part>.html and references, with no imports (LCTYSP-0009).

/** The longest display name, in code points (after NFC). */
export const TAG_NAME_MAX = 40;
/** Categories Z (separators) and C (controls, format, private use, surrogates, unassigned), and these ASCII symbols. */
const FORBIDDEN_RE = /[\p{Z}\p{C}:;/"'`~\\|]/u;
/** Escaped in the file-name part as ~ and two lowercase hex digits. */
const ESCAPED_RE = /[!#$%&()*<>?[\]^{}]/g;
/** Parts whose file would be the reorder page, a hidden file or a name /t/ redirects to /lcty.v1/. */
const RESERVED_RE = /^(?:index$|\.|lcty\.v1)/;

/** Why the display name cannot be used ("length", "character" or "reserved"), or null, checked as it will be saved. */
export function tagNameError(name) {
	const n = String(name).normalize("NFC");
	const length = [...n].length;
	if (length < 1 || length > TAG_NAME_MAX) return "length";
	if (FORBIDDEN_RE.test(n)) return "character";
	if (RESERVED_RE.test(tagPart(n))) return "reserved";
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

/** <part>.html */
export function tagFileName(part) {
	return `${part}.html`;
}

/** The reference to the tag of a definition: the part of its file name (without .html) */
export function tagRef(def) {
	return def.file.normalize("NFC").slice(0, -5);
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

/** The file names of tags edited in order: each tag's file is its name's part; an invalid tag keeps its own. */
export function assignFileNames(tags) {
	return tags.map((t) =>
		t.invalid ? t : { ...t, file: tagFileName(tagPart(t.name)) },
	);
}

/** The file name of a tag file's page from its URL path (/t/ruby.html): the last segment, decoded, NFC. */
export function tagFileOfPath(path) {
	const last = path.split("/").pop();
	try {
		return decodeURIComponent(last).normalize("NFC");
	} catch {
		return last;
	}
}
