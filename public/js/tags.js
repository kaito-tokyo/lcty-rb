// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Tags and memory: the system prompt draft, the tag editor and memory proposals (LCTYSP-0009).

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

/** Draws the editor for tag definitions (all, or only the tag in file) into container. */
export function renderTagsEditor(
	container,
	{ defs, etag, onSaved, toast, file },
) {
	let saved = structuredClone(defs);
	let work = structuredClone(saved);
	let version = etag;
	const single = file !== undefined;
	let currentFile = file;
	let current = single ? work.find((t) => t.file === currentFile) : null;
	const list = el("div", { class: "tags-edit" });
	const status = el("p", { class: "hint" });
	// Takes work anew (after a reload or a save): the tag shown on a tag file's page is found again by its file
	const reset = (tags) => {
		work = structuredClone(tags);
		if (single) current = work.find((t) => t.file === currentFile);
	};

	const render = () => {
		const deleteButton = (t, i) =>
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
						if (single) save();
					},
				},
				tr("delete", "Delete"),
			);
		if (single && !current) {
			list.replaceChildren(
				el(
					"p",
					{ class: "hint" },
					tr(
						"tagFileGone",
						"This tag is not in the tags any more: it was renamed or deleted.",
					),
				),
			);
			return;
		}
		list.replaceChildren(
			...work
				.flatMap((t, i) => (single && t !== current ? [] : [[t, i]]))
				.map(([t, i]) => {
					// A file without <lcty-t>: shown with its name, not editable
					if (t.invalid)
						return el(
							"section",
							{ class: "tag-edit tag-invalid" },
							el(
								"div",
								{ class: "tag-edit-head" },
								el("span", { class: "tag-chip" }, t.name),
								deleteButton(t, i),
							),
							el(
								"p",
								{ class: "hint" },
								tr(
									"invalidTagFile",
									"The tag file {file} cannot be read (it has no <lcty-t>), so it cannot be edited here. Fix or delete the file in t/ of the data directory.",
									{ file: t.file },
								),
							),
						);
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
							deleteButton(t, i),
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
								open:
									(t.memory || []).length > 0 && (t.memory || []).length <= 5,
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
		const bad = work.find((t) => !t.invalid && tagNameError(t.name));
		if (bad !== undefined) {
			status.textContent = tr(
				"badTagName",
				'The tag name "{name}" cannot be used (1 to 40 characters, no spaces, control characters or : ; / " \' ` ~ \\ |)',
				{ name: bad.name },
			);
			return;
		}
		// Names with the same part are one tag (one file); an invalid tag's part is its file's
		const parts = work.map((t) => (t.invalid ? tagRef(t) : tagPart(t.name)));
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
				reset(saved);
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
		// The shown tag's file after the save: tags is in the order of work
		if (single) {
			const i = work.indexOf(current);
			currentFile = i < 0 ? null : tags[i].file;
		}
		try {
			// Take timestamps etc. from the saved values; the ETag is the one this GET read them with
			({ tags: saved, etag: version } = await getTags());
		} catch {
			saved = tags; // Saved: keep what was sent, with the ETag PUT returned
		}
		reset(saved);
		onSaved(structuredClone(saved), { file: currentFile });
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
			single
				? null
				: el(
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
							reset(saved);
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

/** Builds the tags dialog, wires button to open it, and returns open(). */
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
	// Opens the editor on the saved definitions, read again from the browser's copy
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

/** Asks the model for memory proposals for the conversation's defined tags, as a temporary continuation. */
export async function proposeMemory({ conv, backend, defs, signal }) {
	const chosen = conv.tags
		.map((ref) => defs.find((d) => tagRef(d) === ref))
		.filter((d) => d && !d.invalid);
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

/** A dialog to accept, edit or discard each proposal, which adds the approved ones. */
export function openMemoryDialog({
	dialog = document.querySelector("#memory-dialog"),
	proposals,
	tags,
	source,
	onDone,
	toast,
}) {
	const items = proposals.map((p) => ({ ...p, keep: true }));
	// Every element has a part (BEM, the block lcty-memory), for lcty-c::part(…)
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
