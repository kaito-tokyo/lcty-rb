# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/config.rb (LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/config_test.rb, whose steps are the lines below.

Feature: LCTYSP-3008 Server settings

  lib/config.rb computes the server's settings once, when it is loaded. LCTY_DATA_DIR, an environment variable, gives
  the data directory, by default the per-user application data folder (~/Library/Application Support on macOS and
  Windows, $XDG_DATA_HOME or ~/.local/share elsewhere). The other settings are in server_settings.json of the data
  directory (port, host, base_url and allowed_origins), and an environment variable that is set and not empty
  overrides one (PORT, LCTY_HOST, LCTY_BASE_URL and LCTY_ALLOWED_ORIGIN). Without either a setting takes its
  default: the port 45280, the address 127.0.0.1, the base URL "/" and the server's own origins. A settings file that
  is not JSON, not an object, or has an unknown key or a value of the wrong type stops the server. A relative LCTY_DATA_DIR is resolved against the repository root, and the conversations,
  the tag files and their lock, the tags of conversations and the search index live at fixed places in the data
  directory. It also defines the patterns of ids and tag references, and HttpError, the error that carries an HTTP status. Each setting is read in a new Ruby process that
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

  # ---- server_settings.json of the data directory ----

  Scenario: The settings file of the data directory sets the port, the address, the base URL and the allowed origins
    Given a data directory whose server_settings.json is {"port": 8080, "host": "0.0.0.0", "base_url": "/lcty/", "allowed_origins": ["http://a.test:8080"]}
    When lib/config.rb is loaded
    Then PORT is 8080, BIND is "0.0.0.0", BASE_URL_SETTING is "/lcty/" and ALLOWED_ORIGINS_SETTING is ["http://a.test:8080"]
    And SETTINGS_PATH is its "server_settings.json"

  Scenario: Without a settings file every setting takes its default
    Given a data directory without server_settings.json
    When lib/config.rb is loaded
    Then PORT is 45280, BIND is "127.0.0.1", BASE_URL_SETTING is "/" and ALLOWED_ORIGINS_SETTING is nil
    And no server_settings.json has been created

  Scenario: An environment variable that is set and not empty overrides the file
    Given a data directory whose server_settings.json is {"port": 8080, "host": "0.0.0.0", "base_url": "/lcty/", "allowed_origins": ["http://a.test:8080"]}
    And PORT is "9090", LCTY_HOST is empty, LCTY_BASE_URL is "/x/" and LCTY_ALLOWED_ORIGIN is "http://b.test, http://c.test"
    When lib/config.rb is loaded
    Then PORT is 9090, BIND is "0.0.0.0", BASE_URL_SETTING is "/x/" and ALLOWED_ORIGINS_SETTING is ["http://b.test", "http://c.test"]

  Scenario Outline: A settings file that cannot be used stops the server
    Given a data directory whose server_settings.json is <content>
    When lib/config.rb is loaded
    Then loading fails with a SettingsError that starts with the path of the file and "<message>"

    Examples:
      | content                         | message                                                               |
      | {port: 1}                       | not JSON:                                                             |
      | [1, 2]                          | must be a JSON object                                                 |
      | {"prot": 8080}                  | unknown setting "prot" (known: port, host, base_url, allowed_origins) |
      | {"port": "8080"}                | port must be an integer from 1 to 65535                               |
      | {"port": 70000}                 | port must be an integer from 1 to 65535                               |
      | {"host": ""}                    | host must be a non-empty string                                       |
      | {"base_url": 1}                 | base_url must be a string                                             |
      | {"allowed_origins": "http://a"} | allowed_origins must be an array of non-empty strings                 |

  Scenario: An absolute LCTY_DATA_DIR is the data directory
    Given LCTY_DATA_DIR is an absolute path
    When lib/config.rb is loaded
    Then DATA_DIR is that path
    And CONV_DIR is its "c", TAG_DIR its "t", TAG_LOCK_PATH its "t.lock", TAGS_DB_PATH its "lcty_t.sqlite", FORMER_TAGS_DB_PATH its "tags.sqlite" and INDEX_PATH its "_index.sqlite"

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

  Scenario Outline: tag_ref? accepts tag references of at most 244 bytes
    Then tag_ref? accepts <value>

    Examples:
      | value                      |
      | "x" (one character)        |
      | "work-2026"                |
      | "日本語" (not ASCII)       |
      | "c~23" (an escaped symbol) |
      | "a#b" (punctuation)        |
      | 244 bytes                  |

  Scenario Outline: tag_ref? rejects whitespace, controls, path separators, colons and more than 244 bytes
    Then tag_ref? rejects <value>

    Examples:
      | value                    |
      | "" (empty)               |
      | 245 bytes                |
      | "tag:work" (a colon)     |
      | "a/b" (a slash)          |
      | a backslash              |
      | "two words" (a space)    |
      | an ideographic space     |
      | a tab                    |
      | a trailing newline       |
      | bytes that are not UTF-8 |
      | a number                 |

  Scenario: HttpError carries an HTTP status and a message
    When an HttpError is made with the status 404 and the message "no such conversation"
    Then its status is 404 and its message is "no such conversation"
    And it is a StandardError, so a plain rescue catches it
