# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/api/tab-rpc.js, the tab's one connection to /v1/rpc (LCTYSP-0014). Each Scenario is a test
# of the same title in tests/unit/tab-rpc.test.js, whose steps are the lines below.

Feature: LCTYSP-1024 The tab's connection

  The parts of a page (the sidebar, the conversation page) register the notifications they follow (onTabNotify), the
  requests of the server they answer (onTabRequest) and what to do whenever the connection opens (onTabOpen); then the
  page opens the connection with tabRpc(), which declares all of them in initialize (connectRpc, LCTYSP-1022). In the
  steps every scenario loads the module anew, and the WebSocket is a fake that records what is sent and is driven by
  the test, with a fake timer; nothing reaches a server.

  Background:
    Given the module, with a fake WebSocket and a fake timer for tabRpc()

  Scenario: The connection declares what every part registered
    Given two listeners of "c.batch.updated", one of "t.batch.updated" and an answer to "c.cmd.holds" are registered
    When tabRpc() is called and the socket opens
    Then initialize declares the receives "c.batch.updated", "t.batch.updated" and "c.cmd.holds"

  Scenario: A notification goes to every listener, whatever one throws
    Given a listener of "c.batch.updated" that throws and a second one are registered
    And the connection is open
    When the server sends c.batch.updated
    Then the second listener gets its params
    And the error of the first is logged as a warning

  Scenario: Every open listener gets the connection, again after reconnecting
    Given a listener of the connection's opening is registered
    When the connection opens
    Then the listener has been called once with the connection
    When the socket closes and the client opens a new one
    Then the listener has been called twice with the connection

  Scenario: tabRpc() returns the one connection of the tab
    When tabRpc() is called twice
    Then both calls return the same connection, on one socket

  Scenario: Registering after the connection is open is refused
    Given tabRpc() has been called
    Then onTabNotify, onTabRequest and onTabOpen each throw "the tab's connection is already open"
