// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// tags.js: the entry of /tags (LCTYSP-005), loaded after lcty.v1.js, the language scripts and the inline
// defineLctyV1CustomElements(). Bundled at startup and served from memory.
import { initTagsPage } from "./js/pages/tags.js";

initTagsPage();
