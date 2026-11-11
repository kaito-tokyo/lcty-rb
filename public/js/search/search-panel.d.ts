// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Search box and conversation list of the sidebar, on every page (LCTYSP-0007, LCTYSP-0008).
// With an empty box it lists newest first; otherwise it merges keyword search (server) and semantic search (browser)
// with RRF.
// The list is the browser's copies, which follow the server over /v1/rpc (LCTYSP-0014): the meta of every conversation
// and its number of elements (api/meta-db.js, lcty_c) and its tags (api/lcty-t.js, t_has_many_c of lcty_t, in the
// order of the tags' files); it is read again whenever this tab has stored a change of them. The rounds of each
// conversation (message_ids, which semantic search needs to map a hit to its conversation) are fetched from
// /v1/conversations only when a semantic search runs, and kept until the list changes.

/** The search panel's handle. */
export interface SearchPanel {
	/** Reload the list from the copies (on opening a page, after saving or renaming). */
	refresh(): Promise<void>;
	/** Put q into the search box and run the search (a tag chip clicked in the list sets `tag:<name>`). */
	setQuery(q: string): void;
	/** The id of the conversation shown on the page, marked in the list. */
	set current(id: string | null);
}

/**
 * Wire the sidebar's search box to its conversation list.
 * list: the <lcty-conv-list> element; box: the search box; status: the status display; getSettings: the current
 * settings (null or undefined when not loaded), from which the embedding backend for semantic search is taken.
 * A query is split on whitespace: `tag:<name>` terms filter by tag (tag:C# and tag:c~23 are one tag, as conversations
 * refer to tags by the file-name part, LCTYSP-0009) and the rest is the search text.
 */
export function createSearchPanel(o: {
	list: HTMLElement;
	box: HTMLInputElement;
	status: HTMLElement;
	getSettings: () => object | null | undefined;
}): SearchPanel;

// Internals:
// One vector store per page: each page creates one search panel.
// state.all is the list (from the copy); state.stale says the copy is out of date (before the first sync it is empty:
// the list then waits for it instead of saying there are no conversations); state.rounds is {convOf, idsOf} from
// /v1/conversations, fetched on demand for semantic search and dropped when the list is reloaded.
// checkModel(): the distribution files hold the vectors of the default embedding model only (LCTYSP-0008), so semantic
// search fails when the configured model is another one.
// semantic(): with tag: filters the worker selects among the rounds of the matching conversations; otherwise it only
// drops rounds whose conversation is not in the list.
// run(): keyword and semantic hits are merged with RRF (each adds 1/(RRF_K + rank), RRF_K = 60, per round), the
// highest-scoring round per conversation is kept (at most 30 conversations), and the missing snippets are fetched.
// A sequence number drops the result of a search when a newer one has started or the query was cleared. When semantic
// search fails, the keyword results are shown with a note.
