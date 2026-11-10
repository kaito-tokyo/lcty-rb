# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lcty.rb, the entry point (LCTYSP-0005, with LCTYSP-0010 for the offline copies). Each Scenario is a
# test of the same title in tests/backend/lcty_test.rb, whose steps are the lines below.

Feature: LCTYSP-3019 The entry point

  lcty.rb wires the servlets of the site together. Lcty.base_url is the path the site is served under, from the base
  URL of the settings (--base-url or LCTY_BASE_URL, LCTYSP-3008): it always starts and ends with "/", and is "/" when
  it is unset or empty. Lcty.main reads the options of its command line (those of server_settings.txt) before the
  other arguments: none starts the server, "convert" converts the conversation files. Lcty.mount_all
  mounts every servlet under it: the HTTP API at v1, C at c and T at t, each file of /lcty.v1/ under its own name and
  under the names of version 1 (nothing else there), the page entries as they are (they are not bundled) and the rest
  of public/. Lcty.publish_offline copies what a file opened directly reads, lcty.v1.js (the bytes of
  public/lcty.v1/lcty.v1.cjs) and lcty.v1.css, into the root of the data directory, c/ and t/, rewriting a copy only
  when its bytes changed. The server is started in the root of the repository, which the files of the site are found
  from; so are the tests.

  Scenario Outline: The base URL always starts and ends with a slash
    Given LCTY_BASE_URL is <value>
    When lcty.rb is loaded
    Then Lcty.base_url is <base>

    Examples:
      | value     | base     |
      | unset     | "/"      |
      | ""        | "/"      |
      | "lcty"    | "/lcty/" |
      | "/lcty/"  | "/lcty/" |
      | "/a//b/"  | "/a/b/"  |

  Scenario: A settings file that cannot be used stops lcty.rb with its message
    Given a data directory whose server_settings.txt is the line "--prot=8080"
    When lcty.rb is loaded
    Then it exits with the status 1 and prints "lcty-rb: " and the message of the settings file, without a backtrace

  Scenario: An option of the command line that is not one stops lcty.rb with the usage
    Given a data directory without server_settings.txt
    When lcty.rb is run with "--prot"
    Then it exits with the status 1 and prints "lcty-rb: the command line: invalid option: --prot" and the usage

  Scenario: --help prints every option
    When lcty.rb is run with "--help"
    Then it exits with the status 0 and prints the usage with --bind-ip, --base-url and --allowed-origin

  # Digest authentication (LCTYSP-0010): an htdigest file in the data directory turns it on for every request
  Scenario: Without an htdigest file no request needs credentials
    Given a data directory without htdigest
    When Lcty.digest_auth is called
    Then it returns nil

  Scenario: With an htdigest file every request needs one of its users
    Given a data directory whose htdigest has the user "alice" with the password "secret-pass" in the realm "lcty-rb"
    And a server listening with Lcty.digest_auth, the site mounted
    When /c/ is requested without credentials
    Then it is answered 401 with a Digest challenge of the realm "lcty-rb"
    When /c/ is requested with the Digest response of "alice" and "secret-pass"
    Then it is answered 200
    When /c/ is requested with the Digest response of "alice" and "wrong"
    Then it is answered 401
    When /c/ is requested with Basic credentials of "alice" and "secret-pass"
    Then it is answered 401

  Scenario: The WebSocket of /v1/rpc needs the credentials too
    Given a data directory whose htdigest has the user "alice" with the password "secret-pass" in the realm "lcty-rb"
    And a server listening with Lcty.digest_auth, the site mounted
    When the WebSocket of /v1/rpc is opened without credentials
    Then the handshake is answered 401
    When it is opened with the Digest response of "alice" and "secret-pass"
    Then the handshake is answered 101

  Scenario Outline: An htdigest file that cannot be used stops the server
    Given a data directory whose htdigest is <content>
    When Lcty.digest_auth is called
    Then it raises a SettingsError that starts with the path of the file and "<message>"

    Examples:
      | content                                                                        | message                                          |
      | the line "alice:secret"                                                        | not a line of htdigest (user:realm:md5): "alice:secret" |
      | empty                                                                          | no user (add one with htdigest)                  |
      | the users "alice" of the realm "a" and "bob" of the realm "b"                  | one realm only, not "a", "b"                     |

  # WEBrick waits for the thread of every request, and a /v1/rpc connection's thread reads until the page closes it
  Scenario Outline: The server stops on a signal while a page keeps /v1/rpc open
    Given lcty.rb is running, with a page connected to /v1/rpc that never closes its end
    When the server is sent <signal>
    Then it exits with the status 0 within 5 seconds
    And the page got a close frame with the code 1001

    Examples:
      | signal |
      | INT    |
      | TERM   |

  # The port is LCTY_PORT or PORT, or else the first free one of Chatty::PORTS_TRIED (LCTYSP-0010)
  Scenario: Without a port asked for, the server listens on the first free port tried
    Given two free ports, the first of them taken by another server
    When Lcty.listen is given no port to ask for and the two ports to try
    Then it listens on the second port
    And Chatty.port is the second port

  Scenario: A port asked for that is taken stops the server
    Given a port taken by another server
    When Lcty.listen is given that port to ask for
    Then it raises Lcty::PortError "the port <port> (LCTY_PORT or PORT) is in use"

  # Several addresses (--bind-ip) share one port. IPv6 is needed for these two: without ::1 they are skipped
  Scenario: The server listens on every address given, at one port
    Given a free port
    When Lcty.listen is given that port to ask for and the addresses "127.0.0.1" and "::1"
    Then both addresses answer at that port

  Scenario: A port taken on one of the addresses is skipped on all of them
    Given two free ports, the first of them taken on "::1" by another server
    When Lcty.listen is given no port to ask for, the two ports to try and the addresses "127.0.0.1" and "::1"
    Then it listens on the second port
    And the first port is free again on "127.0.0.1"

  Scenario: An address that is not one of this machine stops the server
    When Lcty.listen is given the address "192.0.2.1"
    Then it raises Lcty::PortError "cannot listen on 192.0.2.1: it is not an address of this machine (--bind-ip)"

  Scenario: When every port tried is taken the server stops
    Given two ports taken by another server
    When Lcty.listen is given no port to ask for and the two ports to try
    Then it raises Lcty::PortError "no free port from <first> to <second> (set one with LCTY_PORT or PORT)"

  Scenario Outline: Every path of the site is mounted
    Given Lcty.mount_all on a WEBrick server
    When <path> is requested
    Then the status is <status> with the type <type>

    Examples:
      | path                          | status | type                               |
      | /lcty.v1/lcty.v1.cjs          | 200    | "text/javascript; charset=utf-8"   |
      | /lcty.v1/lcty.v1.lang-ja.cjs  | 200    | "text/javascript; charset=utf-8"   |
      | /lcty.v1/lcty.v1.css          | 200    | "text/css; charset=utf-8"          |
      | /lcty.v1/lcty.v1.async.mjs    | 200    | "text/javascript; charset=utf-8"   |
      | /lcty.v1/lcty.v1.c.worker.cjs | 200    | "text/javascript; charset=utf-8"   |
      | /lcty.v1/lcty.v1.t.worker.cjs | 200    | "text/javascript; charset=utf-8"   |
      | /c/index.js                   | 200    | "text/javascript; charset=utf-8"   |
      | /t/index.js                   | 200    | "text/javascript; charset=utf-8"   |
      | /t/tag-file.js                | 200    | "text/javascript; charset=utf-8"   |
      | /c/                           | 200    | "text/html; charset=utf-8"         |
      | /t/                           | 200    | "text/html; charset=utf-8"         |
      | /                             | 200    | "text/html; charset=utf-8"         |
      | /js/site.js                   | 200    | "text/javascript; charset=utf-8"   |
      | /v1/tags                      | 200    | "application/json; charset=utf-8"  |

  Scenario Outline: The names of version 1 in /lcty.v1/ are the files they stand for
    Given Lcty.mount_all on a WEBrick server
    When /lcty.v1/<name> is requested
    Then the body is the bytes of public/lcty.v1/<file>

    Examples:
      | name               | file                |
      | lcty.v1.js         | lcty.v1.cjs         |
      | lcty.v1.lang-ja.js | lcty.v1.lang-ja.cjs |
      | lcty.v1.module.js  | lcty.v1.async.mjs   |

  Scenario Outline: Nothing else is under /lcty.v1/
    Given Lcty.mount_all on a WEBrick server
    When <path> is requested
    Then the status is 404

    Examples:
      | path                       |
      | /lcty.v1/                  |
      | /lcty.v1/lcty.v1.d.cts     |
      | /lcty.v1/lcty.v1.mjs       |
      | /lcty.v1/sub/lcty.v1.cjs   |

  Scenario: The entries are served as they are, not bundled
    Given Lcty.mount_all on a WEBrick server
    When /c/index.js is requested
    Then the body is the bytes of public/c/index.js

  Scenario: Under a base URL every path is below it
    Given Lcty.mount_all on a WEBrick server under "/base/"
    When /base/lcty.v1/lcty.v1.css and /lcty.v1/lcty.v1.css are requested
    Then the first is 200 and the second is 404

  Scenario: Lcty.publish_offline copies what a file opened directly reads into the data directories
    When Lcty.publish_offline runs
    Then lcty.v1.js and lcty.v1.css of the data directory, its c/ and its t/ have the bytes of public/lcty.v1/lcty.v1.cjs and public/lcty.v1/lcty.v1.css

  Scenario: Lcty.publish_offline leaves copies that are up to date alone
    Given Lcty.publish_offline has run
    When Lcty.publish_offline runs again
    Then the copies in c/ are the same files as before, not rewritten

  Scenario: Lcty.publish_offline puts back a copy that was changed
    Given c/lcty.v1.css of the data directory was changed
    When Lcty.publish_offline runs
    Then c/lcty.v1.css has the bytes of public/lcty.v1/lcty.v1.css again

  Scenario: Lcty.publish_offline leaves the other files of the data directories alone
    Given a file "lcty.v0.js" in c/ of the data directory
    When Lcty.publish_offline runs
    Then c/lcty.v0.js is still there with its content
