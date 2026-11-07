# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/search/vectors.js (LCTYSP-0008; the server reads the records as LCTYSP-3006, the worker is
# LCTYSP-1013). Each Scenario is a test of the same title in tests/unit/vectors.spec.js, whose steps are the lines
# below.

Feature: LCTYSP-1011 Vector records and the vector store

  encodeRecords(items) turns [{id, vec}] (768-dimension Float32Arrays) into the registration vector binary lctyvLE0
  that the indexer PUTs (LCTYSP-1012): one record of 3,104 bytes per item, a 16-byte control block ("lctyvLE0", the
  vector's byte size 3072 as uint32 LE, a reserved uint32 of 0), the 16 bytes of the id, then the vector as Float32
  LE, the records the server's VectorRecords reads (LCTYSP-3006). It returns { body, size, count }.

  createVectorStore() makes the client of the semantic search worker /fuzzy_search.worker.js (LCTYSP-1013), which
  starts on first use. refresh() loads the distribution files /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx
  in the worker (concurrent calls share one load) and sets size, the row count. search(q, k = 50, { allow, accept })
  cuts the 768-dimension query to its first 256 dimensions, renormalizes it, and answers the k best ids as
  [id, score] pairs, descending; allow is the only ids the worker may answer, accept a check on the main thread (the
  worker is then asked for 2k). A store with no rows answers no ids without asking the worker. When the worker fails
  (its error event), the calls waiting for it reject and the next call starts a new worker.

  In the Scenarios a row's score is its first value: the queries are 1 in their first dimension unless said otherwise.

  Background:
    Given a page on the server's origin
    And /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx are answered by the test

  Scenario: A record is the control block, the id and the vector
    Given a UUIDv7 id and a vector of 768 Float32 values
    When encodeRecords encodes them
    Then it returns a body of 3,104 bytes, the size 3072 and the count 1
    And the bytes 0 to 15 are 6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00
    And the bytes 16 to 31 are the 16 bytes of the id
    And the rest is the vector as Float32 LE

  Scenario: Records follow each other in the order given
    Given three items, the first and the third with the same id
    When encodeRecords encodes them
    Then it returns a body of 9,312 bytes, the size 3072 and the count 3
    And each record of 3,104 bytes is the control block, the id and the vector of its item, in order

  Scenario: No items encode to an empty body
    When encodeRecords encodes no items
    Then it returns a body of 0 bytes, the size 3072 and the count 0

  Scenario: A vector that is a view of a larger array is encoded from its own values
    Given an item whose vector is the 768 values from the 11th of a Float32Array of 1,000
    When encodeRecords encodes it
    Then the bytes from 32 are those 768 values as Float32 LE

  Scenario Outline: A vector that does not have 768 dimensions is rejected
    Given an item whose vector has <dims> values
    When encodeRecords encodes it
    Then it throws "wrong dimensions (<dims> ≠ 768)"

    Examples:
      | dims |
      | 256  |
      | 767  |
      | 769  |

  Scenario: FULL_DIM is the dimension of registration
    Then FULL_DIM is 768

  Scenario: A new store is empty and starts no worker
    When createVectorStore() makes a store
    And it searches with k 3
    Then its size is 0
    And the search answers no ids
    And /fuzzy_search.worker.js was not requested

  Scenario: A refresh loads the distribution files in the worker
    Given the files hold the rows of "a", "b" and "c"
    And a store made by createVectorStore()
    When refresh() is called
    Then it resolves and the size is 3
    And /fuzzy_search.worker.js was requested once
    And each file was requested once

  Scenario: Concurrent refreshes share one load
    Given the files hold the rows of "a" and "b"
    And a store made by createVectorStore()
    When refresh() is called twice at once
    Then both resolve and the size is 2
    And each file was requested once

  Scenario: A refresh after the files changed loads the new rows in the same worker
    Given the files hold the rows of "a" and "b", with the ETag "v1"
    And a store that has been refreshed
    And the files now hold the row of "c", with the ETag "v2"
    When refresh() is called
    Then it resolves and the size is 1
    And a search with k 3 answers "c"
    And /fuzzy_search.worker.js was requested once

  Scenario: Refreshing empty files leaves the store empty
    Given the files are empty
    And a store made by createVectorStore()
    When refresh() is called
    Then it resolves and the size is 0
    And a search with k 3 answers no ids

  Scenario: A search answers the k best ids by their best row, with their scores
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 3
    Then it answers "a" 0.875, "c" 0.75 and "b" 0.5

  Scenario: The query is cut to its first 256 dimensions and renormalized
    Given the files hold the rows of "x", "y" and "z", 1 in their first, second and third dimension
    And a store that has been refreshed
    When it searches with k 3 for a query of 3 and 4 in its first two dimensions, 100 in the 257th and -50 in the 768th
    Then it answers "y" 0.8, "x" 0.6 and "z" 0

  Scenario: A query of zeros scores every row 0
    Given the files hold the rows of "a" and "b"
    And a store that has been refreshed
    When it searches with k 3 for a query of 768 zeros
    Then it answers "a" and "b", both with the score 0

  Scenario: A store searched without k answers at most 50 ids
    Given the files hold one row for each of 60 ids, every one scoring differently
    And a store that has been refreshed
    When it searches without k
    Then it answers the 50 best ids, descending

  Scenario: allow is the only ids the worker may answer
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 3 and allow "b" and "d"
    Then it answers "b" 0.5 and "d" 0.125

  Scenario: accept drops ids on the main thread before k are taken
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 2 and an accept that rejects "a"
    Then it answers "c" 0.75 and "b" 0.5

  Scenario: accept is given only the 2k best ids
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 1 and an accept that takes only "d"
    Then it answers no ids
    And accept was asked about "a" and "c" only

  Scenario: A query shorter than 256 dimensions is rejected by the worker
    Given the files hold the rows of "a" and "b"
    And a store that has been refreshed
    When it searches with k 3 for a query of 100 dimensions
    Then the search rejects with "wrong query dimensions (100 ≠ 256)"

  Scenario Outline: A failed refresh rejects and keeps what was loaded
    Given the files hold the rows of "a" and "b", with the ETag "v1"
    And a store that has been refreshed
    And with the ETag "v2", <change>
    When refresh() is called
    Then it rejects with "<error>"
    And the size is still 2
    And a search with k 3 answers "b" and "a"

    Examples:
      | change                                              | error                                         |
      | /v1/vectors.eg2_264.dat answers with the status 500 | failed to fetch the vectors (HTTP 500)        |
      | the rows are one byte short                         | broken vectors (2111 bytes of rows for 2 ids) |

  Scenario: A worker that cannot be loaded rejects the refresh
    Given the files hold the rows of "a" and "b"
    And /fuzzy_search.worker.js answers with the status 404
    And a store made by createVectorStore()
    When refresh() is called
    Then it rejects with an error
    And the size is still 0

  Scenario: A store whose worker failed starts a new worker at the next call
    Given the files hold the rows of "a" and "b"
    And /fuzzy_search.worker.js answers with the status 404 once, then is served
    And a store made by createVectorStore()
    When refresh() is called
    Then it rejects with "the vector search worker failed"
    When refresh() is called again
    Then it resolves and the size is 2
    And a search with k 3 answers "b" and "a"
    And /fuzzy_search.worker.js was requested twice
