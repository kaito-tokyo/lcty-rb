# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/uuid.js (LCTYSP-0003, LCTYSP-0008), the browser's side of LCTYSP-3001. Each Scenario is a
# test of the same title in tests/unit/uuid.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1002 Message ids as UUIDv7

  js/uuid.js makes and checks the ids of messages in the browser, as lib/uuid.rb does on the server (LCTYSP-3001):
  UUIDv7 (RFC 9562) in canonical lowercase form. uuidv7(ms) puts the milliseconds (now, unless given) into the first
  48 bits, the version 7 and the variant 10 into their bits, and random bits into the rest; newMsgId() of js/common.js
  calls it. UUID_RE accepts only such a string. uuidToBytes(id, out, off) writes the 16 bytes of an id into a byte
  array at an offset, as the vector binary of LCTYSP-0008 holds them.

  Scenario: A new id is a canonical UUIDv7
    When uuidv7() makes an id
    Then it is 36 lowercase characters in the groups 8-4-4-4-12
    And its version is 7 and its variant is 10
    And UUID_RE accepts it

  Scenario Outline: The first 48 bits are the milliseconds
    When uuidv7() makes an id for the milliseconds <ms>
    Then the id starts with "<start>"

    Examples:
      | ms             | start           |
      | 0x0123456789ab | 01234567-89ab-7 |
      | 0              | 00000000-0000-7 |
      | 0xffffffffffff | ffffffff-ffff-7 |

  Scenario: Without milliseconds the id is for now
    When uuidv7() makes an id without milliseconds
    Then the milliseconds in its first 48 bits are between those before and after the call

  Scenario: Ids of later milliseconds sort after earlier ones
    When uuidv7() makes ids for the milliseconds 1000, 1001 and 2000
    Then they sort as strings in the same order

  Scenario: Ids of the same millisecond differ
    When uuidv7() makes 100 ids for the millisecond 1000
    Then all of them are different
    And all of them start with "00000000-03e8-7"

  Scenario: Every id is a valid UUIDv7, whatever its random bits
    When uuidv7() makes 1000 ids
    Then UUID_RE accepts every one of them

  Scenario Outline: UUID_RE rejects what is not a canonical UUIDv7
    Then UUID_RE rejects <value>

    Examples:
      | value                                                         |
      | "0190f3a1-7c2e-4abc-8def-0123456789ab" (version 4)            |
      | "0190f3a1-7c2e-7abc-cdef-0123456789ab" (variant 11)           |
      | "0190F3A1-7C2E-7ABC-8DEF-0123456789AB" (uppercase)            |
      | "0190f3a17c2e7abc8def0123456789ab" (no hyphens)               |
      | "0190f3a1-7c2e-7abc-8def-0123456789ab\n" (a trailing newline) |
      | " 0190f3a1-7c2e-7abc-8def-0123456789ab" (a leading space)     |
      | "0190f3a1-7c2e-7abc-8def-0123456789a" (a digit short)         |
      | "" (empty)                                                    |
      | null                                                          |
      | a number                                                      |

  Scenario: An id converts to its 16 bytes
    Given the id "0190f3a1-7c2e-7abc-8def-0123456789ab"
    When uuidToBytes() writes it into 16 bytes at the offset 0
    Then the bytes are 01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab

  Scenario: uuidToBytes() writes only the 16 bytes at the offset
    Given the id "0190f3a1-7c2e-7abc-8def-0123456789ab"
    And 20 bytes that are all ee
    When uuidToBytes() writes it at the offset 2
    Then the bytes 2 to 17 are 01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab
    And the bytes 0, 1, 18 and 19 are still ee

  Scenario: A new id and its bytes agree
    When uuidv7() makes an id for the milliseconds 0x0123456789ab
    And uuidToBytes() writes it into 16 bytes at the offset 0
    Then the bytes as lowercase hex are the id without its hyphens
    And the bytes 0 to 5 are 01 23 45 67 89 ab
