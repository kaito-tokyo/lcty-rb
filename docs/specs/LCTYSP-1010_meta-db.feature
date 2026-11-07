# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/api/meta-db.js (LCTYSP-0010; the sync worker it starts is LCTYSP-1001). Each Scenario is a
# test of the same title in tests/unit/meta-db.spec.js, whose steps are the lines below.

Feature: LCTYSP-1010 The browser's copy of the meta

  The module keeps the browser's copy of every conversation's meta, the store "c_meta" of the IndexedDB database
  "lcty". A sync starts the worker /js/sync_c_meta.worker.js (LCTYSP-1001), which replaces the store with
  GET /v1/meta-all.json; then the module writes a snapshot of the newest 20 conversations to localStorage
  "lcty.meta.v1" for the first paint and calls the listeners of onMetaDbChange. requestMetaDbSync() syncs when the
  browser is idle (the pages call it on loading the list and after sending a change), resetMetaDb() removes the
  snapshot and syncs at once (the sidebar's refresh button), and readMetaDb() reads the copy newest first without ever
  creating the database. In a tab at most one sync runs: syncs requested while one runs share one more sync after it.

  Background:
    Given a page on the server's origin
    And GET /v1/meta-all.json is answered by the test

  Scenario: Reading before any sync finds no copy
    Given there is no database "lcty"
    When readMetaDb() reads the copy
    Then it returns no items and stale true
    And there is still no database "lcty"

  Scenario: Reading a database the worker has not upgraded finds no copy
    Given the database "lcty" is at version 4 with the stores "meta" and "sync"
    When readMetaDb() reads the copy
    Then it returns no items and stale true
    And the database "lcty" is still at version 4

  Scenario: Reading returns the copy newest first
    Given "c_meta" holds the conversations "a" updated at 10:00, "b" at 12:00, "c" at 11:00 and "d" at 12:00
    When readMetaDb() reads the copy
    Then it returns "d", "b", "c" and "a" in that order, as stored, and stale false

  Scenario: Reading leaves no connection open
    Given "c_meta" holds the conversation "a"
    When readMetaDb() reads the copy
    Then the database "lcty" can be opened at version 6 without being blocked

  Scenario: A reset syncs at once
    Given there is no database "lcty"
    And GET /v1/meta-all.json returns the conversations "a" and "b"
    And a listener is registered with onMetaDbChange
    When resetMetaDb() is called
    Then it resolves after GET /v1/meta-all.json was requested once
    And readMetaDb() returns the conversations "a" and "b" and stale false
    And the listener was called once

  Scenario: A sync writes a snapshot of the newest 20 conversations
    Given GET /v1/meta-all.json returns 25 conversations, each updated at a different time
    When resetMetaDb() is called
    Then localStorage "lcty.meta.v1" holds the newest 20 of them, newest first
    And each entry has only id, title, updated_at_hint, tags_hint and messages_hint

  Scenario: A snapshot that does not fit is removed
    Given localStorage "lcty.meta.v1" holds an old snapshot
    And GET /v1/meta-all.json returns 20 conversations whose titles together are too large for localStorage
    When resetMetaDb() is called
    Then it resolves
    And localStorage has no "lcty.meta.v1"
    And readMetaDb() returns the 20 conversations

  Scenario Outline: A failed reset rejects with the worker's error and keeps the copy
    Given "c_meta" holds the conversations "a" and "b"
    And localStorage "lcty.meta.v1" holds an old snapshot
    And a listener is registered with onMetaDbChange
    And GET /v1/meta-all.json <answer>
    When resetMetaDb() is called
    Then it rejects with an error whose message has "<message>" and does not start with "Uncaught"
    And localStorage has no "lcty.meta.v1"
    And readMetaDb() returns the conversations "a" and "b"
    And the listener was not called

    Examples:
      | answer                        | message                                |
      | answers with the status 500   | Failed to fetch /v1/meta-all.json: 500 |
      | returns an object, not a list | meta-all.json is invalid               |

  Scenario: Resets made during a sync share one sync after it
    Given GET /v1/meta-all.json is held until the test answers it
    When resetMetaDb() is called three times
    Then GET /v1/meta-all.json has been requested once
    And the second and the third call return the same promise
    When the first request is answered with the conversation "a"
    Then GET /v1/meta-all.json is requested a second time
    When the second request is answered with the conversation "b"
    Then all three calls resolve
    And readMetaDb() returns only the conversation "b"

  Scenario: A sync queued after a failed one still runs
    Given GET /v1/meta-all.json answers with the status 500 first and returns the conversation "a" next
    When resetMetaDb() is called twice at once
    Then the first call rejects and the second resolves
    And readMetaDb() returns only the conversation "a"

  Scenario: Requests made before the browser is idle share one sync
    Given GET /v1/meta-all.json returns the conversation "a"
    And a listener is registered with onMetaDbChange
    When requestMetaDbSync() is called three times
    Then the listener is called once
    And GET /v1/meta-all.json was requested once
    And readMetaDb() returns only the conversation "a"

  Scenario: A request after a finished sync syncs again
    Given GET /v1/meta-all.json returns the conversation "a" first and the conversations "a" and "b" next
    And a listener is registered with onMetaDbChange
    When requestMetaDbSync() is called and the listener has been called
    And requestMetaDbSync() is called again
    Then the listener is called a second time
    And GET /v1/meta-all.json was requested twice
    And readMetaDb() returns the conversations "a" and "b" and stale false

  Scenario: A failed requested sync is only logged
    Given "c_meta" holds the conversation "a"
    And GET /v1/meta-all.json answers with the status 500
    And a listener is registered with onMetaDbChange
    When requestMetaDbSync() is called
    Then the warning "the meta of the conversations could not be synced" is logged
    And the listener was not called
    And readMetaDb() returns only the conversation "a"

  Scenario: A listener that throws does not stop the others
    Given a listener that throws is registered with onMetaDbChange
    And a second listener is registered with onMetaDbChange
    And GET /v1/meta-all.json returns the conversation "a"
    When resetMetaDb() is called
    Then it resolves
    And the second listener was called once
    And the error of the first listener is logged as a warning

  Scenario: A snapshot written in another document notifies the listeners
    Given a listener is registered with onMetaDbChange
    When another document of the same origin writes localStorage "lcty.meta.v1"
    Then the listener is called once
    And GET /v1/meta-all.json was not requested

  Scenario: Other keys written in another document do not notify the listeners
    Given a listener is registered with onMetaDbChange
    When another document of the same origin writes localStorage "lcty.other"
    Then the listener was not called
