# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The paths of the site as a browser meets them (LCTYSP-0005 "Routing" and "The lcty.v1 files"). Each Scenario is a test
# of the same title in tests/ui/site.spec.js, whose steps are the lines below.

Feature: LCTYSP-2005 The paths of the site

  Conversation files and tag files load lcty.v1.js, lcty.v1.lang-ja.js and lcty.v1.css next to themselves, by names
  they keep on disk, and every page of /c/ and /t/ is one directory below the root of the site. These Scenarios request
  the paths as a browser does, following redirects, and check where they lead: not how the server answers them, so they
  hold for any server that keeps those paths working. The Scenarios make the conversations they need through the HTTP
  API.

  Scenario Outline: The names a page loads next to itself lead to the files of /lcty.v1/
    When <path> is requested
    Then it leads to a path under /lcty.v1/
    And the answer is 200 with the type <type>

    Examples:
      | path                  | type              |
      | /c/lcty.v1.js         | "text/javascript" |
      | /c/lcty.v1.lang-ja.js | "text/javascript" |
      | /c/lcty.v1.css        | "text/css"        |
      | /t/lcty.v1.js         | "text/javascript" |
      | /t/lcty.v1.lang-ja.js | "text/javascript" |
      | /t/lcty.v1.css        | "text/css"        |

  Scenario Outline: A directory without its slash leads to it, with its query
    When <path> is requested
    Then it leads to <target>
    And the answer is 200 with the type "text/html"

    Examples:
      | path    | target    |
      | /c      | /c/       |
      | /c?q=ab | /c/?q=ab  |
      | /t      | /t/       |

  Scenario: A conversation file is served as it is
    Given a conversation titled "経路のテスト" made through the HTTP API
    When /c/<id>.html is requested
    Then the answer is 200 with the type "text/html"
    And the body starts with "<!DOCTYPE html>" and holds the title "経路のテスト"

  Scenario Outline: What is not a page or a file of the site is 404
    When <path> is requested
    Then the answer is 404

    Examples:
      | path                      |
      | /c/no-such-id.html        |
      | /c/sub/no-such-id.html    |
      | /c/notes.txt              |
      | /t/00010-no-such-tag.html |
      | /t/notes.html             |
