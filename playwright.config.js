// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// UI tests (tests/ui). The Ruby server runs on its own port with a fresh, empty data directory, and llama-server is
// replaced by a fake inside the browser (tests/ui/fixtures.js), so neither the real data nor the models are touched.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The config is loaded again by every worker: the directory is made once and passed down in the environment
process.env.LCTY_TEST_DATA_DIR ??= mkdtempSync(join(tmpdir(), "lcty-ui-"));
const PORT = Number(process.env.LCTY_TEST_PORT || 45290);

export default defineConfig({
	testDir: "tests/ui",
	globalTeardown: "./tests/ui/global-teardown.js", // LCTY_TEST_KEEP_DATA=1 keeps the data directory to look at
	fullyParallel: false,
	workers: 1, // one server and one data directory: the sidebar lists every conversation the tests make
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		locale: "ja-JP",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
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
