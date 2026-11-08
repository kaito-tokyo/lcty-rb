// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// tag-file.js: the features of a tag file's page, /t/NNNNN-<part>.html (LCTYSP-0005, LCTYSP-0009). <lcty-t>
// (lcty.v1.js) imports it once the page has loaded. Bundled at startup and served from memory at /t/tag-file.js
// (LCTYSP-0011); like site.js it sits one directory below the root of the site.
import { initTagFilePage } from "../js/pages/tag-file.js";

initTagFilePage();
