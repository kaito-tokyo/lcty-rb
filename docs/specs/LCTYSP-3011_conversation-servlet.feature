# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/c/servlet.rb (LCTYSP-0005, with LCTYSP-0003 and LCTYSP-0010). Each Scenario is a test of the
# same title in tests/backend/c_servlet_test.rb, whose steps are the lines below.

Feature: LCTYSP-3011 Conversation servlet

  Chatty::C::Servlet, mounted at /c, serves under /c/ the conversation files of data/c/ (/c/<id>.html, untouched) and
  the files of public/c/ that C.publish_assets listed at startup (the new conversation page index.html, without the
  .d.ts and .license files), and redirects the version 1 names a conversation file loads (lcty.v1.js,
  lcty.v1.lang-<lang>.js, lcty.v1.css and lcty.v1.module.js) to their files in /lcty.v1/ (LCTYSP-3017); everything else
  is 404. /c/ itself is the new conversation page, and /c without the slash redirects to c/ with its query, so that the
  page's relative paths resolve (LCTYSP-0005). C.publish_assets also copies what a conversation file opened directly
  needs into data/c/, under the version 1 names (lcty.v1.js from public/lcty.v1/lcty.v1.cjs, and lcty.v1.css), and
  C.write_if_changed writes a file by an atomic replace only when its bytes change.

  Scenario: A conversation file is served as it is
    Given a conversation file made by the store
    When GET /c/<id>.html is requested
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is the bytes of the file

  Scenario Outline: What is not a conversation file or a published file is 404
    Given a conversation file made by the store, and the files "notes.txt" and "<id> copy.html" in data/c/
    When GET <path> is requested
    Then the status is 404

    Examples:
      | path                       |
      | /c/<unknown id>.html       |
      | /c/<id>                    |
      | /c/<id>.htm                |
      | /c/sub/<id>.html           |
      | /c/<id>%20copy.html        |
      | /c/notes.txt               |
      | /c/lcty.v1.d.ts            |
      | /c/lcty.v1.cjs             |
      | /c/lcty.v1.mjs             |
      | /c/..%2Fsecret.html        |

  Scenario Outline: /c/ is the new conversation page, public/c/index.html
    When GET <path> is requested
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is public/c/index.html

    Examples:
      | path              |
      | /c/               |
      | /c/?fork=abc&at=3 |

  Scenario Outline: /c redirects to c/ with its query
    When GET <path> is requested
    Then the status is 302 with the Location <location>, relative to the request

    Examples:
      | path             | location             |
      | /c               | "c/"                 |
      | /c?fork=abc&at=3 | "c/?fork=abc&at=3"   |

  Scenario Outline: The lcty.v1 names redirect to their files in /lcty.v1/
    When GET /c/<name> is requested
    Then the status is 302 with the Location "../lcty.v1/<file>", relative to the request

    Examples:
      | name               | file                |
      | lcty.v1.css        | lcty.v1.css         |
      | lcty.v1.js         | lcty.v1.cjs         |
      | lcty.v1.lang-ja.js | lcty.v1.lang-ja.cjs |
      | lcty.v1.module.js  | lcty.v1.async.mjs   |

  Scenario: A published file answers 304 when it has not changed
    Given the ETag of GET /c/index.html
    When GET /c/index.html is requested with If-None-Match of that ETag
    Then the status is 304

  Scenario: The copy in data/c/ is never what /c/ serves
    Given the copy of lcty.v1.css in data/c/ differs from public/lcty.v1/lcty.v1.css
    When GET /c/lcty.v1.css is requested
    Then it is redirected to /lcty.v1/lcty.v1.css, not answered with the copy

  Scenario: C.publish_assets lists the files of public/c/ but documentation and licences
    When C.publish_assets runs
    Then C.published is every file under public/c/, sorted, except the names ending in .d.ts or .license
    And it has index.html
    And it is frozen

  Scenario: C.publish_assets copies what a conversation file opened directly needs into data/c/
    When C.publish_assets runs
    Then data/c/lcty.v1.js and data/c/lcty.v1.css have the bytes of public/lcty.v1/lcty.v1.cjs and lcty.v1.css
    And no other file of public/lcty.v1/ is copied, such as lcty.v1.module.js (lcty.v1.async.mjs)

  Scenario: C.publish_assets copies the same files into the root of data/ and into data/t/, for the tag files
    When C.publish_assets runs
    Then data/lcty.v1.js, data/lcty.v1.css, data/t/lcty.v1.js and data/t/lcty.v1.css have the same bytes as those of data/c/

  Scenario: C.publish_assets leaves copies that are up to date alone
    Given C.publish_assets has run
    When C.publish_assets runs again
    Then data/c/lcty.v1.js and data/c/lcty.v1.css are the same files as before, not rewritten

  Scenario: C.publish_assets puts back a copy that was changed
    Given data/c/lcty.v1.css was changed
    When C.publish_assets runs
    Then data/c/lcty.v1.css has the bytes of public/lcty.v1/lcty.v1.css again

  Scenario: C.publish_assets leaves the other files of data/c/ alone
    Given a file "lcty.v0.js" in data/c/ that an older server made
    When C.publish_assets runs
    Then data/c/lcty.v0.js is still there with its content

  Scenario: C.write_if_changed writes a new file and the folders it needs
    When C.write_if_changed writes "hello" to a/b/file.txt in an empty folder
    Then a/b/file.txt has the bytes "hello"
    And no temporary file is left next to it

  Scenario: C.write_if_changed leaves a file with the same bytes alone
    Given a file with "hello"
    When C.write_if_changed writes "hello" to it
    Then it is the same file as before, not rewritten

  Scenario: C.write_if_changed replaces a file whose bytes differ
    Given a file with "hello"
    When C.write_if_changed writes "world" to it
    Then the file is replaced by a new one with the bytes "world"
    And no temporary file is left next to it

  Scenario: C.write_if_changed compares bytes, whatever the encoding of the string
    Given a file with the UTF-8 bytes of "日本語"
    When C.write_if_changed writes "日本語" as a UTF-8 string to it
    Then it is the same file as before, not rewritten
