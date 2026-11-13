# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/embedding.rb and lib/embedding/indexer.rb, and of the parts of /v1 and /v1/rpc that use them
# (LCTYSP-0019). Each Scenario is a test of the same title in tests/backend/server_embedding_test.rb, whose steps are
# the lines below. The tests run tests/backend/fake/llama-server in place of llama-server.

Feature: LCTYSP-3028 Embedding on the server

  Chatty::Embedding opens the vector pair at startup, starts the embedding server and queues every user and model
  message of the lcty-msg files that has no valid row. The indexer embeds each with the prefix "title: none | text: ",
  in parts of at most 6,000 characters, and appends its rows. A message that goes away (c.unappend, or its
  conversation deleted) has its rows filled with NaN. /v1 serves the pair's JSON, and .dat and .idx by Range;
  /v1/rpc embeds a query with vectors.<name>.embed and announces changes with vectors.<name>.changed.

  Background:
    Given a data directory with the conversation "c1" holding a system message, a user message and a model reply

  Scenario: The pair is named after the model
    When the name of the pair is asked for the default model and for "someone/other-GGUF:Q4_0"
    Then it is "eg2_264" for the default and the first 8 hex digits of the SHA-256 of the repository, then "_264"

  Scenario: A long message is embedded in parts
    When the inputs of a message of 13,000 characters are made
    Then there are three, of 6,000, 6,000 and 1,000 characters after the prefix "title: none | text: "

  Scenario: Every user and model message is embedded at startup
    When the embedding is started
    Then the user message and the model reply each have one valid row, and the system message none
    And each row is the vector of its content with the prefix "title: none | text: "
    And a change was announced as vectors.eg2_264.changed with the summary of the pair

  Scenario: A message appended through /v1/rpc is embedded
    Given the embedding is started and has embedded "c1"
    When a user message is appended to "c1" with c.append.msg
    Then that message gets a valid row

  Scenario: A message removed with c.unappend has its rows filled with NaN
    Given the embedding is started and has embedded "c1"
    When the model reply is removed with c.unappend
    Then its row is listed as invalid in the summary
    And the user message keeps its valid row

  Scenario: Deleting a conversation fills its rows with NaN
    Given the embedding is started and has embedded "c1"
    When "c1" is deleted with DELETE /v1/conversations/c1
    Then the rows of the user message and the model reply are listed as invalid

  Scenario: A message removed while it is being embedded is dropped
    Given the embedding is started and has embedded "c1"
    And a user message appended to "c1" that is removed while the indexer embeds it
    When the indexer processes it
    Then no row is appended for it

  Scenario: The JSON of the pair is revalidated by its ETag
    Given the embedding is started and has embedded "c1"
    When GET /v1/vectors.eg2_264.json is requested, and again with If-None-Match of its ETag
    Then the first answer is 200 with the summary of the pair: its rev, its count and its invalid ranges
    And the second is 304

  Scenario: The rows are served by Range in the generation of If-Match
    Given the embedding is started and has embedded "c1"
    When the 16 bytes of the user message's record of /v1/vectors.eg2_264.idx are requested with If-Match of the rev
    Then the answer is 206 with the message's id and a Content-Range of those bytes and the size of .idx
    And the same request with If-Match of another rev is answered 412
    And a range from the end of .idx is answered 416
    And a request for .dat with Range is answered with the row of the user message

  Scenario: A query is embedded over /v1/rpc
    Given the embedding is started and has embedded "c1"
    When vectors.eg2_264.embed is called with the text "closures"
    Then the result's vector is the base64 of 256 Float32 LE, the vector of "task: search result | query: closures"
    And initialize lists vectors.eg2_264.embed among the methods the server receives

  Scenario: Without an embedding server a query is unavailable
    Given the embedding is started with --no-embedding
    When vectors.eg2_264.embed is called with the text "closures"
    Then it is answered with the error 7
    And the pair is still open and served
