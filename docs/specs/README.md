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

## Number ranges

IDs have four digits, and the first digit says what kind of document it is:

| Range         | Kind                                |
| ------------- | ----------------------------------- |
| `LCTYSP-0xxx` | Specifications (this directory)     |
| `LCTYSP-1xxx` | Gherkin features for the unit tests |
| `LCTYSP-2xxx` | Gherkin features for the UI tests   |

## Conventions

- File names are `LCTYSP-NNNN_short-name.md` (a Gherkin feature uses its own extension). `LCTYSP-NNNN` is the
  permanent id; the short name may change.
- Refer to specs by id (`LCTYSP-0003`), including in code comments.
- Numbers are never reused. A withdrawn or replaced spec keeps its number with the status `Withdrawn` or
  `Superseded by LCTYSP-NNNN`.
- Status is one of `Draft`, `Accepted`, `Withdrawn`, `Superseded by LCTYSP-NNNN`.
- Specs describe the current design. History lives in git.
