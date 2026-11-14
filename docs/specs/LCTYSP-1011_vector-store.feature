# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/search/vectors.js (LCTYSP-0008, LCTYSP-0019; the worker is LCTYSP-1013). Each Scenario is a
# test of the same title in tests/unit/vectors.test.js (in Node.js; the worker runs as a Web Worker of Node.js 26,
# LCTYSP-1000), whose steps are the lines below.

Feature: LCTYSP-1011 The vector store and the query embedding

  embedQuery(rpc, text) asks the server for the vector of a query: it calls vectors.eg2_264.embed with { text } on the
  connection given and decodes the answer's vector, the base64 of 256 Float32 LE, into a Float32Array of 256. An
  answer of another length rejects; a rejection of the call passes through.

  createVectorStore() makes the client of the semantic search worker /fuzzy_search.worker.js (LCTYSP-1013, started from
  siteUrl() of js/site.js), which starts on first use. refresh() brings the worker's copy of the vector pair up to date
  from /v1/vectors.eg2_264.json, fetching the records of /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx it lacks by
  Range (concurrent calls share one load), and sets size, the row count. changed(summary) is the notification
  vectors.eg2_264.changed: it brings a copy the worker has up to date from summary, without the JSON, and does nothing
  before the first load. The loads run one at a time. createVectorStore({ actor }) is given the actorId of the tab's
  connection (null without one): after a refresh made with an actorId, the notifications of that connection keep the
  copy up to date, so refresh() fetches nothing while the actorId is the same and no notification has failed. search(q,
  k = 50, { allow, accept }) gives the 256-dimension query to the worker as it is and answers the k best ids as [id,
  score] pairs, descending; allow is the only ids the worker may answer, accept a check on the main thread (the worker
  is then asked for 2k). A store with no rows answers no ids without asking the worker. When the worker fails (its error
  event), the calls waiting for it reject and the next call starts a new worker.

  In the Scenarios a row's score is its first value: the queries are 1 in their first dimension unless said otherwise.
  The pair served has its header as record 0 and the rows from record 1, as the server writes it.

  Scenario: A query is embedded by the server
    Given a connection whose vectors.eg2_264.embed answers the base64 of 256 Float32 LE, 0.5 in the first and -0.25 in the last
    When embedQuery embeds "closures" over it
    Then vectors.eg2_264.embed was called once with { text: "closures" }
    And it resolves with a Float32Array of 256, 0.5 in the first, -0.25 in the last and 0 in the others

  Scenario Outline: An answer that is not 256 floats rejects
    Given a connection whose vectors.eg2_264.embed answers the base64 of <bytes> bytes
    When embedQuery embeds "closures" over it
    Then it rejects with "wrong query dimensions (<floats> ≠ 256)"

    Examples:
      | bytes | floats |
      | 1020  | 255    |
      | 3072  | 768    |
      | 0     | 0      |

  Scenario: A failed call of the connection passes through
    Given a connection whose vectors.eg2_264.embed rejects with "semantic search is unavailable"
    When embedQuery embeds "closures" over it
    Then it rejects with "semantic search is unavailable"

  Scenario: A new store is empty and starts no worker
    Given the vector pair is answered by the test
    When createVectorStore() makes a store
    And it searches with k 3
    Then its size is 0
    And the search answers no ids
    And /fuzzy_search.worker.js was not requested

  Scenario: A refresh loads the vector pair in the worker
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a", "b" and "c"
    And a store made by createVectorStore()
    When refresh() is called
    Then it resolves and the size is 3
    And /fuzzy_search.worker.js was requested once
    And the JSON was requested once
    And each file was requested once, from its record 1

  Scenario: A notification brings a loaded copy up to date without the JSON
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store that has been refreshed
    And the row of "c" is now appended to the pair
    When changed() is given the summary of the pair
    Then the size is 3
    And the JSON was requested once
    And each file was requested again, from its record 3
    And a search with k 3 answers "c", "b" and "a"

  Scenario: A notification before the first load does nothing
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store made by createVectorStore()
    When changed() is given the summary of the pair
    Then the size is 0
    And /fuzzy_search.worker.js was not requested

  Scenario: An older summary of the same generation changes nothing
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store that has been refreshed
    And the row of "c" is now appended to the pair
    And the store has been refreshed again
    When changed() is given the summary of the pair as it was with the rows of "a" and "b"
    Then the size is 3
    And each file was requested twice
    And a search with k 3 answers "c", "b" and "a"

  Scenario: A refresh fetches nothing while the connection's notifications keep the copy
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store whose connection's actorId is "actor-1", refreshed
    When refresh() is called
    Then it resolves and the size is 2
    And the JSON was requested once

  Scenario Outline: A refresh fetches the JSON when the connection changed
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store whose connection's actorId is "actor-1", refreshed
    And the row of "c" is now appended to the pair
    And the connection's actorId is now <actor>
    When refresh() is called
    Then it resolves and the size is 3
    And the JSON was requested twice

    Examples:
      | actor     |
      | "actor-2" |
      | null      |

  Scenario: A failed notification makes the next refresh fetch the JSON
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store whose connection's actorId is "actor-1", refreshed
    And the row of "c" is now appended to the pair
    And /v1/vectors.eg2_264.dat answers with the status 500
    When changed() is given the summary of the pair
    Then the size is 2
    When /v1/vectors.eg2_264.dat is served again
    And refresh() is called
    Then it resolves and the size is 3
    And the JSON was requested twice

  Scenario: Concurrent refreshes share one load
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store made by createVectorStore()
    When refresh() is called twice at once
    Then both resolve and the size is 2
    And each file was requested once, from its record 1

  Scenario: A refresh after a new generation loads the new rows in the same worker
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store that has been refreshed
    And the pair is now a new generation holding the row of "c"
    When refresh() is called
    Then it resolves and the size is 1
    And a search with k 3 answers "c"
    And /fuzzy_search.worker.js was requested once

  Scenario: Refreshing a pair with no rows leaves the store empty
    Given the vector pair is answered by the test
    Given the pair holds no rows
    And a store made by createVectorStore()
    When refresh() is called
    Then it resolves and the size is 0
    And a search with k 3 answers no ids

  Scenario: A search answers the k best ids by their best row, with their scores
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 3
    Then it answers "a" 0.875, "c" 0.75 and "b" 0.5

  Scenario: The query is given to the worker as it is
    Given the vector pair is answered by the test
    Given the pair holds the rows of "x", "y" and "z", 1 in their first, second and third dimension
    And a store that has been refreshed
    When it searches with k 3 for a query of 0.6 and 0.8 in its first two dimensions
    Then it answers "y" 0.8, "x" 0.6 and "z" 0

  Scenario: A store searched without k answers at most 50 ids
    Given the vector pair is answered by the test
    Given the pair holds one row for each of 60 ids, every one scoring differently
    And a store that has been refreshed
    When it searches without k
    Then it answers the 50 best ids, descending

  Scenario: allow is the only ids the worker may answer
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 3 and allow "b" and "d"
    Then it answers "b" 0.5 and "d" 0.125

  Scenario: accept drops ids on the main thread before k are taken
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 2 and an accept that rejects "a"
    Then it answers "c" 0.75 and "b" 0.5

  Scenario: accept is given only the 2k best ids
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a", "b", "c", "d" and "a" again, scoring 0.25, 0.5, 0.75, 0.125 and 0.875
    And a store that has been refreshed
    When it searches with k 1 and an accept that takes only "d"
    Then it answers no ids
    And accept was asked about "a" and "c" only

  Scenario: A query shorter than 256 dimensions is rejected by the worker
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store that has been refreshed
    When it searches with k 3 for a query of 100 dimensions
    Then the search rejects with "wrong query dimensions (100 ≠ 256)"

  Scenario Outline: A failed refresh rejects and keeps what was loaded
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And a store that has been refreshed
    And the pair is now a new generation, and <change>
    When refresh() is called
    Then it rejects with "<error>"
    And the size is still 2
    And a search with k 3 answers "b" and "a"

    Examples:
      | change                                              | error                                  |
      | /v1/vectors.eg2_264.dat answers with the status 500 | failed to fetch the vectors (HTTP 500) |
      | the rows are one byte short                         | broken vectors (2111 bytes for 2112)   |

  Scenario: A worker that cannot be loaded rejects the refresh
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And /fuzzy_search.worker.js answers with the status 404
    And a store made by createVectorStore()
    When refresh() is called
    Then it rejects with an error
    And the size is still 0

  Scenario: A store whose worker failed starts a new worker at the next call
    Given the vector pair is answered by the test
    Given the pair holds the rows of "a" and "b"
    And /fuzzy_search.worker.js answers with the status 404 once, then is served
    And a store made by createVectorStore()
    When refresh() is called
    Then it rejects with "the vector search worker failed"
    When refresh() is called again
    Then it resolves and the size is 2
    And a search with k 3 answers "b" and "a"
    And /fuzzy_search.worker.js was requested twice
