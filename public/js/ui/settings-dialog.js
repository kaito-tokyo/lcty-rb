// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Settings dialog: a modal <dialog> from the sidebar's ⚙︎ button that edits the browser settings (LCTYSP-0010).

import { getDefaults } from "../api/storage.js";
import { mergeSettings, showToast, storeSettings } from "../common.js";
import { tr } from "../i18n.js";

function el(tag, attrs = {}, ...children) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
	e.append(...children);
	return e;
}

function field(label, attrs) {
	return el(
		"label",
		{ class: "field" },
		el("span", {}, label),
		el("input", attrs),
	);
}

/** Builds the dialog (in <body>, so it is styled by lcty.v1.css on every page) and wires button to open it. */
export function initSettingsDialog(button) {
	const status = el("p", { class: "hint", role: "status" });
	const resetButton = el(
		"button",
		{ type: "button" },
		tr("resetDefaults", "Reset to defaults"),
	);
	const testButton = el(
		"button",
		{ type: "button" },
		tr("testConnection", "Test connection"),
	);
	const closeButton = el("button", { type: "button" }, tr("close", "Close"));
	const form = el(
		"form",
		{ class: "settings-form" },
		el("h2", {}, tr("settings", "Settings")),
		el(
			"p",
			{ class: "hint" },
			tr(
				"settingsHint",
				"Settings are stored in this browser. Only the items that differ from the defaults are stored; the rest follow the server's defaults. Saved settings take effect the next time a page loads.",
			),
		),
		field(tr("baseUrlLabel", "Server (llama-server)"), {
			type: "url",
			name: "base_url",
			required: "",
		}),
		field(tr("apiKeyLabel", "API key"), {
			type: "text",
			name: "api_key",
			autocomplete: "off",
			spellcheck: "false",
		}),
		field(tr("chatModelLabel", "Chat model"), {
			type: "text",
			name: "model",
			required: "",
			spellcheck: "false",
		}),
		field(
			tr(
				"embeddingModelLabel",
				"Embedding model (leave empty to turn off semantic search)",
			),
			{ type: "text", name: "embedding_model", spellcheck: "false" },
		),
		el(
			"div",
			{ class: "dialog-buttons" },
			el("button", { type: "submit", class: "primary" }, tr("save", "Save")),
			resetButton,
			testButton,
			el("span", { class: "spacer" }),
			closeButton,
		),
		status,
	);
	const dialog = el(
		"dialog",
		{ id: "settings-dialog", "aria-label": tr("settings", "Settings") },
		form,
	);
	document.body.append(dialog);
	closeButton.addEventListener("click", () => dialog.close());
	// A click on the backdrop (outside the form) closes it too
	dialog.addEventListener("click", (e) => {
		if (e.target === dialog) dialog.close();
	});

	let defaults = null;

	const fields = () =>
		[...form.elements].filter((e) => e.name && defaults && e.name in defaults);

	function fill(values) {
		for (const e of fields()) {
			if (e.type === "checkbox") e.checked = values[e.name];
			else e.value = values[e.name];
			const d = defaults[e.name];
			e.title = tr("defaultValue", "Default: {value}", {
				value:
					typeof d === "boolean"
						? d
							? tr("on", "on")
							: tr("off", "off")
						: d || tr("empty", "(empty)"),
			});
			if (e.type !== "checkbox") e.placeholder = String(d);
		}
	}

	function read() {
		return Object.fromEntries(
			fields().map((e) => [
				e.name,
				e.type === "checkbox" ? e.checked : e.value.trim(),
			]),
		);
	}

	// Each time it opens, the form shows the stored settings (discarding unsaved edits) and the defaults are refetched
	button.addEventListener("click", async () => {
		status.textContent = "";
		dialog.showModal();
		try {
			defaults = await getDefaults();
		} catch (err) {
			showToast(
				tr("defaultsLoadFailed", "Failed to load the defaults: {error}", {
					error: err.message,
				}),
			);
			return;
		}
		fill(mergeSettings(defaults));
	});

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		if (!defaults) return;
		const n = Object.keys(storeSettings(read(), defaults)).length;
		status.textContent = n
			? tr("settingsSaved", "Saved ({n} items differ from the defaults)", { n })
			: tr("settingsSavedDefaults", "Saved (all defaults)");
	});

	resetButton.addEventListener("click", () => {
		if (!defaults) return;
		storeSettings({}, defaults);
		fill(defaults);
		status.textContent = tr("settingsReset", "Reset to the defaults");
	});

	// Tests the values in the form (saved or not).
	testButton.addEventListener("click", async () => {
		if (!defaults) return;
		const v = read();
		try {
			status.textContent = tr("connecting", "Connecting…");
			const headers = v.api_key ? { Authorization: `Bearer ${v.api_key}` } : {};
			const r = await fetch(`${v.base_url.replace(/\/+$/, "")}/v1/models`, {
				headers,
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const ids = ((await r.json()).data || []).map((m) => m.id);
			const missing = [v.model, v.embedding_model].filter(
				(m) => m && !ids.includes(m),
			);
			status.textContent = tr("connected", "Connected: {models}{missing}", {
				models: ids.join(", ") || tr("noModelList", "(no model list)"),
				missing: missing.length
					? tr("missingModels", " (models not found: {models})", {
							models: missing.join(", "),
						})
					: "",
			});
		} catch (e) {
			status.textContent = tr("connectFailed", "Cannot connect: {error}", {
				error: e.message,
			});
		}
	});

	return dialog;
}
