// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// A node:test reporter that writes the tests that ran as JSON, for tests/unit/check-scenarios.js: one entry per
// top-level test (a Scenario) with its file, its title, whether it passed and the titles of its subtests (its steps),
// in order. It writes the file itself, test-results-node/scenarios.json (LCTY_SCENARIOS_JSON to change it), making
// the directory (Playwright empties test-results/, so the file is kept apart), and prints nothing. Used with another
// reporter for people to read:
//
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//     --test-reporter=./tests/unit/scenarios-reporter.js --test-reporter-destination=stdout

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

const OUT =
	process.env.LCTY_SCENARIOS_JSON || "test-results-node/scenarios.json";

export default async function* scenariosReporter(source) {
	const tests = [];
	// A test ends after its subtests: the steps that ended at each nesting level, per file, wait for their test
	const pending = new Map();
	for await (const { type, data } of source) {
		if (type !== "test:pass" && type !== "test:fail") continue;
		if (data.details?.type === "suite") continue;
		if (
			data.nesting === 0 &&
			!data.entryFile &&
			data.file?.endsWith("node-unit.js")
		)
			throw new Error(
				"scenarios-reporter.js needs Node.js 24 or later (the entryFile of test events)",
			);
		// file is where test() was called (node-unit.js); entryFile is the test file that ran
		const file = relative(process.cwd(), data.entryFile ?? data.file ?? "");
		if (!data.entryFile && data.name === file) {
			// the test file as a whole, in its own process: it fails when the file could not run
			if (type === "test:fail")
				tests.push({ file, title: data.name, ok: false, steps: [] });
			continue;
		}
		const levels = pending.get(file) ?? [];
		pending.set(file, levels);
		const steps = levels[data.nesting + 1] ?? [];
		levels[data.nesting + 1] = [];
		if (data.nesting === 0) {
			tests.push({
				file,
				title: data.name,
				ok: type === "test:pass",
				steps: steps.map((s) => s.title),
			});
		} else {
			levels[data.nesting] ??= [];
			levels[data.nesting].push({ title: data.name });
		}
	}
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(
		OUT,
		`${JSON.stringify({ runner: "node", tests }, null, "\t")}\n`,
	);
}
