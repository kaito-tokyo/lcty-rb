# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/embedding/vector_pair.rb (LCTYSP-0019). Each Scenario is a test of the same title in
# tests/backend/vector_pair_test.rb, whose steps are the lines below.

Feature: LCTYSP-3026 Vector pair

  Chatty::Embedding::VectorPair keeps the vectors of semantic search in two files of fixed-size records: .dat, rows of
  1,056 bytes (256 Float32 LE and 32 zero bytes), and .idx, the 16 bytes of the UUIDv7 of each row's message. Record 0
  is the header of both and holds the generation's rev. Opening the pair is a start: it cuts back a write that did not
  finish, fills with NaN the rows of messages that are not current, and writes a new header with a rev that always
  grows. While it is open, rows are appended, or filled with NaN when their message goes away.

  Scenario: A new pair has a header and no rows
    Given a data directory without a pair
    When a VectorPair is opened there at the time 1763000000000
    Then both files are one record long
    And its rev and its count are 1763000000000 and 1
    And .idx record 0 is a UUIDv8 whose octets 0 to 5 are the rev
    And .dat record 0 is 256 quiet NaNs whose first three payloads are the rev, 16 bits each, and 32 zero bytes

  Scenario: The rev grows even when the clock goes back
    Given a pair opened at the time 1763000000000
    When it is opened again at the time 1700000000000
    Then its rev is 1763000000001

  Scenario: Appended rows are read back after the header
    Given a new pair
    When two rows are appended for one message
    Then the count is 3 and the message has a valid row
    And .dat records 1 and 2 are the rows, each with 32 zero bytes after its floats
    And .idx records 1 and 2 are the 16 bytes of the message's id

  Scenario: Rows are not appended when the message is gone
    Given a new pair
    When a row is appended with a block that answers false
    Then nothing is appended and the count stays 1

  Scenario: Invalidated rows are filled with NaN and listed as ranges
    Given a new pair with one row each for the messages a, b and c, and two for d
    When the rows of b and d are invalidated
    Then the summary lists the invalid records as [[2, 2], [4, 5]]
    And those rows are quiet NaNs with zero padding, and their ids are left as they were
    And invalidating b again changes nothing

  Scenario: A start cuts back a write that did not finish
    Given a pair with one row, then half a record more of .idx and a whole row more of .dat
    When it is opened again
    Then .idx and .dat are cut back to two records
    And the count is 2

  Scenario: A start fills with NaN the rows of messages that are not current
    Given a pair with one row for the message a and one for b
    When it is opened again with a the only current message
    Then the row of b is NaN and listed as invalid
    And a still has its valid row and b has none

  Scenario: A read is clamped to the records
    Given a new pair with one row
    When bytes 1000 to 99999 of .dat are read
    Then it returns the bytes 1000 to 2111 and the size 2112
    And a read from byte 2112 returns nothing
