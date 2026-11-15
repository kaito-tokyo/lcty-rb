# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/v1/servlet.rb (LCTYSP-0006, with LCTYSP-0003, LCTYSP-0004, LCTYSP-0007, LCTYSP-0008 and
# LCTYSP-0009). Each Scenario is a test of the same title in tests/backend/v1_servlet_test.rb, whose steps are the lines
# below.

Feature: LCTYSP-3012 HTTP API

  Chatty::V1::Servlet, mounted at /v1, answers the JSON API on the same origin as the pages, which serves reads only:
  the defaults of the browser settings, conversations (one and the list), keyword search and snippets, and the vector
  pair of semantic search (its JSON, and its files by Range: LCTYSP-3028). Every write goes through /v1/rpc
  (LCTYSP-0012), the tag files included (LCTYSP-3020); the API answers GET and POST only, and POST only for the
  searches. Bodies are JSON unless stated otherwise, and every error is {"error": "…"} with an HTTP status. Paths and
  query values are read as UTF-8, and request bodies are limited to 64 MiB.

  In the steps a conversation is a file of LCTYSP-0003 that the test writes to c/ and adds to the search index, as the
  server does at startup.

  Scenario: The defaults of the browser settings
    When GET /v1/defaults.json is requested
    Then the status is 200 and the body is JSON
    And it has the base_url "http://127.0.0.1:9931" and the model "gemma-4-26b-a4b-it", and no embedding_model
    And its api_key is the host name and the user joined by "-"

  Scenario: A conversation is listed with its title, messages and tags
    Given a conversation with the title "Hello", the tag "t", an inherited user message, a user message and an assistant message
    When GET /v1/conversations is requested
    Then it lists the conversation with the title "Hello", 3 messages and the tags ["t"]
    And its message_ids are only the id of its own user message

  Scenario: A conversation is read as its meta, title, tags and messages
    Given a conversation with the title "Greeting" whose assistant message has content_html
    When GET /v1/conversations/<id> is requested
    Then the body has its meta, the title "Greeting", its tags and its 2 messages
    And the messages have neither type nor content_html

  Scenario: A body that is not JSON is rejected
    When POST /v1/search sends "{not json"
    Then the status is 400 with an error that starts with "invalid JSON: "

  Scenario: A body that is not UTF-8 is rejected
    When POST /v1/search sends the bytes of a JSON string with the byte 0xff in it
    Then the status is 400 with the error "invalid UTF-8"

  Scenario: A body over 64 MiB is rejected before it is read
    When a POST to /v1/search says its Content-Length is 64 MiB and one byte, and sends no body
    Then the status is 413 with the error "too large"

  Scenario Outline: An unknown or invalid conversation id
    When <request> is requested
    Then the status is <status> with the error <error>

    Examples:
      | request                                          | status | error        |
      | GET /v1/conversations/<unknown id>               | 404    | "not found"  |
      | GET /v1/conversations/a.b                        | 400    | "invalid id" |

  Scenario Outline: The writes of conversations are gone
    Given a conversation with a user and an assistant message
    When <request> is requested
    Then the status is <status>
    And the conversation file is unchanged

    Examples:
      | request                              | status |
      | POST /v1/conversations               | 404    |
      | POST /v1/conversations/<id>/lines    | 404    |
      | POST /v1/conversations/<id>/pop      | 404    |
      | DELETE /v1/conversations/<id>        | 405    |

  Scenario: GET /v1/meta-all.json is no longer served
    Given a conversation
    When GET /v1/meta-all.json is requested
    Then the status is 404 with the error "no such endpoint"

  Scenario: Keyword search finds rounds and can be limited to tags
    Given two conversations with a round with the same unique word, only one of them with the tag "pick"
    When POST /v1/search searches for the word
    Then the results include both rounds with their conversation ids and snippets with the word
    When POST /v1/search searches for the word with the tags ["pick"]
    Then the result is only the round of the conversation with the tag "pick"

  Scenario: The search limit is kept between 1 and 200
    Given three conversations with the tag "lim", each with a round with the same unique word
    Then POST /v1/search for the word with the tags ["lim"] and the limit 2 returns 2 results
    And with the limit 0 it returns 1 result
    And with the limit 1000 it returns all 3

  Scenario: A search body that is not an object is rejected
    When POST /v1/search sends an array
    Then the status is 400 with the error "body must be an object"

  Scenario Outline: A search limit that is not a number is rejected
    When POST /v1/search sends a word with the limit <limit>
    Then the status is 400 with the error "limit must be a number"

    Examples:
      | limit |
      | "10"  |
      | []    |
      | true  |

  Scenario: Snippets of rounds by id
    Given a round with a unique word
    When POST /v1/snippets sends its id and an unknown id with the word as q
    Then the body maps its id to its conversation id and a snippet with the word
    And the unknown id is left out

  Scenario: Snippets need a list of ids
    When POST /v1/snippets sends {"q": "x"}
    Then the status is 400 with the error "body must be {\"ids\": [...]}"

  Scenario Outline: An unknown endpoint is 404
    When <request> is requested
    Then the status is 404 with the error "no such endpoint"

    Examples:
      | request                         |
      | GET /v1/nope                    |
      | GET /v1/vectors/pending         |
      | GET /v1/tags                    |
      | POST /v1/tags/00010-a.html/memory |
      | GET /v1/tags/a/memory           |
      | GET /v1/conversations/a/lines   |

  Scenario Outline: A method other than GET and POST is not allowed
    When <request> is requested
    Then the status is 405

    Examples:
      | request                         |
      | PUT /v1/vectors                 |
      | DELETE /v1/defaults.json        |
      | PATCH /v1/conversations         |
      | PUT /v1/tags                    |
      | PATCH /v1/tags/a/memory/b       |
      | DELETE /v1/tags/a/memory/b      |

  Scenario: A path that is not UTF-8 is rejected
    When GET /v1/conversations/%FF is requested
    Then the status is 400 with the error "invalid path encoding"
