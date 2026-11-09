# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of /v1/rpc, the RPC protocol (LCTYSP-0012), and of the conversation files it writes (LCTYSP-0013).
# Each Scenario is a test of the same title in tests/backend/rpc_test.rb, whose steps are the lines below. What several
# pages at once rely on is LCTYSP-3022.

Feature: LCTYSP-3020 The RPC protocol

  /v1/rpc speaks JSON-RPC 2.0 over a WebSocket or POST. A page declares in initialize the methods it receives and gets
  an actorId for its connection. Conversations change only at their end: one element appended after the element named,
  or the last element removed; an lcty-cmd at the end refuses every other write. Every change gets the next global
  version and its notifications: c.appended and c.unappended go only to the connections that follow the conversation
  (c.subscribe), c.meta.updated to every connection that receives it. In the steps the servlet is mounted at /v1/rpc
  of a WEBrick server on 127.0.0.1, the allowed origin is http://allowed.test, and the conversations are written to
  c-next/ of the tests' data directory. "A page" is a WebSocket client that sends Origin http://allowed.test.

  Background:
    Given the RPC servlet mounted on a WEBrick server

  # ---- Transports ----

  Scenario: A request over POST is answered without a session
    When initialize is sent with POST
    Then the result has the protocol, the version and the actorId null

  Scenario: POST takes only application/json
    When a request is sent with POST as text/plain
    Then the status is 415

  Scenario Outline: A request of an origin that is not allowed is refused
    When a request is sent <how> with Origin <origin>
    Then the status is 403

    Examples:
      | how             | origin                    |
      | with POST       | "http://evil.example"     |
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

  # ---- Following a conversation ----

  Scenario: Element notifications go only to the page following the conversation
    Given two conversations and two pages, each following one of them
    When an element is appended to each conversation
    Then each page gets c.appended of its own conversation only

  Scenario: c.subscribe tells whether the page's last element is still the last one
    Given a conversation with a system message
    When a page subscribes holding nothing, and again holding the system message
    Then the first answer is not current and the second is current

  Scenario: c.meta.updated goes to every page with the meta of the conversation
    Given a page following nothing
    When a conversation is created
    Then the page gets c.meta.updated with only cid, lang, title, titleTypeId, updatedAt, createdAt, version and actorId

  Scenario: A notification names the actor that made the change
    Given two pages following a conversation
    When the first appends an element
    Then both get c.appended with the actorId of the first

  Scenario: The notification of a page's own change comes before its response
    Given a page following a conversation
    When it appends an element
    Then it gets c.appended before the response

  # ---- Lists and titles ----

  Scenario: c.list returns the meta of every conversation with the version
    Given two conversations
    When c.list is called
    Then the items hold both with their cid, lang, title, titleTypeId, updatedAt and createdAt

  Scenario: c.update.title fits the title into the slot and notifies c.meta.updated
    Given a conversation with a title slot of 32 bytes, and a page receiving c.meta.updated
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
