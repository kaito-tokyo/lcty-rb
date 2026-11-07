# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/uuid.rb (LCTYSP-0003). Each Scenario is a test of the same title in tests/backend/uuid_test.rb,
# whose steps are the lines below.

Feature: LCTYSP-3001 Message ids as UUIDv7

  Chatty::Uuid makes and checks the ids of messages, which are UUIDv7 (RFC 9562) in canonical lowercase form.
  Uuid.v7 puts the milliseconds (now, unless given) into the first 48 bits, the version 7 and the variant 10 into
  their bits, and random bits into the rest. Uuid.valid? accepts only such a string. Uuid.to_bytes and
  Uuid.from_bytes convert between the string and its 16 bytes.

  Scenario: A new id is a canonical UUIDv7
    When Uuid.v7 makes an id
    Then it is 36 lowercase characters in the groups 8-4-4-4-12
    And its version is 7 and its variant is 10
    And Uuid.valid? accepts it

  Scenario: The first 48 bits are the milliseconds
    When Uuid.v7 makes an id for the milliseconds 0x0123456789ab
    Then the id starts with "01234567-89ab-7"

  Scenario: Without milliseconds the id is for now
    When Uuid.v7 makes an id without milliseconds
    Then the milliseconds in its first 48 bits are between those before and after the call

  Scenario: Ids of later milliseconds sort after earlier ones
    When Uuid.v7 makes ids for the milliseconds 1000, 1001 and 2000
    Then they sort as strings in the same order

  Scenario: Ids of the same millisecond differ
    When Uuid.v7 makes 100 ids for the millisecond 1000
    Then all of them are different

  Scenario Outline: Uuid.valid? rejects what is not a canonical UUIDv7
    Then Uuid.valid? rejects <value>

    Examples:
      | value                                                         |
      | "0190f3a1-7c2e-4abc-8def-0123456789ab" (version 4)            |
      | "0190f3a1-7c2e-7abc-cdef-0123456789ab" (variant 11)           |
      | "0190F3A1-7C2E-7ABC-8DEF-0123456789AB" (uppercase)            |
      | "0190f3a17c2e7abc8def0123456789ab" (no hyphens)               |
      | "0190f3a1-7c2e-7abc-8def-0123456789ab\n" (a trailing newline) |
      | "" (empty)                                                    |
      | nil                                                           |
      | a number                                                      |

  Scenario: An id and its 16 bytes convert both ways
    Given the id "0190f3a1-7c2e-7abc-8def-0123456789ab"
    When Uuid.to_bytes converts it
    Then the result is the 16 bytes 01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab
    And Uuid.from_bytes converts them back to the id
