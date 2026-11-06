// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tags and memory (LCTYSP-009).
//  - composeDraft: builds a system prompt draft from the chosen tags (deterministic)
//  - renderTagsEditor: editor for tag definitions and memory (the new page's tags dialog)
//  - proposeMemory / openMemoryDialog: gets memory proposals from a conversation and adds only the approved ones

import { addMemory, getTags, putTags } from "./api/storage.js";
import { tr } from "./i18n.js";
import { stream } from "./llm/client.js";
import { buildRequest } from "./llm/history.js";

function el(tag, props = {}, ...children) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "class") e.className = v;
		else if (k === "dataset") Object.assign(e.dataset, v);
		else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
		else if (v !== undefined && v !== null && v !== false)
			e.setAttribute(k, v === true ? "" : v);
	}
	e.append(...children.flat().filter((c) => c !== null && c !== undefined));
	return e;
}

const TAG_NAME_RE = /^[^\s:]{1,40}$/;

/** Sort by the order of the tag definitions (tags without a definition go last, in the given order). */
export function sortTags(defs, names) {
	const order = new Map(defs.map((t, i) => [t.name, i]));
	return [...new Set(names)].sort(
		(a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9),
	);
}

/** Draft = for each chosen tag in definition order, its prompt followed by a "# Memory (name)" bullet list (LCTYSP-009). */
export function composeDraft(defs, selected) {
	const set = new Set(selected);
	const parts = [];
	for (const t of defs) {
		if (!set.has(t.name)) continue;
		const p = (t.prompt || "").trim();
		if (p) parts.push(p);
		const mem = (t.memory || []).map((m) => m.text.trim()).filter(Boolean);
		if (mem.length)
			parts.push(
				`# ${tr("memoryHeading", "Memory ({name})", { name: t.name })}\n${mem.map((x) => `- ${x}`).join("\n")}`,
			);
	}
	return parts.join("\n\n");
}

// ---- Tag editor ----

/**
 * Draws the editor for tag definitions (name, prompt, memory) into container. Calls onSaved(new definitions) after
 * saving. Returns { isDirty }: whether there are unsaved edits.
 */
export function renderTagsEditor(container, { defs, onSaved, toast }) {
	let saved = structuredClone(defs);
	let work = structuredClone(saved);
	const list = el("div", { class: "tags-edit" });
	const status = el("p", { class: "hint" });

	const swap = (a, b) => {
		[work[a], work[b]] = [work[b], work[a]];
		render();
	};
	const render = () => {
		list.replaceChildren(
			...work.map((t, i) => {
				const memList = el(
					"ul",
					{ class: "mem-list" },
					(t.memory || []).map((m, k) =>
						el(
							"li",
							{},
							el(
								"textarea",
								{ rows: 2, oninput: (e) => (m.text = e.target.value) },
								m.text,
							),
							el(
								"button",
								{
									type: "button",
									class: "danger",
									onclick: () => {
										t.memory.splice(k, 1);
										render();
									},
								},
								tr("delete", "Delete"),
							),
						),
					),
				);
				const memChars = (t.memory || []).reduce(
					(s, m) => s + m.text.length,
					0,
				);
				return el(
					"section",
					{ class: "tag-edit" },
					el(
						"div",
						{ class: "tag-edit-head" },
						el("input", {
							type: "text",
							value: t.name,
							"aria-label": tr("tagName", "Tag name"),
							oninput: (e) => (t.name = e.target.value.trim()),
						}),
						el(
							"button",
							{
								type: "button",
								disabled: i === 0,
								onclick: () => swap(i - 1, i),
							},
							"↑",
						),
						el(
							"button",
							{
								type: "button",
								disabled: i === work.length - 1,
								onclick: () => swap(i, i + 1),
							},
							"↓",
						),
						el(
							"button",
							{
								type: "button",
								class: "danger",
								onclick: () => {
									const msg = tr(
										"confirmDeleteTag",
										'Delete the tag "{name}"? (Conversations keep the tag name.)',
										{ name: t.name },
									);
									if (!confirm(msg)) return;
									work.splice(i, 1);
									render();
								},
							},
							tr("delete", "Delete"),
						),
					),
					el(
						"label",
						{ class: "field" },
						el(
							"span",
							{},
							tr(
								"tagPromptLabel",
								"System prompt (also write here what to remember)",
							),
						),
						el(
							"textarea",
							{ rows: 3, oninput: (e) => (t.prompt = e.target.value) },
							t.prompt || "",
						),
					),
					el(
						"details",
						{
							open: (t.memory || []).length > 0 && (t.memory || []).length <= 5,
						},
						el(
							"summary",
							{},
							tr(
								"memorySummary",
								"Memory ({count} items, about {chars} characters)",
								{
									count: (t.memory || []).length,
									chars: memChars.toLocaleString(),
								},
							),
						),
						memList,
					),
				);
			}),
		);
	};

	const save = async () => {
		const names = work.map((t) => t.name);
		const bad = names.find((n) => !TAG_NAME_RE.test(n));
		if (bad !== undefined) {
			status.textContent = tr(
				"badTagName",
				'The tag name "{name}" cannot be used (no spaces or ":", up to 40 characters)',
				{ name: bad },
			);
			return;
		}
		if (new Set(names).size !== names.length) {
			status.textContent = tr("duplicateTagName", "Tag names must be unique");
			return;
		}
		for (const t of work)
			t.memory = (t.memory || []).filter((m) => m.text.trim());
		try {
			await putTags({ tags: work });
			saved = (await getTags()).tags; // Take timestamps etc. from the saved values
			work = structuredClone(saved);
			onSaved(structuredClone(saved));
			status.textContent = "";
			render();
			toast(tr("tagsSaved", "Tags saved"));
		} catch (e) {
			status.textContent = tr("saveFailedShort", "Could not save: {error}", {
				error: e.message,
			});
		}
	};

	render();
	container.replaceChildren(
		el(
			"form",
			{ class: "tags-form", onsubmit: (e) => e.preventDefault() },
			el(
				"p",
				{ class: "hint" },
				tr(
					"tagsHint",
					"The order is the order in which the system prompt draft joins them. Changing prompts or memory does not affect conversations already started.",
				),
			),
			list,
			el(
				"button",
				{
					type: "button",
					onclick: () => {
						work.push({ name: "", prompt: "", memory: [] });
						render();
					},
				},
				tr("newTag", "+ New tag"),
			),
			status,
			el(
				"div",
				{ class: "dialog-buttons" },
				el("span", { class: "spacer" }),
				el(
					"button",
					{
						type: "button",
						onclick: () => {
							if (
								!confirm(
									tr(
										"confirmDiscard",
										"Discard the changes and go back to the saved state?",
									),
								)
							)
								return;
							work = structuredClone(saved);
							status.textContent = "";
							render();
						},
					},
					tr("discardChanges", "Discard changes"),
				),
				el(
					"button",
					{ type: "button", class: "primary", onclick: save },
					tr("save", "Save"),
				),
			),
		),
	);
	return { isDirty: () => JSON.stringify(work) !== JSON.stringify(saved) };
}

// ---- Memory proposals (LCTYSP-009) ----

function proposalSchema(tags) {
	return {
		type: "object",
		properties: {
			proposals: {
				type: "array",
				items: {
					type: "object",
					properties: {
						tag: { type: "string", enum: tags },
						text: { type: "string" },
					},
					required: ["tag", "text"],
				},
			},
		},
		required: ["proposals"],
	};
}

function proposalPrompt(defs, tags) {
	const lines = tags.map((name) => {
		const t = defs.find((d) => d.name === name);
		const mem =
			(t?.memory || []).map((m) => `  - ${m.text}`).join("\n") ||
			`  ${tr("noMemoryYet", "(none yet)")}`;
		return `- ${tr("currentMemory", 'Current memory of the tag "{name}":', { name })}\n${mem}`;
	});
	return [
		tr(
			"proposalPrompt1",
			"From this conversation so far, propose what should be added to the memory of the following tags.",
		),
		tr(
			"proposalPrompt2",
			"Follow the policy written in each system prompt about what to remember. For a tag without a policy, you need not propose anything.",
		),
		tr(
			"proposalPrompt3",
			"Do not propose what is already in memory or what matters only for this conversation. Write each item in one or two sentences that can be understood on their own.",
		),
		tr(
			"proposalPrompt4",
			"If there is nothing to add, make proposals an empty array.",
		),
		"",
		...lines,
	].join("\n");
}

/**
 * As a continuation of the current conversation, append one temporary user message asking for proposals (not saved to the conversation).
 * The prefix is identical to the previous state, so the cache applies.
 */
export async function proposeMemory({ conv, backend, defs, signal }) {
	const tags = conv.tags.filter((n) => defs.some((d) => d.name === n));
	if (!tags.length)
		throw new Error(
			tr("noDefinedTags", "The conversation has no defined tags"),
		);
	const req = buildRequest({ ...conv.meta, messages: conv.messages });
	req.input.push({ role: "user", content: proposalPrompt(defs, tags) });
	const extraBody = {
		response_format: {
			type: "json_schema",
			json_schema: { name: "memory_proposals", schema: proposalSchema(tags) },
		},
	};
	let text = "";
	let timings = null;
	for await (const ev of stream({ backend, ...req, extraBody, signal })) {
		if (ev.type === "text") text += ev.delta;
		else if (ev.type === "done") timings = ev.timings;
		else if (ev.type === "error") throw new Error(ev.message);
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(
			tr("proposalNotJson", "Could not read the proposal as JSON"),
		);
	}
	const proposals = (parsed.proposals || [])
		.filter(
			(p) =>
				tags.includes(p.tag) && typeof p.text === "string" && p.text.trim(),
		)
		.map((p) => ({ tag: p.tag, text: p.text.trim() }));
	return { proposals, tags, timings };
}

/** A dialog to accept / edit and accept / discard each proposal. Adds the approved ones. */
export function openMemoryDialog({
	dialog = document.querySelector("#memory-dialog"),
	proposals,
	tags,
	source,
	onDone,
	toast,
}) {
	const items = proposals.map((p) => ({ ...p, keep: true }));
	// Every element has a part (BEM, the block lcty-memory): the dialog is in <lcty-c>'s Shadow DOM, styled from the page
	// with lcty-c::part(…)
	const status = el("p", { part: "lcty-memory__hint" });
	const list = el(
		"div",
		{ part: "lcty-memory__proposals" },
		items.length
			? items.map((it) =>
					el(
						"div",
						{ part: "lcty-memory__proposal" },
						el(
							"label",
							{ part: "lcty-memory__adopt" },
							el("input", {
								type: "checkbox",
								checked: true,
								onchange: (e) => (it.keep = e.target.checked),
							}),
							tr("adopt", "Adopt"),
						),
						el(
							"select",
							{
								part: "lcty-memory__tag",
								onchange: (e) => (it.tag = e.target.value),
							},
							tags.map((t) =>
								el("option", { value: t, selected: t === it.tag }, t),
							),
						),
						el(
							"textarea",
							{
								part: "lcty-memory__text",
								rows: 2,
								oninput: (e) => (it.text = e.target.value),
							},
							it.text,
						),
					),
				)
			: el(
					"p",
					{ part: "lcty-memory__hint" },
					tr("nothingToAdd", "Nothing to add was found."),
				),
	);
	const approve = async () => {
		const chosen = items.filter((it) => it.keep && it.text.trim());
		try {
			for (const it of chosen)
				await addMemory(it.tag, { text: it.text.trim(), source });
			dialog.close();
			onDone();
			toast(
				chosen.length
					? tr("memoryAdded", "Added {n} items to memory", { n: chosen.length })
					: tr("nothingAdded", "Nothing was added"),
			);
		} catch (e) {
			status.textContent = tr("addFailed", "Could not add: {error}", {
				error: e.message,
			});
		}
	};
	dialog.replaceChildren(
		el(
			"form",
			{
				method: "dialog",
				part: "lcty-memory__form",
				onsubmit: (e) => e.preventDefault(),
			},
			el(
				"h2",
				{ part: "lcty-memory__title" },
				tr("memoryProposals", "Memory proposals"),
			),
			el(
				"p",
				{ part: "lcty-memory__hint" },
				tr(
					"memoryProposalsHint",
					"Only the adopted items are added to the tag memory. The system prompt of this conversation does not change (it takes effect from the next conversation).",
				),
			),
			list,
			status,
			el(
				"div",
				{ part: "lcty-memory__buttons" },
				el("span", { part: "lcty-memory__spacer" }),
				el(
					"button",
					{
						type: "button",
						part: "lcty-button",
						onclick: () => dialog.close(),
					},
					tr("close", "Close"),
				),
				items.length
					? el(
							"button",
							{
								type: "button",
								part: "lcty-button lcty-button--primary",
								onclick: approve,
							},
							tr("addAdopted", "Add the adopted items"),
						)
					: null,
			),
		),
	);
	dialog.showModal();
}
