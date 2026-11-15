# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/request_guard.rb (LCTYSP-0016, step 1). Each Scenario is a test of the same title in
# tests/backend/request_guard_test.rb, whose steps are the lines below.

Feature: LCTYSP-3029 The checks of every request

  Chatty::RequestGuard checks every request before it is served, called by WEBrick's RequestCallback before
  authentication and before any servlet. It serves only a Host the server is reached by: an address it listens on,
  localhost when it listens on a loopback address, and the host of every allowed origin, each with its port (421
  otherwise, 400 without a Host or with more than one). It answers a preflight (OPTIONS) 403 with no CORS header. It
  serves a write (any method but GET and HEAD) only when its Sec-Fetch-Site, when it has one, is same-origin and its
  Origin, when it has one, is allowed (403 otherwise); a write with neither is served. A body is at most 64 MiB by its
  Content-Length (413), and a body of the JSON API under /v1/ (POST, PUT and PATCH, but /v1/rpc) must be
  application/json (415). A refused request is answered with a short text in UTF-8 that names none of the allowed
  hosts or origins, and logged with what was checked.

  In the steps the site is mounted at / of a WEBrick server listening on 127.0.0.1 (a free port, "the port"), whose
  RequestCallback is the guard's, with the allowed origin http://127.0.0.1:<the port> unless said otherwise. The
  requests are written on a socket of their own, so their headers are exactly the ones named.

  Background:
    Given the site behind the request guard

  # ---- Host ----

  Scenario Outline: A Host the server is reached by is served
    When GET /v1/defaults.json is sent with Host <host>
    Then the status is 200

    Examples:
      | host                   |
      | "127.0.0.1:<the port>" |
      | "localhost:<the port>" |
      | "LOCALHOST:<the port>" |

  Scenario Outline: Any other Host is answered 421
    When GET /v1/defaults.json is sent with Host <host>
    Then the status is 421 with the text "misdirected request"
    And the log has a line that refused it, with the Host

    Examples:
      | host                     |
      | "attacker.example"       |
      | "127.0.0.1"              |
      | "127.0.0.1:1"            |
      | "192.168.0.10:<the port>" |

  Scenario: The host of an allowed origin is served, with and without its default port
    Given the allowed origins are "https://lcty.example" and "http://lcty.example:8080"
    When GET /v1/defaults.json is sent with each Host "lcty.example", "lcty.example:443" and "lcty.example:8080"
    Then each status is 200
    When it is sent with Host "lcty.example:80"
    Then the status is 421 with the text "misdirected request"

  Scenario Outline: A request without one Host is answered 400
    When GET /v1/defaults.json is sent <hosts>
    Then the status is 400 with the text "a request needs one Host"

    Examples:
      | hosts                                              |
      | without Host                                       |
      | with Host "127.0.0.1:<the port>" twice             |

  Scenario: The WebSocket of /v1/rpc is refused for another Host
    When the handshake of /v1/rpc is sent with Host "attacker.example"
    Then the status is 421

  # ---- Preflights and writes ----

  Scenario: A preflight is answered 403 with no CORS header
    When OPTIONS /v1/search is sent with Origin "http://evil.example" and Access-Control-Request-Method "POST"
    Then the status is 403 with the text "preflight"
    And the response has no Access-Control-* header

  Scenario Outline: A write from another origin is refused
    When POST /v1/search is sent with a JSON body and <headers>
    Then the status is 403 with the text "cross-origin"
    And the log has a line that refused it, with <logged>

    Examples:
      | headers                                                                  | logged                       |
      | Sec-Fetch-Site "cross-site"                                              | its Sec-Fetch-Site           |
      | Sec-Fetch-Site "same-site"                                               | its Sec-Fetch-Site           |
      | Sec-Fetch-Site "none"                                                    | its Sec-Fetch-Site           |
      | Origin "http://evil.example"                                             | its Origin and the allowed   |
      | Sec-Fetch-Site "same-origin" and Origin "http://evil.example"            | its Origin and the allowed   |
      | Origin "null"                                                            | its Origin and the allowed   |

  Scenario Outline: A write from the server's own page, or with neither header, is served
    When POST /v1/search is sent with a JSON body and <headers>
    Then the status is 200

    Examples:
      | headers                                                                  |
      | Sec-Fetch-Site "same-origin" and Origin "http://127.0.0.1:<the port>"    |
      | Origin "http://127.0.0.1:<the port>"                                     |
      | neither Sec-Fetch-Site nor Origin                                        |

  Scenario: A read from another origin is not refused for its origin
    When GET /v1/defaults.json is sent with Sec-Fetch-Site "cross-site" and Origin "http://evil.example"
    Then the status is 200

  # ---- Bodies ----

  Scenario Outline: A body of the JSON API that is not JSON is answered 415
    When POST /v1/search is sent with the body {"q": "x"} and <type>
    Then the status is 415 with the text "the body must be application/json"

    Examples:
      | type                                           |
      | Content-Type "text/plain"                      |
      | Content-Type "application/x-www-form-urlencoded" |
      | no Content-Type                                |

  Scenario: A JSON body with a charset is served
    When POST /v1/search is sent with the body {"q": "x"} and Content-Type "application/json; charset=utf-8"
    Then the status is 200

  Scenario: A body over 64 MiB is answered 413 before it is read
    When POST /v1/search is sent with Content-Length 67108865 and no body
    Then the status is 413 with the text "too large"

  # ---- The answer ----

  Scenario: A refusal is a short text that names no allowed host or origin
    When GET /v1/defaults.json is sent with Host "attacker.example"
    Then the response is text/plain; charset=utf-8
    And its body is "misdirected request" and a line end, with no "127.0.0.1"

  Scenario: Lcty.listen puts the guard before authentication
    Given a server of Lcty.listen with --basic-auth, on 127.0.0.1
    When GET / is sent with Host "attacker.example" and no credentials
    Then the status is 421, not 401
