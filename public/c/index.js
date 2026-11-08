// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// index.js: the entry of the new conversation page /c/ (LCTYSP-0005), a module script (so it never blocks rendering)
// that runs after lcty.v1.cjs (the custom elements, defined at its end) and the language scripts. Bundled at startup
// and served from memory at /c/index.js (LCTYSP-0011); like site.js it sits one directory below the root of the site.
import { initNewPage } from "../js/pages/new.js";

initNewPage();
