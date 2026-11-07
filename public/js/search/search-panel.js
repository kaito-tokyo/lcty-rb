// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Search box and conversation list of the sidebar, on every page (LCTYSP-0007, LCTYSP-0008).
// With an empty box it lists newest first; otherwise it merges keyword search (server) and semantic search (browser) with RRF.
// The list is the browser's copy of every conversation's meta (IndexedDB, api/meta-db.js): titles, dates, tags_hint as
// the tags and messages_hint as the counts; it is read again whenever a sync has stored a new list. The rounds of each
// conversation (message_ids, which semantic search needs to map a hit to its conversation) are fetched from
// /v1/conversations only when a semantic search runs, and kept until the list changes.

import {
	onMetaDbChange,
	readMetaDb,
	requestMetaDbSync,
} from "../api/meta-db.js";
import {
	fetchSnippets,
	getDefaults,
	listConversations,
	searchConversations,
} from "../api/storage.js";
import { backendOf, showToast } from "../common.js";
import { tr } from "../i18n.js";
import { tagPart } from "../tag-names.js";
import { embeddingConfig, embedQuery } from "./embed.js";
import { createVectorStore } from "./vectors.js";

const RRF_K = 60;

/**
 * @param {object} o
 * @param {HTMLElement} o.list   <lcty-conv-list>
 * @param {HTMLInputElement} o.box  search box
 * @param {HTMLElement} o.status  status display
 * @param {() => object} o.getSettings
 */
export function createSearchPanel({ list, box, status, getSettings }) {
	const vectors = createVectorStore(); // One per page: each page creates one search panel
	// all: the list (from the copy); stale: the copy is out of date; rounds: {convOf, idsOf} from /v1/conversations, on demand
	const state = {
		all: [],
		stale: false,
		query: "",
		current: null,
		rounds: null,
	};
	let seq = 0;
	let timer = 0;

	function show(items, empty) {
		list.show(items, empty);
		list.current = state.current;
	}

	// The rounds each conversation owns (user message ids), only for semantic search
	async function rounds() {
		if (!state.rounds) {
			const list = await listConversations();
			state.rounds = {
				idsOf: new Map(list.map((c) => [c.id, c.message_ids || []])),
				convOf: new Map(
					list.flatMap((c) => (c.message_ids || []).map((m) => [m, c.id])),
				),
			};
		}
		return state.rounds;
	}

	// The distribution files hold the vectors of the default embedding model only (LCTYSP-0008)
	let defaults = null;
	async function checkModel(cfg) {
		defaults ||= getDefaults().catch((e) => {
			defaults = null;
			throw e;
		});
		const { embedding_model } = await defaults;
		if (cfg.model !== embedding_model)
			throw new Error(
				`the vectors are for ${embedding_model}, not ${cfg.model}`,
			);
	}

	// [[msgId, score], …] and the map from a round to its conversation
	async function semantic(cfg, text, hasTags, filtered) {
		await checkModel(cfg);
		const [vec, { idsOf, convOf }] = await Promise.all([
			embedQuery(cfg, text),
			rounds(),
			vectors.refresh(),
		]);
		// With tag: filters the worker selects among the rounds of the matching conversations; otherwise it only drops
		// rounds whose conversation is not in the list
		const allow = filtered
			? state.all
					.filter((c) => hasTags(c.id))
					.flatMap((c) => idsOf.get(c.id) || [])
			: null;
		const hits = await vectors.search(vec, 50, {
			allow,
			accept: (id) => hasTags(convOf.get(id)),
		});
		return { hits, convOf };
	}

	async function run() {
		const q = state.query.trim();
		if (!q) {
			seq++; // a search still in flight is for a query that is gone: its result is dropped
			status.textContent = "";
			// Before the first sync the copy is empty: wait for it instead of saying there are no conversations
			const empty =
				state.stale && !state.all.length
					? ""
					: tr("noConversations", "No conversations yet");
			return show(state.all, empty);
		}
		const mySeq = ++seq;
		const terms = q.split(/\s+/);
		// tag:C# and tag:c~23 are one tag: conversations refer to tags by the file-name part (LCTYSP-0009)
		const tags = terms
			.filter((t) => t.startsWith("tag:"))
			.map((t) => t.slice(4))
			.filter(Boolean)
			.map(tagPart);
		const text = terms.filter((t) => !t.startsWith("tag:")).join(" "); // tag:name is a filter
		const convs = new Map(state.all.map((c) => [c.id, c]));
		const hasTags = (id) =>
			!!convs.get(id) && tags.every((t) => convs.get(id).tags?.includes(t));
		if (!text) {
			status.textContent = "";
			return show(
				state.all.filter((c) => hasTags(c.id)),
				tr("noMatches", "No matching conversations"),
			);
		}
		const s = getSettings();
		const cfg = s ? embeddingConfig(backendOf(s)) : null;
		let note = "";
		try {
			const [kw, sem] = await Promise.all([
				searchConversations({ q: text, tags, limit: 50 }).then(
					(r) => r.results,
				),
				cfg
					? semantic(cfg, text, hasTags, tags.length > 0).catch((e) => {
							note = tr(
								"semanticUnavailable",
								"Semantic search is unavailable ({error}); searching by keywords only",
								{ error: e.message },
							);
							return { hits: [], convOf: new Map() };
						})
					: { hits: [], convOf: new Map() },
			]);
			if (mySeq !== seq) return; // Drop the result if a newer search has started
			// RRF: add 1/(k + rank) per round
			const hits = new Map();
			const hit = (id) =>
				hits.get(id) || hits.set(id, { id, score: 0, sources: [] }).get(id);
			kw.forEach((r, i) => {
				const h = hit(r.id);
				h.score += 1 / (RRF_K + i + 1);
				h.sources.push("keyword");
				h.conv_id = r.conv_id;
				h.snippet = r.snippet;
			});
			sem.hits.forEach(([id, sc], i) => {
				const h = hit(id);
				h.score += 1 / (RRF_K + i + 1);
				h.sources.push(`semantic:${sc.toFixed(3)}`);
				h.conv_id ||= sem.convOf.get(id);
			});
			// Keep the highest-scoring round per conversation
			const byConv = new Map();
			for (const h of [...hits.values()].sort((a, b) => b.score - a.score)) {
				if (h.conv_id && !byConv.has(h.conv_id) && convs.has(h.conv_id))
					byConv.set(h.conv_id, h);
				if (byConv.size >= 30) break;
			}
			const top = [...byConv.values()];
			const need = top.filter((h) => !h.snippet).map((h) => h.id);
			if (need.length) {
				const sn = await fetchSnippets(need, text);
				for (const h of top) h.snippet ||= sn[h.id]?.snippet;
			}
			if (mySeq !== seq) return;
			status.textContent = note;
			show(
				top.map((h) => ({
					...convs.get(h.conv_id),
					chunk_id: h.id,
					snippet: h.snippet,
					sources: h.sources,
					score: h.score,
				})),
				tr("noMatches", "No matching conversations"),
			);
		} catch (e) {
			if (mySeq === seq)
				status.textContent = tr("searchFailed", "Search failed: {error}", {
					error: e.message,
				});
		}
	}

	box.addEventListener("input", () => {
		state.query = box.value;
		clearTimeout(timer);
		timer = setTimeout(run, 250);
	});
	list.addEventListener("tag", (e) => setQuery(`tag:${e.detail.name}`));

	function setQuery(q) {
		box.value = q;
		state.query = q;
		run();
	}

	// Read the list from the copy and show it (or rerun the search)
	async function load() {
		try {
			const { items, stale } = await readMetaDb();
			state.all = items.map((m) => ({
				id: m.id,
				title: m.title,
				updated_at_hint: m.updated_at_hint,
				messages: m.messages_hint,
				tags: m.tags_hint,
			}));
			state.stale = stale;
			state.rounds = null; // the conversations may have changed
		} catch (e) {
			showToast(
				tr("listFailed", "Failed to load the list: {error}", {
					error: e.message,
				}),
			);
		}
		run();
	}

	// A sync stored a new list (in this tab or another)
	onMetaDbChange(load);

	/**
	 * Reload the list (on opening a page, after saving or renaming) from the copy, and sync the copy when idle; the new
	 * list then arrives through onMetaDbChange.
	 */
	async function refresh() {
		requestMetaDbSync();
		await load();
	}

	return {
		refresh,
		setQuery,
		set current(id) {
			state.current = id;
			list.current = id;
		},
	};
}
