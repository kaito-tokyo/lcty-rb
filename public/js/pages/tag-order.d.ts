// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tag reorder page (/t/. LCTYSP-0005, LCTYSP-0009). Lists the tag files in their order (file-name order) with
// their display names, lets the user move them, and on save renumbers them 00010, 00020, … and sends the whole set
// with PUT /v1/tags; the contents of the tags are not changed. The tag editor has no order buttons: the order is
// changed only here. An invalid tag (a file without <lcty-t>) is not listed: it is sent back as it is, and the server
// keeps its file.

/**
 * Starts /t/: called once by the page's entry (public/t/index.js). Leaving the page with an unsaved order asks first
 * (beforeunload). A save that fails with 412 (changed elsewhere) loads the tags again and asks for the edit again.
 */
export function initTagOrderPage(): void;

// Internals:
// - state.saved and state.work are the tags that can be moved; state.invalid is sent back as it is.
// - When the tags dialog saved, the page loads again to show its set (it may have added, renamed or deleted tags).
//   tabRpc() is opened so that the sidebar follows the lists over it (LCTYSP-0014).
// - Each item's name is a link to the tag's file, the page that edits it (next to this page).
// - Start: the page edits the set, so it starts from the server's: initSidebar has already run sync_full, and the
//   calls of a tab run in order, so the read in load() comes after it (LCTYSP-0009).
