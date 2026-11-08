// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// tag-file.js: the features of a tag file's page, /t/NNNNN-<part>.html (LCTYSP-0005, LCTYSP-0009). <lcty-t>
// (lcty.v1.cjs) imports it once the page has loaded. Served as it is at /t/tag-file.js: the browser imports the
// modules of js/ over HTTP; like site.js it sits one directory below the root of the site.
import { initTagFilePage } from "../js/pages/tag-file.js";

initTagFilePage();
