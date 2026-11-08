# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/lcty_v1.rb (LCTYSP-0005). Each Scenario is a test of the same title in
# tests/backend/lcty_v1_test.rb, whose steps are the lines below.

Feature: LCTYSP-3017 The scripts of every page: /lcty.v1/

  Chatty::LctyV1::Servlet, mounted at /lcty.v1, serves the files of public/lcty.v1/ as they are, with
  Cache-Control: no-cache, so a browser checks its copy (304) before it uses it; the .d.cts and .license files and
  anything below a folder are 404. Conversation files and tag files load these files by the names of version 1 next to
  themselves, and LctyV1.file_for gives the file each name stands for, which /c/ and /t/ redirect to (LCTYSP-3011,
  LCTYSP-3015): lcty.v1.js is lcty.v1.cjs, lcty.v1.lang-<lang>.js is lcty.v1.lang-<lang>.cjs, lcty.v1.css is itself
  and lcty.v1.module.js is lcty.v1.async.mjs. A name whose file does not exist stands for nothing.

  Background:
    Given LctyV1::Servlet mounted at /lcty.v1

  Scenario Outline: The files of public/lcty.v1/ are served with Cache-Control: no-cache
    When GET /lcty.v1/<name> is requested
    Then the status is 200 with the type <type> and Cache-Control "no-cache"
    And the body is the bytes of public/lcty.v1/<name>

    Examples:
      | name                 | type                             |
      | lcty.v1.cjs          | "text/javascript; charset=utf-8" |
      | lcty.v1.lang-ja.cjs  | "text/javascript; charset=utf-8" |
      | lcty.v1.css          | "text/css; charset=utf-8"        |
      | lcty.v1.async.mjs    | "text/javascript; charset=utf-8" |
      | lcty.v1.c.worker.cjs | "text/javascript; charset=utf-8" |
      | lcty.v1.t.worker.cjs | "text/javascript; charset=utf-8" |

  Scenario: A file of /lcty.v1/ answers 304 when it has not changed
    Given the ETag of GET /lcty.v1/lcty.v1.cjs
    When GET /lcty.v1/lcty.v1.cjs is requested with If-None-Match of that ETag
    Then the status is 304

  Scenario Outline: What is not a file of public/lcty.v1/ is 404
    When GET <path> is requested
    Then the status is 404

    Examples:
      | path                            |
      | /lcty.v1/                       |
      | /lcty.v1/lcty.v1.d.cts          |
      | /lcty.v1/lcty.v1.c.worker.d.cts |
      | /lcty.v1/lcty.v1.js             |
      | /lcty.v1/sub/lcty.v1.cjs        |
      | /lcty.v1/..%2Flcty.rb           |

  Scenario Outline: LctyV1.file_for gives the file a version 1 name stands for
    When LctyV1.file_for is given "<name>"
    Then it returns <file>

    Examples:
      | name               | file                  |
      | lcty.v1.js         | "lcty.v1.cjs"         |
      | lcty.v1.lang-ja.js | "lcty.v1.lang-ja.cjs" |
      | lcty.v1.css        | "lcty.v1.css"         |
      | lcty.v1.module.js  | "lcty.v1.async.mjs"   |
      | lcty.v1.lang-xx.js | nil                   |
      | lcty.v1.cjs        | nil                   |
      | lcty.v1.mjs        | nil                   |
      | index.html         | nil                   |
