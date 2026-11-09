# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/lcty.v1.c.worker.cjs (LCTYSP-0010, LCTYSP-0009). Each Scenario is a test of the same title in
# tests/unit/lcty-c.spec.js, whose steps are the lines below.

Feature: LCTYSP-1001 The meta of every conversation in the browser: lcty.v1.c.worker.cjs

  Every asynchronous operation on the browser's copy of the meta runs in a worker, a classic script started with new
  Worker("/lcty.v1.c.worker.cjs") or new SharedWorker("/lcty.v1/lcty.v1.c.worker.cjs"): the page posts it a message {id, op, endpoint,
  payload} and gets back, on the same port, {id, result}, or {id, errorType} on a failure: "unknownOperation", "error"
  with the error and the status (the HTTP status or null), or "errorMessage" when the error cannot be posted. endpoint
  is the URL of the site's v1/: an absolute URL on the worker's origin ending with "/", or the message is an error
  before any operation. The worker is the only code that opens the IndexedDB database "lcty_v1_c". "sync_meta"
  fetches GET /v1/meta-all.json, replaces the store "c_meta" with the list in one transaction, closes its connection
  and answers no result; when a step fails the copy is left as it was. "get" answers the copy newest first, or no
  items and stale true when there is none, without ever creating the database.

  Background:
    Given a page on the server's origin
    And GET /v1/meta-all.json is answered by the test
    And every message to the worker has the endpoint "/v1/" on the page's origin, unless the scenario says otherwise

  Scenario: A sync stores every conversation of the list
    Given there is no database "lcty_v1_c"
    And GET /v1/meta-all.json returns the conversations "a" and "b"
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers with no result
    And the database "lcty_v1_c" is at version 1 with only the store "c_meta"
    And "c_meta" holds exactly the conversations "a" and "b", as returned

  Scenario: A sync replaces the copy as a whole
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns the conversation "b" with a new title and the conversation "c"
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers with no result
    And "c_meta" holds exactly the conversations "b" and "c", as returned

  Scenario: An empty list empties the copy
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns no conversations
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers with no result
    And "c_meta" is empty

  Scenario: The worker closes its connection after the sync
    Given there is no database "lcty_v1_c"
    And GET /v1/meta-all.json returns the conversation "a"
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers with no result
    And the database "lcty_v1_c" can be opened at version 2 without being blocked, while the worker is still alive

  Scenario Outline: A failed sync leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json <answer>
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers the error "<message>" with the status <status>
    And "c_meta" holds exactly the conversations "a" and "b"

    Examples:
      | answer                        | message                                | status |
      | answers with the status 500   | Failed to fetch /v1/meta-all.json: 500 | 500    |
      | returns an object, not a list | meta-all.json is invalid               | null   |

  Scenario: A response that is not JSON leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns a body that is not JSON
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers an error with the status null
    And "c_meta" holds exactly the conversations "a" and "b"

  Scenario: A failed request leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json fails without a response
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers an error with the status null
    And "c_meta" holds exactly the conversations "a" and "b"

  Scenario: A newer database is left alone
    Given the database "lcty_v1_c" is at version 2 with the store "c_meta" holding the conversation "a"
    And GET /v1/meta-all.json returns the conversation "b"
    When the worker is posted {"id": 1, "op": "sync_meta"}
    Then it answers an error with the status null
    And the database "lcty_v1_c" is still at version 2
    And "c_meta" holds exactly the conversation "a"

  Scenario: Getting before any sync finds no copy
    Given there is no database "lcty_v1_c"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers no items and stale true
    And there is still no database "lcty_v1_c"

  Scenario: Getting returns the copy newest first
    Given "c_meta" holds the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers "d", "b", "c" and "a" in that order, as stored, and stale false

  Scenario: An unknown operation is an error
    When the worker is posted {"id": 1, "op": "nope"}
    Then it answers the error type "unknownOperation"
    And GET /v1/meta-all.json is not fetched

  # Playwright's routes do not catch the requests of a SharedWorker, so this scenario uses no request
  Scenario: A SharedWorker answers on the port the message came from
    Given "c_meta" holds the conversation "a"
    When two ports of new SharedWorker("/lcty.v1/lcty.v1.c.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other
    Then the first port is answered with the id 1 and the conversation "a"
    And the second port is answered with the id 2 and the error type "unknownOperation"

  Scenario: A message without an endpoint is an error
    When the worker is posted {"id": 1, "op": "sync_meta"} without an endpoint
    Then it answers the error "the message has no endpoint" with the status null
    And GET /v1/meta-all.json is not fetched

  Scenario: An endpoint on another origin is an error
    When the worker is posted {"id": 1, "op": "sync_meta", "endpoint": "http://example.com/v1/"}
    Then it answers the error "the endpoint is not on this origin: http://example.com/v1/" with the status null
    And GET /v1/meta-all.json is not fetched

  Scenario: A sync fetches the list from the endpoint it is given
    Given there is no database "lcty_v1_c"
    And GET /api/v1/meta-all.json returns the conversation "a"
    When the worker is posted {"id": 1, "op": "sync_meta"} with the endpoint "/api/v1/" on the page's origin
    Then it answers with no result
    And the list was fetched from /api/v1/meta-all.json only
    And "c_meta" holds exactly the conversation "a", as returned
