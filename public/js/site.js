// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The URLs of the site, which may be served under any path (LCTYSP-0005, LCTYSP-1000).

/** The URL of path, relative to the root of the site (such as "v1/tags"). */
export function siteUrl(path) {
	return new URL(path, new URL("../", import.meta.url));
}
