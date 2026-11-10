# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/lcty.v1/lcty.v1.c.worker.cjs (LCTYSP-0014, LCTYSP-0010, LCTYSP-0009). Each Scenario is a test
# of the same title in tests/unit/lcty-c.spec.js, whose steps are the lines below.

Feature: LCTYSP-1001 The copies of c/ in the browser: lcty.v1.c.worker.cjs

  Every operation on the browser's copies of c/ runs in a worker, a classic script started with new
  Worker("/lcty.v1/lcty.v1.c.worker.cjs") or new SharedWorker("/lcty.v1/lcty.v1.c.worker.cjs"): the page posts it a
  message {id, op, endpoint, payload} and gets back, on the same port, {id, result}, or {id, errorType} on a failure:
  "unknownOperation", "error" with the error and the status null, or "errorMessage" when the error cannot be posted.
  endpoint is the URL of the site's v1/: an absolute URL on the worker's origin ending with "/", or the message is an
  error before any operation. The worker is the only code that opens the IndexedDB database "lcty_c", at version 2 with
  the stores "c_meta" and "c_recordcount" (keyed by cid) and "sync" (one row {store, boot, seq} per copy), and it never
  sends a request: the page posts what /v1/rpc answered. "replace" writes a full read unless the copy holds a newer
  version of the same boot; "apply" writes the records of a c.batch.updated onto a copy of the same boot that holds an
  older version; "get" answers the copies, newest first, without ever creating the database. Versions are written
  "<boot>.<seq>".

  Background:
    Given a page on the server's origin
    And every message to the worker has the endpoint "/v1/" on the page's origin, unless the scenario says otherwise

  # ---- Full reads ----

  Scenario: A full read creates the copies
    Given there is no database "lcty_c"
    When the worker is posted a replace of "c_meta" with the conversations "a" and "b" at "b1.5"
    Then it answers that it was applied
    And the database "lcty_c" is at version 2 with the stores "c_meta", "c_recordcount" and "sync"
    And "c_meta" holds exactly the conversations "a" and "b", as posted
    And "sync" holds "c_meta" at boot "b1" and seq 5, and nothing for "c_recordcount"

  Scenario: A full read replaces the copy as a whole
    Given "c_meta" holds the conversations "a" and "b" at "b1.5"
    When the worker is posted a replace of "c_meta" with the conversation "b" with a new title and the conversation "c" at "b1.7"
    Then it answers that it was applied
    And "c_meta" holds exactly the conversations "b" and "c", as posted
    And "sync" holds "c_meta" at boot "b1" and seq 7

  Scenario Outline: A full read is written unless the copy is newer in the same boot
    Given "c_meta" holds the conversation "a" at "<held>"
    When the worker is posted a replace of "c_meta" with the conversation "b" at "<read>"
    Then it answers that it was <applied>
    And "c_meta" holds exactly the conversation "<kept>"

    Examples:
      | held | read | applied     | kept |
      | b1.5 | b1.5 | applied     | b    |
      | b1.7 | b1.5 | not applied | a    |
      | b1.9 | b2.1 | applied     | b    |

  Scenario: The counts are a copy of their own
    Given "c_meta" holds the conversation "a" at "b1.9"
    When the worker is posted a replace of "c_recordcount" with the counts 2 of "a" and 5 of "b" at "b1.5"
    Then it answers that it was applied
    And "c_recordcount" holds exactly 2 of "a" and 5 of "b"
    And "sync" holds "c_meta" at seq 9 and "c_recordcount" at seq 5

  # ---- Changes ----

  Scenario: A change is written onto an older copy of the same boot
    Given "c_meta" holds the conversations "a" and "b" and "c_recordcount" 2 of "a", both at "b1.5"
    When the worker is posted an apply at "b1.6" of a c_meta put of "a" with a new title, a c_recordcount put of 3 of "a" and a c_html append
    Then it answers that "c_meta" and "c_recordcount" applied it
    And "c_meta" holds exactly the conversation "a" with the new title and "b"
    And "c_recordcount" holds exactly 3 of "a"
    And "sync" holds "c_meta" and "c_recordcount" at seq 6

  Scenario: A deleted conversation leaves both copies
    Given "c_meta" holds the conversations "a" and "b" and "c_recordcount" 2 of "a" and 4 of "b", both at "b1.5"
    When the worker is posted an apply at "b1.6" of a c_meta delete and a c_recordcount delete of "b"
    Then it answers that "c_meta" and "c_recordcount" applied it
    And "c_meta" holds exactly the conversation "a"
    And "c_recordcount" holds exactly 2 of "a"

  Scenario Outline: A change is left when the copy is not older in the same boot
    Given "c_meta" holds the conversation "a" at "<held>"
    When the worker is posted an apply at "<change>" of a c_meta put of "b"
    Then it answers that no store applied it
    And "c_meta" holds exactly the conversation "a"

    Examples:
      | change | held |
      | b1.6   | b1.6 |
      | b1.5   | b1.6 |
      | b2.7   | b1.6 |

  Scenario: A change onto a copy that was never read is left
    Given "c_meta" holds the conversation "a" at "b1.5" and "c_recordcount" was never read
    When the worker is posted an apply at "b1.6" of a c_recordcount put of 3 of "a"
    Then it answers that no store applied it
    And "c_recordcount" is empty

  Scenario: A change of other stores only does not open the database
    Given there is no database "lcty_c"
    When the worker is posted an apply at "b1.6" of a c_html append only
    Then it answers that no store applied it
    And there is still no database "lcty_c"

  Scenario Outline: A bad payload is an error
    When the worker is posted <payload>
    Then it answers the error "<message>" with the status null

    Examples:
      | payload                                  | message                |
      | a replace of "c_html" at "b1.5"          | no such store: c_html  |
      | a replace of "c_meta" at "5"             | not a version: 5       |
      | an apply at "b1" of a c_meta put of "a"  | not a version: b1      |

  Scenario: A newer database is left alone
    Given the database "lcty_c" is at version 3 with the store "c_meta" holding the conversation "a"
    When the worker is posted a replace of "c_meta" with the conversation "b" at "b1.5"
    Then it answers an error with the status null
    And the database "lcty_c" is still at version 3

  Scenario: The worker closes its connection after a write
    Given there is no database "lcty_c"
    When the worker is posted a replace of "c_meta" with the conversation "a" at "b1.5"
    Then it answers that it was applied
    And the database "lcty_c" can be opened at version 3 without being blocked, while the worker is still alive

  # ---- Reading ----

  Scenario: Getting before any read finds no copy
    Given there is no database "lcty_c"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers no items, no counts and stale true
    And there is still no database "lcty_c"

  Scenario: Getting a database of version 1 finds no copy
    Given the database "lcty_c" is at version 1 with the store "c_meta" holding the conversation "a"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers no items, no counts and stale true
    And the database "lcty_c" is still at version 1

  Scenario: Getting returns the copy newest first with the counts
    Given "c_meta" holds the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00
    And "c_recordcount" holds 2 of "a" and 5 of "d"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers "d", "b", "c" and "a" in that order, as stored, the counts 2 of "a" and 5 of "d", and stale false

  # ---- Messages ----

  Scenario: An unknown operation is an error
    When the worker is posted {"id": 1, "op": "nope"}
    Then it answers the error type "unknownOperation"

  Scenario: A SharedWorker answers on the port the message came from
    Given "c_meta" holds the conversation "a" at "b1.5"
    When two ports of new SharedWorker("/lcty.v1/lcty.v1.c.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other
    Then the first port is answered with the id 1 and the conversation "a"
    And the second port is answered with the id 2 and the error type "unknownOperation"

  Scenario: A message without an endpoint is an error
    When the worker is posted {"id": 1, "op": "get"} without an endpoint
    Then it answers the error "the message has no endpoint" with the status null

  Scenario: An endpoint on another origin is an error
    When the worker is posted {"id": 1, "op": "get", "endpoint": "http://example.com/v1/"}
    Then it answers the error "the endpoint is not on this origin: http://example.com/v1/" with the status null
