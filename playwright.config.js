// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The frontend unit tests (tests/unit; their Gherkin features are docs/specs/LCTYSP-1xxx) and the frontend UI tests
// (tests/ui; LCTYSP-2xxx). Both run in
// the browsers against the Ruby server, which runs on its own port with a fresh, empty data directory. llama-server is
// replaced by a fake inside the browser (tests/ui/fixtures.js), so neither the real data nor the models are touched.

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The servers: by default the tests start one per browser on macOS's /usr/bin/ruby, on LCTY_TEST_PORT (Chromium; the
// unit tests use it too) and the two ports after it (WebKit, Firefox), each with a data directory of its own.
// LCTY_TEST_SERVER_URL points every test at one server that is already running instead, with an empty data directory
// of its own (in CI, the container of .devcontainer/ruby-2.6.10/compose.yml).
const external = process.env.LCTY_TEST_SERVER_URL;
const PORT = Number(process.env.LCTY_TEST_PORT || 45290);
const BROWSERS = [
	{ name: "chromium", device: devices["Desktop Chrome"] },
	{ name: "webkit", device: devices["Desktop Safari"] },
	{ name: "firefox", device: devices["Desktop Firefox"] },
];
const urlOf = (i) => external || `http://127.0.0.1:${PORT + i}`;
// The config is loaded again by every worker: the directory is made once and passed down in the environment
if (!external)
	process.env.LCTY_TEST_DATA_DIR ??= mkdtempSync(join(tmpdir(), "lcty-ui-"));

// The unit tests answer every request they make themselves (LCTYSP-1000), so they run in parallel. The UI tests of a
// browser share its server and data directory (the sidebar lists every conversation the tests make), so they run one
// at a time: one worker per browser. With a server per browser the browsers run side by side; sharing one external
// server, they run one after another: Chromium, WebKit, then Firefox.
const unit = {
	testDir: "tests/unit",
	testMatch: "*.spec.js",
	fullyParallel: true,
};
const ui = { testDir: "tests/ui", workers: 1 };

export default defineConfig({
	globalTeardown: "./tests/ui/global-teardown.js", // LCTY_TEST_KEEP_DATA=1 keeps the data directory to look at
	workers: process.env.CI ? 4 : undefined, // CI runners have 4 CPUs; elsewhere half of the CPUs
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: urlOf(0),
		locale: "ja-JP",
		trace: "retain-on-failure",
	},
	projects: [
		...BROWSERS.map(({ name, device }) => ({
			name: `unit-${name}`,
			...unit,
			use: { ...device },
		})),
		...BROWSERS.map(({ name, device }, i) => ({
			name: `ui-${name}`,
			...ui,
			use: { ...device, baseURL: urlOf(i) },
			dependencies: external && i > 0 ? [`ui-${BROWSERS[i - 1].name}`] : [],
		})),
	],
	webServer: external
		? undefined
		: BROWSERS.map(({ name }, i) => {
				const dataDir = join(process.env.LCTY_TEST_DATA_DIR, name);
				mkdirSync(dataDir, { recursive: true });
				return {
					// No embedding server (LCTYSP-0019): the tests never start a model
					command: "/usr/bin/ruby lcty.rb --no-embedding",
					url: `${urlOf(i)}/`,
					reuseExistingServer: false,
					env: {
						PORT: String(PORT + i),
						LCTY_BIND_IP: "127.0.0.1",
						LCTY_DATA_DIR: dataDir,
					},
					stdout: "ignore",
					stderr: "pipe",
				};
			}),
});
