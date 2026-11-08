# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of the servlets of lib/servlets.rb (LCTYSP-0005, with LCTYSP-0003 and LCTYSP-0009). Each Scenario is a
# test of the same title in tests/backend/servlets_test.rb, whose steps are the lines below.

Feature: LCTYSP-3018 The servlets of the site

  Lcty::Servlets holds the servlets that serve the site's files. StaticFileServlet serves one file, given as a path
  from the working directory, with its type from MIME_TYPES, Cache-Control (no-cache unless it is given another),
  Last-Modified and an ETag, and answers a matching If-None-Match with 304. C (/c/) and T (/t/) serve a directory of
  pages: the page at the directory itself and its index.html, the data files of their data directory (C the
  conversation files <id>.html, T the tag files NNNNN-<part>.html), a redirect to the directory for the path without
  its slash, and, for every name that starts with lcty.v1, a redirect to the same name in ../lcty.v1/ that a browser
  keeps for a day. PublicDirectoryServlet serves the files below a directory, and never a path with an empty part, a
  part that starts with "." or a NUL. In the steps the servlets are mounted on one WEBrick server, with
  Lcty::Servlets::MIME_TYPES, over temporary folders; C at /base/c and T at /base/t, so the site is under /base/.

  Background:
    Given the servlets mounted on a WEBrick server over temporary folders

  # ---- StaticFileServlet ----

  Scenario Outline: A file is served with its type, no-cache, Last-Modified and an ETag
    Given the file "<name>" served by a StaticFileServlet
    When it is requested
    Then the status is 200 with the type <type>
    And Cache-Control is "no-cache", with Last-Modified and an ETag
    And the body is the bytes of the file

    Examples:
      | name       | type                             |
      | a.js       | "text/javascript; charset=utf-8" |
      | a.cjs      | "text/javascript; charset=utf-8" |
      | a.css      | "text/css; charset=utf-8"        |
      | a.html     | "text/html; charset=utf-8"       |
      | a.json     | "application/json; charset=utf-8" |

  Scenario: A Cache-Control the servlet is given is sent instead of no-cache
    Given the file "a.js" served by a StaticFileServlet given "public, max-age=60"
    When it is requested
    Then Cache-Control is "public, max-age=60"

  Scenario: The ETag of the file answers 304, with the same ETag and Cache-Control
    Given the ETag of a file served by a StaticFileServlet
    When it is requested with If-None-Match of that ETag
    Then the status is 304 with no body
    And the answer has the same ETag and Cache-Control "no-cache"

  Scenario: Another ETag is answered with the file
    Given a file served by a StaticFileServlet
    When it is requested with If-None-Match "\"other\""
    Then the status is 200 with the bytes of the file

  Scenario: A changed file gets another ETag
    Given the ETag of a file served by a StaticFileServlet
    When the file is rewritten with other bytes
    Then the ETag is another one

  Scenario: HEAD answers the headers of GET without a body
    Given a file served by a StaticFileServlet
    When it is requested with HEAD
    Then the status is 200 with the Content-Length of the file and no body

  Scenario: A file that is not there is 404
    Given a StaticFileServlet for a file that does not exist
    When it is requested
    Then the status is 404

  Scenario: POST is not allowed
    Given a file served by a StaticFileServlet
    When it is requested with POST
    Then the status is 405

  Scenario: A Cache-Control that is not a string is refused
    When a StaticFileServlet is made with the Cache-Control :public
    Then it raises ArgumentError

  # ---- C and T ----

  Scenario Outline: A directory without its slash redirects to it, with its query
    When <path> is requested
    Then the status is 302 with the Location <location>, relative to the request

    Examples:
      | path              | location           |
      | /base/c           | "/base/c/"         |
      | /base/c?fork=a&at=1 | "/base/c/?fork=a&at=1" |
      | /base/t           | "/base/t/"         |

  Scenario Outline: The directory and its index.html are its page
    When <path> is requested
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is the bytes of <page>

    Examples:
      | path              | page                |
      | /base/c/          | public/c/index.html |
      | /base/c/index.html | public/c/index.html |
      | /base/t/          | public/t/index.html |

  Scenario: A conversation file is served as it is
    Given the conversation file "abc-1.html" in the conversations' folder
    When /base/c/abc-1.html is requested
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is the bytes of the file

  Scenario Outline: A tag file is served as it is
    Given the tag file "<file>" in the tags' folder
    When it is requested under /base/t/
    Then the status is 200 with the type "text/html; charset=utf-8"
    And the body is the bytes of the file

    Examples:
      | file            |
      | 00010-ruby.html |
      | 00020-c~23.html |
      | 00030-料理.html  |

  Scenario Outline: A name that starts with lcty.v1 redirects to the same name in ../lcty.v1/ for a day
    When <path> is requested
    Then the status is 302 with the Location <location>, relative to the request
    And Cache-Control is "max-age=86400"

    Examples:
      | path                      | location                          |
      | /base/c/lcty.v1.js        | "/base/lcty.v1/lcty.v1.js"        |
      | /base/c/lcty.v1.module.js | "/base/lcty.v1/lcty.v1.module.js" |
      | /base/t/lcty.v1.css       | "/base/lcty.v1/lcty.v1.css"       |
      | /base/c/lcty.v1%20x.js    | "/base/lcty.v1/lcty.v1%20x.js"    |
      | /base/c/lcty.v1%3Fq.js    | "/base/lcty.v1/lcty.v1%3Fq.js"    |

  Scenario Outline: What is not a page, a data file or an lcty.v1 name is 404
    Given the conversation file "abc-1.html" and the file "notes.txt" in the conversations' folder
    When <path> is requested
    Then the status is 404

    Examples:
      | path                       |
      | /base/c/no-such-id.html    |
      | /base/c/notes.txt          |
      | /base/c/sub/abc-1.html     |
      | /base/c/..%2Fabc-1.html    |
      | /base/c/%FF.html           |
      | /base/c/lcty.v1/sub.js     |
      | /base/t/0010-short.html    |
      | /base/t/00010-none.html    |

  # ---- PublicDirectoryServlet ----

  Scenario Outline: The files below the directory are served
    Given the files "index.html" and "js/x.js" in the public folder
    When <path> is requested
    Then the status is 200 with the type <type>

    Examples:
      | path              | type                             |
      | /pub/             | "text/html; charset=utf-8"       |
      | /pub/index.html   | "text/html; charset=utf-8"       |
      | /pub/js/x.js      | "text/javascript; charset=utf-8" |

  Scenario Outline: A hidden file, a folder or a missing file is 404
    Given the files "js/x.js" and ".hidden" and the folder "sub" in the public folder
    When <path> is requested
    Then the status is 404

    Examples:
      | path            |
      | /pub/.hidden    |
      | /pub/%2Ehidden  |
      | /pub/sub        |
      | /pub/no-such.js |

  # WEBrick resolves .. and // in the path of a request (after decoding %2E and %2F) before a servlet sees it, so these
  # paths are given to the servlet directly
  Scenario Outline: The servlet itself refuses a path with an empty part, a part that starts with "." or a NUL
    Given the files "js/x.js" and ".hidden" in the public folder
    When the PublicDirectoryServlet is given the path <path> directly
    Then it raises NotFound

    Examples:
      | path               |
      | "/js/../js/x.js"   |
      | "/js//x.js"        |
      | "/./js/x.js"       |
      | "/.hidden"         |
      | "/js/x.js\u0000"   |
