// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The URLs of the site (LCTYSP-0005). The site may be served under any path, not only at the root of its host, so the
// modules never write a URL that starts with "/": they ask siteUrl() for the URL of a path of the site. The root is
// the directory above the file that runs this code: public/js/site.js itself, or the bundle it is part of
// (/c/index.js, LCTYSP-0011). So every such file sits one directory below the root, as the pages do (/*/*.html). In
// Node.js the root is public/ (LCTYSP-1000).

/** The URL of path, relative to the root of the site (such as "v1/tags"). */
export function siteUrl(path) {
	return new URL(path, new URL("../", import.meta.url));
}
