# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/common.js (LCTYSP-0003, LCTYSP-0005, LCTYSP-0007, LCTYSP-0010). Each Scenario is a test of
# the same title in tests/unit/common.test.js (in Node.js) or tests/unit/common.spec.js (in the browser), whose steps
# are the lines below.

Feature: LCTYSP-1004 Ids, times, URLs and settings

  js/common.js holds the small helpers every page uses. nowIso() writes the local time with its offset, as messages
  carry it in data-at; newConvId() makes a conversation id from the local time and four random hex digits
  (20261104-102300-a1b2), and newMsgId() a message id (a UUIDv7). showToast(msg) shows a message in the one #toast
  element for 4 seconds. backendOf(settings, id) picks a backend and convUrl(id, msgId) links to a conversation or to
  one of its messages, c/<id>.html of the site (siteUrl of js/site.js, LCTYSP-0005). The settings are the defaults of GET /v1/defaults.json overlaid with the changes stored in
  localStorage "lcty.settings.v1": storeSettings keeps only the values that differ from the defaults, mergeSettings
  overlays them, ignoring unknown keys and values of another type, and loadSettings turns the result into the one
  backend the pages use, or shows a toast and returns null when the defaults cannot be loaded. appIndexer(getSettings)
  is the indexer of the pages (LCTYSP-0007): it reads the settings at every kick, does nothing without an embedding
  model and shows its first failure in a toast.

  Scenario: query() returns the first element that matches
    Given a page on the server's origin
    Given the body has <p class="a" id="one"></p><p class="a" id="two"></p>
    When query(".a") and query(".none") are called
    Then they return the element "one" and null

  Scenario Outline: nowIso() writes the local time with the offset of the time zone
    Given the time zone is <zone> and the time is 2026-11-04T01:23:05.678Z
    When nowIso() is called
    Then it returns "<iso>"
    And Date.parse of it is 2026-11-04T01:23:05Z

    Examples:
      | zone             | iso                       |
      | Asia/Tokyo       | 2026-11-04T10:23:05+09:00 |
      | UTC              | 2026-11-04T01:23:05+00:00 |
      | Asia/Kolkata     | 2026-11-04T06:53:05+05:30 |
      | America/St_Johns | 2026-11-03T21:53:05-03:30 |

  Scenario Outline: newConvId() is made of the local time and four random hex digits
    Given the time zone is <zone> and the time is 2026-11-04T01:23:05.678Z
    When newConvId() is called
    Then it matches "<start>" followed by four lowercase hex digits
    And it is a valid conversation id of the server

    Examples:
      | zone             | start            |
      | Asia/Tokyo       | 20261104-102305- |
      | America/St_Johns | 20261103-215305- |

  Scenario: Conversation ids made in the same second differ by their random digits
    Given the time is fixed
    When newConvId() is called 20 times
    Then all of them start with the same time
    And their hex digits are not all the same

  Scenario: newMsgId() is a UUIDv7 for now
    When newMsgId() is called
    Then UUID_RE accepts it
    And the milliseconds in its first 48 bits are between those before and after the call

  Scenario: showToast() makes the #toast status element
    Given a page on the server's origin
    Given the page has no #toast
    When showToast("Saved") is called
    Then the body ends with one #toast whose role is "status"
    And it is shown with the text "Saved"

  Scenario: showToast() uses the #toast the page has
    Given a page on the server's origin
    Given the body has a hidden <div id="toast"> after a paragraph
    When showToast("Saved") is called
    Then the page still has one #toast, after the paragraph
    And it is shown with the text "Saved"

  Scenario: showToast() writes its message as text
    Given a page on the server's origin
    When showToast("<b>bold</b>") is called
    Then the text of #toast is "<b>bold</b>"
    And #toast has no child elements

  Scenario: A toast hides itself after 4 seconds
    Given a page on the server's origin
    Given the clock is controlled by the test
    When showToast("Saved") is called
    Then #toast is shown 3999 ms later
    And #toast is hidden 4000 ms after the call

  Scenario: A new toast replaces the shown one and restarts the 4 seconds
    Given a page on the server's origin
    Given the clock is controlled by the test
    When showToast("First") is called
    And showToast("Second") is called 3000 ms later
    Then #toast shows "Second" 4000 ms after the first call
    And #toast is hidden 4000 ms after the second call

  Scenario Outline: backendOf() picks a backend
    Given the settings have the backends "a" and "b" and the default backend <default>
    When backendOf() is called with the id <id>
    Then it returns the backend <backend>

    Examples:
      | case                             | default | id        | backend |
      | the id given                     | "a"     | "b"       | "b"     |
      | the default without an id        | "b"     | undefined | "b"     |
      | the default for an empty id      | "b"     | ""        | "b"     |
      | the first for an unknown id      | "b"     | "zzz"     | "a"     |
      | the first for an unknown default | "zzz"   | undefined | "a"     |

  Scenario: backendOf() returns undefined without backends
    Given the settings have no backends
    When backendOf() is called without an id
    Then it returns undefined

  Scenario Outline: convUrl() links to a conversation or one of its messages
    When convUrl() is called with <id> and <msgId>
    Then it returns the URL of "<path>" on the site

    Examples:
      | case                     | id                     | msgId                                  | path                                                                   |
      | a conversation           | "20261104-102300-a1b2" | undefined                              | c/20261104-102300-a1b2.html                                            |
      | an empty message id      | "20261104-102300-a1b2" | ""                                     | c/20261104-102300-a1b2.html                                            |
      | a message                | "20261104-102300-a1b2" | "0190f3a1-7c2e-7abc-8def-0123456789ab" | c/20261104-102300-a1b2.html#c-msg-0190f3a1-7c2e-7abc-8def-0123456789ab |
      | an id that needs escapes | "a b/c?d#e"            | undefined                              | c/a%20b%2Fc%3Fd%23e.html                                               |

  Scenario: storeSettings() stores only the values that differ from the defaults
    Given a page on the server's origin
    Given the defaults { base_url: "http://d", model: "m", api_key: "k" }
    When storeSettings() is given { base_url: "http://d", model: "other", api_key: "k" }
    Then it returns { model: "other" }
    And localStorage "lcty.settings.v1" holds {"model":"other"}

  Scenario: storeSettings() ignores the keys the defaults do not have
    Given a page on the server's origin
    Given the defaults { model: "m" }
    When storeSettings() is given { model: "other", unknown: "x" }
    Then it returns { model: "other" }
    And localStorage "lcty.settings.v1" holds {"model":"other"}

  Scenario: storeSettings() keeps the default of a key the values do not have
    Given a page on the server's origin
    Given the defaults { model: "m", api_key: "k" }
    When storeSettings() is given { api_key: "" }
    Then it returns { api_key: "" }
    And localStorage "lcty.settings.v1" holds {"api_key":""}

  Scenario: storeSettings() removes the stored changes when nothing differs
    Given a page on the server's origin
    Given localStorage "lcty.settings.v1" holds {"model":"other"}
    And the defaults { model: "m" }
    When storeSettings() is given { model: "m" }
    Then it returns {}
    And localStorage has no "lcty.settings.v1"

  Scenario: storeSettings() replaces the stored changes as a whole
    Given a page on the server's origin
    Given localStorage "lcty.settings.v1" holds {"model":"other"}
    And the defaults { model: "m", api_key: "k" }
    When storeSettings() is given { model: "m", api_key: "mine" }
    Then it returns { api_key: "mine" }
    And localStorage "lcty.settings.v1" holds {"api_key":"mine"}

  Scenario: mergeSettings() overlays the defaults with the stored changes
    Given a page on the server's origin
    Given localStorage "lcty.settings.v1" holds {"model":"other"}
    When mergeSettings() is given the defaults { base_url: "http://d", model: "m" }
    Then it returns { base_url: "http://d", model: "other" }

  Scenario: mergeSettings() ignores unknown keys and values of another type
    Given a page on the server's origin
    When mergeSettings() is given the defaults { model: "m", count: 3 } and the changes { model: 5, count: 4, unknown: "x" }
    Then it returns { model: "m", count: 4 }

  Scenario Outline: mergeSettings() uses the defaults when the stored changes cannot be read
    Given a page on the server's origin
    Given localStorage "lcty.settings.v1" holds <stored>
    When mergeSettings() is given the defaults { model: "m" }
    Then it returns { model: "m" }

    Examples:
      | stored    |
      | not JSON  |
      | null      |
      | ["model"] |
      | "model"   |
      | nothing   |

  Scenario: loadSettings() makes the backend of the pages from the defaults and the stored changes
    Given a page on the server's origin
    Given GET /v1/defaults.json returns { base_url: "http://d", api_key: "k", model: "m", embedding_model: "e" }
    And localStorage "lcty.settings.v1" holds {"model":"other"}
    When loadSettings() is called
    Then it returns the one backend "local" of the default backend "local", with the model "other" and the rest of the defaults

  Scenario Outline: loadSettings() shows a toast and returns null when the defaults cannot be loaded
    Given a page on the server's origin
    Given the page's lang is "<lang>" and the Japanese table is loaded
    And GET /v1/defaults.json answers with the status 500 and the body "boom"
    When loadSettings() is called
    Then it returns null
    And the toast says "<toast>"

    Examples:
      | lang | toast                                 |
      | en   | Failed to load the settings: 500 boom |
      | ja   | 設定の読み込みに失敗しました: 500 boom              |

  Scenario: The indexer does nothing without settings
    Given a page on the server's origin
    Given GET /v1/vectors/pending is answered by the test
    When the indexer of appIndexer() with no settings is kicked
    Then no request is sent to /v1/vectors/pending

  Scenario: The indexer does nothing without an embedding model
    Given a page on the server's origin
    Given GET /v1/vectors/pending is answered by the test
    When the indexer of appIndexer() with settings whose embedding model is "" is kicked
    Then no request is sent to /v1/vectors/pending

  Scenario: The indexer asks for the pending rounds of the embedding model
    Given a page on the server's origin
    Given GET /v1/vectors/pending returns no rounds
    When the indexer of appIndexer() with settings whose embedding model is "embed" is kicked
    Then GET /v1/vectors/pending?model=embed&limit=16 is sent once
    And no toast is shown

  Scenario: The indexer reads the settings at every kick
    Given a page on the server's origin
    Given GET /v1/vectors/pending returns no rounds
    And the indexer of appIndexer() has no settings
    When it is kicked, then given settings whose embedding model is "embed" and kicked again
    Then GET /v1/vectors/pending?model=embed&limit=16 is sent once

  Scenario: The indexer shows only its first failure in a toast
    Given a page on the server's origin
    Given GET /v1/vectors/pending answers with the status 500 and the body "boom"
    When the indexer of appIndexer() with settings whose embedding model is "embed" is kicked
    Then the toast says "Failed to index: 500 boom"
    When the toast is hidden and the indexer is kicked again
    Then GET /v1/vectors/pending was sent twice
    And the toast is still hidden
