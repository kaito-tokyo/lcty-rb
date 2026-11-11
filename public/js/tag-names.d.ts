// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tag names, tag file names and references (LCTYSP-0009). A tag is a file t/NNNNN-<part>.html on the server; NNNNN is
// the draft order and <part> is derived from the display name here: all Unicode handling is the browser's, and the
// server only checks file names mechanically. Conversations refer to a tag by its part. No imports, so search and
// the reorder page can use it without the rest of js/tags.js.

/** One memory item of a tag. */
export interface TagMemory {
	text: string;
	source?: unknown;
	[key: string]: unknown;
}

/**
 * A tag definition as GET /v1/tags gives it: file is its file name (NNNNN-<part>.html, NFC), or null for a new tag
 * not saved yet. invalid marks a file without <lcty-t>: it keeps its file name and takes no memory.
 */
export interface TagDef {
	file: string | null;
	name: string;
	ops?: unknown[];
	prompt?: string;
	memory?: TagMemory[];
	invalid?: boolean;
	[key: string]: unknown;
}

/** The longest display name, in code points (after NFC). */
export const TAG_NAME_MAX: number;

/**
 * Why the display name cannot be used ("length" or "character"), or null. The name is checked as it will be saved:
 * NFC, then 1 to TAG_NAME_MAX code points, with no character of the categories Z and C and none of : ; / " ' ` ~ \ |.
 */
export function tagNameError(name: unknown): "length" | "character" | null;

/**
 * The file-name part of a display name, which is also how conversations refer to the tag: NFC, lowercase (final sigma
 * as sigma), NFC again, then the ASCII symbols that mean something to shells, URLs, globs or Windows
 * (! # $ % & ( ) * < > ? [ ] ^ { }) escaped as ~ and two lowercase hex digits. C# → c~23, Ruby → ruby. Applying it to
 * a part gives the same part.
 */
export function tagPart(name: unknown): string;

/** The tag file name NNNNN-<part>.html: number padded to five digits. */
export function tagFileName(number: number, part: string): string;

/** The order number of a tag file name (its first five digits). */
export function tagNumber(file: string): number;

/** The reference to the tag of a definition: the part of its file name (without the number and .html), NFC. */
export function tagRef(def: { file: string }): string;

/** The display name of a reference: the name of its tag file, or the reference itself for an undefined tag. */
export function tagDisplayName(defs: readonly TagDef[], ref: string): string;

/** Sort references by the order of the tag files (undefined tags go last, in the given order); duplicates dropped. */
export function sortTags(
	defs: readonly TagDef[],
	refs: Iterable<string>,
): string[];

/**
 * The file names of tags edited in order: a tag keeps its number (the order is changed on the reorder page) and takes
 * the part of its name; a new tag (file null) gets the number after the largest (largest + 10). Throws an Error
 * "full" when that would need more than five digits (above 99999). An invalid tag (a file without <lcty-t>) keeps its
 * file name as it is. Returns new objects; the given tags are not changed.
 */
export function assignFileNames<T extends TagDef>(
	tags: readonly T[],
): (T & { file: string })[];

/**
 * The file name of a tag file's page from its URL path (/t/00010-ruby.html): the last segment, percent-decoded and
 * composed to NFC as the tags' file names are. A segment that cannot be decoded is returned as it is.
 */
export function tagFileOfPath(path: string): string;

/** The same tags renumbered in the given order, 00010, 00020, … (the reorder page). */
export function renumber<T extends { file: string }>(
	tags: readonly T[],
): (T & { file: string })[];

// Internals:
// - FORBIDDEN_RE: categories Z (separators) and C (controls, format, private use, surrogates, unassigned), and the
//   ASCII symbols : ; / " ' ` ~ \ |.
// - ESCAPED_RE: the symbols escaped in the file-name part as ~ and two lowercase hex digits.
// - MAX_NUMBER: the largest order number, 99999 (five digits).
