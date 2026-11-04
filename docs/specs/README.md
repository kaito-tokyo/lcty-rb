<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# Specifications

Specifications of lcty-rb. Each spec describes the current design of one topic and the reasons behind it.

| ID | Title | Status |
|---|---|---|
| [LCTYSP-001](LCTYSP-001_architecture.md) | Architecture | Accepted |
| [LCTYSP-002](LCTYSP-002_llm-backend.md) | LLM backend | Accepted |
| [LCTYSP-003](LCTYSP-003_conversation-file.md) | Conversation file | Accepted |
| [LCTYSP-004](LCTYSP-004_editing.md) | Editing a conversation | Accepted |
| [LCTYSP-005](LCTYSP-005_page-and-elements.md) | Pages and custom elements | Accepted |
| [LCTYSP-006](LCTYSP-006_http-api.md) | HTTP API | Accepted |
| [LCTYSP-007](LCTYSP-007_search.md) | Search | Accepted |
| [LCTYSP-008](LCTYSP-008_vector-binary.md) | Vector binary and semantic search | Accepted |
| [LCTYSP-009](LCTYSP-009_tags-and-memory.md) | Tags and memory | Accepted |
| [LCTYSP-010](LCTYSP-010_data-and-settings.md) | Data directory and settings | Accepted |

## Conventions

- File names are `LCTYSP-NNN_short-name.md`. `LCTYSP-NNN` is the permanent id; the short name may change.
- Refer to specs by id (`LCTYSP-003`), including in code comments.
- Numbers are never reused. A withdrawn or replaced spec keeps its number with the status `Withdrawn` or
  `Superseded by LCTYSP-NNN`.
- Status is one of `Draft`, `Accepted`, `Withdrawn`, `Superseded by LCTYSP-NNN`.
- Specs describe the current design. History lives in git.
