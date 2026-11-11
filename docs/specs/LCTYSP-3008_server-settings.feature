# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/config.rb (LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/config_test.rb, whose steps are the lines below.

Feature: LCTYSP-3008 Server settings

  lib/config.rb computes the server's settings once, when it is loaded. Two are environment variables only:
  LCTY_DATA_DIR gives the data directory, by default the per-user application data folder (~/Library/Application
  Support on macOS and Windows, $XDG_DATA_HOME or ~/.local/share elsewhere), and LCTY_PORT, else PORT, the port; without
  either PORT is nil and lcty.rb takes the first free port of PORTS_TRIED, 45280 to 45379 (LCTYSP-3019). A port that is
  not an integer from 1 to 65535 stops the server. The other settings are the options of lcty.rb, parsed by one
  OptionParser: --bind-ip, --allowed-origin and --basic-auth (each once per value) and --base-url. --basic-auth is
  USER:HASH, a user of Basic authentication with a hash of lib/password.rb (Chatty.basic_users, {user => hash}, empty
  by default); one that is not this, or a user given twice, stops the server. Chatty.configure(argv) takes them
  from server_settings.txt of the data directory (one option per line, blank lines and # comments left out), then from
  the environment variables that are set and not empty (LCTY_BIND_IP, LCTY_BASE_URL, LCTY_ALLOWED_ORIGIN and LCTY_BASIC_AUTH, one value
  each: the environment is for starting quickly, and a value with a comma or whitespace stops the server), then from
  argv, each replacing the ones before, and returns the other arguments; lib/config.rb runs it with no argv when it is loaded. Without any a setting takes its default: the
  address 127.0.0.1 (Chatty.bind_ips, the IP addresses to listen on, an address given twice listed once), the base URL
  "/" (Chatty.base_url) and the server's own origins (Chatty.allowed_origins nil). An option that is not one (the --host of before
  among them), lacks its value or is --port or --data-dir (LCTY_DATA_DIR is an environment variable only, since the
  data directory holds the file), or an address to listen on that is not an IP address, stops the server,
  named after the file, the variable or the command line. Chatty.url_host writes an address as a URL does. A relative LCTY_DATA_DIR is resolved against the repository root, and the conversations,
  the tag files and their lock, the tags of conversations and the search index live at fixed places in the data
  directory. It also defines the patterns of ids and tag references, and HttpError, the error that carries an HTTP status. Each setting is read in a new Ruby process that
  loads lib/config.rb with only the given environment.

  Scenario: Without settings the port is left to lcty.rb and the address is 127.0.0.1
    Given LCTY_PORT, PORT and LCTY_BIND_IP are unset
    When lib/config.rb is loaded
    Then PORT is nil and PORTS_TRIED is 45280 to 45379
    And Chatty.bind_ips is ["127.0.0.1"]

  Scenario: Empty settings count as unset
    Given LCTY_PORT, PORT and LCTY_BIND_IP are empty
    When lib/config.rb is loaded
    Then PORT is nil
    And Chatty.bind_ips is ["127.0.0.1"]

  Scenario: PORT sets the port
    Given PORT is "8080"
    When lib/config.rb is loaded
    Then PORT is the integer 8080

  Scenario: LCTY_PORT sets the port, before PORT
    Given LCTY_PORT is "8081" and PORT is "8080"
    When lib/config.rb is loaded
    Then PORT is the integer 8081

  Scenario Outline: A port that is not an integer from 1 to 65535 stops the server
    Given LCTY_PORT is "<value>"
    When lib/config.rb is loaded
    Then loading fails with the SettingsError "the port must be an integer from 1 to 65535: "<value>""

    Examples:
      | value |
      | http  |
      | 80.5  |
      | 0     |
      | 70000 |

  Scenario: LCTY_BIND_IP sets the one address to listen on
    Given LCTY_BIND_IP is "::1"
    When lib/config.rb is loaded
    Then Chatty.bind_ips is ["::1"]

  Scenario Outline: An environment variable takes one value only
    Given <variable> is "<value>"
    When lib/config.rb is loaded
    Then loading fails with the SettingsError "<variable>: one value only; give more with <option> in server_settings.txt"

    Examples:
      | variable            | value                       | option           |
      | LCTY_BIND_IP        | 0.0.0.0, ::1                | --bind-ip        |
      | LCTY_ALLOWED_ORIGIN | http://a.test http://b.test | --allowed-origin |

  Scenario: LCTY_BIND_IP that is not an IP address stops the server
    Given LCTY_BIND_IP is "localhost"
    When lib/config.rb is loaded
    Then loading fails with the SettingsError "LCTY_BIND_IP: not an IP address to listen on: "localhost""

  Scenario: An IPv6 address is written in brackets in URLs
    When Chatty.url_host is given "::1" and "127.0.0.1"
    Then it returns "[::1]" and "127.0.0.1"

  # ---- server_settings.txt of the data directory, and the command line ----

  Scenario: The settings file of the data directory sets the addresses, the base URL and the allowed origins
    Given a data directory whose server_settings.txt has the lines "# a comment", "", "--bind-ip=0.0.0.0", "--bind-ip ::1", "--bind-ip=0.0.0.0", "--base-url /lcty/", "--allowed-origin=http://a.test:8080" and "--allowed-origin=http://b.test:8080"
    When lib/config.rb is loaded
    Then Chatty.bind_ips is ["0.0.0.0", "::1"], Chatty.base_url is "/lcty/" and Chatty.allowed_origins is ["http://a.test:8080", "http://b.test:8080"]
    And SETTINGS_PATH is its "server_settings.txt"

  Scenario: Without a settings file every setting takes its default, and server_settings.json is not read
    Given a data directory with a server_settings.json of {"host": "0.0.0.0"} and no server_settings.txt
    When lib/config.rb is loaded
    Then Chatty.bind_ips is ["127.0.0.1"], Chatty.base_url is "/" and Chatty.allowed_origins is nil
    And no server_settings.txt has been created

  Scenario: An environment variable that is set and not empty overrides the file
    Given a data directory whose server_settings.txt has the lines "--bind-ip=0.0.0.0", "--base-url=/lcty/" and "--allowed-origin=http://a.test:8080"
    And LCTY_BIND_IP is empty, LCTY_BASE_URL is "/x/" and LCTY_ALLOWED_ORIGIN is "http://b.test"
    When lib/config.rb is loaded
    Then Chatty.bind_ips is ["0.0.0.0"], Chatty.base_url is "/x/" and Chatty.allowed_origins is ["http://b.test"]

  Scenario: The command line overrides the environment and the file, and the other arguments are returned
    Given a data directory whose server_settings.txt has the lines "--bind-ip=0.0.0.0" and "--allowed-origin=http://a.test:8080"
    And LCTY_BIND_IP is "::1"
    When Chatty.configure is given "--bind-ip=10.0.0.1", "convert" and "--allowed-origin=http://c.test"
    Then Chatty.bind_ips is ["10.0.0.1"] and Chatty.allowed_origins is ["http://c.test"]
    And it returns "convert"

  Scenario Outline: A settings file that cannot be used stops the server
    Given a data directory whose server_settings.txt is the line "<line>"
    When lib/config.rb is loaded
    Then loading fails with a SettingsError that starts with the path of the file and "<message>"

    Examples:
      | line                | message                                          |
      | --prot=1            | invalid option: --prot=1                         |
      | --host=0.0.0.0      | invalid option: --host=0.0.0.0                   |
      | --bind-ip           | missing argument: --bind-ip                      |
      | bind-ip=1           | not an option: bind-ip=1                         |
      | --port=8080         | the port is not an option; set LCTY_PORT or PORT |
      | --data-dir=/tmp/x   | the data directory is not an option; set LCTY_DATA_DIR |
      | --bind-ip=          | not an IP address to listen on: ""               |
      | --bind-ip=localhost | not an IP address to listen on: "localhost"      |
      | --bind-ip=10.0.0.0/8 | not an IP address to listen on: "10.0.0.0/8"    |
      | --basic-auth=alice  | --basic-auth: not USER:HASH, as tools/hash_password.rb prints it |
      | --basic-auth=alice:secret | --basic-auth: the user "alice": not a password hash ($pbkdf2-sha256$i=<iterations>$<salt>$<hash>) |

  # The users of Basic authentication (LCTYSP-0010), as tools/hash_password.rb prints them (LCTYSP-3024)
  Scenario: The settings file gives the users of Basic authentication
    Given a data directory whose server_settings.txt has --basic-auth for "alice" and for "bob"
    When lib/config.rb is loaded
    Then Chatty.basic_users has "alice" and "bob" with their hashes

  Scenario: Without --basic-auth there is no user
    Given a data directory without server_settings.txt
    When lib/config.rb is loaded
    Then Chatty.basic_users is empty

  Scenario: A user given twice stops the server
    Given a data directory whose server_settings.txt has --basic-auth for "alice" twice
    When lib/config.rb is loaded
    Then loading fails with a SettingsError that starts with the path of the file and "--basic-auth: the user "alice" is given twice"

  Scenario: LCTY_BASIC_AUTH gives one user, instead of those of the file
    Given a data directory whose server_settings.txt has --basic-auth for "alice"
    And LCTY_BASIC_AUTH is "bob" and a hash
    When lib/config.rb is loaded
    Then Chatty.basic_users has "bob" only

  Scenario: An option of the command line that is not one stops the server
    Given a data directory without server_settings.txt
    When Chatty.configure is given "--prot"
    Then it fails with the SettingsError "the command line: invalid option: --prot"

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
