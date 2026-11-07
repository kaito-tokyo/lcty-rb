// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// UUIDv7 (RFC 9562), used for message ids (LCTYSP-0003). The first 48 bits are milliseconds.

export const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hexByte(b) {
	return b.toString(16).padStart(2, "0");
}

export function uuidv7(ms = Date.now()) {
	const b = crypto.getRandomValues(new Uint8Array(16));
	for (let i = 5; i >= 0; i--, ms = Math.floor(ms / 256)) b[i] = ms % 256;
	b[6] = (b[6] & 0x0f) | 0x70; // version 7
	b[8] = (b[8] & 0x3f) | 0x80; // variant 10
	return bytesToUuid(b, 0);
}

/** 16 bytes → canonical string form */
function bytesToUuid(u8, off) {
	let s = "";
	for (let i = 0; i < 16; i++) {
		if (i === 4 || i === 6 || i === 8 || i === 10) s += "-";
		s += hexByte(u8[off + i]);
	}
	return s;
}

/** canonical string form → out[off..off+16) */
export function uuidToBytes(s, out, off) {
	const h = s.replace(/-/g, "");
	for (let i = 0; i < 16; i++) out[off + i] = parseInt(h.substr(i * 2, 2), 16);
}
