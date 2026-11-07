<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-1000: Frontend unit tests

- Status: Accepted
- Related: [LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md)
- Implementation: `tests/unit/` (`unit-page.js` and one `*.spec.js` per feature), run by Playwright
  (`playwright.config.js`), in CI by `.github/workflows/browser.yml`

## Summary

The 1000 range holds the behaviour of the browser's code in `public/`, one module at a time, written as Gherkin
features. LCTYSP-1000 is this document, the guide to the range; LCTYSP-1001 and on are the features. Each feature is
tested by a Playwright spec in `tests/unit/` that has one test per Scenario. The module runs in a real browser
(Chromium and WebKit) on the test server's origin, on an empty page, so nothing but the test touches it.

## What belongs here

A module whose behaviour can be checked on its own: functions, workers, custom elements and components that are given
their elements. Its dependencies are the real ones; what is outside the browser (the server's answers, `llama-server`)
is answered by the test with `page.route`, so each Scenario sets exactly the answers it needs.

The page modules that wire everything together, `js/pages/new.js`, `js/ui/sidebar.js`, `js/ui/settings-dialog.js` and
`/c/lcty.v1.module.js`, are tested through the pages they make: they belong to the UI tests (`LCTYSP-2xxx`,
`tests/ui/`).

## The features

| ID                                                            | Module                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| [LCTYSP-1001](LCTYSP-1001_sync-c-meta.feature)                | `js/sync_c_meta.worker.js`: syncing the meta into c_meta |
| [LCTYSP-1002](LCTYSP-1002_uuid-v7.feature)                    | `js/uuid.js`: message ids as UUIDv7                      |
| [LCTYSP-1003](LCTYSP-1003_ui-texts.feature)                   | `js/i18n.js` and the language files: UI texts            |
| [LCTYSP-1004](LCTYSP-1004_common.feature)                     | `js/common.js`: ids, times, URLs and settings            |
| [LCTYSP-1005](LCTYSP-1005_text-attributes.feature)            | `js/ui/text-attr.js`: text attributes and base64         |
| [LCTYSP-1006](LCTYSP-1006_sse.feature)                        | `js/llm/sse.js`: server-sent events                      |
| [LCTYSP-1007](LCTYSP-1007_responses-stream.feature)           | `js/llm/responses.js` and `client.js`: the Responses API |
| [LCTYSP-1008](LCTYSP-1008_llm-request.feature)                | `js/llm/history.js`: the request from a conversation     |
| [LCTYSP-1009](LCTYSP-1009_storage-api.feature)                | `js/api/storage.js`: the client of the HTTP API          |
| [LCTYSP-1010](LCTYSP-1010_meta-db.feature)                    | `js/api/meta-db.js`: the browser's copy of the meta      |
| [LCTYSP-1011](LCTYSP-1011_vector-store.feature)               | `js/search/vectors.js`: vector records and search        |
| [LCTYSP-1012](LCTYSP-1012_embedding.feature)                  | `js/search/embed.js`: embedding and indexing             |
| [LCTYSP-1013](LCTYSP-1013_fuzzy-search-worker.feature)        | `fuzzy_search.worker.js`: semantic search                |
| [LCTYSP-1014](LCTYSP-1014_markdown.feature)                   | `js/ui/markdown.js`: Markdown rendering                  |
| [LCTYSP-1015](LCTYSP-1015_commands.feature)                   | `js/ui/lcty-cmd.js`: command tags                        |
| [LCTYSP-1016](LCTYSP-1016_conversation-file-elements.feature) | `/c/lcty.v1.mjs`: the elements of a conversation file    |
| [LCTYSP-1017](LCTYSP-1017_conversation-elements.feature)      | `js/ui/lcty-elements.js`: messages and the composer      |
| [LCTYSP-1018](LCTYSP-1018_tags.feature)                       | `js/tags.js`: tags, drafts and memory                    |
| [LCTYSP-1019](LCTYSP-1019_search-panel.feature)               | `js/search/search-panel.js`: the search panel            |

## How a feature is written

As in [LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md):

- One feature per module (or per small group of modules used together), named `LCTYSP-1NNN_short-name.feature` and
  numbered in the order it was added; numbers are never reused.
- A comment at the top names the module, the specifications it follows, and the spec file.
- The `Feature:` line is `LCTYSP-1NNN Title`, followed by a paragraph that says what the module is for and how a page
  uses it.
- Scenarios describe what can be seen from outside the module: return values, elements and their attributes, requests
  sent, messages posted, what is stored. A Scenario Outline is used when only the data changes.
- When a test finds a bug, the code is fixed and a Scenario that failed before the fix is added. Behaviour whose intent
  is unclear is not written as a Scenario until it is decided.

## How a test is written

Each feature has one spec, `tests/unit/<name>.spec.js`, whose head comment names the feature. Each Scenario is a
`test()` with the Scenario's title (an Examples row adds its first column in parentheses), and each line of the
Scenario is a `test.step()` with the line word for word, in order:

```js
test("A new id is a canonical UUIDv7", async ({ page, context }) => {
	await givenAPage(page, context);
	let id;
	await test.step("When uuidv7() makes an id", async () => {
		id = await page.evaluate(async () =>
			(await import("/js/uuid.js")).uuidv7(),
		);
	});
	await test.step("Then it matches UUID_RE", async () => {
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
	});
});
```

- `tests/unit/unit-page.js` serves the empty page: `givenAPage(page, context, { lang, langs, body })` is the usual
  Background line "Given a page on the server's origin". The page loads `/c/lcty.v1.js` (the global `LctyT` that
  `js/i18n.js` needs) unless told not to, and the languages it is given.
- Modules are imported inside the page with `import()`. Values cross between the test and the page as JSON, so a test
  turns typed arrays, `Map`s and elements into plain values inside `page.evaluate` before returning them.
- Requests the module makes are answered with `context.route` (it also catches a worker's requests), never by the
  server's data.

## The test environment

- **Browsers.** Chromium and WebKit, as for the UI tests; every test runs in both.
- **Server.** The tests share the server the UI tests start (`playwright.config.js`): port 45290 by default
  (`LCTY_TEST_PORT` to change it), with an empty data directory in the temporary folder. Unit tests use it only to
  serve `public/`.
- **State.** Every test gets a new browser context, so `localStorage` and IndexedDB start empty.

## Running the tests

```bash
npm run test:unit
```

`npm run test:unit -- --project=chromium` runs one browser, and `npm run test:unit -- -g "UUIDv7"` the tests whose
titles match. CI runs them with the UI tests (`npm test` in `.github/workflows/browser.yml`).
