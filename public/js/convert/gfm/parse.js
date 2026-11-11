// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// A complete text of GFM 0.29-gfm as its document tree (LCTYSP-0017): the block structure first, then the inlines of
// every leaf block, with the link reference definitions of the whole text.

import { BlockParser } from "./blocks.js";
import { Node, walk } from "./common.js";
import { InlineParser } from "./inlines.js";

/**
 * The document tree of text. decodeName(name) is the text of the named character reference &name; ("amp" → "&"), or
 * null when HTML has no such name. options.autolink (true by default) makes the extended autolinks.
 */
export function parseGfm(text, decodeName, options = {}) {
	const blocks = new BlockParser(decodeName);
	const doc = blocks.parse(text);
	const inlines = new InlineParser(decodeName, options);
	inlines.refmap = blocks.refmap;
	parseLeaves(doc, inlines);
	return doc;
}

function parseLeaves(doc, inlines) {
	const leaves = [];
	for (const node of walk(doc))
		if (
			node.type === "paragraph" ||
			node.type === "heading" ||
			node.type === "table"
		)
			leaves.push(node);
	for (const leaf of leaves) {
		if (leaf.type === "table") buildTable(leaf, inlines);
		else inlines.parse(leaf, leaf.string_content);
	}
}

/** The rows of a table as its children: a table_head, then a table_row for each row, each with its table_cells. */
function buildTable(table, inlines) {
	const width = table.header.length;
	const row = (cells, type) => {
		const r = new Node(type);
		for (let i = 0; i < width; i++) {
			const cell = new Node("table_cell", { align: table.aligns[i] });
			inlines.parse(cell, cells[i] ?? "");
			r.append(cell);
		}
		return r;
	};
	table.append(row(table.header, "table_head"));
	for (const cells of table.rows) table.append(row(cells, "table_row"));
	delete table.header;
	delete table.rows;
}
