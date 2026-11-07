// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Check that the frontend unit tests that ran are the Scenarios of docs/specs/LCTYSP-1*.feature (LCTYSP-1000): one
// passing test per Scenario (an Examples row adds its first column in parentheses), titled after it, whose steps are
// the lines of the Background and the Scenario, word for word, in order. A Scenario whose lines include "Given a page
// on the server's origin" runs in the browser (Playwright, in every unit-* project); the others run in Node.js.
//
//   node tests/unit/check-scenarios.js [--node <node:test JSON>] [--browser <Playwright JSON>]
//
// The node:test JSON is written by tests/unit/scenarios-reporter.js, the Playwright JSON by its json reporter. Each
// file checks its own runner completely: every Scenario of that runner is there and every test is a Scenario of it.
// The feature of a test file is the first LCTYSP-1NNN in it (not LCTYSP-1000, the guide); a Playwright test in a file
// without one (such as unit-page.spec.js) is a check of the test setup, not a Scenario, and is only counted.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SPECS = join(ROOT, "docs/specs");
export const PAGE_LINE = "Given a page on the server's origin";

const STEP_RE = /^(Given|When|Then|And|But|\*) /;

/** The cells of a table row "| a | b \| c |": the text between unescaped |, trimmed, with \| read as |. */
function cells(line) {
	const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** The Scenarios of a feature file, each { id, title, lines, runner }, Outlines expanded one per Examples row. */
export function parseFeature(path) {
	const id = path.match(/LCTYSP-\d{4}/)[0];
	const scenarios = [];
	let background = [];
	let current = null; // { kind, title, lines, examples: [{ header, rows }] }
	let section = null; // "background" | "scenario" | "examples"
	const finish = () => {
		if (!current) return;
		if (current.kind === "Scenario") {
			scenarios.push({
				title: current.title,
				lines: [...background, ...current.lines],
			});
		} else {
			for (const { header, rows } of current.examples) {
				for (const row of rows) {
					const sub = (s) =>
						s.replace(/<([^<>]+)>/g, (m, k) =>
							header.includes(k) ? row[header.indexOf(k)] : m,
						);
					scenarios.push({
						title: `${sub(current.title)} (${row[0]})`,
						lines: [...background, ...current.lines.map(sub)],
					});
				}
			}
		}
		current = null;
	};
	for (const raw of readFileSync(path, "utf8").split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const m = line.match(
			/^(Scenario|Scenario Outline|Scenario Template|Example):\s*(.*)$/,
		);
		if (line.startsWith("Feature:")) {
			section = null;
		} else if (line === "Background:") {
			finish();
			section = "background";
			background = [];
		} else if (m) {
			finish();
			const kind =
				m[1] === "Example"
					? "Scenario"
					: m[1] === "Scenario"
						? "Scenario"
						: "Outline";
			current = { kind, title: m[2], lines: [], examples: [] };
			section = "scenario";
		} else if (/^(Examples|Scenarios):/.test(line)) {
			current.examples.push({ header: null, rows: [] });
			section = "examples";
		} else if (line.startsWith("|") && section === "examples") {
			const ex = current.examples.at(-1);
			if (ex.header) ex.rows.push(cells(line));
			else ex.header = cells(line);
		} else if (
			line.startsWith("|") ||
			line.startsWith('"""') ||
			line.startsWith("Rule:")
		) {
			throw new Error(`${relative(ROOT, path)}: unsupported Gherkin: ${line}`);
		} else if (STEP_RE.test(line)) {
			if (section === "background") background.push(line);
			else if (section === "scenario") current.lines.push(line);
		}
		// anything else is the description of the feature or of a Scenario
	}
	finish();
	return scenarios.map((s) => ({
		id,
		...s,
		runner: s.lines.includes(PAGE_LINE) ? "browser" : "node",
	}));
}

/** Every Scenario of docs/specs/LCTYSP-1*.feature. */
export function allScenarios() {
	return readdirSync(SPECS)
		.filter((f) => /^LCTYSP-1\d{3}_.*\.feature$/.test(f))
		.sort()
		.flatMap((f) => parseFeature(join(SPECS, f)));
}

const featureOfFile = new Map();
/** The feature a test file is for: the first LCTYSP-1NNN in it, or null. */
function featureOf(file) {
	if (!featureOfFile.has(file)) {
		const m = readFileSync(join(ROOT, file), "utf8").match(
			/LCTYSP-1(?!000)\d{3}/,
		);
		featureOfFile.set(file, m ? m[0] : null);
	}
	return featureOfFile.get(file);
}

/** The runs of the tests in a node:test JSON of scenarios-reporter.js: one run, "node". */
function nodeRuns(path) {
	const { tests } = JSON.parse(readFileSync(path, "utf8"));
	return [{ runner: "node", name: "node", tests }];
}

/** The runs of the tests in a Playwright JSON report: one per unit-* project. */
function browserRuns(path) {
	const report = JSON.parse(readFileSync(path, "utf8"));
	const testDir = report.config?.rootDir ?? ROOT;
	const byProject = new Map();
	const walk = (suite) => {
		for (const spec of suite.specs ?? []) {
			for (const t of spec.tests) {
				if (!t.projectName.startsWith("unit-")) continue;
				const result = t.results.at(-1);
				if (!byProject.has(t.projectName)) byProject.set(t.projectName, []);
				byProject.get(t.projectName).push({
					file: relative(ROOT, join(testDir, spec.file)),
					title: spec.title,
					ok: t.status === "expected" || t.status === "flaky",
					steps: (result?.steps ?? []).map((s) => s.title),
				});
			}
		}
		for (const s of suite.suites ?? []) walk(s);
	};
	for (const s of report.suites) walk(s);
	return [...byProject].map(([name, tests]) => ({
		runner: "browser",
		name,
		tests,
	}));
}

/** Check one run against the Scenarios of its runner; returns { errors, checked, other }. */
export function checkRun(run, scenarios) {
	const errors = [];
	const expected = new Map();
	for (const s of scenarios.filter((s) => s.runner === run.runner))
		expected.set(`${s.id}\0${s.title}`, s);
	const seen = new Set();
	let other = 0;
	for (const t of run.tests) {
		const id = featureOf(t.file);
		if (t.title === t.file) {
			errors.push(`${run.name}: ${t.file} could not run`);
			continue;
		}
		if (!id) {
			if (run.runner === "node")
				errors.push(
					`${t.file}: "${t.title}" is in a file that names no feature`,
				);
			other++;
			continue;
		}
		const key = `${id}\0${t.title}`;
		const where = `${run.name}: ${id} "${t.title}" (${t.file})`;
		const s = expected.get(key);
		if (!s) {
			const elsewhere = scenarios.find(
				(x) => x.id === id && x.title === t.title,
			);
			errors.push(
				elsewhere
					? `${where}: the Scenario runs in ${elsewhere.runner === "browser" ? "the browser" : "Node.js"}, not here`
					: `${where}: no such Scenario`,
			);
			continue;
		}
		if (seen.has(key)) errors.push(`${where}: tested twice`);
		seen.add(key);
		if (!t.ok) errors.push(`${where}: did not pass`);
		const n = Math.max(s.lines.length, t.steps.length);
		for (let i = 0; i < n; i++) {
			if (s.lines[i] !== t.steps[i]) {
				errors.push(
					`${where}: step ${i + 1} is ${JSON.stringify(t.steps[i] ?? null)}, the feature says ${JSON.stringify(s.lines[i] ?? null)}`,
				);
				break;
			}
		}
	}
	for (const [key, s] of expected)
		if (!seen.has(key))
			errors.push(`${run.name}: ${s.id} "${s.title}" is not tested`);
	return { errors, checked: seen.size, other };
}

function main(argv) {
	const runs = [];
	for (let i = 0; i < argv.length; i += 2) {
		if (argv[i] === "--node") runs.push(...nodeRuns(argv[i + 1]));
		else if (argv[i] === "--browser") runs.push(...browserRuns(argv[i + 1]));
		else
			throw new Error(
				`usage: check-scenarios.js [--node <json>] [--browser <json>]`,
			);
	}
	const scenarios = allScenarios();
	const count = (r) => scenarios.filter((s) => s.runner === r).length;
	console.log(
		`${scenarios.length} Scenarios: ${count("node")} in Node.js, ${count("browser")} in the browser`,
	);
	if (runs.length === 0) return 0;
	let failed = false;
	for (const run of runs) {
		const { errors, checked, other } = checkRun(run, scenarios);
		console.log(
			`${run.name}: ${checked} of ${count(run.runner)} Scenarios${other ? `, ${other} other tests` : ""}${errors.length ? `, ${errors.length} errors` : ", all match"}`,
		);
		for (const e of errors) console.log(`  ${e}`);
		failed ||= errors.length > 0;
	}
	if (
		!runs.some((r) => r.runner === "browser") ||
		!runs.some((r) => r.runner === "node")
	)
		console.log("(only the runners given were checked)");
	return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	process.exitCode = main(process.argv.slice(2));
