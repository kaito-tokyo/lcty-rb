# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/v1/vector_records.rb (LCTYSP-0008). Each Scenario is a test of the same title in
# tests/backend/vector_records_test.rb, whose steps are the lines below.

Feature: LCTYSP-3006 Vector binary records

  Chatty::V1::VectorRecords reads and writes the vector binary lctyvLE0, the exchange format of vectors. A record is a
  16-byte control block (the magic "lctyvLE0", the byte size of the vector as uint32 LE and a reserved uint32 of 0),
  the 16 bytes of a UUIDv7 message id, then the vector. VectorRecords.control makes the control block, VectorRecords.pack
  makes a record, and VectorRecords.unpack splits bytes into [id, vector bytes] pairs, all of one vector size, raising
  VectorRecords::FormatError for anything else.

  Scenario: The control block of a registration record is fixed
    When VectorRecords.control makes the control block for the size 3072
    Then it is the 16 bytes 6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00

  Scenario: The control block carries the size in bytes
    When VectorRecords.control makes the control block for the size 1024
    Then it is "lctyvLE0" followed by 00 04 00 00 and 00 00 00 00

  Scenario: A record is the control block, the id and the vector
    Given a UUIDv7 id and a vector of 768 Float32 values
    When VectorRecords.pack makes a record of them
    Then the record is 3,104 bytes
    And it starts with the control block for the size 3072
    And the bytes 16 to 31 are the 16 bytes of the id
    And the rest is the vector as it was given

  Scenario: Packed records unpack to their ids and vectors in order
    Given three records of 768 dimensions, the first and the third with the same id
    When VectorRecords.unpack reads their concatenation with the size 3072
    Then it returns the three ids and vectors in the order they were packed

  Scenario: Records of another size unpack with that size
    Given two records of 256 dimensions
    When VectorRecords.unpack reads them with the size 1024
    Then it returns both ids and their vectors of 1,024 bytes

  Scenario: No bytes unpack to no records
    When VectorRecords.unpack reads an empty string with the size 3072
    Then it returns no records

  Scenario: Unpack reads a text string as bytes
    Given a record whose bytes are labelled as UTF-8 text
    When VectorRecords.unpack reads it with the size 3072
    Then it returns the id and the vector as binary bytes

  Scenario Outline: Unpack rejects a length that is not a whole number of records
    Given two records of 768 dimensions with <change>
    When VectorRecords.unpack reads them with the size 3072
    Then it raises a FormatError saying "length <length> is not a multiple of 3104"

    Examples:
      | change              | length |
      | the last byte cut   | 6207   |
      | one byte added      | 6209   |
      | a 256-dim record    | 4160   |

  Scenario Outline: Unpack rejects a record whose control block is wrong
    Given a good record followed by a record with <change>
    When VectorRecords.unpack reads them with the size 3072
    Then it raises a FormatError saying "record 1: bad control block (expected lctyvLE0 + 3072)"

    Examples:
      | change                             |
      | the magic "lctyvLE1"               |
      | the size written big-endian        |
      | the size 3068 and 4 bytes of extra |
      | a reserved field of 1              |

  Scenario Outline: Unpack rejects an id that is not a UUIDv7
    Given a record whose id is <id>
    When VectorRecords.unpack reads it with the size 3072
    Then it raises a FormatError saying "record 0: id is not a UUIDv7"

    Examples:
      | id                                     |
      | 16 zero bytes                          |
      | "0190f3a1-7c2e-4abc-8def-0123456789ab" |

  Scenario: Records of another size are rejected even when the length fits
    Given three records of 256 dimensions, 3,168 bytes in all
    When VectorRecords.unpack reads them with the size 3136
    Then it raises a FormatError saying "record 0: bad control block (expected lctyvLE0 + 3136)"
