# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/api/storage.js (LCTYSP-0003, LCTYSP-0006, LCTYSP-0007, LCTYSP-0009, LCTYSP-0010). Each
# Scenario is a test of the same title in tests/unit/storage.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1009 The client of the HTTP API

  js/api/storage.js is how the pages talk to the server's HTTP API: one function per endpoint, each sending one
  request to the page's origin and resolving to the parsed JSON of the answer. A body is sent as JSON with the
  Content-Type application/json, and ids and names in a path are percent-encoded. An answer that is not OK becomes an
  Error "<status> <body>", the body cut to 200 characters, with the status as its status. The API serves reads
  only: the pages write through /v1/rpc (LCTYSP-0012), and read the tags there too (js/api/lcty-t.js, LCTYSP-1021).

  Background:
    Given requests to /v1/ are answered by the test, which records them

  Scenario Outline: Each function sends its request and resolves to the answer
    Given the server answers {"ok": true}
    When <call> is called
    Then one request <method> <url> is sent
    And its body is <body>
    And its Content-Type is <type>
    And it resolves to {"ok": true}

    Examples:
      | call                                                                     | method | url                                       | body                                                          | type             |
      | listConversations()                                                      | GET    | /v1/conversations                         | none                                                          | none             |
      | getConversation("a b/c")                                                 | GET    | /v1/conversations/a%20b%2Fc               | none                                                          | none             |
      | getDefaults()                                                            | GET    | /v1/defaults.json                         | none                                                          | none             |
      | searchConversations({"q": "x", "tags": ["t"], "limit": 5})               | POST   | /v1/search                                | {"q":"x","tags":["t"],"limit":5}                              | application/json |
      | fetchSnippets(["r1", "r2"], "x")                                         | POST   | /v1/snippets                              | {"ids":["r1","r2"],"q":"x"}                                   | application/json |

  Scenario: An Error of a request that is not OK carries the status
    Given the server answers with the status 404 and the text "not found"
    When getConversation("nope") is called
    Then it rejects with the Error "404 not found" whose status is 404

  Scenario Outline: An answer that is not OK becomes an Error with the status and the body
    Given the server answers with the status <status> and the text "<text>"
    When <call> is called
    Then it rejects with the Error "<message>"

    Examples:
      | call                         | status | text           | message                  |
      | listConversations()          | 500    | boom           | 500 boom                 |
      | getConversation("nope")      | 404    | not found      | 404 not found            |

  Scenario: A long error body is cut to 200 characters
    Given the server answers with the status 500 and a text of 300 characters
    When listConversations() is called
    Then it rejects with the Error "500 " followed by the first 200 characters of the text

  Scenario: An OK answer that is not JSON rejects with a SyntaxError
    Given the server answers with the status 200 and the text "not json"
    When listConversations() is called
    Then it rejects with a SyntaxError

  Scenario: A request that fails without an answer rejects with a TypeError
    Given the request to the server fails without an answer
    When listConversations() is called
    Then it rejects with a TypeError

