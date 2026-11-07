// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Small helpers shared by every page (LCTYSP-0005).

import { getDefaults } from "./api/storage.js";
import { tr } from "./i18n.js";
import { createIndexer, embeddingConfig } from "./search/embed.js";
import { siteUrl } from "./site.js";
import { uuidv7 } from "./uuid.js";

export function query(s) {
	return document.querySelector(s);
}

function pad(n, w = 2) {
	return String(n).padStart(w, "0");
}

export function nowIso() {
	const d = new Date();
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
	);
}

function hex(n) {
	return crypto
		.getRandomValues(new Uint8Array(n))
		.reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
}

export function newConvId() {
	const d = new Date();
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${hex(2)}`;
}

export function newMsgId() {
	return uuidv7();
}

const state = { toastTimer: 0 };
export function showToast(msg) {
	let t = query("#toast");
	if (!t) {
		t = document.createElement("div");
		t.id = "toast";
		t.setAttribute("role", "status");
		document.body.append(t);
	}
	t.textContent = msg;
	t.hidden = false;
	clearTimeout(state.toastTimer);
	state.toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

export function backendOf(settings, id) {
	return (
		settings.backends.find((b) => b.id === (id || settings.default_backend)) ||
		settings.backends[0]
	);
}

// The URL of a conversation, c/<id>.html of the site (LCTYSP-0005). msgId links to the message element itself
// (id="c-msg-<UUIDv7>". LCTYSP-0003)
export function convUrl(id, msgId) {
	return siteUrl(
		`c/${encodeURIComponent(id)}.html${msgId ? `#c-msg-${msgId}` : ""}`,
	).href;
}

/** Index registration (LCTYSP-0007). Every page calls kick() after saving and on open. */
export function appIndexer(getSettings) {
	let shown = false;
	return createIndexer({
		getConfig: () => {
			const s = getSettings();
			return s ? embeddingConfig(backendOf(s)) : null;
		},
		onError: (e) => {
			if (shown) return;
			shown = true;
			showToast(
				tr("indexFailed", "Failed to index: {error}", { error: e.message }),
			);
		},
	});
}

// ---- Settings (LCTYSP-0010) ----
// The server only provides defaults (/v1/defaults.json). Changes made on /settings are kept in localStorage, and only the
// values that differ from the defaults are stored, so changed defaults still apply to everything left untouched.
const SETTINGS_KEY = "lcty.settings.v1";

/** The stored changes ({} when none or unreadable). */
function storedSettings() {
	try {
		const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
		return v && typeof v === "object" && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}

/** Store values, keeping only the keys whose value differs from defaults. Returns what was stored. */
export function storeSettings(values, defaults) {
	const diff = Object.fromEntries(
		Object.keys(defaults)
			.filter((k) => k in values && values[k] !== defaults[k])
			.map((k) => [k, values[k]]),
	);
	if (Object.keys(diff).length)
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(diff));
	else localStorage.removeItem(SETTINGS_KEY);
	return diff;
}

/** Defaults overlaid with the stored changes. Keys the defaults do not know, or values of another type, are ignored. */
export function mergeSettings(defaults, stored = storedSettings()) {
	return Object.fromEntries(
		Object.entries(defaults).map(([k, d]) => [
			k,
			k in stored && typeof stored[k] === typeof d ? stored[k] : d,
		]),
	);
}

/** Flat settings → the shape the pages use (one backend). */
function toAppSettings(v) {
	return {
		backends: [
			{
				id: "local",
				label: "llama-server",
				base_url: v.base_url,
				api: "responses",
				api_key: v.api_key,
				model: v.model,
				embedding_model: v.embedding_model,
				extra: {},
			},
		],
		default_backend: "local",
	};
}

export async function loadSettings() {
	try {
		return toAppSettings(mergeSettings(await getDefaults()));
	} catch (e) {
		showToast(
			tr("settingsLoadFailed", "Failed to load the settings: {error}", {
				error: e.message,
			}),
		);
		return null;
	}
}
