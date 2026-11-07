# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/api/storage.js (LCTYSP-0003, LCTYSP-0006, LCTYSP-0007, LCTYSP-0009, LCTYSP-0010). Each
# Scenario is a test of the same title in tests/unit/storage.test.js (in Node.js) or tests/unit/storage.spec.js (in the
# browser), whose steps are the lines below.

Feature: LCTYSP-1009 The client of the HTTP API

  js/api/storage.js is how the pages talk to the server's HTTP API: one function per endpoint, each sending one
  request to the page's origin and resolving to the parsed JSON of the answer. A body is sent as JSON with the
  Content-Type application/json, ids and names in a path are percent-encoded, and putVectors sends a registration
  vector binary as application/octet-stream. An answer that is not OK becomes an Error "<status> <body>", the body
  cut to 200 characters, with the status as its status. The tags are not here: js/api/lcty-t.js and its worker
  (LCTYSP-1021) send their requests. The requests that change conversations (create, append, pop, delete) then ask for a sync of the browser's copy
  of the meta (requestMetaDbSync of js/api/meta-db.js), also when they fail, and the meta sync worker fetches GET
  /v1/meta-all.json when the browser is idle; changing the tags changes no conversation. toLine turns a message into a line to append: a
  reply also carries its content rendered by js/ui/markdown.js, as the screen shows it.

  In the steps the requests of the meta sync worker, GET /v1/meta-all.json, are counted apart from the others.

  Background:
    Given requests to /v1/ are answered by the test, which records them

  Scenario: A user message becomes a message line without HTML
    Given the user message {"id": "m1", "role": "user", "content": "**Hi**", "at": "2026-11-07T00:00:00.000Z"}
    When toLine is called with it
    Then it returns {"type": "message", "id": "m1", "role": "user", "content": "**Hi**", "at": "2026-11-07T00:00:00.000Z"}

  Scenario: A reply carries its content rendered as HTML
    Given the assistant message {"id": "m2", "role": "assistant", "content": "**bold** text"}
    When toLine is called with it
    Then it returns {"type": "message", "id": "m2", "role": "assistant", "content": "**bold** text", "content_html": "<p><strong>bold</strong> text</p>"}

  Scenario: The HTML of a reply is what renderMarkdown makes of its content
    Given an assistant message whose content has a heading, a list, a table, a code block and a link
    When toLine is called with it
    Then its content_html equals renderMarkdown of the content

  Scenario: A reply without content carries empty HTML
    Given the assistant message {"id": "m3", "role": "assistant"}
    When toLine is called with it
    Then it returns {"type": "message", "id": "m3", "role": "assistant", "content_html": ""}

  Scenario: toLine leaves the message as it was
    Given an assistant message with content
    When toLine is called with it
    Then the message has no type and no content_html

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
      | createConversation({"id": "c1", "tags": []}, [{"type": "message"}])      | POST   | /v1/conversations                         | {"meta":{"id":"c1","tags":[]},"lines":[{"type":"message"}]}   | application/json |
      | appendLines("a b", [{"type": "title", "title": "T"}])                    | POST   | /v1/conversations/a%20b/lines             | [{"type":"title","title":"T"}]                                | application/json |
      | popMessages("c1", 2)                                                     | POST   | /v1/conversations/c1/pop                  | {"from":2}                                                    | application/json |
      | deleteConversation("c/1")                                                | DELETE | /v1/conversations/c%2F1                   | none                                                          | none             |
      | getDefaults()                                                            | GET    | /v1/defaults.json                         | none                                                          | none             |
      | vectorsPending("eg/2")                                                   | GET    | /v1/vectors/pending?model=eg%2F2&limit=16 | none                                                          | none             |
      | vectorsPending("eg", 4)                                                  | GET    | /v1/vectors/pending?model=eg&limit=4      | none                                                          | none             |
      | searchConversations({"q": "x", "tags": ["t"], "limit": 5})               | POST   | /v1/search                                | {"q":"x","tags":["t"],"limit":5}                              | application/json |
      | fetchSnippets(["r1", "r2"], "x")                                         | POST   | /v1/snippets                              | {"ids":["r1","r2"],"q":"x"}                                   | application/json |

  Scenario: An Error of a request that is not OK carries the status
    Given the server answers with the status 404 and the text "not found"
    When getConversation("nope") is called
    Then it rejects with the Error "404 not found" whose status is 404

  Scenario: putVectors sends the vector binary with its query
    Given the server answers {"accepted": 2, "stale": []}
    When putVectors is called with the model "eg/2", the revs [["r1", 3], ["r2", 4]] and a body of 16 bytes for 2 records of 8 bytes
    Then one request PUT /v1/vectors?model=eg%2F2&magic=lctyvLE0&size=8&entry_count=2&rev=r1:3,r2:4 is sent
    And its Content-Type is application/octet-stream and its body is the 16 bytes
    And it resolves to {"accepted": 2, "stale": []}

  Scenario Outline: An answer that is not OK becomes an Error with the status and the body
    Given the server answers with the status <status> and the text "<text>"
    When <call> is called
    Then it rejects with the Error "<message>"

    Examples:
      | call                         | status | text           | message                  |
      | listConversations()          | 500    | boom           | 500 boom                 |
      | getConversation("nope")      | 404    | not found      | 404 not found            |
      | createConversation({}, [])   | 409    | already exists | 409 already exists       |
      | popMessages("c1", 0)         | 409    | too far back   | 409 too far back         |
      | putVectors("eg", [], {})     | 400    | bad magic      | 400 bad magic            |

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

  Scenario Outline: A change of conversations asks for a sync of the meta
    Given a page on the server's origin
    Given the server answers {"ok": true}
    When <call> is called
    Then it resolves
    And the meta sync worker then fetches GET /v1/meta-all.json

    Examples:
      | call                                    |
      | createConversation({"id": "c1"}, [])    |
      | appendLines("c1", [])                   |
      | popMessages("c1", 2)                    |
      | deleteConversation("c1")                |

  Scenario Outline: A change of conversations that fails still asks for a sync
    Given a page on the server's origin
    Given <answer>
    When appendLines("c1", []) is called
    Then it rejects
    And the meta sync worker then fetches GET /v1/meta-all.json

    Examples:
      | answer                                            |
      | the server answers with the status 500            |
      | the request to the server fails without an answer |

  Scenario: Requests that do not change conversations do not ask for a sync
    Given a page on the server's origin
    Given the server answers {"ok": true}
    When listConversations, getConversation, getDefaults, vectorsPending, putVectors, searchConversations and fetchSnippets are called
    Then no GET /v1/meta-all.json is fetched within 3 seconds
