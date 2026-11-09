# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# Several pages on /v1/rpc at once: the RPC protocol (LCTYSP-0012) as the pages of LCTYSP-0014 use it, with the
# conversation files of LCTYSP-0013. Each Scenario is a test of the same title in tests/backend/rpc_pages_test.rb, whose
# steps are the lines below.

Feature: LCTYSP-3022 Several pages over /v1/rpc

  LCTYSP-3020 tests each method; this feature tests what several pages connected at the same time rely on. Writes that
  race are decided by the last element alone: one is written and the others are refused with the last id, so a page
  never has to lock anything. Every change has one version, and every page gets the notifications it receives in the
  order of their versions, so a page that follows a conversation from c.subscribe on can rebuild it from c.appended and
  c.unappended alone, missing nothing and getting nothing twice, even while others write. The lcty-cmd of a page is
  found by asking the pages that are connected, so a page that leaves takes its lock claims with it. A page that comes
  back reads again: a new actorId, c.list and c.subscribe tell it what changed. In the steps the servlet is mounted at
  /v1/rpc of a WEBrick server on 127.0.0.1, as in LCTYSP-3020; "a page" is a WebSocket client that sends Origin
  http://allowed.test and receives c.created, c.meta.updated, c.appended and c.unappended; "at once" means one thread
  per page, all released together.

  Background:
    Given the RPC servlet mounted on a WEBrick server

  # ---- Writes that race ----

  Scenario: Of eight pages appending after the same element at once, exactly one is written
    Given a conversation with a system message and eight pages
    When each page appends a user message after the system message at once
    Then exactly one is written and the seven others are refused with error 1 and data.last its id
    And the file holds the system message and that user message

  Scenario: Of four pages appending an lcty-cmd at once, exactly one holds the conversation
    Given a conversation with a user message and four pages
    When each page appends an lcty-cmd after the user message at once
    Then exactly one is written and the three others are refused with error 1 and data.last its id
    And the file ends with that lcty-cmd

  # ---- The order of notifications ----

  Scenario: Every page gets the changes in the same order, one version each
    Given three pages, each with a conversation of its own, and two pages that only watch
    When the three append ten elements each to their conversations at once
    Then each watching page gets thirty c.meta.updated with increasing versions
    And both get them in the same order, with the versions of the thirty responses

  Scenario: A page following a conversation rebuilds it from the notifications
    Given an empty conversation and a page following it
    When another page appends a system message, a user message and an lcty-cmd, removes the lcty-cmd, appends a model message and a user message, and removes that user message
    Then each c.appended names as after the last element the following page holds, and each c.unappended its last element
    And the elements the following page holds are those of the file

  Scenario: A page that subscribes while another writes misses nothing and gets nothing twice
    Given a conversation that a page keeps appending messages to, until ten more after the subscription
    When another page subscribes while it appends
    Then the first c.appended it gets names as after the last id c.subscribe answered, and each next one the one before
    And every one has a version after that of c.subscribe
    And the file up to that last id, followed by the elements notified, is the whole file

  Scenario: A page that follows another conversation stops getting the elements of the first
    Given two conversations and a page following the first
    When it subscribes to the second, an element is appended to each, it subscribes to nothing and one more is appended to the second
    Then it gets c.appended of the second conversation's first element only
    And it gets c.meta.updated of all three

  Scenario: A change made over POST reaches the pages with no actorId
    Given a conversation and a page following it
    When a message is appended over POST
    Then the page gets c.appended and c.meta.updated with actorId null

  # ---- The lcty-cmd between pages ----

  Scenario: The page that holds an lcty-cmd is found by another, and its reply ends the lock
    Given a page that has appended a user message and an lcty-cmd and answers that it holds it, and another page following the conversation
    When the other page appends after the lcty-cmd and calls c.cmd.held
    Then the append is refused with error 2 and c.cmd.held answers held with the actorId of the first page
    When the first page removes the lcty-cmd and appends a model message after the user message
    Then the other page gets c.unappended of the lcty-cmd and then c.appended of the model message
    And its user message after the model message is written

  Scenario: Only the page that holds the lcty-cmd answers held, and only the pages that receive c.cmd.holds are asked
    Given a page holding an lcty-cmd, two pages that answer not held, a page that does not receive c.cmd.holds and a page that asks
    When the asking page calls c.cmd.held
    Then the answer is held with the actorId of the holding page
    And the two other pages were asked once each, and neither the page that does not receive c.cmd.holds nor the asking page was asked

  Scenario: When the page holding an lcty-cmd closes, nobody holds it
    Given a page that has appended an lcty-cmd and answers that it holds it
    When the page closes its connection
    Then another page's c.cmd.held answers not held without waiting for the time to answer

  # ---- Pages that leave and come back ----

  Scenario: A page that closes does not stop the others getting notifications
    Given three pages following a conversation
    When one of them closes its connection without a close frame and a message is appended
    Then the two others get c.appended
    And the server no longer counts the closed page among its connections

  Scenario: A page that reconnects finds what it missed
    Given a page following a conversation with a system message
    When the page closes, a user message is appended, and the page connects again
    Then initialize answers another actorId and a later version
    And c.list holds the conversation, and c.subscribe holding the system message answers not current with the user message as last

  # ---- Titles ----

  Scenario: Of titles written by two pages at once, the one with the last version stays
    Given a conversation, two pages and a page that watches
    When the two pages each change the title ten times at once
    Then the watching page gets twenty c.meta.updated of the conversation
    And the title of the one with the last version is the title c.list answers
