// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// index.js: the entry of the tag reorder page /t/ (LCTYSP-0005, LCTYSP-0009), a module script that runs after
// lcty.v1.cjs and the language scripts. Bundled at startup and served from memory at /t/index.js (LCTYSP-0011); like
// site.js it sits one directory below the root of the site.
import { initTagOrderPage } from "../js/pages/tag-order.js";

initTagOrderPage();
