// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The page of a tag file (/t/NNNNN-<part>.html. LCTYSP-0005, LCTYSP-0009). The file itself is served, and its <lcty-t>
// (lcty.v1.cjs) has made it a page with the sidebar and a read-only view of the tag. This replaces the view with the
// tag editor for that tag alone: the same fields as in the tags dialog, saved with PUT /v1/tags like the dialog (the
// rest of the set is sent back as it is). The tag is found in the browser's copy of the tags by the file name of the
// page. Saving it under a new name gives it a new file, so the page goes to the new file's URL; deleting it goes to
// the reorder page, /t/.

/**
 * Starts the page: called once by its entry (public/t/tag-file.js). Does nothing without <lcty-t>. Leaving the page
 * with unsaved edits asks first (beforeunload).
 */
export function initTagFilePage(): void;

// Internals:
// - When the tags dialog saved, the page loads again to show this tag as it is now (it may have been renamed or
//   deleted there). tabRpc() is opened so that the sidebar follows the lists over it (LCTYSP-0014).
// - load(): when the tags cannot be loaded, a toast is shown and the read-only view stays.
// - onSaved: the page is the file, so a new name is a new file (location.replace to it), and a deleted tag has none
//   (location.replace to ./, the reorder page).
// - Start: the page edits the set, so it starts from the server's: initSidebar has already run sync_full, and the
//   calls of a tab run in order, so the read in load() comes after it (LCTYSP-0009).
