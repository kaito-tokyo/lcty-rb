// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Removes the data directory the test server used (made in playwright.config.js).

import { rmSync } from "node:fs";

export default function globalTeardown() {
	const dir = process.env.LCTY_TEST_DATA_DIR;
	if (dir && !process.env.LCTY_TEST_KEEP_DATA)
		rmSync(dir, { recursive: true, force: true });
}
