# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/fuzzy_search.worker.js (LCTYSP-0008, LCTYSP-0019, the search of LCTYSP-0007). Each Scenario
# is a test of the same title in tests/unit/fuzzy-search-worker.test.js (in Node.js; the worker runs as a Web Worker of
# Node.js 26, LCTYSP-1000), whose steps are the lines below.

Feature: LCTYSP-1013 The semantic search worker

  The worker is started with new Worker(siteUrl("fuzzy_search.worker.js")) (a classic worker; js/search/vectors.js
  starts it, LCTYSP-1011). It answers each message with a message of the same id. { op: "load", summary } brings its
  copy of the server's vector pair up to date and answers { rows }, the number of rows of the copy. The pair is
  /v1/vectors.eg2_264.json, .dat and .idx of the worker's own site, found from its own URL: a message names no URL to
  fetch. It fetches the pair's JSON ({ rev, count, invalid }), or takes it from summary when the message has one (checked
  as the JSON is), and then, with Range and
  If-Match of the generation rev, the records of .dat (256 Float32 and 32 zero bytes each, 1,056 bytes) and of .idx (16
  bytes each) that the copy lacks, never record 0, the header. Another generation replaces the copy; the same one
  fetches only the records past its end. The rows of the invalid ranges are filled with NaN, so they never score. A 412
  starts again from the JSON, three times at most. { op: "search", query, k, allow } scores the 256-dimension query
  against every row with the kernel /bdot264.wasm, or in JavaScript when the kernel cannot be used, and answers
  { results }: the k best ids (50 when k is not given) by their best row, descending, as [id, score] pairs; allow,
  when given, lists the only ids that may appear. A failure is answered as { error } and the worker keeps its copy.

  In the Scenarios the query is 1 in its first dimension and 0 in the others, so a row's score is its first value. The
  rows of the pair are records 1 and on: "the rows of "a" and "b"" are records 1 and 2.

  Background:
    Given the vector pair of /v1/vectors.eg2_264.json, .dat and .idx is answered by the test
    And the worker is started

  Scenario: Loading fetches the JSON and the rows from record 1, and answers the row count
    Given the pair holds the rows of "a", "b" and "c" in the generation 1
    When the worker is sent a load of the pair
    Then it answers with the message's id and 3 rows
    And the JSON was requested once
    And .dat was requested once, with bytes=1056-4223 and If-Match "1"
    And .idx was requested once, with bytes=16-63 and If-Match "1"
    And /bdot264.wasm was requested once

  Scenario: A search answers the k best ids by their best row, descending
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And the worker has loaded it
    When the worker is sent a search with k 3
    Then it answers with the message's id and the results "a" 0.875, "c" 0.75 and "b" 0.5

  Scenario Outline: k limits the number of ids
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And the worker has loaded it
    When the worker is sent a search with k <k>
    Then it answers the ids <ids>

    Examples:
      | k  | ids                   |
      | 1  | "a"                   |
      | 4  | "a", "c", "b" and "d" |
      | 10 | "a", "c", "b" and "d" |
      | 0  | none                  |
      | -1 | none                  |

  Scenario: A search without k answers at most 50 ids
    Given the pair holds one row for each of 60 ids, every one scoring differently
    And the worker has loaded it
    When the worker is sent a search without k
    Then it answers the 50 best ids, descending

  Scenario: allow selects the ids that may appear
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And the worker has loaded it
    When the worker is sent a search with k 3 and allow "b", "d" and "z"
    Then it answers the results "b" 0.5 and "d" 0.125

  Scenario: An empty allow answers no ids
    Given the pair holds the rows of "a", "b" and "c" in the generation 1
    And the worker has loaded it
    When the worker is sent a search with k 3 and an empty allow
    Then it answers the ids none

  Scenario: A search before any load answers no ids
    When the worker is sent a search with k 3
    Then it answers the ids none

  Scenario: A pair with no rows loads as 0 rows
    Given the pair holds no rows in the generation 1
    When the worker is sent a load of the pair
    Then it answers with the message's id and 0 rows
    And neither .dat nor .idx was requested
    And a search with k 3 answers the ids none

  Scenario: A load in the same generation fetches only the new records
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the worker has loaded it
    And the row of "c" has been appended to the pair
    When the worker is sent a load of the pair
    Then it answers with the message's id and 3 rows
    And .dat was requested again, with bytes=3168-4223 only
    And .idx was requested again, with bytes=48-63 only
    And a search with k 3 answers the ids "c", "b" and "a"

  Scenario: A load with nothing new fetches no rows
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the worker has loaded it
    When the worker is sent a load of the pair
    Then it answers with the message's id and 2 rows
    And the JSON was requested twice, and .dat and .idx once each

  Scenario: A new generation replaces the copy
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the worker has loaded it
    And the pair now holds the row of "c" in the generation 2
    When the worker is sent a load of the pair
    Then it answers with the message's id and 1 rows
    And .dat was requested again, with bytes=1056-2111 and If-Match "2"
    And a search with k 3 answers the ids "c"

  Scenario: Rows in the invalid ranges are never answered
    Given the pair holds the rows of "a", "b" and "c" in the generation 1, its JSON listing record 2 as invalid
    When the worker is sent a load of the pair
    Then it answers with the message's id and 3 rows
    And a search with k 3 answers the ids "c" and "a"

  Scenario: Rows invalidated after they were loaded are never answered
    Given the pair holds the rows of "a", "b" and "c" in the generation 1
    And the worker has loaded it
    And the JSON now lists records 2 to 3 as invalid
    When the worker is sent a load of the pair
    Then it answers with the message's id and 3 rows
    And neither .dat nor .idx was requested again
    And a search with k 3 answers the ids "a"

  Scenario: A 412 starts again from the JSON
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the pair moves to the generation 2, the row of "c" appended, right after its JSON is first requested
    When the worker is sent a load of the pair
    Then it answers with the message's id and 3 rows
    And the JSON was requested twice
    And a search with k 3 answers the ids "c", "b" and "a"

  Scenario: A generation that keeps changing fails after three tries
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the pair moves to a new generation right after every request of its JSON
    When the worker is sent a load of the pair
    Then it answers with the message's id and the error "the vectors changed while they were fetched"
    And the JSON was requested 3 times

  Scenario: A summary given with the load is used without fetching the JSON
    Given the pair holds the rows of "a" and "b" in the generation 1
    When the worker is sent a load of the pair with the summary of the generation 1, 3 records and no invalid range
    Then it answers with the message's id and 2 rows
    And the JSON was not requested
    And a search with k 3 answers the ids "b" and "a"

  Scenario: A summary that is not that of a pair answers an error
    Given the pair holds the rows of "a" and "b" in the generation 1
    When the worker is sent a load of the pair with the summary {"rev": 1, "count": 3, "invalid": [["x", 2]]}
    Then it answers with the message's id and the error "broken vectors (not the JSON of a pair)"
    And the JSON was not requested

  Scenario: URLs in a load message are not fetched
    Given the pair holds the rows of "a" and "b" in the generation 1
    When the worker is sent a load of the pair whose message also names json, dat and idx at http://elsewhere.test
    Then it answers with the message's id and 2 rows
    And nothing was requested from elsewhere.test

  Scenario Outline: A failed load answers an error and keeps the copy
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the worker has loaded it
    And the pair now holds the row of "c" in the generation 2, and <change>
    When the worker is sent a load of the pair
    Then it answers with the message's id and the error "<error>"
    And a search with k 3 answers the ids "b" and "a"

    Examples:
      | change                                 | error                                   |
      | the JSON answers with the status 500   | failed to fetch the vectors (HTTP 500)  |
      | the JSON is not that of a pair         | broken vectors (not the JSON of a pair) |
      | .dat answers with the status 500       | failed to fetch the vectors (HTTP 500)  |
      | .idx answers with the status 404       | failed to fetch the vectors (HTTP 404)  |
      | .dat answers with one byte less        | broken vectors (1055 bytes for 1056)    |

  Scenario: A file that fails without a response answers an error and keeps the copy
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the worker has loaded it
    And the pair now holds the row of "c" in the generation 2, and .idx fails without a response
    When the worker is sent a load of the pair
    Then it answers with the message's id and an error
    And a search with k 3 answers the ids "b" and "a"

  Scenario: A query that does not have 256 dimensions answers an error
    Given the pair holds the rows of "a" and "b" in the generation 1
    And the worker has loaded it
    When the worker is sent a search with a query of 255 dimensions
    Then it answers with the message's id and the error "wrong query dimensions (255 ≠ 256)"
    And a search with k 3 answers the ids "b" and "a"

  Scenario: An unknown op answers an error
    When the worker is sent the op "drop"
    Then it answers with the message's id and the error "unknown op: drop"

  Scenario Outline: Scoring in JavaScript gives the results of bdot264.wasm
    Given /bdot264.wasm can be instantiated with its memory of 256 MiB
    And the pair holds 300 rows of 100 ids, the rows and the query being random unit vectors
    When one worker loads it and searches with k 20
    And a second worker, for which /bdot264.wasm <wasm>, loads it and searches with k 20
    Then both answer the same 20 ids in the same order, with scores within 0.00001

    Examples:
      | wasm                                        |
      | answers with the status 404                 |
      | fails without a response                    |
      | answers with bytes that are not WebAssembly |
