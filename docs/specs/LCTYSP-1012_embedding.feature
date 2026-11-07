# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/search/embed.js (LCTYSP-0007, LCTYSP-0008; the records are those of LCTYSP-1011 and
# LCTYSP-3006, the pending rounds and the PUT those of LCTYSP-3007). Each Scenario is a test of the same title in
# tests/unit/embed.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1012 Embedding and indexing

  The browser talks to the embedding model itself, through the OpenAI-compatible POST <base_url>/v1/embeddings of the
  backend in its settings. embeddingConfig(backend) is the config of a backend with an embedding_model, or null.
  embedQuery(cfg, q, signal) embeds a search query with the prefix "task: search result | query: " and returns its
  768-dimension Float32Array. createIndexer({ getConfig, onError }) makes the indexer: each kick() runs passes that ask
  GET /v1/vectors/pending for the rounds without vectors, embed their parts with the prefix "title: none | text: " in
  batches of about 6,000 characters, and PUT them to /v1/vectors as registration records (LCTYSP-1011), until nothing
  is pending. One pass runs at a time; a kick while it runs asks for one more pass. A round whose embedding fails is
  reported to onError and skipped for the rest of the session.

  In the Scenarios the embedding of a text is 768 values whose first is a number the test gave that text, so the
  records sent can be read back as texts.

  Background:
    Given POST /llm/v1/embeddings of the embedding model is answered by the test
    And GET /v1/vectors/pending and PUT /v1/vectors are answered by the test, which registers the rounds it is sent

  Scenario Outline: A backend without an embedding model has no config
    When embeddingConfig is given <backend>
    Then it returns null

    Examples:
      | backend                                  |
      | null                                     |
      | a backend without embedding_model        |
      | a backend whose embedding_model is empty |

  Scenario: A backend with an embedding model has a config
    When embeddingConfig is given a backend whose embedding_model is "eg2"
    Then it returns the backend itself and the model "eg2"

  Scenario: A query is embedded with the query prefix
    Given a backend at /llm/ of the page's origin with the embedding model "eg2" and the API key "test-key"
    When embedQuery embeds "cats"
    Then POST /llm/v1/embeddings was requested once, with the Content-Type application/json and the Authorization "Bearer test-key"
    And its body is the model "eg2" and the input "task: search result | query: cats"
    And it returns the embedding of that input as a Float32Array of 768 values

  Scenario: Without an API key no Authorization is sent
    Given a backend at /llm/ of the page's origin with the embedding model "eg2" and no API key
    When embedQuery embeds "cats"
    Then POST /llm/v1/embeddings was requested once, without an Authorization

  Scenario: The slashes at the end of the base URL are dropped
    Given a backend at /llm/// of the page's origin with the embedding model "eg2" and no API key
    When embedQuery embeds "cats"
    Then POST /llm/v1/embeddings was requested once, without an Authorization

  Scenario Outline: A failed embedding rejects
    Given a backend at /llm/ of the page's origin with the embedding model "eg2" and no API key
    And POST /llm/v1/embeddings answers with <answer>
    When embedQuery embeds "cats"
    Then it rejects with "<message>"

    Examples:
      | answer                                                  | message                      |
      | the status 500 and the error message "model not loaded" | model not loaded             |
      | the status 400 and an error without a message           | HTTP 400                     |
      | the status 503 and a body that is not JSON              | HTTP 503                     |
      | the status 200 and no data                              | HTTP 200                     |
      | an embedding of 256 values                              | wrong dimensions (256 ≠ 768) |

  Scenario: An aborted signal cancels the embedding
    Given a backend at /llm/ of the page's origin with the embedding model "eg2" and no API key
    When embedQuery embeds "cats" with a signal that is already aborted
    Then it rejects with an AbortError
    And POST /llm/v1/embeddings was not requested

  Scenario: Without a config the indexer requests nothing
    Given an indexer whose getConfig returns null
    And a round "r1" is pending
    When kick() runs
    Then GET /v1/vectors/pending was not requested
    And POST /llm/v1/embeddings was not requested

  Scenario: A pending round is embedded and registered
    Given an indexer for the model "eg2"
    And a round "r1" of the rev "1111111111111111" is pending with the part "hello"
    When kick() runs
    Then GET /v1/vectors/pending?model=eg2&limit=16 was requested twice
    And POST /llm/v1/embeddings was requested once, with the model "eg2" and the input "title: none | text: hello"
    And one PUT /v1/vectors?model=eg2&magic=lctyvLE0&size=3072&entry_count=1&rev=<r1>:1111111111111111 was sent, as application/octet-stream
    And its body is the record of "r1" with the embedding of "title: none | text: hello"
    And onError was not called

  Scenario: Every part of a round is a record of its id, in order
    Given an indexer for the model "eg2"
    And a round "r1" is pending with the parts "p1", "p2" and "p3"
    When kick() runs
    Then one PUT was sent, with the entry_count 3 and the rev of "r1" only
    And its body is the records of "r1" with the embeddings of "p1", "p2" and "p3", in order

  Scenario: Small rounds are embedded together
    Given an indexer for the model "eg2"
    And the rounds "r1", "r2" and "r3" of 100 characters each are pending, in that order
    When kick() runs
    Then POST /llm/v1/embeddings was requested once, with the parts of "r1", "r2" and "r3", in order
    And one PUT was sent, with the entry_count 3 and the revs of "r1", "r2" and "r3", in order

  Scenario: Rounds are cut into batches of 6,000 characters in their order
    Given an indexer for the model "eg2"
    And the rounds "r1" of 4,000 characters, "r2" of 3,000 and "r3" of 2,000 are pending, in that order
    When kick() runs
    Then POST /llm/v1/embeddings was requested twice, with the parts of "r1", then of "r2" and "r3"
    And two PUTs were sent, of "r1", then of "r2" and "r3"

  Scenario: A round longer than a batch is embedded alone
    Given an indexer for the model "eg2"
    And the round "r1" with parts of 6,000 and 1,000 characters and the round "r2" of 10 are pending, in that order
    When kick() runs
    Then POST /llm/v1/embeddings was requested twice, with the parts of "r1", then of "r2"
    And two PUTs were sent, of "r1", then of "r2"

  Scenario: The embeddings are matched to the parts by their index
    Given an indexer for the model "eg2"
    And a round "r1" is pending with the parts "p1", "p2" and "p3"
    And POST /llm/v1/embeddings answers with the embeddings in reverse order, each with its index
    When kick() runs
    Then the PUT body is the records of "r1" with the embeddings of "p1", "p2" and "p3", in order

  Scenario: When a batch fails, each round is embedded alone
    Given an indexer for the model "eg2"
    And the rounds "r1" and "r2" of 100 characters each are pending, in that order
    And POST /llm/v1/embeddings answers with the status 500 when it is given more than one input
    When kick() runs
    Then POST /llm/v1/embeddings was requested three times: with the parts of "r1" and "r2", of "r1", of "r2"
    And one PUT was sent, of "r1" and "r2"
    And onError was not called

  Scenario: A round that fails alone is reported and skipped for the session
    Given an indexer for the model "eg2"
    And the rounds "r1" and "r2" of 100 characters each are pending, in that order
    And POST /llm/v1/embeddings answers with the status 500 and the error message "too large" when it is given the part of "r2"
    When kick() runs
    Then one PUT was sent, of "r1"
    And onError was called once, with "too large"
    When kick() runs again
    Then GET /v1/vectors/pending was requested again
    But no more embeddings were requested and no more PUTs were sent
    And onError was called once, with "too large"

  Scenario: A round the server keeps pending is sent once per pass
    Given an indexer for the model "eg2"
    And a round "r1" is pending with the part "hello", which the server never registers
    When kick() runs
    Then one PUT was sent, of "r1"
    And GET /v1/vectors/pending was requested twice
    When kick() runs again
    Then two PUTs were sent, of "r1", then of "r1"

  Scenario: Kicks while a pass runs cause one more pass after it
    Given an indexer for the model "eg2"
    And nothing is pending
    And GET /v1/vectors/pending is held until the test answers it
    When kick() is called three times
    Then the second and the third call resolve at once
    And GET /v1/vectors/pending has been requested once
    When the request is answered with nothing pending
    Then the first call resolves
    And GET /v1/vectors/pending was requested twice

  Scenario: Each pass reads the config again
    Given an indexer for the model "a"
    And nothing is pending
    When kick() runs
    And the config changes to the model "b"
    And kick() runs again
    Then GET /v1/vectors/pending was requested with the model "a", then with the model "b"

  Scenario: A failed request for pending rounds is reported
    Given an indexer for the model "eg2"
    And GET /v1/vectors/pending answers with the status 500 and the body "boom"
    When kick() runs
    Then onError was called once, with "500 boom"
    When GET /v1/vectors/pending answers with nothing pending
    And kick() runs again
    Then GET /v1/vectors/pending was requested twice
    And onError was called once, with "500 boom"

  Scenario: A failed PUT is reported and ends the pass
    Given an indexer for the model "eg2"
    And a round "r1" is pending with the part "hello"
    And PUT /v1/vectors answers with the status 400 and the body "bad body"
    When kick() runs
    Then onError was called once, with "400 bad body"
    And GET /v1/vectors/pending was requested once
