# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/basic_auth.rb (LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/basic_auth_test.rb, whose steps are the lines below.

Feature: LCTYSP-3025 Basic authentication

  Chatty::BasicAuth#authenticate checks a request against the users of --basic-auth, each with a hash of
  lib/password.rb (LCTYSP-3024). It returns when the Authorization header is Basic with the user and password of one
  of them, and otherwise sets WWW-Authenticate to 'Basic realm="lcty-rb", charset="UTF-8"' and raises
  WEBrick::HTTPStatus::Unauthorized, which WEBrick answers as 401. Credentials that name a user are logged when they are
  refused, the user only, and answered after the delay given (a second by default); a request without them is not.
  A user and password that were accepted are remembered (an HMAC with a key of the process), so the hash is checked
  once; an unknown user is checked against a hash of its own, so the time does not tell which users there are.

  Scenario: A request without credentials is answered with the challenge
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery"
    When a request without an Authorization header is authenticated
    Then it raises WEBrick::HTTPStatus::Unauthorized
    And WWW-Authenticate is 'Basic realm="lcty-rb", charset="UTF-8"'
    And nothing is logged

  Scenario: The user and password of a user get in
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery"
    When a request with the Basic credentials of "alice" and "correct horse battery" is authenticated
    Then it returns

  Scenario Outline: Other credentials are refused after the delay, and the user is logged
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery", and a delay of 0.2 seconds
    When a request with the Basic credentials of <user> and <password> is authenticated
    Then it raises WEBrick::HTTPStatus::Unauthorized after 0.2 seconds or more
    And the log names <user> and not the password

    Examples:
      | user    | password                |
      | "alice" | "correct horse batterY" |
      | "bob"   | "correct horse battery" |
      | "alice" | ""                      |

  Scenario: An unknown user is checked against a hash too
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery"
    When a request with the Basic credentials of "bob" and "correct horse battery" is authenticated
    Then Password.verify was called once

  Scenario: Credentials that were accepted are remembered
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery"
    When a request with the Basic credentials of "alice" and "correct horse battery" is authenticated three times
    Then Password.verify was called once

  Scenario: A password that is close to a remembered one is checked again
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery"
    And the credentials of "alice" and "correct horse battery" were accepted
    When a request with the Basic credentials of "alice" and "correct horse batterY" is authenticated
    Then it raises WEBrick::HTTPStatus::Unauthorized

  Scenario: A password that is not ASCII gets in, as UTF-8
    Given Chatty::BasicAuth with the user "alice" and the password "ただしいうまでんちほっちきすね"
    When a request with the Basic credentials of "alice" and "ただしいうまでんちほっちきすね" is authenticated
    Then it returns

  Scenario Outline: An Authorization header that is not Basic credentials is answered with the challenge
    Given Chatty::BasicAuth with the user "alice" and the password "correct horse battery"
    When a request with the Authorization header <header> is authenticated
    Then it raises WEBrick::HTTPStatus::Unauthorized
    And nothing is logged

    Examples:
      | header                                   |
      | Digest of "alice"                        |
      | Basic and Base64 without a colon         |
      | Basic and bytes that are not UTF-8       |
      | Basic and no Base64                      |
