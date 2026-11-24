# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/secure_server.rb (LCTYSP-0016, step 2). Each Scenario is a test of the same title in
# tests/backend/secure_server_test.rb, whose steps are the lines below.

Feature: LCTYSP-3030 The protective headers of every response

  Chatty::SecureServer, the WEBrick server of Lcty.listen, sends every response with the protective headers of
  LCTYSP-0016 as it is sent, when its type and status are final: a page (text/html) the page policy of the Content
  Security Policy, a script the policy a worker runs under (connections and WebAssembly of the site), and anything
  else the policy default-src 'none'; frame-ancestors 'none'; every response
  X-Content-Type-Options, X-Frame-Options, Referrer-Policy, the three cross-origin policies, Permissions-Policy,
  X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch-Control and X-Robots-Tag; the user's data (the API under /v1/, the
  conversation files and the tag files) Cache-Control: private, no-cache; and a text type without a charset
  charset=utf-8. No response has a Server header, and an error WEBrick makes is a short body of its own in UTF-8: JSON
  under /v1/, plain text elsewhere.

  In the steps the site is mounted on a server of Lcty.listen on 127.0.0.1 (a free port), behind its request guard,
  with a conversation file and the tag file ruby.html in the tests' data directory, and the path /probe answers "x" as text/plain
  without a charset.

  Background:
    Given the site on a server of Lcty.listen

  Scenario: A page gets the page policy and every common header
    When GET /c/ is requested
    Then Content-Security-Policy is "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    And X-Content-Type-Options is "nosniff", X-Frame-Options "DENY" and Referrer-Policy "no-referrer"
    And Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy are "same-origin", Cross-Origin-Embedder-Policy "require-corp"
    And Permissions-Policy turns every feature off but "sync-xhr=(self)"
    And X-Permitted-Cross-Domain-Policies is "none", X-DNS-Prefetch-Control "off" and X-Robots-Tag "noindex, nofollow"

  Scenario Outline: A script gets the policy a worker runs under
    When <path> is requested
    Then Content-Security-Policy is "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'"

    Examples:
      | path                        |
      | GET /fuzzy_search.worker.js |
      | GET /lcty.v1/lcty.v1.cjs    |

  Scenario Outline: A response that is neither a page nor a script gets the short policy
    When <path> is requested
    Then Content-Security-Policy is "default-src 'none'; frame-ancestors 'none'"
    And X-Content-Type-Options is "nosniff"

    Examples:
      | path                       |
      | GET /v1/defaults.json      |
      | GET /lcty.v1/lcty.v1.css   |
      | GET /nope                  |

  Scenario Outline: The user's data is kept out of shared caches, and the code is not
    When GET <path> is requested
    Then Cache-Control is <cache>

    Examples:
      | path                      | cache               |
      | /v1/defaults.json         | "private, no-cache" |
      | /c/<the conversation>.html | "private, no-cache" |
      | /t/ruby.html              | "private, no-cache" |
      | /c/                       | "no-cache"          |
      | /t/index.html             | "no-cache"          |
      | /lcty.v1/lcty.v1.cjs      | "no-cache"          |
      | /js/site.js               | "no-cache"          |

  Scenario Outline: No response says what server it is
    When <path> is requested
    Then the response has no Server header

    Examples:
      | path                  |
      | GET /c/               |
      | GET /nope             |
      | POST /v1/rpc          |

  Scenario: An error WEBrick makes is a short text in UTF-8
    When GET /nope is requested
    Then the status is 404, the type "text/plain; charset=utf-8" and the body "404 Not Found" and a line end

  Scenario: An error WEBrick makes under /v1/ is JSON
    When POST /v1/rpc is requested
    Then the status is 405, the type "application/json; charset=utf-8" and the body {"error": "method not allowed"}

  Scenario: A text type without a charset gets charset=utf-8
    When GET /probe is requested
    Then Content-Type is "text/plain; charset=utf-8"

  Scenario: A refusal of the request guard gets the headers too
    When GET /c/ is requested with Host "attacker.example"
    Then the status is 421
    And Content-Security-Policy is "default-src 'none'; frame-ancestors 'none'" and X-Content-Type-Options "nosniff"
