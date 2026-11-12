// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The tail converter of LCTYSP-0018: a reply's tail, read by a heuristic of its own and drawn in place (tail.d.ts).

const LINK_ATTRS = ["target", "_blank", "rel", "noopener noreferrer"];
const reAllowedUrl = /^(?:https?|mailto):/i;
const reBlank = /^[ \t]*$/;
const reAtx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const reHr = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const reFence = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const reList = /^( {0,3})([-*+]|(\d{1,9})[.)])([ \t]+|$)/;
const reQuote = /^ {0,3}> ?/;
const reSetext = /^ {0,3}(=+|-+)[ \t]*$/;
const reDelimRow =
	/^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const reDef =
	/^ {0,3}\[(?:[^\]\\]|\\.)+\]:[ \t]*\S+(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const rePunct = /[\p{P}\p{S}]/u;
const reAsciiPunct = /[!-/:-@[-`{-~]/;
const reSpace = /\s/u;
const reEntity =
	/^&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{0,31}));/;
const reAutolink = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\0- ]*)>/;
const reEmail =
	/^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)>/;
const reSuggestion = /^<suggestion-for-user-turn>/i;
const reWebLink =
	/(?:https?:\/\/|www\.)[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*[^\s<]*/y;
const reEmailLocal = /[A-Za-z0-9.+_-]+$/;
const reEmailDomain = /@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/y;
const reSuggestionEnd = /<\/suggestion-for-user-turn>/i;
const reDestination =
	/\([ \t\n]*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:[ \t\n]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?[ \t\n]*\)/y;
// how far the text of a link is looked for
const LABEL_MAX = 1000;
const BR = ["br", null, []];
// block quotes and list items nest at most this deep, as in LCTYSP-0017
const DEPTH = 32;

/** The nodes that show text, the tail of a reply (tail.d.ts). */
export function tailNodes(text, { selectAll = "Select all", decodeName } = {}) {
	const lines = text.split(/\r\n|\r|\n/);
	// a text ending with a line end ends with a complete line; otherwise its last line may still grow
	const open = lines[lines.length - 1] !== "";
	if (!open) lines.pop();
	return blocks(lines, open, {
		selectAll,
		decodeName: decodeName ?? (() => null),
	});
}

/** Make parent's children the nodes, keeping each node drawn already where it is the same (tail.d.ts). */
export function drawTail(parent, nodes) {
	const doc = parent.ownerDocument;
	let child = parent.firstChild;
	for (const n of nodes) {
		if (typeof n === "string" && child?.nodeType === 3) {
			// text that grows at its end is appended
			if (child.data !== n)
				if (n.startsWith(child.data))
					child.appendData(n.slice(child.data.length));
				else child.data = n;
		} else if (typeof n !== "string" && child?.nodeType === 1 && same(child, n))
			drawTail(child, n[2]);
		else {
			const made = build(doc, n);
			if (child) parent.replaceChild(made, child);
			else parent.append(made);
			child = made;
		}
		child = child.nextSibling;
	}
	while (child) {
		const next = child.nextSibling;
		child.remove();
		child = next;
	}
}

/** Whether element e is the element of node n: its tag and its attributes. */
function same(e, n) {
	if (e.localName !== n[0]) return false;
	const attrs = n[1] ?? [];
	if (e.attributes.length * 2 !== attrs.length) return false;
	for (let i = 0; i < attrs.length; i += 2)
		if (e.getAttribute(attrs[i]) !== attrs[i + 1]) return false;
	return true;
}

/** The DOM of node n. */
function build(doc, n) {
	if (typeof n === "string") return doc.createTextNode(n);
	const e = doc.createElement(n[0]);
	const attrs = n[1] ?? [];
	for (let i = 0; i < attrs.length; i += 2)
		e.setAttribute(attrs[i], attrs[i + 1]);
	for (const c of n[2]) e.append(build(doc, c));
	return e;
}

/** Adjacent strings of nodes joined, and empty ones left out. */
function joined(nodes) {
	const out = [];
	for (const n of nodes) {
		if (n === "") continue;
		if (typeof n === "string" && typeof out[out.length - 1] === "string")
			out[out.length - 1] += n;
		else out.push(n);
	}
	return out;
}

/** The leading spaces of line. */
const indentOf = (line) => line.length - line.trimStart().length;

/** Whether line starts a block that ends a paragraph. */
function interrupts(line) {
	if (reAtx.test(line) || reHr.test(line) || reQuote.test(line)) return true;
	const f = reFence.exec(line);
	if (f && !(f[2][0] === "`" && f[3].includes("`"))) return true;
	const m = reList.exec(line);
	// a list interrupts a paragraph when its item is not empty, and an ordered one only from 1
	return m !== null && m[4] !== "" && (m[3] === undefined || m[3] === "1");
}

/** The block nodes of lines; open when their last line may still grow. */
function blocks(lines, open, opts, depth = 0) {
	const out = [];
	let para = null;
	const flush = () => {
		if (para !== null) {
			const p = paragraph(para, opts);
			if (p !== null) out.push(p);
			para = null;
		}
	};
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		// the last line, while it may still grow, does not decide what the lines above are
		const growing = open && i === lines.length - 1;
		if (reBlank.test(line)) {
			flush();
			i++;
			continue;
		}
		const setext = para !== null ? reSetext.exec(line) : null;
		// a growing underline of one or two characters may yet be a list item or text
		if (setext && !(growing && setext[1].length < 3)) {
			out.push([
				setext[1][0] === "=" ? "h1" : "h2",
				null,
				inlines(para.join("\n"), opts),
			]);
			para = null;
			i++;
			continue;
		}
		if (
			para !== null &&
			!growing &&
			line.includes("|") &&
			reDelimRow.test(line)
		) {
			const head = cells(para[para.length - 1]);
			const aligns = cells(line).map(alignOf);
			if (head.length === aligns.length) {
				para.pop();
				if (para.length === 0) para = null;
				flush();
				i = table(lines, i + 1, head, aligns, out, opts);
				continue;
			}
		}
		// a quote or a list too deep to nest is text
		const nesting = reQuote.test(line) || reList.test(line);
		const nests = nesting && depth < DEPTH;
		if (para !== null && !(interrupts(line) && (nests || !nesting))) {
			para.push(line);
			i++;
			continue;
		}
		flush();
		const atx = reAtx.exec(line);
		const f = reFence.exec(line);
		if (atx) {
			out.push([`h${atx[1].length}`, null, inlines(atx[2] ?? "", opts)]);
			i++;
		} else if (reHr.test(line)) {
			out.push(["hr", null, []]);
			i++;
		} else if (f && !(f[2][0] === "`" && f[3].includes("`")))
			i = fence(lines, i, f, open, out, opts);
		else if (nests && reQuote.test(line))
			i = quote(lines, i, open, out, opts, depth);
		else if (nests) i = list(lines, i, open, out, opts, depth);
		else {
			para = [line];
			i++;
		}
	}
	flush();
	return out;
}

/** A paragraph of lines, its link reference definitions left out; null when nothing is left. */
function paragraph(lines, opts) {
	let k = 0;
	while (k < lines.length && reDef.test(lines[k])) k++;
	if (k === lines.length) return null;
	const text = lines
		.slice(k)
		.map((l) => l.trimStart())
		.join("\n")
		.trimEnd();
	return ["p", null, inlines(text, opts)];
}

/** A fenced code block from line i, open to the end when its closing fence has not come. */
function fence(lines, i, m, open, out, opts) {
	const indent = m[1].length;
	const ch = m[2][0];
	const lang = m[3].trim().split(/[ \t]/)[0];
	const reClose = new RegExp(
		`^ {0,3}${ch === "`" ? "`" : "~"}{${m[2].length},}[ \\t]*$`,
	);
	let code = "";
	let k = i + 1;
	for (; k < lines.length; k++) {
		if (reClose.test(lines[k])) {
			k++;
			break;
		}
		const line = lines[k].slice(Math.min(indent, indentOf(lines[k])));
		code += open && k === lines.length - 1 ? line : `${line}\n`;
	}
	out.push([
		"div",
		["class", "codeblock"],
		[
			[
				"div",
				["class", "codebar"],
				[
					["span", ["class", "lang"], joined([lang])],
					["button", ["type", "button", "class", "select"], [opts.selectAll]],
				],
			],
			[
				"pre",
				null,
				[["code", lang === "" ? null : ["data-lang", lang], joined([code])]],
			],
		],
	]);
	return k;
}

/** A block quote from line i: its lines with their > taken off, and the lines that continue its paragraph. */
function quote(lines, i, open, out, opts, depth) {
	const inner = [];
	let k = i;
	for (; k < lines.length; k++) {
		const line = lines[k];
		const m = reQuote.exec(line);
		if (m) inner.push(line.slice(m[0].length));
		else if (
			!reBlank.test(line) &&
			inner.length > 0 &&
			!reBlank.test(inner[inner.length - 1]) &&
			!interrupts(line)
		)
			inner.push(line);
		else break;
	}
	out.push([
		"blockquote",
		null,
		blocks(inner, open && k === lines.length, opts, depth + 1),
	]);
	return k;
}

/** The kind of a list marker: its character, or an ordered one's delimiter. */
const kindOf = (m) => (m[3] === undefined ? m[2] : m[2].slice(-1));

/** A list from line i: its items as long as their markers are of one kind. */
function list(lines, i, open, out, opts, depth) {
	const first = reList.exec(lines[i]);
	const kind = kindOf(first);
	const items = [];
	let loose = false;
	let k = i;
	while (k < lines.length) {
		const m = reList.exec(lines[k]);
		if (!m || kindOf(m) !== kind) break;
		// where the item's content starts: after the marker and one to four spaces
		const after = m[0].length;
		const spaces = m[4].length;
		const col =
			spaces === 0 || spaces > 4 ? m[1].length + m[2].length + 1 : after;
		const own = [lines[k].slice(Math.min(col, lines[k].length))];
		k++;
		while (k < lines.length) {
			const line = lines[k];
			if (reBlank.test(line)) own.push("");
			else if (indentOf(line) >= col) own.push(line.slice(col));
			else if (
				!reBlank.test(own[own.length - 1]) &&
				!interrupts(line) &&
				!reList.test(line)
			)
				own.push(line.trimStart());
			else break;
			k++;
		}
		// blank lines at the item's end belong to no block: between two items they make the list loose
		let trailing = false;
		while (own.length > 1 && own[own.length - 1] === "") {
			own.pop();
			trailing = true;
		}
		if (trailing && k < lines.length && reList.test(lines[k])) {
			const next = reList.exec(lines[k]);
			if (kindOf(next) === kind) loose = true;
		}
		if (blankBetween(own)) loose = true;
		items.push({ own, last: k === lines.length });
	}
	const ordered = first[3] !== undefined;
	const start = ordered ? Number.parseInt(first[3], 10) : 1;
	const lis = items.map(({ own, last }) => {
		let children = blocks(own, open && last, opts, depth + 1);
		const p = children[0];
		// a task list item's box is the first inline of its first paragraph
		if (p?.[0] === "p" && typeof p[2][0] === "string") {
			const t = /^\[([ xX])\][ \t]+/.exec(p[2][0]);
			if (t) {
				const done = t[1] !== " ";
				p[2] = joined([
					["span", ["class", done ? "task done" : "task"], [done ? "☑" : "☐"]],
					" ",
					p[2][0].slice(t[0].length),
					...p[2].slice(1),
				]);
			}
		}
		if (!loose) children = children.flatMap((c) => (c[0] === "p" ? c[2] : [c]));
		return ["li", null, joined(children)];
	});
	out.push([
		ordered ? "ol" : "ul",
		ordered && start !== 1 ? ["start", String(start)] : null,
		lis,
	]);
	return k;
}

/** Whether an item's lines have a blank line between two of its own blocks, outside a code block. */
function blankBetween(own) {
	let fenced = null;
	for (let k = 0; k < own.length; k++) {
		const line = own[k];
		const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fenced === null && f) fenced = f[1][0];
		else if (fenced !== null && f && f[1][0] === fenced) fenced = null;
		else if (
			fenced === null &&
			line === "" &&
			k + 1 < own.length &&
			indentOf(own[k + 1]) === 0
		)
			return true;
	}
	return false;
}

/** The cells of a table row: its text between unescaped pipes, trimmed. */
function cells(row) {
	let s = row.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	return s.split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));
}

/** The alignment of a delimiter row's cell, as LCTYSP-0017's class, or null. */
function alignOf(cell) {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return "align-center";
	if (right) return "align-right";
	return left ? "align-left" : null;
}

/** A table: its header row, then rows from line i until a blank line or the start of another block. */
function table(lines, i, head, aligns, out, opts) {
	const row = (tag, texts) => [
		"tr",
		null,
		aligns.map((a, c) => [
			tag,
			a === null ? null : ["class", a],
			inlines(texts[c] ?? "", opts),
		]),
	];
	const body = [];
	let k = i;
	for (; k < lines.length; k++) {
		const line = lines[k];
		if (reBlank.test(line) || interrupts(line)) break;
		body.push(row("td", cells(line)));
	}
	const parts = [["thead", null, [row("th", head)]]];
	if (body.length > 0) parts.push(["tbody", null, body]);
	out.push(["div", ["class", "table-wrap"], [["table", null, parts]]]);
	return k;
}

/** Whether ch, a character or undefined at either end, counts as white space. */
const space = (ch) => ch === undefined || reSpace.test(ch);

/** The inline nodes of s, a paragraph's, a heading's or a cell's text; inLink inside a link's text. */
function inlines(s, opts, inLink = false) {
	const items = [];
	let text = "";
	const push = (item) => {
		if (text !== "") items.push(text);
		text = "";
		items.push(item);
	};
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === "\\" && s[i + 1] === "\n") {
			push(BR);
			i += 2;
		} else if (c === "\\" && i + 1 < s.length && reAsciiPunct.test(s[i + 1])) {
			text += s[i + 1];
			i += 2;
		} else if (c === "\n") {
			text = text.trimEnd();
			push(BR);
			i++;
			while (s[i] === " " || s[i] === "\t") i++;
		} else if (c === "`") {
			let n = 1;
			while (s[i + n] === "`") n++;
			const fence = "`".repeat(n);
			let end = s.indexOf(fence, i + n);
			while (end !== -1 && s[end + n] === "`") {
				let e = end;
				while (s[e] === "`") e++;
				end = s.indexOf(fence, e);
			}
			if (end === -1) {
				text += fence;
				i += n;
			} else {
				let code = s.slice(i + n, end).replaceAll("\n", " ");
				if (
					code.length > 2 &&
					code[0] === " " &&
					code.at(-1) === " " &&
					code.trim() !== ""
				)
					code = code.slice(1, -1);
				push(["code", null, [code]]);
				i = end + n;
			}
		} else if (c === "&") {
			const m = reEntity.exec(s.slice(i, i + 40));
			const decoded = m === null ? null : entity(m, opts);
			if (decoded === null) {
				text += c;
				i++;
			} else {
				text += decoded;
				i += m[0].length;
			}
		} else if (c === "<") {
			const rest = s.slice(i);
			const auto = reAutolink.exec(rest);
			const email = auto === null ? reEmail.exec(rest) : null;
			if (!inLink && reSuggestion.test(rest)) {
				// a suggested next message: the text up to its closing tag, or to the end of the line
				const from = rest.indexOf(">") + 1;
				const close = reSuggestionEnd.exec(rest);
				const nl = rest.indexOf("\n");
				let to = close === null ? rest.length : close.index;
				if (nl !== -1 && nl < to) to = nl;
				const label = rest.slice(from, to).trim();
				if (label !== "")
					push(["button", ["type", "button", "class", "suggestion"], [label]]);
				i += to === close?.index ? to + close[0].length : to;
			} else if (auto !== null || email !== null) {
				// an autolink: a link of its URL when its scheme is allowed, its text otherwise
				const url = auto?.[1] ?? email[1];
				const href = auto === null ? `mailto:${url}` : url;
				if (!inLink && reAllowedUrl.test(href))
					push(["a", ["href", href, ...LINK_ATTRS], [url]]);
				else text += url;
				i += (auto ?? email)[0].length;
			} else {
				text += c;
				i++;
			}
		} else if (c === "*" || c === "_" || c === "~") {
			let n = 1;
			while (s[i + n] === c) n++;
			const before = s[i - 1];
			const after = s[i + n];
			const left =
				!space(after) &&
				(!rePunct.test(after) || space(before) || rePunct.test(before));
			const right =
				!space(before) &&
				(!rePunct.test(before) || space(after) || rePunct.test(after));
			let opens = left;
			let closes = right;
			if (c === "_") {
				opens = left && (!right || rePunct.test(before ?? ""));
				closes = right && (!left || rePunct.test(after ?? ""));
			}
			if (c === "~" && n > 2) opens = closes = false;
			push({ ch: c, n, orig: n, opens, closes });
			i += n;
		} else if (
			(c === "w" || c === "h") &&
			!inLink &&
			webLinkAt(s, i) !== null
		) {
			// an extended autolink of GFM: www. or http:// and https://
			const url = webLinkAt(s, i);
			push([
				"a",
				["href", c === "w" ? `http://${url}` : url, ...LINK_ATTRS],
				[url],
			]);
			i += url.length;
		} else if (c === "@" && !inLink && emailAt(s, i, text) !== null) {
			const [local, domain] = emailAt(s, i, text);
			text = text.slice(0, -local.length);
			push([
				"a",
				["href", `mailto:${local}${domain}`, ...LINK_ATTRS],
				[local + domain],
			]);
			i += domain.length;
		} else if (c === "[" || (c === "!" && s[i + 1] === "[")) {
			const image = c === "!";
			const link = linkAt(s, image ? i + 1 : i);
			if (link === null) {
				text += c;
				i++;
			} else {
				const allowed = !inLink && reAllowedUrl.test(link.destination);
				const label = image
					? [plain(inlines(link.label, opts, true))]
					: inlines(link.label, opts, true);
				if (allowed)
					push(["a", ["href", link.destination, ...LINK_ATTRS], label]);
				else for (const n of label) push(n);
				i = link.end;
			}
		} else {
			text += c;
			i++;
		}
	}
	if (text !== "") items.push(text);
	emphasis(items);
	return joined(
		items.map((x) =>
			typeof x === "object" && "ch" in x ? x.ch.repeat(x.n) : x,
		),
	);
}

/** The extended autolink of a web address at s[i], with no trailing punctuation, or null. */
function webLinkAt(s, i) {
	const before = s[i - 1];
	if (!(space(before) || "*_~(".includes(before))) return null;
	reWebLink.lastIndex = i;
	const m = reWebLink.exec(s);
	if (m === null) return null;
	let url = m[0];
	for (;;) {
		const last = url.at(-1);
		if ("?!.,:*_~'\"".includes(last)) url = url.slice(0, -1);
		else if (last === ")" && url.split(")").length > url.split("(").length)
			url = url.slice(0, -1);
		else if (last === ";" && /&[A-Za-z0-9]+;$/.test(url))
			url = url.replace(/&[A-Za-z0-9]+;$/, "");
		else break;
	}
	return /^(?:https?:\/\/|www\.)[A-Za-z0-9_-]/.test(url) ? url : null;
}

/** The local part, taken from the text before it, and the domain of an email address at the @ of s[i], or null. */
function emailAt(s, i, text) {
	const local = reEmailLocal.exec(text.slice(-64))?.[0];
	if (local === undefined) return null;
	reEmailDomain.lastIndex = i;
	let domain = reEmailDomain.exec(s)?.[0];
	if (domain === undefined) return null;
	while (domain.endsWith(".")) domain = domain.slice(0, -1);
	return /[-_]$/.test(domain) || !domain.includes(".") ? null : [local, domain];
}

/** The text of a character reference, or null when it is none. */
function entity(m, opts) {
	if (m[3] !== undefined) return opts.decodeName(m[3]);
	const code = Number.parseInt(m[1] ?? m[2], m[1] === undefined ? 10 : 16);
	return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
		? "�"
		: String.fromCodePoint(code);
}

/** The link at s[i], a [ ]: its label, destination and where it ends, or null when it is not an inline link. */
function linkAt(s, i) {
	let depth = 0;
	let k = i;
	// a link's text is looked for this far at most, so that brackets left open cost no more than that each
	const end = Math.min(s.length, i + LABEL_MAX);
	for (; k < end; k++) {
		const ch = s[k];
		if (ch === "\\") k++;
		else if (ch === "[") depth++;
		else if (ch === "]" && --depth === 0) break;
	}
	if (k >= end || s[k + 1] !== "(") return null;
	reDestination.lastIndex = k + 1;
	const m = reDestination.exec(s);
	if (m === null) return null;
	const destination = (m[1] ?? m[2]).replace(/\\([!-/:-@[-`{-~])/g, "$1");
	return { label: s.slice(i + 1, k), destination, end: k + 1 + m[0].length };
}

/** The plain text of nodes, as an image's alt text. */
function plain(nodes) {
	return nodes
		.map((n) =>
			typeof n === "string" ? n : n[0] === "br" ? "\n" : plain(n[2]),
		)
		.join("");
}

/** Match the delimiter runs of items as GFM does, more or less, and put what they enclose into em, strong and del. */
function emphasis(items) {
	// below this index there is no opener left for a closer of the character
	const bottom = { "*": 0, _: 0, "~": 0 };
	for (let c = 0; c < items.length; c++) {
		const closer = items[c];
		if (typeof closer !== "object" || !("ch" in closer) || !closer.closes)
			continue;
		let o = c - 1;
		let opener = null;
		for (; o >= bottom[closer.ch]; o--) {
			const d = items[o];
			if (
				typeof d !== "object" ||
				!("ch" in d) ||
				d.ch !== closer.ch ||
				!d.opens ||
				d.n === 0
			)
				continue;
			if (d.ch === "~" && d.n !== closer.n) continue;
			const both = (d.opens && d.closes) || (closer.opens && closer.closes);
			if (
				d.ch !== "~" &&
				both &&
				(d.orig + closer.orig) % 3 === 0 &&
				!(d.orig % 3 === 0 && closer.orig % 3 === 0)
			)
				continue;
			opener = d;
			break;
		}
		if (opener === null) {
			if (!closer.opens) bottom[closer.ch] = c;
			continue;
		}
		const use =
			closer.ch === "~" ? closer.n : closer.n >= 2 && opener.n >= 2 ? 2 : 1;
		const tag = closer.ch === "~" ? "del" : use === 2 ? "strong" : "em";
		const inner = items.splice(o + 1, c - o - 1);
		const children = joined(
			inner.map((x) =>
				typeof x === "object" && "ch" in x ? x.ch.repeat(x.n) : x,
			),
		);
		items.splice(o + 1, 0, [tag, null, children]);
		opener.n -= use;
		closer.n -= use;
		// what was spliced out held no opener any more
		for (const ch of Object.keys(bottom))
			if (bottom[ch] > o) bottom[ch] = o + 1;
		c = o + 2;
		if (closer.n > 0) c--;
		else items[c] = "";
		c--;
	}
}
