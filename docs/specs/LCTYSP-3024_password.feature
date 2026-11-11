# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/password.rb (LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/password_test.rb, whose steps are the lines below.

Feature: LCTYSP-3024 Password hashes

  Chatty::Password makes and checks the password hashes of Basic authentication. Password.create derives 32 bytes
  from the password with PBKDF2-HMAC-SHA256, 600,000 iterations and a new random salt of 16 bytes, and writes them as
  the PHC string "$pbkdf2-sha256$i=<iterations>$<salt>$<hash>", Base64 without padding. Password.verify derives again
  with the iterations and salt of the string and compares every byte. A new password has 15 characters or more
  (NIST SP 800-63B-4) and 1024 bytes or fewer, in UTF-8. Password.option is the option of the settings for a user,
  "--basic-auth=<user>:<hash>", the user without ":", spaces or control characters.

  Scenario: PBKDF2 derives the bytes of RFC 7914's test vector
    When Password.derive is given the password "passwd", the salt "salt" and 1 iteration
    Then the bytes are 55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc

  Scenario: A hash is a PHC string of PBKDF2-SHA256
    When Password.create hashes "correct horse battery"
    Then it is "$pbkdf2-sha256$i=600000$" and two parts in Base64 without padding
    And the salt is 16 bytes and the hash 32 bytes

  Scenario: A hash accepts its password and no other
    Given the hash of "correct horse battery"
    Then Password.verify accepts "correct horse battery"
    And it refuses "correct horse batterY" and ""

  Scenario: Two hashes of one password differ by their salt
    When Password.create hashes "correct horse battery" twice
    Then the two hashes differ
    And each accepts the password

  Scenario: A hash made with other iterations is checked with its own
    Given the hash of "correct horse battery" made with 1000 iterations
    Then it starts with "$pbkdf2-sha256$i=1000$"
    And Password.verify accepts "correct horse battery"

  Scenario Outline: A new password that cannot be used is refused
    When Password.create is given <password>
    Then it raises Password::Error "<message>"

    Examples:
      | password                   | message                                         |
      | 14 characters              | the password is shorter than 15 characters      |
      | 1025 bytes                 | the password is longer than 1024 bytes          |
      | bytes that are not UTF-8   | the password is not UTF-8                       |

  Scenario: Fifteen characters are enough, whatever their bytes
    When Password.create is given 15 characters of 3 bytes each
    Then it returns a hash that accepts them

  Scenario Outline: A string that is not a hash of PBKDF2-SHA256 is refused
    When Password.verify is given <string>
    Then it raises Password::Error "<message>"

    Examples:
      | string                                 | message                                                          |
      | a hash of another algorithm            | not a password hash ($pbkdf2-sha256$i=<iterations>$<salt>$<hash>) |
      | a hash without iterations              | not a password hash ($pbkdf2-sha256$i=<iterations>$<salt>$<hash>) |
      | a hash whose salt is 8 bytes           | the salt is shorter than 16 bytes                                |
      | a hash of 16 bytes                     | the hash is not 32 bytes                                         |

  Scenario: The option of a user is --basic-auth with the user and the hash
    When Password.option is given the user "alice" and the password "correct horse battery"
    Then it starts with "--basic-auth=alice:$pbkdf2-sha256$i=600000$"
    And the hash after "alice:" accepts the password

  Scenario Outline: A user name that cannot be one of Basic credentials is refused
    When Password.option is given the user <user>
    Then it raises Password::Error that names the user

    Examples:
      | user      |
      | ""        |
      | "al:ice"  |
      | "al ice"  |
      | "al\tice" |
