# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/api/rpc.js, the page's end of /v1/rpc (LCTYSP-0012, LCTYSP-0014). Each Scenario is a test
# of the same title in tests/unit/rpc.test.js, whose steps are the lines below.

Feature: LCTYSP-1022 The RPC client

  connectRpc opens one WebSocket and keeps it open. It sends initialize with the methods the page receives, answers the
  server's requests, hands the notifications to the page, and opens a new socket when one closes. In the steps the
  WebSocket is a fake that records what is sent and is driven by the test, and the timer a fake that records the delays
  it is given; nothing reaches a server.

  Background:
    Given connectRpc with the notification "c.batch.updated", the request "c.cmd.holds" and onOpen, on a fake WebSocket and a fake timer

  Scenario: The client sends initialize with the methods it receives, then calls onOpen
    When the socket opens
    Then the first message is initialize with the receives "c.batch.updated" and "c.cmd.holds"
    When initialize answers the actorId "actor-1"
    Then onOpen has been called once and the client's actorId is "actor-1"

  Scenario: A request sent before initialize has answered waits for it
    When c.list is called before the socket opens
    And the socket opens and initialize answers
    Then the second message is the request c.list with its params

  Scenario: A result resolves the call, and an error rejects it with an RpcError
    Given the socket is open and initialized
    When c.list is called and answered with a result, and c.unappend is called and answered with the error 1 and data
    Then the first call resolves to the result
    And the second rejects with an RpcError of the code 1, the message and the data

  Scenario: A notification goes to its handler, and one not received is ignored
    Given the socket is open and initialized
    When the server sends c.batch.updated and then c.other
    Then the handler of c.batch.updated has been given its params once
    And nothing is sent back

  Scenario Outline: A request of the server is answered
    Given the socket is open and initialized
    When the server sends the request <method>
    Then the client answers it with <answer>

    Examples:
      | method               | answer                                  |
      | c.cmd.holds          | the result of its handler                |
      | c.cmd.holds throwing | an error of the code -32603 and its text |
      | c.unknown            | an error of the code -32603              |

  Scenario: A lost connection rejects the waiting calls and opens a new socket, waiting longer each time
    Given the socket is open and initialized, and c.list is waiting for its answer
    When the socket closes
    Then the call rejects because the connection was lost
    And a new socket is opened after 1000 ms
    When that socket closes before it opens
    Then the next one is opened after 2000 ms
    When it opens and initialize answers
    Then onOpen has been called again

  Scenario: close() closes the socket and opens no other
    Given the socket is open and initialized
    When close() is called
    Then the socket is closed, no new socket is waited for, and a call rejects
