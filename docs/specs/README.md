<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# Specifications

Specifications of lcty-rb. Each spec describes the current design of one topic and the reasons behind it.

| ID                                              | Title                             | Status   |
| ----------------------------------------------- | --------------------------------- | -------- |
| [LCTYSP-0001](LCTYSP-0001_architecture.md)      | Architecture                      | Accepted |
| [LCTYSP-0002](LCTYSP-0002_llm-backend.md)       | LLM backend                       | Accepted |
| [LCTYSP-0003](LCTYSP-0003_conversation-file.md) | Conversation file                 | Accepted |
| [LCTYSP-0004](LCTYSP-0004_editing.md)           | Editing a conversation            | Accepted |
| [LCTYSP-0005](LCTYSP-0005_page-and-elements.md) | Pages and custom elements         | Accepted |
| [LCTYSP-0006](LCTYSP-0006_http-api.md)          | HTTP API                          | Accepted |
| [LCTYSP-0007](LCTYSP-0007_search.md)            | Search                            | Accepted |
| [LCTYSP-0008](LCTYSP-0008_vector-binary.md)     | Vector binary and semantic search | Accepted |
| [LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)   | Tags and memory                   | Accepted |
| [LCTYSP-0010](LCTYSP-0010_data-and-settings.md) | Data directory and settings       | Accepted |
| [LCTYSP-0011](LCTYSP-0011_module-bundler.md)    | Module bundler                    | Accepted |

## Gherkin features

Behaviour written as Gherkin. Each feature is tested by one test per Scenario, with the Scenario's title and its lines
as the test's steps (for the frontend unit features, `LCTYSP-1xxx`, a `node:test` file in Node.js and a Playwright spec
for the Scenarios that need a browser; a Playwright spec for the UI features, `LCTYSP-2xxx`; and a Minitest file for the
backend features, `LCTYSP-3xxx`; see
[LCTYSP-1000](LCTYSP-1000_frontend-unit-tests.md) for the frontend unit tests and
[LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md) for the backend ones).

| ID                                                            | Title                                              | Tested by                                                    |
| ------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| [LCTYSP-1001](LCTYSP-1001_sync-c-meta.feature)                | Syncing the meta of every conversation into c_meta | `tests/unit/sync_c_meta.spec.js`                             |
| [LCTYSP-1002](LCTYSP-1002_uuid-v7.feature)                    | Message ids as UUIDv7                              | `tests/unit/uuid.test.js`                                    |
| [LCTYSP-1003](LCTYSP-1003_ui-texts.feature)                   | UI texts                                           | `tests/unit/i18n.test.js`, `tests/unit/i18n.spec.js`         |
| [LCTYSP-1004](LCTYSP-1004_common.feature)                     | Ids, times, URLs and settings                      | `tests/unit/common.test.js`, `tests/unit/common.spec.js`     |
| [LCTYSP-1005](LCTYSP-1005_text-attributes.feature)            | Reading text strings from attributes               | `tests/unit/text-attr.test.js`                               |
| [LCTYSP-1006](LCTYSP-1006_sse.feature)                        | Reading server-sent events                         | `tests/unit/sse.test.js`                                     |
| [LCTYSP-1007](LCTYSP-1007_responses-stream.feature)           | Streaming a reply through the Responses API        | `tests/unit/responses.test.js`                               |
| [LCTYSP-1008](LCTYSP-1008_llm-request.feature)                | Building the request from a conversation           | `tests/unit/history.test.js`                                 |
| [LCTYSP-1009](LCTYSP-1009_storage-api.feature)                | The client of the HTTP API                         | `tests/unit/storage.test.js`, `tests/unit/storage.spec.js`   |
| [LCTYSP-1010](LCTYSP-1010_meta-db.feature)                    | The browser's copy of the meta                     | `tests/unit/meta-db.spec.js`                                 |
| [LCTYSP-1011](LCTYSP-1011_vector-store.feature)               | Vector records and the vector store                | `tests/unit/vectors.test.js`                                 |
| [LCTYSP-1012](LCTYSP-1012_embedding.feature)                  | Embedding and indexing                             | `tests/unit/embed.test.js`                                   |
| [LCTYSP-1013](LCTYSP-1013_fuzzy-search-worker.feature)        | The semantic search worker                         | `tests/unit/fuzzy-search-worker.test.js`                     |
| [LCTYSP-1014](LCTYSP-1014_markdown.feature)                   | Rendering Markdown to HTML                         | `tests/unit/markdown.test.js`, `tests/unit/markdown.spec.js` |
| [LCTYSP-1015](LCTYSP-1015_commands.feature)                   | Command tags                                       | `tests/unit/lcty-cmd.spec.js`                                |
| [LCTYSP-1016](LCTYSP-1016_conversation-file-elements.feature) | The elements of a conversation file                | `tests/unit/conversation-file-elements.spec.js`              |
| [LCTYSP-1017](LCTYSP-1017_conversation-elements.feature)      | Messages and the composer of a conversation        | `tests/unit/lcty-elements.spec.js`                           |
| [LCTYSP-1018](LCTYSP-1018_tags.feature)                       | Tags, drafts and memory                            | `tests/unit/tags.test.js`, `tests/unit/tags.spec.js`         |
| [LCTYSP-1019](LCTYSP-1019_search-panel.feature)               | The search panel of the sidebar                    | `tests/unit/search-panel.spec.js`                            |
| [LCTYSP-1021](LCTYSP-1021_lcty-t.feature)                     | The tags in the browser: lcty_t.worker.js          | `tests/unit/lcty-t.spec.js`                                  |
| [LCTYSP-3001](LCTYSP-3001_uuid-v7.feature)                    | Message ids as UUIDv7                              | `tests/backend/uuid_test.rb`                                 |
| [LCTYSP-3002](LCTYSP-3002_conversation-html.feature)          | Conversation files as HTML                         | `tests/backend/conv_html_test.rb`                            |
| [LCTYSP-3003](LCTYSP-3003_store.feature)                      | Storing conversations, tags and memory             | `tests/backend/store_test.rb`                                |
| [LCTYSP-3004](LCTYSP-3004_search-index.feature)               | The search index                                   | `tests/backend/search_index_test.rb`                         |
| [LCTYSP-3005](LCTYSP-3005_tag-store.feature)                  | The tag store                                      | `tests/backend/tag_store_test.rb`                            |
| [LCTYSP-3006](LCTYSP-3006_vector-records.feature)             | Vector binary records                              | `tests/backend/vector_records_test.rb`                       |
| [LCTYSP-3007](LCTYSP-3007_vector-db.feature)                  | Vector DB                                          | `tests/backend/vector_db_test.rb`                            |
| [LCTYSP-3008](LCTYSP-3008_server-settings.feature)            | Server settings                                    | `tests/backend/config_test.rb`                               |
| [LCTYSP-3009](LCTYSP-3009_module-bundler.feature)             | Module bundler                                     | `tests/backend/bundle_test.rb`                               |
| [LCTYSP-3010](LCTYSP-3010_module-servlet.feature)             | Module servlet                                     | `tests/backend/module_servlet_test.rb`                       |
| [LCTYSP-3011](LCTYSP-3011_conversation-servlet.feature)       | Conversation servlet                               | `tests/backend/c_servlet_test.rb`                            |
| [LCTYSP-3012](LCTYSP-3012_http-api.feature)                   | HTTP API                                           | `tests/backend/v1_servlet_test.rb`                           |
| [LCTYSP-3013](LCTYSP-3013_gzip.feature)                       | Transparent gzip                                   | `tests/backend/gzip_test.rb`                                 |
| [LCTYSP-3014](LCTYSP-3014_tag-files.feature)                  | Tag files                                          | `tests/backend/tag_files_test.rb`                            |
| [LCTYSP-3015](LCTYSP-3015_tag-order-servlet.feature)          | Tag reorder servlet                                | `tests/backend/t_servlet_test.rb`                            |

## Number ranges

IDs have four digits, and the first digit says what kind of document it is:

| Range         | Kind                                                           |
| ------------- | -------------------------------------------------------------- |
| `LCTYSP-0xxx` | Specifications                                                 |
| `LCTYSP-1xxx` | Gherkin features for the frontend unit tests (`tests/unit/`)   |
| `LCTYSP-2xxx` | Gherkin features for the frontend UI tests (`tests/ui/`)       |
| `LCTYSP-3xxx` | Gherkin features for the backend unit tests (`tests/backend/`) |

The first number of a test range, `x000`, is a Markdown document that explains the range: what it covers, how its
features and tests are written, and how they run. [LCTYSP-1000](LCTYSP-1000_frontend-unit-tests.md) explains the 1000
range and [LCTYSP-3000](LCTYSP-3000_backend-unit-tests.md) the 3000 range; the features start at `x001`.

## Conventions

- Every `LCTYSP-` document lives in this directory, whatever its kind.
- File names are `LCTYSP-NNNN_short-name.md`, or `LCTYSP-NNNN_short-name.feature` for a Gherkin feature.
  `LCTYSP-NNNN` is the permanent id; the short name may change. Test code is not named after its feature: it lives
  with its kind of tests (`tests/unit/`, `tests/ui/`, `tests/backend/`) and names the feature in its head comment.
- Refer to specs by id (`LCTYSP-0003`), including in code comments.
- Numbers are never reused. A withdrawn or replaced spec keeps its number with the status `Withdrawn` or
  `Superseded by LCTYSP-NNNN`.
- Status is one of `Draft`, `Accepted`, `Withdrawn`, `Superseded by LCTYSP-NNNN`.
- Specs describe the current design. History lives in git.
