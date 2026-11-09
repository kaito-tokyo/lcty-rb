# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/v1/vector_db.rb (LCTYSP-0008, with the rounds of LCTYSP-0007 and the derived data of
# LCTYSP-0010). Each Scenario is a test of the same title in tests/backend/vector_db_test.rb, whose steps are the lines
# below.

Feature: LCTYSP-3007 Vector DB

  Chatty::V1::VectorDB keeps the vectors of the rounds of a search index in its table vectors, one row per embedding
  model and round part, in _index.sqlite, the one file of every cache that may be lost. VectorDB#pending lists the
  rounds without vectors, newest first. VectorDB#put registers a registration vector binary (768 dims) for the
  revisions the caller embedded, L2-normalizes each vector and keeps its first 256 dimensions renormalized; ids whose
  round changed meanwhile are dropped as stale. VectorDB#export builds in memory, on every call, the distribution of the
  vectors that match the current rounds: the .dat (256 Float32 + 32 zero bytes per row) and the .idx (16 bytes of id
  per row); nothing is written to disk. VectorDB#gc and #gc_all delete the vectors that match no current round, and
  #gc_all the cache files of the former layout. Every test has a search index and a data directory of its own in a
  temporary folder.

  Scenario: Rounds without vectors are pending, newest first
    Given three rounds answered at 10:00, 12:00 and 11:00
    When VectorDB#pending lists the rounds of the model "m" up to 16
    Then it returns the three rounds, the one of 12:00 first and the one of 10:00 last
    And each has its id, its rev and its text as the only part

  Scenario: Pending lists at most the limit
    Given three rounds answered at 10:00, 11:00 and 12:00
    When VectorDB#pending lists the rounds of the model "m" up to 2
    Then it returns the rounds of 12:00 and 11:00

  Scenario: A long round is pending with all its parts
    Given a round of 7,000 characters
    When VectorDB#pending lists the rounds of the model "m" up to 16
    Then the round has two parts, of 6,000 and 1,000 characters, in order

  Scenario: Registered vectors are no longer pending
    Given two rounds without vectors
    When VectorDB#put registers a vector for the first round with its rev for the model "m"
    Then it returns 1 accepted and no stale ids
    And only the second round is pending for the model "m"

  Scenario: Vectors are kept per embedding model
    Given a round with a vector registered for the model "a"
    Then the round is not pending for the model "a"
    But it is pending for the model "b"
    And the data directory holds no file but _index.sqlite

  Scenario: Many models are all served
    Given a round with a vector registered for the model "m0"
    When the round's pending state is asked for the models "m1" to "m11"
    Then it is pending for each of them
    And the round is still not pending for the model "m0"

  Scenario: Put drops an id whose rev is not the current one
    Given a round without vectors
    When VectorDB#put registers a vector for it with the rev "0000000000000000"
    Then it returns 0 accepted and the round's id as stale
    And the round is still pending

  Scenario: Put drops an id whose part count does not match
    Given a round of 7,000 characters, which has two parts
    When VectorDB#put registers one vector for it with its rev
    Then it returns 0 accepted and the round's id as stale
    And the round is still pending

  Scenario: Put drops an id that is not a round
    Given an id that no round has
    When VectorDB#put registers a vector for it with a rev
    Then it returns 0 accepted and that id as stale

  Scenario: Put accepts some ids and drops others in one body
    Given two rounds without vectors
    When VectorDB#put registers a vector for each, the second with a wrong rev
    Then it returns 1 accepted and the second round's id as stale
    And only the second round is pending

  Scenario: Put replaces every vector of an id
    Given a round of two parts with the vectors A and B registered
    When VectorDB#put registers the vectors C and D for it
    Then the exported rows are those of C and D, in that order

  Scenario: Put without a rev for an id of the body is a 400
    Given a round without vectors
    When VectorDB#put registers a vector for it without its rev
    Then it raises an HttpError 400 saying "rev is missing for <the id>"
    And the round is still pending

  Scenario: Put of a body that is not whole records is a 400
    When VectorDB#put registers 100 bytes
    Then it raises an HttpError 400 saying "length 100 is not a multiple of 3104"

  Scenario Outline: Put rejects a vector that cannot be normalized
    Given a round without vectors
    When VectorDB#put registers for it a vector of <values>
    Then it raises an HttpError 400 saying "vector must be finite and non-zero"
    And the round is still pending

    Examples:
      | values                 |
      | zeros                  |
      | ones and one NaN       |
      | ones and one infinity  |

  Scenario: Put rejects a vector whose first 256 dimensions are all zero
    Given a round without vectors
    And another round without vectors
    When VectorDB#put registers in one body a good vector for the other round and, for the round, a vector of 256 zeros and then ones
    Then it raises an HttpError 400 saying "the first 256 dimensions of a vector must not all be zero"
    And both rounds are still pending

  Scenario Outline: An invalid model name is a 400
    When VectorDB#pending lists the rounds of the model <model>
    Then it raises an HttpError 400 saying "invalid model name: <model>"
    And the data directory holds no file but _index.sqlite

    Examples:
      | model                    |
      | "../m"                   |
      | "a b"                    |
      | ""                       |
      | "m" repeated 81 times    |

  Scenario: Vectors are stored L2-normalized
    Given a round without vectors
    When VectorDB#put registers for it a unit vector multiplied by 3
    Then the stored 768-dimension vector has the length 1 and the direction of the unit vector

  Scenario: A unit vector is stored as it was sent
    Given a round without vectors
    When VectorDB#put registers for it a unit vector
    Then the stored 768-dimension vector is the same bytes

  Scenario: The distributed vector is the first 256 dimensions renormalized
    Given a round with a vector registered whose first 256 dimensions are 2 and the rest are 1
    When VectorDB#export builds the distribution of the model "m"
    Then the row of the round is 256 values of 1/16
    And it is followed by 32 zero bytes

  Scenario: Export builds the rows and the ids of the valid vectors
    Given a round of 11:00 with one part and a round of 10:00 with two parts, all with vectors of the model "m"
    When VectorDB#export builds the distribution of the model "m"
    Then the .dat has 3 rows of 1,056 bytes and the .idx 3 ids of 16 bytes
    And the rows are the two parts of the 10:00 round, then the 11:00 round
    And the data directory holds no file but _index.sqlite

  Scenario: Export of a model without vectors is empty
    When VectorDB#export builds the distribution of the model "empty"
    Then both are empty

  Scenario: Export leaves out the vectors of a changed round
    Given two rounds with vectors of the model "m"
    When the text of the first round changes
    And VectorDB#export builds the distribution of the model "m"
    Then only the second round has a row

  Scenario: Export builds the distribution anew on every call
    Given two rounds, the first with a vector of the model "m", and its distribution
    When VectorDB#put registers a vector for the second round
    And VectorDB#export builds the distribution of the model "m"
    Then the .dat has the rows of both rounds

  Scenario: Export of another model holds only its own vectors
    Given a round with a vector of the model "m"
    When VectorDB#export builds the distribution of the model "other", which has no vectors
    Then both are empty
    When VectorDB#export builds the distribution of the model "m"
    Then the .dat has the row of the round

  Scenario: The vectors of an undone change are reused
    Given a round with a vector of the model "m"
    When the text of the round changes
    Then the round is pending again
    When the text changes back
    Then the round is not pending
    And VectorDB#export builds its row

  Scenario: Garbage collection deletes the vectors that match no current round
    Given three rounds with vectors of the model "m"
    When the text of the first round changes and the second round is deleted
    And VectorDB#gc collects the model "m"
    Then it returns 2 and warns "gc: removed 2 stale vectors of the model m"
    And only the vector of the third round is left for the model "m"

  Scenario: Garbage collection with nothing stale is quiet
    Given a round with a vector of the model "m"
    When VectorDB#gc collects the model "m"
    Then it returns 0 and warns nothing

  Scenario Outline: Garbage collection of an invalid model name does nothing
    When VectorDB#gc collects the model <model>
    Then it returns 0
    And the data directory holds no file but _index.sqlite

    Examples:
      | model  |
      | "../m" |
      | nil    |

  Scenario: Garbage collection at startup collects every model
    Given two rounds with vectors of the models "a" and "b"
    And a new search index and VectorDB opened on the same files, as at the next start
    When the first round is deleted
    And VectorDB#gc_all collects the data directory
    Then the models "a" and "b" keep only the vectors of the second round

  Scenario: Garbage collection at startup deletes the cache files of the former layout
    Given the files _vectors.m.sqlite, _vectors.m.sqlite-wal, _vectors.eg2_264.dat, _vectors.eg2_264.idx and _vectors.m.256.bin in the data directory
    When VectorDB#gc_all collects the data directory
    Then those files are gone and the data directory holds no file but _index.sqlite
