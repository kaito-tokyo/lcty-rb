# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of Chatty::MIME_TYPES in lcty.rb (LCTYSP-0005). Each Scenario is a test of the same title in
# tests/backend/file_types_test.rb, whose steps are the lines below.

Feature: LCTYSP-3016 The types of the files served

  Chatty::MIME_TYPES is the table of types that every servlet of lcty.rb serves files with: WEBrick's own table, with
  the text types given charset=utf-8. A JavaScript file is "text/javascript; charset=utf-8" whatever its extension
  (.js, .mjs or .cjs), since WebKit and Firefox load a worker script only when it has a JavaScript type, and WEBrick's
  own table has no .cjs (it would be application/octet-stream).

  Background:
    Given WEBrick's file handler on a temporary folder, with Chatty::MIME_TYPES

  Scenario Outline: A JavaScript file is served as text/javascript
    Given the folder has the file "a.<extension>"
    When GET /a.<extension> is requested
    Then the status is 200 with the type "text/javascript; charset=utf-8"

    Examples:
      | extension |
      | js        |
      | mjs       |
      | cjs       |
