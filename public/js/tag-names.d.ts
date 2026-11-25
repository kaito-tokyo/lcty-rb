// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tag names, tag file names and references (LCTYSP-0009). A tag is a file t/<part>.html on the server, whose <part> is
// derived from the display name here: all Unicode handling is the browser's, and the server only checks file names
// mechanically. The draft order is inside the file (data-order, given by the server from the order of the set sent).
// Conversations refer to a tag by its part. No imports, so search and the reorder page can use it without the rest of
// js/tags.js.

/** One memory item of a tag. */
export interface TagMemory {
	text: string;
	source?: unknown;
	[key: string]: unknown;
}

/**
 * A tag definition as t.list of /v1/rpc gives it: file is its file name (<part>.html, NFC), or null for a new tag not
 * saved yet. order is its data-order (null without one; t.replace ignores it). invalid marks a file without <lcty-t>:
 * it keeps its file name and takes no memory.
 */
export interface TagDef {
	file: string | null;
	name: string;
	order?: number | null;
	ops?: unknown[];
	prompt?: string;
	memory?: TagMemory[];
	invalid?: boolean;
	[key: string]: unknown;
}

/** The longest display name, in code points (after NFC). */
export const TAG_NAME_MAX: number;

/**
 * Why the display name cannot be used ("length", "character" or "reserved"), or null. The name is checked as it will be
 * saved: NFC, then 1 to TAG_NAME_MAX code points, with no character of the categories Z and C and none of
 * : ; / " ' ` ~ \ |. "reserved" is a name whose part is index or starts with . or lcty.v1: its file would be the
 * reorder page (/t/index.html), a hidden or temporary file, or a name /t/ redirects to /lcty.v1/.
 */
export function tagNameError(
	name: unknown,
): "length" | "character" | "reserved" | null;

/**
 * The file-name part of a display name, which is also how conversations refer to the tag: NFC, lowercase (final sigma
 * as sigma), NFC again, then the ASCII symbols that mean something to shells, URLs, globs or Windows
 * (! # $ % & ( ) * < > ? [ ] ^ { }) escaped as ~ and two lowercase hex digits. C# → c~23, Ruby → ruby. Applying it to
 * a part gives the same part.
 */
export function tagPart(name: unknown): string;

/** The tag file name <part>.html. */
export function tagFileName(part: string): string;

/** The reference to the tag of a definition: the part of its file name (without .html), NFC. */
export function tagRef(def: { file: string }): string;

/** The display name of a reference: the name of its tag file, or the reference itself for an undefined tag. */
export function tagDisplayName(defs: readonly TagDef[], ref: string): string;

/** Sort references by the order of the tag files (undefined tags go last, in the given order); duplicates dropped. */
export function sortTags(
	defs: readonly TagDef[],
	refs: Iterable<string>,
): string[];

/**
 * The file names of tags edited in order: each tag's file is the part of its name (a renamed tag gets a new file, a
 * new tag its first). An invalid tag (a file without <lcty-t>) keeps its file name as it is. The order is the order of
 * the array, which the server writes into the files. Returns new objects; the given tags are not changed.
 */
export function assignFileNames<T extends TagDef>(
	tags: readonly T[],
): (T & { file: string })[];

/**
 * The file name of a tag file's page from its URL path (/t/ruby.html): the last segment, percent-decoded and composed
 * to NFC as the tags' file names are. A segment that cannot be decoded is returned as it is.
 */
export function tagFileOfPath(path: string): string;

// Internals:
// - FORBIDDEN_RE: categories Z (separators) and C (controls, format, private use, surrogates, unassigned), and the
//   ASCII symbols : ; / " ' ` ~ \ |.
// - ESCAPED_RE: the symbols escaped in the file-name part as ~ and two lowercase hex digits.
// - RESERVED_RE: the reserved parts: index, and those starting with . or lcty.v1.
