// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// index.js: the entry of the new conversation page /c/ (LCTYSP-0005), a module script (so it never blocks rendering)
// that runs after lcty.v1.cjs (the custom elements, defined at its end) and the language scripts. Served as it is at
// /c/index.js: the browser imports the modules of js/ over HTTP; like site.js it sits one directory below the root.
import { initNewPage } from "../js/pages/new.js";

initNewPage();
