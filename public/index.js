// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// index.js: the entry of / (LCTYSP-005), a module script (so it never blocks rendering) that runs after lcty.v1.js
// (the custom elements, defined at its end) and the language scripts. Bundled at startup and served from memory.
import { initNewPage } from "./js/pages/new.js";

initNewPage();
