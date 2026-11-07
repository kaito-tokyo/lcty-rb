# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/fuzzy_search.worker.js (LCTYSP-0008, the search of LCTYSP-0007). Each Scenario is a test of
# the same title in tests/unit/fuzzy-search-worker.spec.js, whose steps are the lines below.

Feature: LCTYSP-1013 The semantic search worker

  The worker is started with new Worker("/fuzzy_search.worker.js") (a classic worker; js/search/vectors.js starts it,
  LCTYSP-1011). It answers each message with a message of the same id. { op: "load", dat, idx } fetches the two
  distribution files at the URLs given, the rows (256 Float32 and 32 zero bytes each, 1,056 bytes) and the ids (16
  bytes each), keeps them and answers { rows }; a pair with the ETag already loaded is not read again. { op: "search",
  query, k, allow } scores the 256-dimension query against every row with the kernel /bdot264.wasm, or in JavaScript
  when the kernel cannot be used, and answers { results }: the k best ids (50 when k is not given) by their best row,
  descending, as [id, score] pairs; allow, when given, lists the only ids that may appear. A failure is answered as
  { error } and the worker keeps what it had.

  In the Scenarios the query is 1 in its first dimension and 0 in the others, so a row's score is its first value.

  Background:
    Given a page on the server's origin
    And /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx are answered by the test
    And the worker is started

  Scenario: Loading fetches both files and answers the row count
    Given the files hold the rows of "a", "b" and "c"
    When the worker is sent a load of the two files
    Then it answers with the message's id and 3 rows
    And each file was requested once
    And /bdot264.wasm was requested once

  Scenario: A search answers the k best ids by their best row, descending
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And the worker has loaded them
    When the worker is sent a search with k 3
    Then it answers with the message's id and the results "a" 0.875, "c" 0.75 and "b" 0.5

  Scenario Outline: k limits the number of ids
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And the worker has loaded them
    When the worker is sent a search with k <k>
    Then it answers the ids <ids>

    Examples:
      | k  | ids                          |
      | 1  | "a"                          |
      | 4  | "a", "c", "b" and "d"        |
      | 10 | "a", "c", "b" and "d"        |
      | 0  | none                         |
      | -1 | none                         |

  Scenario: A search without k answers at most 50 ids
    Given the files hold one row for each of 60 ids, every one scoring differently
    And the worker has loaded them
    When the worker is sent a search without k
    Then it answers the 50 best ids, descending

  Scenario: allow selects the ids that may appear
    Given the files hold the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And the worker has loaded them
    When the worker is sent a search with k 3 and allow "b", "d" and "z"
    Then it answers the results "b" 0.5 and "d" 0.125

  Scenario: An empty allow answers no ids
    Given the files hold the rows of "a", "b" and "c"
    And the worker has loaded them
    When the worker is sent a search with k 3 and an empty allow
    Then it answers the ids none

  Scenario: A search before any load answers no ids
    When the worker is sent a search with k 3
    Then it answers the ids none

  Scenario: Empty files load as no rows
    Given the files are empty
    When the worker is sent a load of the two files
    Then it answers with the message's id and 0 rows
    And a search with k 3 answers the ids none

  Scenario: A pair with the ETag already loaded is not read again
    Given the files hold the rows of "a" and "b", with the ETag "v1"
    And the worker has loaded them
    And the files now hold the row of "c", still with the ETag "v1"
    When the worker is sent a load of the two files
    Then it answers with the message's id and 2 rows
    And a search with k 3 answers the ids "b" and "a"

  Scenario: A pair with a new ETag replaces what was loaded
    Given the files hold the rows of "a" and "b", with the ETag "v1"
    And the worker has loaded them
    And the files now hold the row of "c", with the ETag "v2"
    When the worker is sent a load of the two files
    Then it answers with the message's id and 1 rows
    And a search with k 3 answers the ids "c"

  Scenario: Files without an ETag are read at every load
    Given the files hold the rows of "a" and "b", without an ETag
    And the worker has loaded them
    And the files now hold the row of "c", without an ETag
    When the worker is sent a load of the two files
    Then it answers with the message's id and 1 rows
    And a search with k 3 answers the ids "c"

  Scenario: A pair whose ETags differ is fetched again
    Given the files hold the rows of "a" and "b"
    And /v1/vectors.eg2_264.idx has the ETag "v0" at its first request and "v1" later, /v1/vectors.eg2_264.dat "v1"
    When the worker is sent a load of the two files
    Then it answers with the message's id and 2 rows
    And each file was requested twice

  Scenario: A pair whose ETags never agree is used after three tries
    Given the files hold the rows of "a" and "b"
    And /v1/vectors.eg2_264.dat always has the ETag "v1" and /v1/vectors.eg2_264.idx "v2"
    When the worker is sent a load of the two files
    Then it answers with the message's id and 2 rows
    And each file was requested 3 times

  Scenario Outline: A failed load answers an error and keeps what was loaded
    Given the files hold the rows of "a" and "b", with the ETag "v1"
    And the worker has loaded them
    And with the ETag "v2", <change>
    When the worker is sent a load of the two files
    Then it answers with the message's id and the error "<error>"
    And a search with k 3 answers the ids "b" and "a"

    Examples:
      | change                                              | error                                           |
      | /v1/vectors.eg2_264.dat answers with the status 500 | failed to fetch the vectors (HTTP 500)          |
      | /v1/vectors.eg2_264.idx answers with the status 404 | failed to fetch the vectors (HTTP 404)          |
      | the rows are one byte short                         | broken vectors (2111 bytes of rows for 2 ids)   |
      | the ids have a third id                             | broken vectors (2112 bytes of rows for 3 ids)   |
      | the ids are one byte short                          | broken vectors (2112 bytes of rows for 1.9375 ids) |

  Scenario: A file that fails without a response answers an error
    Given the files hold the rows of "a" and "b", with the ETag "v1"
    And the worker has loaded them
    And /v1/vectors.eg2_264.idx now fails without a response
    When the worker is sent a load of the two files
    Then it answers with the message's id and an error
    And a search with k 3 answers the ids "b" and "a"

  Scenario: A query that does not have 256 dimensions answers an error
    Given the files hold the rows of "a" and "b"
    And the worker has loaded them
    When the worker is sent a search with a query of 255 dimensions
    Then it answers with the message's id and the error "wrong query dimensions (255 ≠ 256)"
    And a search with k 3 answers the ids "b" and "a"

  Scenario: An unknown op answers an error
    When the worker is sent the op "drop"
    Then it answers with the message's id and the error "unknown op: drop"

  Scenario Outline: Scoring in JavaScript gives the results of bdot264.wasm
    Given the files hold 300 rows of 100 ids, the rows and the query being random unit vectors
    When one worker loads them and searches with k 20
    And a second worker, for which /bdot264.wasm <wasm>, loads them and searches with k 20
    Then both answer the same 20 ids in the same order, with scores within 0.00001

    Examples:
      | wasm                                      |
      | answers with the status 404               |
      | fails without a response                  |
      | answers with bytes that are not WebAssembly |
