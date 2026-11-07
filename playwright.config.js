// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// The frontend unit tests (tests/unit; their Gherkin features are docs/specs/LCTYSP-1xxx) and the frontend UI tests
// (tests/ui; LCTYSP-2xxx). Both run in
// the browsers against the Ruby server, which runs on its own port with a fresh, empty data directory. llama-server is
// replaced by a fake inside the browser (tests/ui/fixtures.js), so neither the real data nor the models are touched.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The server: by default the tests start one on macOS's /usr/bin/ruby. LCTY_TEST_SERVER_URL points them at a server
// that is already running instead, with an empty data directory of its own (in CI, the container of .devcontainer/ruby-2.6.10/compose.yml).
const external = process.env.LCTY_TEST_SERVER_URL;
const PORT = Number(process.env.LCTY_TEST_PORT || 45290);
// The config is loaded again by every worker: the directory is made once and passed down in the environment
if (!external)
	process.env.LCTY_TEST_DATA_DIR ??= mkdtempSync(join(tmpdir(), "lcty-ui-"));

// The unit tests answer every request they make themselves (LCTYSP-1000), so they run in parallel. The UI tests share
// one server and one data directory (the sidebar lists every conversation the tests make), so they run one at a time:
// one worker per browser, and WebKit's after Chromium's.
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
		baseURL: external || `http://127.0.0.1:${PORT}`,
		locale: "ja-JP",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "unit-chromium", ...unit, use: { ...devices["Desktop Chrome"] } },
		{ name: "unit-webkit", ...unit, use: { ...devices["Desktop Safari"] } },
		{ name: "ui-chromium", ...ui, use: { ...devices["Desktop Chrome"] } },
		{
			name: "ui-webkit",
			...ui,
			use: { ...devices["Desktop Safari"] },
			dependencies: ["ui-chromium"],
		},
	],
	webServer: external
		? undefined
		: {
				command: "/usr/bin/ruby lcty.rb",
				url: `http://127.0.0.1:${PORT}/`,
				reuseExistingServer: false,
				env: {
					PORT: String(PORT),
					LCTY_HOST: "127.0.0.1",
					LCTY_DATA_DIR: process.env.LCTY_TEST_DATA_DIR,
				},
				stdout: "ignore",
				stderr: "pipe",
			},
});
