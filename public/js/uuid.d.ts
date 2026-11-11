// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// UUIDv7 (RFC 9562), used for message ids (LCTYSP-0003). The first 48 bits are milliseconds.

/** A UUIDv7 in its canonical lowercase string form (version 7, variant 10). */
export const UUID_RE: RegExp;

/**
 * A new UUIDv7 in canonical string form. The first 48 bits are ms (milliseconds, Date.now() by default), big-endian;
 * the rest is random, with the version (7) and variant (10) bits set.
 */
export function uuidv7(ms?: number): string;

/** Writes the 16 bytes of the canonical string form s into out[off..off+16). */
export function uuidToBytes(s: string, out: Uint8Array, off: number): void;

// Internals: hexByte(b) gives a byte as two lowercase hex digits; bytesToUuid(u8, off) gives the 16 bytes of u8 from
// off in canonical string form.
