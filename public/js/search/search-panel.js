// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Search box and conversation list of the sidebar, on every page (LCTYSP-0007, LCTYSP-0014, LCTYSP-0019).

import {
	getTags,
	onTagsOfConversationsChange,
	readTagsOfConversations,
} from "../api/lcty-t.js";
import { onMetaDbChange, readMetaDb } from "../api/meta-db.js";
import {
	fetchSnippets,
	listConversations,
	searchConversations,
} from "../api/storage.js";
import { tabRpc } from "../api/tab-rpc.js";
import { showToast } from "../common.js";
import { tr } from "../i18n.js";
import { tagPart, tagRef } from "../tag-names.js";
import { createVectorStore, embedQuery } from "./vectors.js";

const RRF_K = 60;

// The references of the defined tags in the order of their files (t_full), or [] when they cannot be read
async function tagOrder() {
	try {
		return (await getTags()).tags.map(tagRef);
	} catch {
		return [];
	}
}

// A conversation's tags in the order of the tags' files; undefined ones after them, as they were
function byOrder(tags, order) {
	const at = (t) => {
		const i = order.indexOf(t);
		return i < 0 ? order.length : i;
	};
	return [...tags].sort((a, b) => at(a) - at(b));
}

/** Wire the sidebar's search box to its conversation list. */
export function createSearchPanel({ list, box, status, rpc = tabRpc }) {
	const vectors = createVectorStore(); // One per page: each page creates one search panel
	// all: the list; stale: the copy is out of date; rounds: {convOf, roundOf, idsOf}, on demand
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

	// The messages each conversation owns and their rounds (message_rounds), only for semantic search
	async function rounds() {
		if (!state.rounds) {
			const list = await listConversations();
			const pairs = list.flatMap((c) =>
				(c.message_rounds || []).map(([m, r]) => [m, r, c.id]),
			);
			state.rounds = {
				idsOf: new Map(
					list.map((c) => [c.id, (c.message_rounds || []).map(([m]) => m)]),
				),
				convOf: new Map(pairs.map(([m, , cid]) => [m, cid])),
				roundOf: new Map(pairs.map(([m, r]) => [m, r])),
			};
		}
		return state.rounds;
	}

	// [[roundId, score], …], the best message of each round, and the map from a round to its conversation
	async function semantic(text, hasTags, filtered) {
		const [vec, { idsOf, convOf, roundOf }] = await Promise.all([
			embedQuery(rpc(), text),
			rounds(),
			vectors.refresh(),
		]);
		// With tag: filters, only the messages of the matching conversations are allowed
		const allow = filtered
			? state.all
					.filter((c) => hasTags(c.id))
					.flatMap((c) => idsOf.get(c.id) || [])
			: null;
		const found = await vectors.search(vec, 50, {
			allow,
			accept: (id) => hasTags(convOf.get(id)),
		});
		// A hit is a message (LCTYSP-0019): keyword search and snippets are by round, so each counts for its round
		const seen = new Set();
		const hits = [];
		for (const [id, score] of found) {
			const round = roundOf.get(id) ?? id;
			if (seen.has(round)) continue;
			seen.add(round);
			hits.push([round, score]);
		}
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
		let note = "";
		try {
			const [kw, sem] = await Promise.all([
				searchConversations({ q: text, tags, limit: 50 }).then(
					(r) => r.results,
				),
				semantic(text, hasTags, tags.length > 0).catch((e) => {
					note = tr(
						"semanticUnavailable",
						"Semantic search is unavailable ({error}); searching by keywords only",
						{ error: e.message },
					);
					return { hits: [], convOf: new Map() };
				}),
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

	// Read the list from the copies and show it (or rerun the search)
	async function load() {
		try {
			const [{ items, counts, stale }, { byCid }, order] = await Promise.all([
				readMetaDb(),
				readTagsOfConversations(),
				tagOrder(),
			]);
			state.all = items.map((m) => ({
				id: m.cid,
				title: m.title,
				updated_at_hint: m.updatedAt,
				messages: counts[m.cid],
				tags: byOrder(byCid.get(m.cid) ?? [], order),
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

	// This tab stored a change of the copies
	onMetaDbChange(load);
	onTagsOfConversationsChange(load);

	/** Reload the list from the copies (on opening a page, after saving or renaming). */
	async function refresh() {
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
