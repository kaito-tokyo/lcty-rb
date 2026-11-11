// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// New conversation (/, the top page. LCTYSP-0004, LCTYSP-0005). Plain HTML (the creation card in public/index.html)
// plus the interactive components <lcty-sidebar> and <lcty-composer>. Sending decides the conversation id, creates the
// file through /v1/rpc in the format of LCTYSP-0013 (the head, the system prompt, for a fork the messages it copies,
// and the first message), ending with an <lcty-cmd data-op="send">, and moves to /c/<id>.html, which generates the
// reply because this tab made that command.
// With ?fork=<id>&at=<n> it forks; ?q=… puts a query into the sidebar's search box (older links to the search page).

/** Starts /: called once by the page's entry (public/index.js). */
export function initNewPage(): void;

// Internals:
// TITLE_MAX_SIZE (512) is the bytes of the title slot, as the files of LCTYSP-0003 have (LCTYSP-0013).
// renderTags(): one checkbox per tag definition, then ⚙︎, laid out as inline content separated by spaces (no CSS of
// its own). The checkboxes are rebuilt only when the definitions change, so focus stays on the box.
// tagsSaved(defs): after saving, the chosen tags that no longer exist are dropped (tags never defined, e.g. from a
// fork, stay), and an untouched draft is composed again from the new prompts and memory.
// create(): the conversation is created through /v1/rpc in the format of LCTYSP-0013 (LCTYSP-0012): c.create writes
// the head, then the system prompt, the messages of a fork (with new ids: a fork shares none, LCTYSP-0013) and the
// user message are appended one by one, and last the lcty-cmd send, which this tab's conversation page runs as its own
// (sessionStorage lcty.run.<id>). The tags at creation go to lcty_t.sqlite (the HTTP API's tags line).
