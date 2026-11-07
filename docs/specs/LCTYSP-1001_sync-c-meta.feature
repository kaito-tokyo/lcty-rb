# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/sync_c_meta.worker.js (LCTYSP-0010). Each Scenario is a test of the same title in
# tests/unit/sync_c_meta.spec.js, whose steps are the lines below.

Feature: LCTYSP-1001 Syncing the meta of every conversation into c_meta

  The worker is started with new Worker("/js/sync_c_meta.worker.js", { type: "module" }). It fetches
  GET /v1/meta-all.json, replaces the IndexedDB store "c_meta" of the database "lcty" with the list in one
  transaction, posts undefined and closes its connection. When a step fails it throws at its top level, so the
  page gets the Worker's error event instead of a message, and the copy is left as it was.

  Background:
    Given a page on the server's origin
    And GET /v1/meta-all.json is answered by the test

  Scenario: A sync stores every conversation of the list
    Given there is no database "lcty"
    And GET /v1/meta-all.json returns the conversations "a" and "b"
    When the worker runs
    Then it posts undefined
    And the database "lcty" is at version 5 with only the store "c_meta"
    And "c_meta" holds exactly the conversations "a" and "b", as returned

  Scenario: A sync replaces the copy as a whole
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns the conversation "b" with a new title and the conversation "c"
    When the worker runs
    Then it posts undefined
    And "c_meta" holds exactly the conversations "b" and "c", as returned

  Scenario: An empty list empties the copy
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns no conversations
    When the worker runs
    Then it posts undefined
    And "c_meta" is empty

  Scenario: Upgrading a version 4 database drops the stores of the old worker
    Given the database "lcty" is at version 4 with the stores "meta" and "sync", each holding a record
    And GET /v1/meta-all.json returns the conversation "a"
    When the worker runs
    Then it posts undefined
    And the database "lcty" is at version 5 with only the store "c_meta"
    And "c_meta" holds exactly the conversation "a", as returned

  Scenario: The worker closes its connection after the sync
    Given there is no database "lcty"
    And GET /v1/meta-all.json returns the conversation "a"
    When the worker runs
    Then it posts undefined
    And the database "lcty" can be opened at version 6 without being blocked, while the worker is still alive

  Scenario Outline: A failed sync leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json <answer>
    When the worker runs
    Then the Worker's error event says "<message>"
    And it posts nothing
    And "c_meta" holds exactly the conversations "a" and "b"

    Examples:
      | answer                          | message                                |
      | answers with the status 500     | Failed to fetch /v1/meta-all.json: 500 |
      | returns an object, not a list   | meta-all.json is invalid               |

  Scenario: A response that is not JSON leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json returns a body that is not JSON
    When the worker runs
    Then the Worker's error event fires
    And it posts nothing
    And "c_meta" holds exactly the conversations "a" and "b"

  Scenario: A failed request leaves the copy as it was
    Given "c_meta" holds the conversations "a" and "b"
    And GET /v1/meta-all.json fails without a response
    When the worker runs
    Then the Worker's error event fires
    And it posts nothing
    And "c_meta" holds exactly the conversations "a" and "b"

  Scenario: A newer database is left alone
    Given the database "lcty" is at version 6 with the store "c_meta" holding the conversation "a"
    And GET /v1/meta-all.json returns the conversation "b"
    When the worker runs
    Then the Worker's error event fires
    And it posts nothing
    And the database "lcty" is still at version 6
    And "c_meta" holds exactly the conversation "a"
