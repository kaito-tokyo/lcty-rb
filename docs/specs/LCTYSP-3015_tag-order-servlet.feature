# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/t/servlet.rb (LCTYSP-0005, LCTYSP-0009). Each Scenario is a test of the same title in
# tests/backend/t_servlet_test.rb, whose steps are the lines below.

Feature: LCTYSP-3015 Tag reorder servlet

  Chatty::T::Servlet, mounted at /t, mirrors /c/ for the tags: /t/ (and /t/index.html) is the tag reorder page,
  public/t/index.html, and /t without the slash redirects to t/ with its query, so that the page's relative paths
  resolve. Every directory of the site that holds HTML has the lcty.v1.* files, so /t/lcty.v1.* serves those of
  public/c/ that C.publish_assets listed. /t/NNNNN-<part>.html returns the tag file data/t/NNNNN-<part>.html as it is,
  as /c/<id>.html does a conversation file; its name starts with five digits, so it never collides with the page or
  the lcty.v1 files. Everything else is 404.

  Scenario Outline: /t/ is the tag reorder page, public/t/index.html
    When GET <path> is requested
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is public/t/index.html

    Examples:
      | path            |
      | /t/             |
      | /t/index.html   |

  Scenario Outline: /t redirects to t/ with its query
    When GET <path> is requested
    Then the status is 302 with the Location <location>, relative to the request

    Examples:
      | path      | location   |
      | /t        | "t/"       |
      | /t?x=1    | "t/?x=1"   |

  Scenario Outline: The lcty.v1 files are served from public/c/
    When GET /t/<name> is requested
    Then the status is 200 with the type <type>
    And the body is the bytes of public/c/<name>

    Examples:
      | name                 | type                               |
      | lcty.v1.css          | "text/css; charset=utf-8"          |
      | lcty.v1.js           | "text/javascript; charset=utf-8"   |
      | lcty.v1.lang-ja.js   | "text/javascript; charset=utf-8"   |
      | lcty.v1.module.js    | "text/javascript; charset=utf-8"   |

  Scenario Outline: A tag file is served as it is
    Given the tag file <file> in data/t/
    When GET <path> is requested
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is the bytes of the file

    Examples:
      | file                  | path                                      |
      | "00010-ruby.html"     | /t/00010-ruby.html                        |
      | "00020-料理.html"     | /t/00020-%E6%96%99%E7%90%86.html          |
      | "00030-c~23.html"     | /t/00030-c~23.html                        |

  Scenario Outline: What is not the page, an lcty.v1 file or a tag file is 404
    Given the tag file "00010-ruby.html" in data/t/
    When GET <path> is requested
    Then the status is 404

    Examples:
      | path                    |
      | /t/00020-ruby.html      |
      | /t/0010-ruby.html       |
      | /t/00010-ruby.htm       |
      | /t/lcty.v1.d.ts         |
      | /t/index.js.license     |
      | /t/notes.html           |
      | /t/sub/index.html       |
      | /t/..%2Fc%2Findex.html  |
