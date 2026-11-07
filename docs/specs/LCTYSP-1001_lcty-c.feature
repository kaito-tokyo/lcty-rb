# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/lcty_c.worker.js (LCTYSP-0010, LCTYSP-0009). Each Scenario is a test of the same title in
# tests/unit/lcty-c.spec.js, whose steps are the lines below.

Feature: LCTYSP-1001 The meta of every conversation in the browser: lcty_c.worker.js

  Every asynchronous operation on the browser's copy of the meta runs in a worker started with
  new Worker("/js/lcty_c.worker.js", { type: "module" }): the page posts it one message {op} and gets one message
  back, {result} or {error, status}. The worker is the only code that opens the IndexedDB database "lcty_c".
  "sync" fetches GET /v1/meta-all.json, replaces the store "c_meta" with the list in one transaction, closes its
  connection, deletes the old database "lcty" (the copy before IndexedDB was split by resource, LCTYSP-0009) and
  answers no result; when a step fails the copy is left as it was. "get" answers the copy newest first, or no items
  and stale true when there is none, without ever creating the database.

  Background:
    Given a page on the server's origin
    And GET /v1/meta-all.json is answered by the test

  Scenario: A sync stores every conversation of the list
    Given there is no database "lcty_c"
    And GET /v1/meta-all.json returns the conversations "a" and "b"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And the database "lcty_c" is at version 1 with only the store "c_meta"
    And "c_meta" holds exactly the conversations "a" and "b", as returned

  Scenario: A sync replaces the copy as a whole
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns the conversation "b" with a new title and the conversation "c"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And "c_meta" holds exactly the conversations "b" and "c", as returned

  Scenario: An empty list empties the copy
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns no conversations
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And "c_meta" is empty

  Scenario: A sync deletes the old database lcty
    Given the database "lcty" is at version 5 with the store "c_meta" holding the conversation "a"
    And GET /v1/meta-all.json returns the conversation "b"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And there is no database "lcty"
    And "c_meta" holds exactly the conversation "b", as returned

  Scenario: A connection to the old database does not hold up the sync
    Given the page holds a connection to the database "lcty" that it never closes
    And GET /v1/meta-all.json returns the conversation "b"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And "c_meta" holds exactly the conversation "b", as returned

  Scenario: The worker closes its connection after the sync
    Given there is no database "lcty_c"
    And GET /v1/meta-all.json returns the conversation "a"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And the database "lcty_c" can be opened at version 2 without being blocked, while the worker is still alive

  Scenario Outline: A failed sync leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json <answer>
    When the worker is posted {"op": "sync"}
    Then it answers the error "<message>" with the status <status>
    And "c_meta" holds exactly the conversations "a" and "b"

    Examples:
      | answer                        | message                                | status |
      | answers with the status 500   | Failed to fetch /v1/meta-all.json: 500 | 500    |
      | returns an object, not a list | meta-all.json is invalid               | null   |

  Scenario: A response that is not JSON leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns a body that is not JSON
    When the worker is posted {"op": "sync"}
    Then it answers an error with the status null
    And "c_meta" holds exactly the conversations "a" and "b"

  Scenario: A failed request leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json fails without a response
    When the worker is posted {"op": "sync"}
    Then it answers an error with the status null
    And "c_meta" holds exactly the conversations "a" and "b"

  Scenario: A newer database is left alone
    Given the database "lcty_c" is at version 2 with the store "c_meta" holding the conversation "a"
    And GET /v1/meta-all.json returns the conversation "b"
    When the worker is posted {"op": "sync"}
    Then it answers an error with the status null
    And the database "lcty_c" is still at version 2
    And "c_meta" holds exactly the conversation "a"

  Scenario: Getting before any sync finds no copy
    Given there is no database "lcty_c"
    When the worker is posted {"op": "get"}
    Then it answers no items and stale true
    And there is still no database "lcty_c"

  Scenario: Getting returns the copy newest first
    Given "c_meta" holds the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00
    When the worker is posted {"op": "get"}
    Then it answers "d", "b", "c" and "a" in that order, as stored, and stale false

  Scenario: An unknown operation is an error
    When the worker is posted {"op": "nope"}
    Then it answers the error "unknown operation: nope" with the status null
    And GET /v1/meta-all.json is not fetched
