// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Settings (/settings. LCTYSP-010). Edits the browser settings: defaults come from /v1/defaults.json, changes go to localStorage.

import { getDefaults } from "../api/storage.js";
import {
	loadSettings,
	mergeSettings,
	query,
	showToast,
	storeSettings,
} from "../common.js";
import { localize, tr } from "../i18n.js";
import { initSidebar } from "../ui/sidebar.js";

/** Starts /settings: called once by the page's entry (public/settings.js). */
export function initSettingsPage() {
	localize();
	const form = query("#settings-form");
	const status = query("#settings-status");
	let defaults = null;

	const fields = () =>
		[...form.elements].filter((el) => el.name && el.name in defaults);

	function fill(values) {
		for (const el of fields()) {
			if (el.type === "checkbox") el.checked = values[el.name];
			else el.value = values[el.name];
			const d = defaults[el.name];
			el.title = tr("defaultValue", "Default: {value}", {
				value:
					typeof d === "boolean"
						? d
							? tr("on", "on")
							: tr("off", "off")
						: d || tr("empty", "(empty)"),
			});
			if (el.type !== "checkbox") el.placeholder = String(d);
		}
	}

	function read() {
		return Object.fromEntries(
			fields().map((el) => [
				el.name,
				el.type === "checkbox" ? el.checked : el.value.trim(),
			]),
		);
	}

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const n = Object.keys(storeSettings(read(), defaults)).length;
		status.textContent = n
			? tr("settingsSaved", "Saved ({n} items differ from the defaults)", { n })
			: tr("settingsSavedDefaults", "Saved (all defaults)");
	});

	query("#settings-reset").addEventListener("click", () => {
		storeSettings({}, defaults);
		fill(defaults);
		status.textContent = tr("settingsReset", "Reset to the defaults");
	});

	// Tests the values in the form (saved or not).
	query("#settings-test").addEventListener("click", async () => {
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

	(async () => {
		try {
			defaults = await getDefaults();
		} catch (e) {
			showToast(
				tr("defaultsLoadFailed", "Failed to load the defaults: {error}", {
					error: e.message,
				}),
			);
			return;
		}
		fill(mergeSettings(defaults));
	})();

	// The sidebar shared by every page (LCTYSP-005)
	{
		let appSettings = null;
		const sidebarPanel = initSidebar(document.querySelector("lcty-sidebar"), {
			getSettings: () => appSettings,
		});
		loadSettings().then((s) => {
			appSettings = s;
			sidebarPanel.refresh();
		});
	}
}
