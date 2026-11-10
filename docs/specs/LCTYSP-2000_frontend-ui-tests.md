<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-2000: Frontend UI tests

- Status: Accepted
- Related: [LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-1000](LCTYSP-1000_frontend-unit-tests.md),
  [LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md)
- Implementation: `tests/ui/`: `fixtures.js` and the `*.spec.js`, run by Playwright (`playwright.config.js`, the
  `ui-chromium` and `ui-webkit` projects), in CI by `.github/workflows/browser.yml`; `tests/unit/check-scenarios.js`
  checks them against the features

## Summary

The 2000 range holds what a user sees on the pages of the site, written as Gherkin features. LCTYSP-2000 is this
document, the guide to the range; LCTYSP-2001 and on are the features. Each Scenario is one test in `tests/ui/`, run in
a real browser (Chromium and WebKit, with Playwright) against the real server: `ruby lcty.rb` started with a new, empty
data directory of its own. Only `llama-server` is not real: the browser talks to it directly, so the tests answer its
requests inside the browser (`llm` in `tests/ui/fixtures.js`), and neither the real data nor the models are touched.

## What belongs here

A page as a whole: what it shows when it is opened, what the user does on it and what happens then, on the screen, in
what the server saves and in where the browser goes. The page's own modules are the real ones (`js/pages/*.js`,
`js/ui/sidebar.js`, `/lcty.v1/lcty.v1.async.mjs`, the page entries), and so are the server's answers. The parts that can be
checked on their own are the unit tests' ([LCTYSP-1000](LCTYSP-1000_frontend-unit-tests.md) for the browser's code,
[LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md) for the server's): a Scenario here says what a user can see, not how a
module does it.

Since a UI test looks at the site only from outside, over HTTP, it does not depend on how the server is built: the same
features check a server whose code is rewritten.

## The features

The last column counts the Scenarios (an Examples row counts as one), each tested in both browsers.

| ID                                                       | Page                                                | Scenarios |
| -------------------------------------------------------- | --------------------------------------------------- | --------: |
| [LCTYSP-2001](LCTYSP-2001_new-conversation-page.feature) | The new conversation page `/c/`                     |         7 |
| [LCTYSP-2002](LCTYSP-2002_conversation-page.feature)     | The conversation page `/c/<id>.html`                |        16 |
| [LCTYSP-2003](LCTYSP-2003_sidebar.feature)               | The sidebar of every page                           |         9 |
| [LCTYSP-2004](LCTYSP-2004_tag-pages.feature)             | The tag reorder page `/t/` and the tag files' pages |         7 |
| [LCTYSP-2005](LCTYSP-2005_site-routing.feature)          | The paths of the site                               |        15 |

## How a feature is written

As in [LCTYSP-1000](LCTYSP-1000_frontend-unit-tests.md):

- One feature per page (or per part every page has, such as the sidebar), named `LCTYSP-2NNN_short-name.feature` and
  numbered in the order it was added; numbers are never reused.
- A comment at the top names the page, the specifications it follows, and the spec file.
- The `Feature:` line is `LCTYSP-2NNN Title`, followed by a paragraph that says what the page is for and what the
  Scenarios have in common (the data they make, the fake `llama-server`).
- Scenarios describe what a user can see: what the page shows, what the server has saved, where the browser goes. A
  Scenario makes the data it needs (through the HTTP API, `tests/ui/fixtures.js`) and does not depend on the data of
  another, since every test shares one server and one data directory. A Scenario Outline is used when only the data
  changes.

## How a test is written

Each feature has one test file, `tests/ui/<name>.spec.js`, whose head comment names the feature. Each Scenario is a
test with the Scenario's title (an Examples row adds its first column in parentheses), and each line of the Scenario,
the Background's first, is a `test.step` with the line word for word, in order. `tests/unit/check-scenarios.js` checks
this for every `ui-*` project of a Playwright JSON report, as it does the unit features (LCTYSP-1000).

```js
import { expect, openNewPage, test } from "./fixtures.js";

test("The new conversation page shows the sidebar and the creation card", async ({
	page,
}) => {
	await test.step("When the new conversation page /c/ is opened", () =>
		openNewPage(page));
	await test.step("Then the sidebar is shown", async () => {
		await expect(page.locator("body > lcty-sidebar")).toBeVisible();
	});
});
```

- The tests run one at a time (one worker per browser, WebKit's after Chromium's), since they share the server and its
  data directory: the sidebar lists every conversation the tests have made.
- Tag definitions are global, so a feature whose Scenarios make tags removes them after each test.
- `LCTY_TEST_SERVER_URL` points the tests at a server that is already running instead (in CI, the container of
  `.devcontainer/ruby-2.6.10/compose.yml`), and `LCTY_TEST_KEEP_DATA=1` keeps the data directory to look at.
