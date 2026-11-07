// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tags and memory (LCTYSP-0009). A tag is a file t/NNNNN-<part>.html on the server: {file, name, ops, prompt,
// memory}. NNNNN is the draft order, <part> is derived from the display name here (all Unicode handling is the
// browser's; the server only checks file names mechanically), and conversations refer to a tag by its part.
//  - (the name rules, file names and references are in tag-names.js)
//  - composeDraft: builds a system prompt draft from the chosen tags (deterministic)
//  - renderTagsEditor / initTagsDialog: editor for tag definitions and memory, in the tags dialog opened from the sidebar
//  - proposeMemory / openMemoryDialog: gets memory proposals from a conversation and adds only the approved ones

import { addMemory, getTags, putTags } from "./api/lcty-t.js";
import { tr } from "./i18n.js";
import { stream } from "./llm/client.js";
import { buildRequest } from "./llm/history.js";
import { siteUrl } from "./site.js";
import { assignFileNames, tagNameError, tagPart, tagRef } from "./tag-names.js";

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

/** Draft = for each chosen tag in file order, its prompt followed by a "# Memory (name)" bullet list (LCTYSP-0009). */
export function composeDraft(defs, selected) {
	const set = new Set(selected);
	const parts = [];
	for (const t of defs) {
		if (!set.has(tagRef(t))) continue;
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
 * Draws the editor for tag definitions (name, prompt, memory) into container: defs and etag are what GET /v1/tags
 * returned. The order is changed on the reorder page (/t/), not here. Calls onSaved(new definitions) after saving.
 * Returns { isDirty }: whether there are unsaved edits.
 */
export function renderTagsEditor(container, { defs, etag, onSaved, toast }) {
	let saved = structuredClone(defs);
	let work = structuredClone(saved);
	let version = etag;
	const list = el("div", { class: "tags-edit" });
	const status = el("p", { class: "hint" });

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
		const bad = work.find((t) => tagNameError(t.name));
		if (bad !== undefined) {
			status.textContent = tr(
				"badTagName",
				'The tag name "{name}" cannot be used (1 to 40 characters, no spaces, control characters or : ; / " \' ` ~ \\ |)',
				{ name: bad.name },
			);
			return;
		}
		// Names that differ only in case or in the escaped form are one tag (one file)
		const parts = work.map((t) => tagPart(t.name));
		if (new Set(parts).size !== parts.length) {
			status.textContent = tr("duplicateTagName", "Tag names must be unique");
			return;
		}
		// Blank memory items are left out of what is sent; the editor keeps them until the save succeeds
		let tags;
		try {
			tags = assignFileNames(
				work.map((t) => ({
					...t,
					name: t.name.normalize("NFC"),
					memory: (t.memory || []).filter((m) => m.text.trim()),
				})),
			);
		} catch {
			status.textContent = tr(
				"tagNumbersFull",
				"There is no number left for a new tag. Renumber the tags on the reorder page first.",
			);
			return;
		}
		try {
			version = await putTags(tags, version);
		} catch (e) {
			if (e.status === 412) {
				// Changed in another tab meanwhile: take the new state; the user redoes the edit on it
				try {
					({ tags: saved, etag: version } = await getTags());
				} catch (err) {
					// The edits are kept; saving again gets 412 until the tags can be loaded
					status.textContent = tr(
						"tagsLoadFailed",
						"Failed to load the tags: {error}",
						{ error: err.message },
					);
					return;
				}
				work = structuredClone(saved);
				render();
				status.textContent = tr(
					"tagsChangedElsewhere",
					"The tags were changed elsewhere, so they were loaded again. Make the edit again.",
				);
				return;
			}
			status.textContent = tr("saveFailedShort", "Could not save: {error}", {
				error: e.message,
			});
			return;
		}
		try {
			// Take timestamps etc. from the saved values; the ETag is the one this GET read them with
			({ tags: saved, etag: version } = await getTags());
		} catch {
			saved = tags; // Saved: keep what was sent, with the ETag PUT returned
		}
		work = structuredClone(saved);
		onSaved(structuredClone(saved));
		status.textContent = "";
		render();
		toast(tr("tagsSaved", "Tags saved"));
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
				" ",
				el(
					"a",
					{ class: "tags-reorder", href: siteUrl("t/") },
					tr("reorderTags", "Change the order"),
				),
			),
			list,
			el(
				"button",
				{
					type: "button",
					onclick: () => {
						work.push({
							file: null,
							name: "",
							ops: [],
							prompt: "",
							memory: [],
						});
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

/**
 * Builds the tags dialog (a modal <dialog id="tags-dialog"> in <body>, so lcty.v1.css styles it on every page) and wires
 * button to open it; the sidebar's tag button opens it on every page. onSaved(new definitions) is called after each
 * save. Returns open(), for other buttons that open the same dialog.
 */
export function initTagsDialog(button, { onSaved, toast }) {
	let editor = null; // { isDirty } of the editor while the dialog is open
	const close = el("button", { type: "button" }, tr("close", "Close"));
	const body = el("div");
	const dialog = el(
		"dialog",
		{ id: "tags-dialog", "aria-label": tr("editTags", "Edit tags") },
		el(
			"div",
			{ class: "dialog-buttons" },
			el("h2", {}, tr("tags", "Tags")),
			el("span", { class: "spacer" }),
			close,
		),
		body,
	);
	document.body.append(dialog);
	// Closing with unsaved edits asks first (the close button, Esc and a click on the backdrop)
	const tryClose = () => {
		if (
			editor?.isDirty() &&
			!confirm(
				tr(
					"confirmCloseTags",
					"Close without saving? The unsaved changes are discarded.",
				),
			)
		)
			return;
		dialog.close();
	};
	close.addEventListener("click", tryClose);
	dialog.addEventListener("cancel", (e) => {
		e.preventDefault();
		tryClose();
	});
	dialog.addEventListener("click", (e) => {
		if (e.target === dialog) tryClose();
	});
	// Opens the editor on the saved definitions, read again from the browser's copy (another tab of this browser may
	// have changed them meanwhile; a change made elsewhere makes the save fail with 412, which loads the new set)
	const open = async () => {
		let defs;
		let etag;
		try {
			({ tags: defs, etag } = await getTags());
		} catch (e) {
			toast(
				tr("tagsLoadFailed", "Failed to load the tags: {error}", {
					error: e.message,
				}),
			);
			return;
		}
		editor = renderTagsEditor(body, { defs, etag, toast, onSaved });
		dialog.showModal();
	};
	button.addEventListener("click", open);
	return open;
}

// ---- Memory proposals (LCTYSP-0009) ----

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
 * The prefix is identical to the previous state, so the cache applies. The conversation's tags are references; the
 * model sees and answers with the display names of the defined ones, and each proposal carries the file of its tag.
 * Returns {proposals: [{tag, file, text}], tags: [{name, file}], timings}.
 */
export async function proposeMemory({ conv, backend, defs, signal }) {
	const chosen = conv.tags
		.map((ref) => defs.find((d) => tagRef(d) === ref))
		.filter(Boolean);
	const tags = chosen.map((d) => d.name);
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
	// The reply must be an object whose proposals, when present, is a list; entries that are not proposals are skipped
	const isObject = (v) =>
		v !== null && typeof v === "object" && !Array.isArray(v);
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = undefined;
	}
	if (
		!isObject(parsed) ||
		(parsed.proposals != null && !Array.isArray(parsed.proposals))
	)
		throw new Error(
			tr("proposalNotJson", "Could not read the proposal as JSON"),
		);
	const proposals = (parsed.proposals || [])
		.filter(
			(p) =>
				isObject(p) &&
				tags.includes(p.tag) &&
				typeof p.text === "string" &&
				p.text.trim(),
		)
		.map((p) => ({
			tag: p.tag,
			file: chosen.find((d) => d.name === p.tag).file,
			text: p.text.trim(),
		}));
	return {
		proposals,
		tags: chosen.map(({ name, file }) => ({ name, file })),
		timings,
	};
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
								onchange: (e) => (it.file = e.target.value),
							},
							tags.map((t) =>
								el(
									"option",
									{ value: t.file, selected: t.file === it.file },
									t.name,
								),
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
				await addMemory(it.file, { text: it.text.trim(), source });
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
