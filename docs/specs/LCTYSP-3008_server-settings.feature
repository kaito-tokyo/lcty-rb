# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/config.rb (LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/config_test.rb, whose steps are the lines below.

Feature: LCTYSP-3008 Server settings

  lib/config.rb computes the server's settings once, when it is loaded, from only three environment variables: PORT,
  LCTY_HOST and LCTY_DATA_DIR. An unset or empty one takes its default: the port 45280, the address 127.0.0.1 and the
  per-user application data folder (~/Library/Application Support on macOS and Windows, $XDG_DATA_HOME or
  ~/.local/share elsewhere). A relative LCTY_DATA_DIR is resolved against the repository root, and the conversations,
  the tags and the search index live at fixed places in the data directory. It also defines the patterns of ids and
  tag names, and HttpError, the error that carries an HTTP status. Each setting is read in a new Ruby process that
  loads lib/config.rb with only the given environment.

  Scenario: Without settings the server listens on 127.0.0.1:45280
    Given PORT and LCTY_HOST are unset
    When lib/config.rb is loaded
    Then PORT is 45280
    And BIND and BIND_URL_HOST are "127.0.0.1"

  Scenario: Empty settings count as unset
    Given PORT and LCTY_HOST are empty
    When lib/config.rb is loaded
    Then PORT is 45280
    And BIND is "127.0.0.1"

  Scenario: PORT sets the port
    Given PORT is "8080"
    When lib/config.rb is loaded
    Then PORT is the integer 8080

  Scenario: A PORT that is not a number stops the server
    Given PORT is "http"
    When lib/config.rb is loaded
    Then loading fails with an ArgumentError about the invalid value "http"

  Scenario: LCTY_HOST sets the address to listen on
    Given LCTY_HOST is "0.0.0.0"
    When lib/config.rb is loaded
    Then BIND and BIND_URL_HOST are "0.0.0.0"

  Scenario: An IPv6 address is written in brackets in URLs
    Given LCTY_HOST is "::1"
    When lib/config.rb is loaded
    Then BIND is "::1"
    And BIND_URL_HOST is "[::1]"

  Scenario: A host name is written in URLs as it is
    Given LCTY_HOST is "localhost"
    When lib/config.rb is loaded
    Then BIND_URL_HOST is "localhost"

  Scenario: An absolute LCTY_DATA_DIR is the data directory
    Given LCTY_DATA_DIR is an absolute path
    When lib/config.rb is loaded
    Then DATA_DIR is that path
    And CONV_DIR is its "c", TAGS_DB_PATH its "tags.sqlite" and INDEX_PATH its "_index.sqlite"

  Scenario: A relative LCTY_DATA_DIR is resolved against the repository root
    Given LCTY_DATA_DIR is "tmp/lcty-data"
    When lib/config.rb is loaded
    Then DATA_DIR is "tmp/lcty-data" in the repository root, whatever the current directory

  Scenario: The repository root and the public folder
    When lib/config.rb is loaded
    Then ROOT is the folder that holds lib/config.rb's folder
    And PUBLIC_DIR is its "public"

  Scenario: XDG_DATA_HOME is used when it is absolute
    Given XDG_DATA_HOME is an absolute path
    When lib/config.rb is loaded
    Then Chatty::XDG_DATA_HOME is that path

  Scenario Outline: Otherwise the data home is ~/.local/share
    Given XDG_DATA_HOME is <value>
    When lib/config.rb is loaded
    Then Chatty::XDG_DATA_HOME is ".local/share" in HOME

    Examples:
      | value                   |
      | unset                   |
      | empty                   |
      | the relative path "xdg" |

  Scenario Outline: Without LCTY_DATA_DIR the data directory is the per-user application data folder
    Given LCTY_DATA_DIR is <value> and XDG_DATA_HOME is an absolute path
    When lib/config.rb is loaded
    Then on macOS and Windows DATA_DIR is "Library/Application Support/tokyo.kaito.lcty-rb/Data" in HOME
    And elsewhere DATA_DIR is "tokyo.kaito.lcty-rb/Data" in XDG_DATA_HOME
    And DEFAULT_DATA_DIR is DATA_DIR

    Examples:
      | value |
      | unset |
      | empty |

  Scenario Outline: ID_RE accepts ids of 1 to 80 letters, digits, "_" and "-"
    Then ID_RE accepts <value>

    Examples:
      | value                                                 |
      | "a" (one character)                                   |
      | "0190f3a1-7c2e-7abc-8def-0123456789ab" (a UUIDv7)     |
      | "My_Conv-01"                                          |
      | 80 characters                                         |

  Scenario Outline: ID_RE rejects anything else
    Then ID_RE rejects <value>

    Examples:
      | value                        |
      | "" (empty)                   |
      | 81 characters                |
      | "a.b" (a dot)                |
      | "../etc" (a path)            |
      | "a b" (a space)              |
      | "abc\n" (a trailing newline) |
      | "日本語" (not ASCII)         |

  Scenario Outline: TAG_NAME_RE accepts names of 1 to 40 characters without whitespace or ":"
    Then TAG_NAME_RE accepts <value>

    Examples:
      | value                  |
      | "x" (one character)    |
      | "work-2026"            |
      | "日本語" (not ASCII)   |
      | "a/b#c" (punctuation)  |
      | 40 characters          |

  Scenario Outline: TAG_NAME_RE rejects anything else
    Then TAG_NAME_RE rejects <value>

    Examples:
      | value                             |
      | "" (empty)                    |
      | 41 characters                 |
      | "tag:work" (a colon)          |
      | "two words" (a space)         |
      | "tab\there" (a tab)           |
      | "work\n" (a trailing newline) |

  Scenario: HttpError carries an HTTP status and a message
    When an HttpError is made with the status 404 and the message "no such conversation"
    Then its status is 404 and its message is "no such conversation"
    And it is a StandardError, so a plain rescue catches it
