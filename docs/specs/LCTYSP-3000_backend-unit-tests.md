<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-3000: Backend unit tests

- Status: Accepted
- Related: [LCTYSP-0001](LCTYSP-0001_architecture.md), [LCTYSP-0010](LCTYSP-0010_data-and-settings.md)
- Implementation: `tests/backend/` (`helper.rb`, `run.rb` and one `*_test.rb` per feature), `.github/workflows/backend.yml`

## Summary

The 3000 range holds the behaviour of the server, the Ruby code in `lib/` and `lcty.rb`, written as Gherkin features.
LCTYSP-3000 is this document, the guide to the range; LCTYSP-3001 and on are the features. Each feature describes one
part of the server on its own and is tested by a Minitest file in `tests/backend/` that has one test per Scenario. The
tests run on the server's Ruby with nothing installed, against a new, empty data directory, and never touch the real
data or `llama-server`.

## The ranges of LCTYSP

| Range         | What                                     | Tested by                  |
| ------------- | ---------------------------------------- | -------------------------- |
| `LCTYSP-0xxx` | Specifications (the design and why)      | (the tests below)          |
| `LCTYSP-1xxx` | Frontend unit tests: one part on its own | Playwright, `tests/unit/`  |
| `LCTYSP-2xxx` | Frontend UI tests: the pages             | Playwright, `tests/ui/`    |
| `LCTYSP-3xxx` | Backend unit tests: one part on its own  | Minitest, `tests/backend/` |

The specifications say what the server must do and why; a 3xxx feature says, Scenario by Scenario, what one module
does today, in terms a test can check. When the two disagree, the specification wins and the feature (and the code) are
changed.

## The features

| ID                                                   | Part of the server                                   |
| ---------------------------------------------------- | ---------------------------------------------------- |
| [LCTYSP-3001](LCTYSP-3001_uuid-v7.feature)           | `lib/uuid.rb`: message ids as UUIDv7                 |
| [LCTYSP-3002](LCTYSP-3002_conversation-html.feature) | `lib/conv_html.rb`: the conversation file format     |
| [LCTYSP-3003](LCTYSP-3003_store.feature)             | `lib/store.rb`: conversations and their tags         |
| [LCTYSP-3004](LCTYSP-3004_search-index.feature)      | `lib/search_index.rb`: the keyword search index      |
| [LCTYSP-3005](LCTYSP-3005_tag-store.feature)         | `lib/tag_store.rb`: `tags.sqlite`                    |
| [LCTYSP-3006](LCTYSP-3006_vector-records.feature)    | `lib/v1/vector_records.rb`: the vector binary format |
| [LCTYSP-3007](LCTYSP-3007_vector-db.feature)         | `lib/v1/vector_db.rb`: the vector DB                 |
| [LCTYSP-3008](LCTYSP-3008_server-settings.feature)   | `lib/config.rb`: the server's settings               |
| [LCTYSP-3012](LCTYSP-3012_http-api.feature)          | `lib/v1/servlet.rb`: the HTTP API `/v1/`             |
| [LCTYSP-3014](LCTYSP-3014_tag-files.feature)         | `lib/tag_files.rb`: the tag files in `t/`            |
| [LCTYSP-3016](LCTYSP-3016_file-types.feature)        | `lcty.rb`: the types of the files served             |
| [LCTYSP-3018](LCTYSP-3018_site-servlets.feature)     | `lib/servlets.rb`: the servlets of the site          |
| [LCTYSP-3019](LCTYSP-3019_entry-point.feature)       | `lcty.rb`: the entry point                           |
| [LCTYSP-3020](LCTYSP-3020_rpc.feature)               | `lib/rpc/`: the RPC protocol at `/v1/rpc`            |
| [LCTYSP-3022](LCTYSP-3022_rpc-pages.feature)         | `lib/rpc/`: several pages over `/v1/rpc` at once     |
| [LCTYSP-3021](LCTYSP-3021_openapi.feature)           | `openapi.yaml`: every path the site answers          |
| [LCTYSP-3023](LCTYSP-3023_convert.feature)           | `lib/convert_c.rb`: `tools/convert.rb`               |
| [LCTYSP-3024](LCTYSP-3024_password.feature)          | `lib/password.rb`: the password hashes               |
| [LCTYSP-3025](LCTYSP-3025_basic-auth.feature)        | `lib/basic_auth.rb`: Basic authentication            |

Every module of `lib/` has a feature. What `Chatty.run` itself does (binding the address, mounting the servlets,
handling signals) is left to the UI tests, which start the real server.

## How a feature is written

- One feature per module, named `LCTYSP-3NNN_short-name.feature` and numbered in the order it was added (numbers are
  never reused, [docs/specs/README.md](README.md)).
- A comment at the top names the module, the specifications it follows, and the test file.
- The `Feature:` line is `LCTYSP-3NNN Title`, followed by a paragraph that says what the module is for and how it is
  used, so the Scenarios can be short.
- Scenarios describe behaviour that can be observed from outside the module: return values, `HttpError` statuses and
  messages, files written, HTTP responses. Not private methods or SQL.
- A Scenario Outline is used when only the data changes; each Examples row is a test of its own.
- When a test finds a bug, the code is fixed and a Scenario that failed before the fix is added. Behaviour whose intent
  is unclear is not written as a Scenario until it is decided.

## How a test is written

Each feature has one file, `tests/backend/<name>_test.rb`, whose head comment names the feature. The test class
inherits `Lcty::Scenarios` (`tests/backend/helper.rb`):

```ruby
class UuidTest < Lcty::Scenarios
  scenario 'The first 48 bits are the milliseconds' do
    id = nil
    step('When Uuid.v7 makes an id for the milliseconds 0x0123456789ab') { id = Uuid.v7(0x0123456789ab) }
    step('Then the id starts with "01234567-89ab-7"') { assert id.start_with?('01234567-89ab-7'), id }
  end
end
```

- `scenario` names the test after the Scenario's title. An Examples row adds its first column in parentheses:
  `Top-level await is rejected in the entry (await init();)`.
- `step` takes a line of the Scenario, word for word, in order. Every line is a step and every step is a line, so the
  feature and the test read side by side, and a failure names the line that failed.
- A Background is run as the first steps of every test.

## The test environment

- **Ruby.** Ruby 2.6, as macOS's `/usr/bin/ruby`, with Minitest, which it bundles. The tests use the same libraries as
  the server (the standard library, nokogiri, sqlite3, webrick) and nothing else.
- **Data.** `helper.rb` points `LCTY_DATA_DIR` at a new, empty folder in the temporary folder before `lib/config.rb` is
  loaded, whatever it was, and removes it afterwards (`LCTY_TEST_KEEP_DATA=1` keeps it). Every test of a run shares it:
  `Lcty.open_data` opens it as the server does, once, and each test makes conversations, tags and words with ids of its
  own. Tests of a module that takes a path (the search index, the tag store, the vector DB, the servlets) give it a
  folder of their own instead.
- **Settings.** `lib/config.rb` reads the environment once, so LCTYSP-3008 checks it in child processes.
- **HTTP.** The servlet tests start a WEBrick server on `127.0.0.1` on a free port, mount the servlets as `Chatty.run`
  does, and request it over HTTP. No other server is needed.
- **Order.** Minitest runs the tests in a random order; they must pass in any order.

## Running the tests

```bash
ruby tests/backend/run.rb
```

`npm run test:backend` does the same. Minitest's options follow, for example `-n "/same millisecond/"` to run the tests
whose names match, or `--seed 1234` to repeat an order.

## CI

`.github/workflows/backend.yml` runs the tests on Linux in the dev container `.devcontainer/ruby-2.6.10`
(`ruby:2.6.10` with the libraries of the `Gemfile`, the versions macOS's `/usr/bin/ruby` has), started from its
`devcontainer.json` with the Dev Container CLI. It runs for every pull request to `main` and, through
`push-main.yml`, for every push to `main`. To do the same by hand:

```bash
npx --yes @devcontainers/cli@0.89.0 up --workspace-folder . --config .devcontainer/ruby-2.6.10/devcontainer.json
```

```bash
npx --yes @devcontainers/cli@0.89.0 exec --workspace-folder . --config .devcontainer/ruby-2.6.10/devcontainer.json ruby tests/backend/run.rb
```
