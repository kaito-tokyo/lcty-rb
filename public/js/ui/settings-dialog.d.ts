// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Settings dialog (LCTYSP-0010), a modal <dialog> opened from the sidebar's ⚙︎ button on every page. Edits the
// browser settings: defaults come from /v1/defaults.json, changes go to localStorage.

/**
 * Builds the dialog (id "settings-dialog", in <body>, so it is styled by lcty.v1.css on every page) and wires button to
 * open it. Each time it opens, the form shows the stored settings (discarding unsaved edits) and the defaults are
 * refetched. Save stores only the items that differ from the defaults; "Reset to defaults" clears them; "Test
 * connection" tests the values in the form (saved or not) against <base_url>/v1/models and names the configured
 * models it does not list. A click on the backdrop (outside the form) closes it too.
 * @returns the dialog
 */
export function initSettingsDialog(button: HTMLElement): HTMLDialogElement;
