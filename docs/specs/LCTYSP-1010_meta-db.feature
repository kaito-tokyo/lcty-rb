# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/api/meta-db.js (LCTYSP-0014, LCTYSP-0010; the worker it starts is LCTYSP-1001). Each
# Scenario is a test of the same title in tests/unit/meta-db.spec.js, whose steps are the lines below.

Feature: LCTYSP-1010 The browser's copies of the list of conversations

  The module keeps the browser's copies of the list of conversations, the stores "c_meta" and "c_recordcount" of the
  IndexedDB database "lcty_c", through the worker /lcty.v1/lcty.v1.c.worker.cjs (LCTYSP-1001), which alone opens it.
  readMetaDbFrom(rpc) calls c.list and then c.recordcount.list on the page's /v1/rpc connection and posts each answer
  to the worker as a replace; applyMetaBatch(params) posts the records of a c.batch.updated as an apply, after the
  lists when they are being read; readMetaDb() reads the copies through the worker ({items, counts, stale}). In a tab
  the operations run one at a time, in order. The listeners of onMetaDbChange are called once the worker has stored
  something. In the steps "the connection" is a fake rpc whose answers the test gives, and versions are written
  "<boot>.<seq>".

  Background:
    Given a page on the server's origin
    And a connection whose answers to c.list and c.recordcount.list the test gives

  Scenario: Reading before any list finds no copy
    Given there is no database "lcty_c"
    When readMetaDb() reads the copies
    Then it returns no items, no counts and stale true
    And there is still no database "lcty_c"

  Scenario: Reading the lists stores the meta and the counts
    Given c.list answers "a" updated at 10:00 and "b" at 12:00, and c.recordcount.list 2 of "a", both at "b1.5"
    And a listener is registered with onMetaDbChange
    When readMetaDbFrom(the connection) is called
    Then it resolves after c.list and then c.recordcount.list were called once each
    And readMetaDb() returns "b" and "a" in that order, the counts 2 of "a", and stale false
    And the listener was called once

  Scenario: A notification that arrives while the lists are read is written after them
    Given c.list is held until the test answers it
    When readMetaDbFrom(the connection) is called
    And applyMetaBatch() is given a c_meta put of "c" at "b1.6"
    And c.list answers "a" at "b1.5" and c.recordcount.list nothing at "b1.5"
    Then readMetaDbFrom resolves
    And readMetaDb() returns "c" and "a"

  Scenario: A notification after the lists is written and calls the listeners
    Given the lists have been read with "a" at "b1.5"
    And a listener is registered with onMetaDbChange
    When applyMetaBatch() is given a c_meta put of "b" at "b1.6" and a c_recordcount put of 3 of "b"
    Then readMetaDb() returns "b" and "a" and the counts 3 of "b"
    And the listener was called once

  Scenario: A notification older than the copy is left and calls no listener
    Given the lists have been read with "a" at "b1.6"
    And a listener is registered with onMetaDbChange
    When applyMetaBatch() is given a c_meta put of "b" at "b1.5"
    And readMetaDb() has been called after it
    Then readMetaDb() returns only "a"
    And the listener was not called

  Scenario: A failed read rejects and keeps the copies
    Given the lists have been read with "a" at "b1.5"
    And a listener is registered with onMetaDbChange
    And c.list fails with "the connection was lost"
    When readMetaDbFrom(the connection) is called
    Then it rejects with "the connection was lost"
    And readMetaDb() returns only "a"
    And the listener was not called

  Scenario: A notification held during a failed read is still written
    Given the lists have been read with "a" at "b1.5"
    And c.list is held until the test answers it
    When readMetaDbFrom(the connection) is called
    And applyMetaBatch() is given a c_meta put of "b" at "b1.6"
    And c.list fails with "the connection was lost"
    Then readMetaDbFrom rejects
    And readMetaDb() returns "b" and "a"

  Scenario: A listener that throws does not stop the others
    Given a listener that throws is registered with onMetaDbChange
    And a second listener is registered with onMetaDbChange
    And c.list answers "a" and c.recordcount.list nothing, both at "b1.5"
    When readMetaDbFrom(the connection) is called
    Then it resolves
    And the second listener was called once
    And the error of the first listener is logged as a warning

  Scenario: Reading leaves no connection open
    Given the lists have been read with "a" at "b1.5"
    When readMetaDb() reads the copies
    Then the database "lcty_c" can be opened at version 3 without being blocked
