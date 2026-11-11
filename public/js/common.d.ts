// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Small helpers shared by every page (LCTYSP-0005).

/** One LLM backend of the settings. */
export interface Backend {
	id: string;
	label: string;
	base_url: string;
	api: string;
	api_key: string;
	model: string;
	embedding_model: string;
	extra: Record<string, unknown>;
}

/** The settings in the shape the pages use. */
export interface AppSettings {
	backends: Backend[];
	default_backend: string;
}

/** The first element matching the selector s, or null (document.querySelector). */
export function query(s: string): Element | null;

/** The current local time as ISO 8601 with seconds and the UTC offset (2026-11-12T09:30:00+09:00). */
export function nowIso(): string;

/** A new conversation id: the local time YYYYMMDD-HHMMSS and four random hex digits (20261112-093000-1a2b). */
export function newConvId(): string;

/** A new message id: a UUIDv7 (LCTYSP-0003). */
export function newMsgId(): string;

/** Shows msg in the #toast status element (created in <body> when missing) for four seconds. */
export function showToast(msg: string): void;

/** The backend with id (the default backend when id is not given), or the first backend when there is none. */
export function backendOf(settings: AppSettings, id?: string | null): Backend;

/**
 * The URL (href) of a conversation, c/<id>.html of the site (LCTYSP-0005). msgId links to the message element itself
 * (id="c-msg-<UUIDv7>", LCTYSP-0003).
 */
export function convUrl(id: string, msgId?: string | null): string;

/**
 * Index registration (LCTYSP-0007): the page's indexer, configured from the embedding model of getSettings()'s
 * default backend (nothing is indexed while getSettings() is null). Every page calls kick() after saving and on open.
 * Only the first failure is shown, as a toast.
 */
export function appIndexer(getSettings: () => AppSettings | null): {
	kick(): Promise<void>;
};

// Settings (LCTYSP-0010): the server only provides defaults (/v1/defaults.json). Changes made on /settings are kept in
// localStorage (key "lcty.settings.v1", SETTINGS_KEY), and only the values that differ from the defaults are stored,
// so changed defaults still apply to everything left untouched.

/**
 * Store values, keeping only the keys of defaults whose value differs from the default; the key is removed when
 * nothing differs. Returns what was stored.
 */
export function storeSettings(
	values: Record<string, unknown>,
	defaults: Record<string, unknown>,
): Record<string, unknown>;

/**
 * Defaults overlaid with the stored changes (stored defaults to what localStorage holds). Keys the defaults do not
 * know, or values of another type, are ignored.
 */
export function mergeSettings<T extends Record<string, unknown>>(
	defaults: T,
	stored?: Record<string, unknown>,
): T;

/**
 * The settings: the server's defaults overlaid with the stored changes, in the shape the pages use. Resolves to null
 * (after a toast) when the defaults cannot be loaded.
 */
export function loadSettings(): Promise<AppSettings | null>;

// Internals:
// - pad(n, w) pads n with zeros to w digits (2 by default); hex(n) gives n random bytes as hex.
// - state.toastTimer is the timer that hides the toast.
// - storedSettings() gives the stored changes ({} when none or unreadable).
// - toAppSettings(v) turns the flat settings into the shape the pages use: one backend, "local" (llama-server,
//   Responses API).
