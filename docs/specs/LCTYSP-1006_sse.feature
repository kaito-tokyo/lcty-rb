# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/llm/sse.js (LCTYSP-0002). Each Scenario is a test of the same title in
# tests/unit/sse.spec.js, whose steps are the lines below.

Feature: LCTYSP-1006 Reading server-sent events

  parseSSE(body) turns the body of a fetch Response, a ReadableStream of bytes, into an async sequence of
  {event, data}: js/llm/responses.js reads llama-server's stream of the Responses API with it. The bytes are decoded
  as UTF-8 and cut into lines ending in LF or CRLF. A blank line ends an event: its "data" lines are joined with LF
  and it is yielded with the name of its "event" line, or "message" without one; an event without data is not
  yielded. Lines starting with ":" are comments, one space after the field's colon is dropped, and other fields are
  ignored. At the end of the stream an event that has data is yielded even without its blank line.

  In the steps a chunk is written as a JavaScript string, and an event as its name followed by its data.

  Background:
    Given a page on the server's origin

  Scenario: An event is yielded at its blank line
    Given a body that arrives as the chunk "data: hello\n\n"
    When parseSSE reads it
    Then it yields message "hello"

  Scenario: One chunk may hold several events
    Given a body that arrives as the chunk "data: a\n\ndata: b\n\ndata: c\n\n"
    When parseSSE reads it
    Then it yields message "a", message "b", message "c"

  Scenario: An event may be split across chunks anywhere
    Given a body that arrives as the chunks "da", "ta: hel", "lo\n", "\nda", "ta: wor", "ld\n\n"
    When parseSSE reads it
    Then it yields message "hello", message "world"

  Scenario: A body that arrives one byte at a time gives the same events
    Given a body that arrives as one-byte chunks of "event: delta\ndata: one\ndata: two\n\n: note\ndata: three\n\n"
    When parseSSE reads it
    Then it yields delta "one\ntwo", message "three"

  Scenario: The data lines of one event are joined with a line feed
    Given a body that arrives as the chunk "data: one\ndata: two\ndata: three\n\n"
    When parseSSE reads it
    Then it yields message "one\ntwo\nthree"

  Scenario: The event line names the event, only until its blank line
    Given a body that arrives as the chunk "event: response.output_text.delta\ndata: a\n\ndata: b\n\n"
    When parseSSE reads it
    Then it yields response.output_text.delta "a", message "b"

  Scenario: Comments are skipped
    Given a body that arrives as the chunk ": keep-alive\n\ndata: a\n: between\ndata: b\n\n"
    When parseSSE reads it
    Then it yields message "a\nb"

  Scenario: An event without data is not yielded and its name is forgotten
    Given a body that arrives as the chunk "event: ping\n\ndata: a\n\n"
    When parseSSE reads it
    Then it yields message "a"

  Scenario: Fields other than event and data are ignored
    Given a body that arrives as the chunk "id: 7\nretry: 1000\nfoo: bar\ndata: a\n\n"
    When parseSSE reads it
    Then it yields message "a"

  Scenario: Only one space after the colon is dropped
    Given a body that arrives as the chunk "data:a\n\ndata:  b\n\ndata: c: d \n\n"
    When parseSSE reads it
    Then it yields message "a", message " b", message "c: d "

  Scenario: An empty data line is data
    Given a body that arrives as the chunk "data:\n\ndata\ndata\n\n"
    When parseSSE reads it
    Then it yields message "", message "\n"

  Scenario: Lines may end in CRLF
    Given a body that arrives as the chunk "event: x\r\ndata: a\r\ndata: b\r\n\r\n"
    When parseSSE reads it
    Then it yields x "a\nb"

  Scenario: A CRLF may be split across chunks
    Given a body that arrives as the chunks "data: a\r", "\n\r", "\ndata: b\r", "\n\r\n"
    When parseSSE reads it
    Then it yields message "a", message "b"

  Scenario: A character split across chunks is decoded whole
    Given a body that arrives as the bytes of "data: こんにちは🎉\n\n" in chunks of 4 bytes
    When parseSSE reads it
    Then it yields message "こんにちは🎉"

  Scenario: A byte order mark at the start is dropped
    Given a body that arrives as the bytes EF BB BF followed by the chunk "data: a\n\n"
    When parseSSE reads it
    Then it yields message "a"

  Scenario: At the end of the stream the last event is yielded without its blank line
    Given a body that arrives as the chunks "data: a\n\n", "event: last\ndata: b\n"
    When parseSSE reads it
    Then it yields message "a", last "b"

  Scenario: A last line without its line feed is not read
    Given a body that arrives as the chunks "data: a\n\n", "data: partial"
    When parseSSE reads it
    Then it yields message "a"

  Scenario Outline: A body without events yields nothing
    Given a body that arrives as <body>
    When parseSSE reads it
    Then it yields nothing

    Examples:
      | body                                 |
      | no chunks                            |
      | the chunk "\n\n\n"                   |
      | the chunk ": only a comment\n\n"     |
      | the chunk "event: ping\nid: 1\n\n"   |

  Scenario: Events are yielded as they arrive, before the stream ends
    Given a body that has sent the chunk "data: first\n\n" and stays open
    When parseSSE reads its first event
    Then it yields message "first" while the body is still open

  Scenario: A failed body rejects after the events that arrived before it
    Given a body that sends the chunk "data: a\n\n" and then fails with the error "network lost"
    When parseSSE reads it
    Then it yields message "a"
    And it then rejects with the error "network lost"
