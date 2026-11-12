// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Markdown → HTML (pure functions, no DOM), split into blocks for streaming rendering (LCTYSP-0005).
import { tr } from "../i18n.js";

const RE_BLANK = /^[ \t]*$/;
const RE_FENCE = /^( {0,3})(`{3,}|~{3,})([^`]*)$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const RE_QUOTE = /^ {0,3}>/;
const RE_TABLE_SEP = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

function leading(s) {
	return s.length - s.trimStart().length;
}

function isFenceClose(line, fence) {
	const t = fence.nested ? line.trimStart() : line.replace(/^ {0,3}/, "");
	const m = /^(`{3,}|~{3,})[ \t]*$/.exec(t);
	return !!m && m[1][0] === fence.ch && m[1].length >= fence.len;
}

/** Split src into blocks. */
export function scanBlocks(src, final = true) {
	const blocks = [];
	const safe = final ? src.length : src.lastIndexOf("\n") + 1;
	let cur = null;
	let fence = null;
	let pos = 0;

	const open = (kind, start) =>
		(cur = {
			kind,
			start,
			end: start,
			lines: [],
			completeAt: null,
			blank: false,
		});
	const close = (at) => {
		if (!cur) return;
		cur.completeAt = at;
		blocks.push(cur);
		cur = null;
	};
	const add = (line, end) => {
		cur.lines.push(line);
		cur.end = end;
	};

	while (pos < src.length) {
		const nl = src.indexOf("\n", pos);
		const lineEnd = nl < 0 ? src.length : nl + 1;
		let line = src.slice(pos, nl < 0 ? src.length : nl);
		if (line.endsWith("\r")) line = line.slice(0, -1);
		const start = pos;
		pos = lineEnd;

		if (fence) {
			add(line, lineEnd);
			if (isFenceClose(line, fence)) {
				fence = null;
				if (cur.kind === "fence") close(lineEnd);
			}
			continue;
		}

		if (RE_BLANK.test(line)) {
			if (cur && cur.kind === "list") {
				add("", lineEnd);
				cur.blank = true;
			} else {
				close(lineEnd);
			}
			continue;
		}

		if (cur && cur.kind === "list") {
			const isItem = RE_LIST.test(line) && !RE_HR.test(line);
			if (leading(line) > 0 || isItem) {
				const fm = /^(`{3,}|~{3,})/.exec(line.trimStart());
				if (fm && leading(line) > 0)
					fence = { ch: fm[1][0], len: fm[1].length, nested: true };
				add(line, lineEnd);
				cur.blank = false;
				continue;
			}
			const structural =
				RE_FENCE.test(line) ||
				RE_HEADING.test(line) ||
				RE_HR.test(line) ||
				RE_QUOTE.test(line);
			if (!cur.blank && !structural) {
				add(line, lineEnd); // Lazy continuation line (continues the previous item)
				continue;
			}
			close(lineEnd);
		}

		const fm = RE_FENCE.exec(line);
		if (fm) {
			close(lineEnd);
			open("fence", start);
			fence = {
				ch: fm[2][0],
				len: fm[2].length,
				indent: fm[1].length,
				nested: false,
			};
			add(line, lineEnd);
			continue;
		}
		if (RE_HR.test(line) || RE_HEADING.test(line)) {
			close(lineEnd);
			blocks.push({
				kind: RE_HR.test(line) ? "hr" : "heading",
				start,
				end: lineEnd,
				lines: [line],
				completeAt: lineEnd,
			});
			continue;
		}
		if (RE_QUOTE.test(line)) {
			if (cur && cur.kind !== "quote") close(lineEnd);
			if (!cur) open("quote", start);
		} else if (RE_LIST.test(line)) {
			close(lineEnd);
			open("list", start);
		} else if (!cur) {
			open("para", start);
		} else if (
			cur.kind === "para" &&
			cur.lines.length === 1 &&
			RE_TABLE_SEP.test(line) &&
			cur.lines[0].includes("|")
		) {
			cur.kind = "table";
		} else if (cur.kind === "table" && !line.includes("|")) {
			close(lineEnd);
			open("para", start);
		}
		add(line, lineEnd);
	}
	if (cur) {
		cur.completeAt = final ? src.length : null;
		blocks.push(cur);
	}
	let ok = true;
	for (const b of blocks) {
		ok = ok && b.completeAt !== null && b.completeAt <= safe;
		b.complete = ok;
	}
	return blocks;
}

export function renderMarkdown(src, opts = {}) {
	return scanBlocks(src, true)
		.map((b) => renderBlock(b, opts))
		.join("");
}

/** Parts of a code block (also used for incremental rendering while streaming). */
export function fenceParts(block) {
	const m = RE_FENCE.exec(block.lines[0]) || ["", "", "```", ""];
	const indent = m[1].length;
	const lang = m[3].trim().split(/\s+/)[0] || "";
	const fence = { ch: m[2][0], len: m[2].length, nested: false };
	let body = block.lines.slice(1);
	const closed = body.length > 0 && isFenceClose(body[body.length - 1], fence);
	if (closed) body = body.slice(0, -1);
	if (indent)
		body = body.map((l) => l.replace(new RegExp(`^ {0,${indent}}`), ""));
	return { lang, code: body.join("\n"), closed };
}

export function codeBlockHTML(lang, code) {
	return (
		`<div class="codeblock"><div class="codebar"><span class="lang">${esc(lang)}</span>` +
		`<button type="button" class="select">${esc(tr("selectAll", "Select all"))}</button></div>` +
		`<pre><code${lang ? ` data-lang="${esc(lang)}"` : ""}>${esc(code)}</code></pre></div>`
	);
}

export function renderBlock(b, opts = {}) {
	switch (b.kind) {
		case "fence": {
			const { lang, code } = fenceParts(b);
			return codeBlockHTML(lang, code);
		}
		case "heading": {
			const m = RE_HEADING.exec(b.lines[0]);
			const n = m[1].length;
			return `<h${n}>${inline(m[2] || "")}</h${n}>`;
		}
		case "hr":
			return "<hr>";
		case "quote": {
			const inner = b.lines.map((l) => l.replace(/^ {0,3}> ?/, "")).join("\n");
			return `<blockquote>${renderMarkdown(inner)}</blockquote>`;
		}
		case "list":
			return renderList(b.lines);
		case "table":
			return renderTable(b.lines);
		default: {
			const html = inline(b.lines.map((l) => l.trim()).join("\n"));
			return opts.tight ? html : `<p>${html}</p>`;
		}
	}
}

function listType(marker) {
	return /\d/.test(marker) ? `ol${marker.slice(-1)}` : `ul${marker}`;
}

// A blank line inside an item (outside code blocks) makes it a loose list.
function hasBlank(lines) {
	let inFence = false;
	for (const l of lines) {
		if (/^\s*(`{3,}|~{3,})/.test(l)) inFence = !inFence;
		else if (!inFence && l === "") return true;
	}
	return false;
}

function renderList(lines) {
	const items = [];
	let item = null;
	for (const line of lines) {
		const m = RE_LIST.exec(line);
		if (m && !(item && leading(line) >= item.indent)) {
			const pad = m[3].length > 4 ? 1 : m[3].length || 1;
			item = {
				indent: m[1].length + m[2].length + pad,
				marker: m[2],
				lines: [line.slice(m[0].length)],
			};
			items.push(item);
		} else if (item) {
			const strip = Math.min(leading(line), item.indent);
			item.lines.push(line.slice(strip));
		}
	}
	// A different marker starts a new list (e.g. "-" after "1.")
	const groups = [];
	for (const it of items) {
		const g = groups[groups.length - 1];
		if (g && g.type === listType(it.marker)) g.items.push(it);
		else groups.push({ type: listType(it.marker), items: [it] });
	}
	return groups
		.map(({ type, items }) => {
			for (const it of items) {
				while (it.lines.length > 1 && it.lines[it.lines.length - 1] === "") {
					it.lines.pop();
					it.trailingBlank = true;
				}
			}
			const last = items.length - 1;
			const tight = items.every(
				(it, i) => !hasBlank(it.lines) && (i === last || !it.trailingBlank),
			);
			const ordered = type.startsWith("ol");
			const start = ordered ? parseInt(items[0].marker, 10) : 1;
			const tag = ordered ? "ol" : "ul";
			const attr = ordered && start !== 1 ? ` start="${start}"` : "";
			const lis = items
				.map(
					(it) => `<li>${renderMarkdown(it.lines.join("\n"), { tight })}</li>`,
				)
				.join("");
			return `<${tag}${attr}>${lis}</${tag}>`;
		})
		.join("");
}

function splitRow(line) {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function renderTable(lines) {
	const head = splitRow(lines[0]);
	const aligns = splitRow(lines[1]).map((c) =>
		c.startsWith(":") && c.endsWith(":")
			? "center"
			: c.endsWith(":")
				? "right"
				: c.startsWith(":")
					? "left"
					: "",
	);
	const cell = (tag, c, i) =>
		`<${tag}${aligns[i] ? ` class="align-${aligns[i]}"` : ""}>${inline(c)}</${tag}>`;
	const th = head.map((c, i) => cell("th", c, i)).join("");
	const rows = lines
		.slice(2)
		.map((l) => {
			const cells = splitRow(l);
			return `<tr>${head.map((_, i) => cell("td", cells[i] ?? "", i)).join("")}</tr>`;
		})
		.join("");
	return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- Inline ----

function esc(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function unesc(s) {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

function safeUrl(u) {
	try {
		const url = new URL(u);
		return ["http:", "https:", "mailto:"].includes(url.protocol)
			? url.href
			: null;
	} catch {
		return null;
	}
}

function anchor(href, text) {
	return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

function inline(src) {
	let out = "";
	const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
	let last = 0;
	for (let m = re.exec(src); m; m = re.exec(src)) {
		out += inlineText(src.slice(last, m.index));
		let code = m[2];
		if (/^ .* $/s.test(code)) code = code.slice(1, -1);
		out += `<code>${esc(code)}</code>`;
		last = re.lastIndex;
	}
	return out + inlineText(src.slice(last));
}

function emphasis(s) {
	return s
		.replace(/\*\*\*(?!\s)([\s\S]*?\S)\*\*\*/g, "<strong><em>$1</em></strong>") // before ** and *, so the tags nest
		.replace(/\*\*(?!\s)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
		.replace(
			/(^|[^*\w])\*(?![\s*])([^*\n]*?[^\s*])\*(?![*\w])/g,
			"$1<em>$2</em>",
		)
		.replace(/~~(?!\s)([\s\S]*?\S)~~/g, "<del>$1</del>");
}

function inlineText(raw) {
	let s = esc(raw);
	const slots = [];
	const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
	// <suggestion-for-user-turn>text</suggestion-for-user-turn>: a suggested next user message, shown as a button
	s = s.replace(
		/&lt;suggestion-for-user-turn&gt;([^\n]*?)(?:&lt;\/suggestion-for-user-turn&gt;|(?=\n)|$)/g,
		(_, text) =>
			hold(
				text.trim()
					? `<button type="button" class="suggestion">${text.trim()}</button>`
					: "",
			),
	);
	// [text](url)
	s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (all, text, u) => {
		const href = safeUrl(unesc(u));
		return href ? hold(anchor(href, emphasis(text))) : all;
	});
	// Bare URL: it stops at a held piece of HTML (NUL) and before an escaped ", < or >
	const RE_BARE_URL =
		// biome-ignore lint/suspicious/noControlCharactersInRegex: NUL is the placeholder marker
		/https?:\/\/(?:(?!&(?:quot|lt|gt);)[^\s<>"\u0000　、。「」『』（）])+/g;
	s = s.replace(RE_BARE_URL, (u) => {
		const trail = /[.,;:!?)\]'*]+$/.exec(u);
		const body = trail ? u.slice(0, -trail[0].length) : u;
		const href = safeUrl(unesc(body));
		return (href ? hold(anchor(href, body)) : body) + (trail ? trail[0] : "");
	});
	s = emphasis(s);
	s = s.replace(/\n/g, "<br>");
	// biome-ignore lint/suspicious/noControlCharactersInRegex: NUL is the placeholder marker
	return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
}
