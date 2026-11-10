# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of /v1/rpc, the RPC protocol (LCTYSP-0012), and of the conversation files it writes (LCTYSP-0013).
# Each Scenario is a test of the same title in tests/backend/rpc_test.rb, whose steps are the lines below. What several
# pages at once rely on is LCTYSP-3022.

Feature: LCTYSP-3020 The RPC protocol

  /v1/rpc speaks JSON-RPC 2.0 over a WebSocket, and nothing else: a page always has one. A page declares in initialize the methods it receives and gets
  an actorId for its connection. Conversations change only at their end: one element appended after the element named,
  or the last element removed; an lcty-cmd at the end refuses every other write. Every change gets the next global
  version and one c.batch.updated with a record of every copy it changes: its c_html records go only to the connections
  that follow the conversation (c.subscribe), its c_meta and c_recordcount records to every connection that receives
  it. In the steps the servlet is mounted at /v1/rpc
  of a WEBrick server on 127.0.0.1, the allowed origin is http://allowed.test, and the conversations are written to
  c/ of the tests' data directory, with a search index and an lcty_c.sqlite of the tests' own. "A page" is a WebSocket client that sends Origin http://allowed.test; a step
  that names no page sends its request through a page of the test's own that receives no notification.

  Background:
    Given the RPC servlet mounted on a WEBrick server

  # ---- Transports ----

  Scenario: initialize answers the protocol, the version and the connection's actorId
    Given a page
    When it sends initialize
    Then the result has the protocol, the version and an actorId that is a UUID

  Scenario: POST is not a transport
    When a request is sent with POST
    Then the status is 405

  Scenario Outline: A request of an origin that is not allowed is refused
    When a request is sent <how> with Origin <origin>
    Then the status is 403

    Examples:
      | how             | origin                    |
      | as a WebSocket  | "http://evil.example"     |
      | as a WebSocket  | "http://allowed.test:1"   |

  Scenario: GET without Upgrade is answered 426
    When /v1/rpc is requested with GET
    Then the status is 426

  Scenario Outline: A message of any length arrives whole
    Given a page
    When it sends a request of <length> bytes
    Then the response comes back

    Examples:
      | length |
      | 125    |
      | 126    |
      | 127    |
      | 65535  |
      | 65536  |
      | 600000 |

  # ---- Sessions ----

  Scenario: initialize gives each connection its own actorId
    Given two pages
    When both send initialize, and the first sends it again
    Then each has a UUID of its own, and the first keeps its one

  Scenario: rpc.discover returns the OpenRPC document of the methods the server receives
    Given a page
    When it calls rpc.discover
    Then the document's methods for the server are those initialize says the server receives

  Scenario: A page receives only the notifications it declared
    Given a page that declared it receives nothing, following a conversation
    When an element is appended to the conversation
    Then the page gets no notification

  # ---- Conversations ----

  Scenario Outline: c.create writes the head the page chose
    When a conversation is created with lang <lang>
    Then line 1 is <html lang=<lang>> and line 2 loads <scripts>
    And line 3 is a title slot of 64 bytes

    Examples:
      | lang | scripts                                |
      | "ja" | "lcty.v1.js and lcty.v1.lang-ja.js"    |
      | "en" | "lcty.v1.js only"                      |

  Scenario: c.create refuses a conversation that exists
    Given a conversation
    When it is created again
    Then the error is 5

  Scenario: Elements are appended after the element named
    Given a conversation
    When a system message is appended after null and a user message after it
    Then the file holds the two elements in that order

  Scenario: An append that names another element than the last is refused with the last id
    Given a conversation with a system message
    When a message is appended after null
    Then the error is 1 with data.last the id of the system message

  Scenario: A request sent again is recognised by the last id
    Given a conversation with a user message just appended
    When the same append is sent again
    Then the error is 1 with data.last the id of that user message

  Scenario: An lcty-cmd locks the conversation until it is unappended
    Given a conversation whose last element is an lcty-cmd
    When a message is appended after the lcty-cmd, and another lcty-cmd too
    Then both are refused with error 2
    And after c.unappend of the lcty-cmd the message is appended

  Scenario Outline: An element that breaks a rule of the format is refused
    Given a conversation
    When a message is appended with <fault>
    Then the error is 3

    Examples:
      | fault                                  |
      | the attributes out of order            |
      | an id prefix of another role           |
      | a <script> in its article              |
      | a user article other than its text     |
      | a control character in data-content    |

  Scenario: The server fills in the integrity placeholder
    Given a conversation
    When a message is appended with data-content-integrity "sha384-"
    Then the attributes written have the SHA-384 of the text in base64

  Scenario: c.unappend removes only the last element
    Given a conversation with two messages
    When c.unappend names the first one
    Then the error is 1, and c.unappend of the second removes it

  Scenario: A conversation of LCTYSP-0003 is never written but its title
    Given a conversation file of LCTYSP-0003 in c/ with a user message
    When a message is appended to it and its last element is unappended
    Then both are refused with error 6 and the file has not changed
    And c.update.title still changes its title

  Scenario: A user or model message brings the search index up to date
    Given a conversation
    When a user message and a model message are appended
    Then the search index finds the round by a word of the reply
    When the model message is unappended
    Then the search index no longer finds it

  # ---- What was measured of a reply ----

  Scenario: c.stats.put records what was measured of a reply and c.stats.list returns it
    Given a conversation
    When c.stats.put records timings and usage for a model message
    Then c.stats.list returns them for its id, with client null
    And c.stats.put again replaces them

  Scenario Outline: c.stats.put refuses a bad request
    Given a conversation
    When c.stats.put is called with <params>
    Then the error is <code>

    Examples:
      | what                        | params                                   | code |
      | an id that is not a reply   | the id of a user message                 | 3    |
      | timings that are not object | timings that are a string                | 3    |
      | an unknown conversation     | a cid with no file                       | 4    |

  # ---- Following a conversation ----

  Scenario: Element notifications go only to the page following the conversation
    Given two conversations and two pages, each following one of them
    When an element is appended to each conversation
    Then each page gets the c_html records of its own conversation only

  Scenario: c.subscribe tells whether the page's last element is still the last one
    Given a conversation with a system message
    When a page subscribes holding nothing, and again holding the system message
    Then the first answer is not current and the second is current

  Scenario: A c_meta record goes to every page with the meta of the conversation
    Given a page following nothing
    When a conversation is created
    Then the page gets a c.batch.updated with only version, actorId and records
    And its c_meta record has a row of only cid, lang, title, titleTypeId, updatedAt and createdAt

  Scenario: One change is one c.batch.updated, without the c_html records for a page that does not follow
    Given a page following a conversation and a page following nothing
    When an element is appended to the conversation
    Then the following page gets one c.batch.updated with a c_html, a c_meta and a c_recordcount record
    And the other gets one with the same version and only the c_meta and c_recordcount records

  Scenario: c_recordcount counts every element but lcty-c
    Given a page following nothing
    When a conversation is created, a system message, a user message and an lcty-cmd are appended, and the lcty-cmd is unappended
    Then the page gets c_recordcount records of 0, 1, 2, 3 and 2
    And the file has as many lines as the last count and 4

  # ---- The cache of the counts ----

  Scenario: The count is cached in _index.sqlite whenever the file is written
    When a conversation is created, a system message and a user message are appended, and the user message is unappended
    Then the cached count is 0 after creating it, 2 after the appends and 1 after unappending

  Scenario: A conversation the cache has no count for has an unknown count
    Given a conversation with a system message whose cached count is removed
    Then its cached count is unknown, not read from the file

  Scenario: At startup the cache is filled from the files
    Given a conversation with no element and one with two, and a cache that holds neither but a count for a conversation that does not exist
    When the cache is filled as at startup
    Then it holds 0 and 2 for the two conversations and nothing for the other

  Scenario: c.recordcount.list returns every cached count with the version
    Given a conversation with no element, one with two, and one with a system message whose cached count is removed
    When c.recordcount.list is called
    Then the items are rows of only cid and count, ordered by cid, with 0 and 2 for the first two
    And the conversation whose count is not cached is not among them
    And the version is that of the last change

  Scenario: A notification names the actor that made the change
    Given two pages following a conversation
    When the first appends an element
    Then both get a c_html record with the actorId of the first

  Scenario: The notification of a page's own change comes before its response
    Given a page following a conversation
    When it appends an element
    Then it gets c.batch.updated before the response

  # ---- Lists and titles ----

  Scenario: c.list returns the meta of every conversation with the version
    Given two conversations
    When c.list is called
    Then the items hold both with their cid, lang, title, titleTypeId, updatedAt and createdAt

  Scenario: c.update.title fits the title into the slot and sends a c_meta record
    Given a conversation with a title slot of 32 bytes, and a page receiving c.batch.updated
    When its title is changed to a longer one
    Then the result and the notification have the title cut to the slot

  # ---- Who holds an lcty-cmd ----

  Scenario: c.cmd.held finds the page that holds the lcty-cmd
    Given a page that answers c.cmd.holds with true
    When another page calls c.cmd.held
    Then the result is held, with the actorId of the first page

  Scenario: A page that does not answer counts as not holding the lcty-cmd
    Given a page that receives c.cmd.holds but never answers
    When another page calls c.cmd.held
    Then the result is not held once the time to answer is over

  # ---- Pages that stop reading ----

  Scenario: A page that stops reading is dropped without holding up the others
    Given a page that receives every notification, follows a conversation and never reads
    When more changes are made than its queue holds
    Then every change is answered at once, and the page's connection is closed
