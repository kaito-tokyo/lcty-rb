<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-1000: Frontend unit tests

- Status: Accepted
- Related: [LCTYSP-0005](LCTYSP-0005_page-and-elements.md), [LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md)
- Implementation: `tests/unit/`: in Node.js `node-unit.js`, `node-preload.cjs` and the `*.test.js`, run by `node:test`, in CI by
  `.github/workflows/node.yml`; in the browser `unit-page.js` and the `*.spec.js`, run by Playwright
  (`playwright.config.js`), in CI by `.github/workflows/browser.yml`; `check-scenarios.js` checks both against the
  features

## Summary

The 1000 range holds the behaviour of the browser's code in `public/`, one module at a time, written as Gherkin
features. LCTYSP-1000 is this document, the guide to the range; LCTYSP-1001 and on are the features. Each Scenario is
one test in `tests/unit/`. A Scenario that needs a browser runs in a real one (Chromium and WebKit, with Playwright) on
the test server's origin, on an empty page, so nothing but the test touches it; it says so with the line "Given a page
on the server's origin". Every other Scenario runs in Node.js (`node:test`), which imports the module straight from
`public/`: it takes a second instead of a minute and needs neither the server nor the browsers.

## What belongs here

A module whose behaviour can be checked on its own: functions, workers, custom elements and components that are given
their elements. Its dependencies are the real ones; what is outside the browser (the server's answers, `llama-server`)
is answered by the test (`context.route` in the browser, a replaced `fetch` in Node.js), so each Scenario sets exactly
the answers it needs.

The page modules that wire everything together, `js/pages/new.js`, `js/ui/sidebar.js`, `js/ui/settings-dialog.js` and
`/c/lcty.v1.module.js`, are tested through the pages they make: they belong to the UI tests (`LCTYSP-2xxx`,
`tests/ui/`).

## The features

The last two columns count the Scenarios (an Examples row counts as one) tested in Node.js and in the browser.

| ID                                                            | Module                                                   | Node.js | Browser |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------: | ------: |
| [LCTYSP-1001](LCTYSP-1001_sync-c-meta.feature)                | `js/sync_c_meta.worker.js`: syncing the meta into c_meta |       0 |      10 |
| [LCTYSP-1002](LCTYSP-1002_uuid-v7.feature)                    | `js/uuid.js`: message ids as UUIDv7                      |      21 |       0 |
| [LCTYSP-1003](LCTYSP-1003_ui-texts.feature)                   | `js/i18n.js` and the language files: UI texts            |      22 |      10 |
| [LCTYSP-1004](LCTYSP-1004_common.feature)                     | `js/common.js`: ids, times, URLs and settings            |      18 |      26 |
| [LCTYSP-1005](LCTYSP-1005_text-attributes.feature)            | `js/ui/text-attr.js`: text attributes and base64         |      17 |       0 |
| [LCTYSP-1006](LCTYSP-1006_sse.feature)                        | `js/llm/sse.js`: server-sent events                      |      23 |       0 |
| [LCTYSP-1007](LCTYSP-1007_responses-stream.feature)           | `js/llm/responses.js` and `client.js`: the Responses API |      29 |       0 |
| [LCTYSP-1008](LCTYSP-1008_llm-request.feature)                | `js/llm/history.js`: the request from a conversation     |      17 |       0 |
| [LCTYSP-1009](LCTYSP-1009_storage-api.feature)                | `js/api/storage.js`: the client of the HTTP API          |      29 |       9 |
| [LCTYSP-1010](LCTYSP-1010_meta-db.feature)                    | `js/api/meta-db.js`: the browser's copy of the meta      |       0 |      17 |
| [LCTYSP-1011](LCTYSP-1011_vector-store.feature)               | `js/search/vectors.js`: vector records and search        |      25 |       0 |
| [LCTYSP-1012](LCTYSP-1012_embedding.feature)                  | `js/search/embed.js`: embedding and indexing             |      27 |       0 |
| [LCTYSP-1013](LCTYSP-1013_fuzzy-search-worker.feature)        | `fuzzy_search.worker.js`: semantic search                |      28 |       0 |
| [LCTYSP-1014](LCTYSP-1014_markdown.feature)                   | `js/ui/markdown.js`: Markdown rendering                  |      67 |      15 |
| [LCTYSP-1015](LCTYSP-1015_commands.feature)                   | `js/ui/lcty-cmd.js`: command tags                        |       0 |      17 |
| [LCTYSP-1016](LCTYSP-1016_conversation-file-elements.feature) | `/c/lcty.v1.mjs`: the elements of a conversation file    |       0 |      66 |
| [LCTYSP-1017](LCTYSP-1017_conversation-elements.feature)      | `js/ui/lcty-elements.js`: messages and the composer      |       0 |      27 |
| [LCTYSP-1018](LCTYSP-1018_tags.feature)                       | `js/tags.js`: tags, drafts and memory                    |      14 |      25 |
| [LCTYSP-1019](LCTYSP-1019_search-panel.feature)               | `js/search/search-panel.js`: the search panel            |       0 |      21 |

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

## Node.js or the browser

A Scenario runs in Node.js unless it needs the browser: elements and the HTML parser (`document`, `innerHTML`,
custom elements, Shadow DOM, dialogs), IndexedDB, `localStorage`, or the page's origin read by the module itself.
Such a Scenario has "Given a page on the server's origin" among its lines: in the Background when every
Scenario of the feature needs it, or else as the first line of each Scenario that does, so a feature can be split
between the two (LCTYSP-1009, for example). Node.js gets no fake DOM (no jsdom or happy-dom): what is tested there is
what the module does without one. Only a global the module merely reads on the way is stood in for, and the test file's
head comment says which; for example `document.documentElement.lang`, the only part of the page `LctyT._()` reads.

Workers and wasm run in Node.js too: Node.js 26 has Web Workers (`--experimental-web-worker`) and WebAssembly, so a
worker is the real script of `public/` running as a real worker (LCTYSP-1011, LCTYSP-1013). What the test stands in
for is the site around it, as `context.route` does in the browser: `tests/unit/node-preload.cjs` (loaded with
`--require`, which also runs in classic workers, unlike `--import`) sends each request of a worker to the test, and
requests a worker's script from the test before starting it, so a script that cannot be loaded is the worker's error
event, as in a browser. A worker whose Scenario also needs IndexedDB (LCTYSP-1001) stays in the browser.

The browser keeps one more check that is not a Scenario: `unit-page.spec.js` imports every module tested in Node.js in
both browsers, so a module that only Node.js can load fails there.

## How a test is written

Each feature has one test file per runner, `tests/unit/<name>.test.js` (Node.js) and `tests/unit/<name>.spec.js` (the
browser), whose head comment names the feature. Each Scenario is a test with the Scenario's title (an Examples row adds
its first column in parentheses), and each line of the Scenario, the Background's first, is a step with the line word
for word, in order. In Node.js:

```js
import { expect, publicUrl, scenario } from "./node-unit.js";

const { uuidv7, UUID_RE } = await import(publicUrl("js/uuid.js"));

scenario("A new id is a canonical UUIDv7", async ({ step }) => {
	let id;
	await step("When uuidv7() makes an id", () => {
		id = uuidv7();
	});
	await step("Then it matches UUID_RE", () => {
		expect(UUID_RE.test(id)).toBe(true);
	});
});
```

- `tests/unit/node-unit.js`: `scenario(title, fn)` is a `node:test` test; `step(line, body)` runs a line as a subtest
  named after it, and a failed step stops the Scenario, as `test.step()` does in Playwright. `expect` is Playwright's,
  so the assertions read the same in both runners. `publicUrl(path)` is the file of `public/` to import,
  `useLctyT({ lang, langs })` makes the global `LctyT` that `js/i18n.js` needs from `/c/lcty.v1.mjs` and its languages,
  and `routeFetch(t, handler)` answers every request of the test with `handler(request)`. In Node.js the root of the
  site that `siteUrl()` of `js/site.js` finds is `public/` itself ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)),
  so `routeFetch` gives the handler a URL under `public/` as the same path on the page's origin
  (`http://127.0.0.1:45290/v1/tags`), the request a page would send. The handler also answers the requests of the
  workers and of their scripts (`node-preload.cjs`); a handler that answers `undefined` lets the site serve the file of
  `public/` (`route.continue()` in the browser), and one that throws fails the request without a response
  (`route.abort()`). The workers a test started are ended when it ends, as closing the page does.

In the browser:

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

- `tests/unit/unit-page.js` serves the empty page: `givenAPage(page, context, { lang, langs, body })` is the line
  "Given a page on the server's origin". The page loads `/c/lcty.v1.js` (the global `LctyT` that `js/i18n.js` needs)
  unless told not to, and the languages it is given.
- Modules are imported inside the page with `import()`. Values cross between the test and the page as JSON, so a test
  turns typed arrays, `Map`s and elements into plain values inside `page.evaluate` before returning them.
- Requests the module makes are answered with `context.route` (it also catches a worker's requests), never by the
  server's data.

`tests/unit/check-scenarios.js` checks the tests that ran against the features: every Scenario is one passing test, in
Node.js or in each browser as its lines say, whose steps are its lines; and every test of a feature is one of its
Scenarios. It reads what the runners write: `tests/unit/scenarios-reporter.js` (a `node:test` reporter that `npm run
test:node` uses) and Playwright's JSON reporter.

## The test environment

- **Node.js.** 26 or later, run as `node --experimental-web-worker --require ./tests/unit/node-preload.cjs --test`
  (`npm run test:node`; Node.js 24 has no Web Workers). Each test file runs in a process of its own, its tests one
  after another; a test that replaces a global (`fetch`) puts it back when it ends.
- **Browsers.** Chromium and WebKit, as for the UI tests; every browser test runs in both.
- **Server.** The browser tests share the server the UI tests start (`playwright.config.js`): port 45290 by default
  (`LCTY_TEST_PORT` to change it), with an empty data directory in the temporary folder. Unit tests use it only to
  serve `public/`.
- **State.** Every browser test gets a new browser context, so `localStorage` and IndexedDB start empty.
- **Parallel.** Because a unit test answers every request it makes and keeps its state in its own context, the browser
  unit tests run in parallel, every test on its own (`fullyParallel`, projects `unit-chromium` and `unit-webkit`, which
  run only the `*.spec.js`). The UI tests share the server's data directory, so they run one at a time (`ui-chromium`,
  then `ui-webkit`). A unit test must therefore never depend on another test or on the server's data.

## Running the tests

```bash
npm run test:node
```

```bash
npm run test:unit
```

`npm run test:node` runs the tests in Node.js, without the server or the browsers, and writes
`test-results-node/scenarios.json`; `npm run test:unit` runs them and then the browser's. `npm run test:unit --
--project=unit-chromium` runs one browser, and `npm run test:unit -- -g "UUIDv7"` the browser tests whose titles match
(`node --test --test-name-pattern="UUIDv7" tests/unit/*.test.js` for Node.js). To check the tests against the
features:

```bash
npm run check:scenarios -- --node test-results-node/scenarios.json
```

`--browser <file>` checks a Playwright JSON report (`PLAYWRIGHT_JSON_OUTPUT_NAME=<file> npx playwright test
--reporter=json`) the same way. CI runs the Node.js tests on their own (`.github/workflows/node.yml`: no server, no
browsers) and the browser tests with the UI tests (`.github/workflows/browser.yml`), and checks each of them.
