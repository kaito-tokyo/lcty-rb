# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/i18n.js, of the LctyT object of public/c/lcty.v1.js it uses and of the Japanese table
# public/c/lcty.v1.lang-ja.js (LCTYSP-0005, "UI texts"). Each Scenario is a test of the same title in
# tests/unit/i18n.spec.js, whose steps are the lines below.

Feature: LCTYSP-1003 UI texts

  Every text a user sees goes through a key and its English x-default, written where the text is used. LctyT of
  lcty.v1.js keeps one frozen table per language, registered by a language script such as lcty.v1.lang-ja.js
  (LctyT.addLang), and LctyT._(key, text) returns the translation for <html lang>, matched exactly, or text when that
  language has no translation for the key. tr(key, text, vars) of js/i18n.js is what modules call: LctyT._ plus
  {name} placeholders filled from vars, so a language can order the parts its own way. localize(root) localizes
  static HTML: data-lcty-t="key" replaces an element's text, and data-lcty-t-placeholder, data-lcty-t-title and
  data-lcty-t-aria-label replace that attribute; the English written in the HTML is the x-default.

  Background:
    Given a page on the server's origin

  Scenario: An English page shows the English text
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("delete", "Delete") is called
    Then it returns "Delete"

  Scenario: A Japanese page shows the Japanese text
    Given the page's lang is "ja" and the Japanese table is loaded
    When tr("delete", "Delete") is called
    Then it returns "削除"

  Scenario: A key the language does not have shows the English text
    Given the page's lang is "ja" and the Japanese table is loaded
    When tr("noSuchKey", "No such text") is called
    Then it returns "No such text"

  Scenario Outline: A language that is not registered shows the English text
    Given the page's lang is <lang> and the Japanese table is loaded
    When tr("delete", "Delete") is called
    Then it returns "Delete"

    Examples:
      | lang                          |
      | "ja-JP" (not matched exactly) |
      | "JA" (not matched exactly)    |
      | "fr" (no table)               |
      | "" (no language)              |

  Scenario: Without the Japanese table a Japanese page shows the English text
    Given the page's lang is "ja" and no language table is loaded
    When tr("delete", "Delete") is called
    Then it returns "Delete"

  Scenario: An empty translation counts as none
    Given the page's lang is "xx" and the language "xx" has the empty text for "delete"
    When tr("delete", "Delete") is called
    Then it returns "Delete"

  Scenario: Only the table's own keys are translations
    Given the page's lang is "ja" and the Japanese table is loaded
    When tr("toString", "To string") is called
    Then it returns "To string"

  Scenario: A missing English text shows as undefined
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("noSuchKey") is called without a text
    Then it returns "undefined"

  Scenario: Placeholders are filled from vars
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("searchFailed", "Search failed: {error}", { error: "boom" }) is called
    Then it returns "Search failed: boom"

  Scenario: Placeholders are filled in the Japanese text
    Given the page's lang is "ja" and the Japanese table is loaded
    When tr("confirmDelete", "Delete \"{title}\"?", { title: "Plans" }) is called
    Then it returns "「Plans」を削除しますか？"

  Scenario: A placeholder written twice is filled twice
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("k", "{name} and {name}", { name: "x" }) is called
    Then it returns "x and x"

  Scenario: A placeholder vars does not have stays as written
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("k", "{error} at {where}", { error: "boom" }) is called
    Then it returns "boom at {where}"

  Scenario: Without vars every placeholder stays as written
    Given the page's lang is "ja" and the Japanese table is loaded
    When tr("messageCount", "{n} messages") is called
    Then it returns "{n}件"

  Scenario: Only the own properties of vars fill placeholders
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("k", "{toString} {constructor} {a}", { a: "A" }) is called
    Then it returns "{toString} {constructor} A"

  Scenario: Values that are not strings are converted to strings
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("k", "{n}|{zero}|{no}|{nothing}", { n: 3, zero: 0, no: false, nothing: null }) is called
    Then it returns "3|0|false|null"

  Scenario: A filled value is not filled again
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("k", "{a} {b}", { a: "{b}", b: "B" }) is called
    Then it returns "{b} B"

  Scenario: Only names of word characters are placeholders
    Given the page's lang is "en" and the Japanese table is loaded
    When tr("k", "{a-b} {a b} {} {a_1}", { "a-b": "x", "a b": "y", "": "z", a_1: "w" }) is called
    Then it returns "{a-b} {a b} {} w"

  Scenario: The Japanese table is frozen when registered
    Given the page's lang is "ja" and the Japanese table is loaded
    When a script sets LctyT.dicts.ja.delete to "changed"
    Then tr("delete", "Delete") still returns "削除"

  Scenario: The keys of the Japanese table are the keys of LctyTextKey
    Given the page's lang is "ja" and the Japanese table is loaded
    When the keys of LctyT.dicts.ja are compared with LctyTextKey of /c/lcty.v1.d.ts
    Then each is in the other
    And every Japanese text is a non-empty string

  Scenario: localize() replaces the text of data-lcty-t elements
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <button data-lcty-t="delete">Delete</button>
    When localize() runs
    Then the button's text is "削除"

  Scenario: localize() keeps the English written in the HTML on an English page
    Given the page's lang is "en" and the Japanese table is loaded
    And the body has <button data-lcty-t="delete">Delete</button>
    When localize() runs
    Then the button's text is "Delete"

  Scenario: localize() keeps the English written in the HTML for a key the language does not have
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <button data-lcty-t="noSuchKey">Written</button>
    When localize() runs
    Then the button's text is "Written"

  Scenario Outline: localize() replaces the attribute an element names for localization
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <input data-lcty-t-<attribute>="searchPlaceholder" <attribute>="Search conversations">
    When localize() runs
    Then the input's <attribute> is "会話を検索"
    And its text and its other attributes are unchanged

    Examples:
      | attribute   |
      | placeholder |
      | title       |
      | aria-label  |

  Scenario: localize() keeps an attribute's English for a key the language does not have
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <input data-lcty-t-title="noSuchKey" title="Written">
    When localize() runs
    Then the input's title is "Written"

  Scenario: localize() replaces the text and the attributes of one element
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <button data-lcty-t="delete" data-lcty-t-title="refreshList" title="Refresh">Delete</button>
    When localize() runs
    Then the button's text is "削除"
    And the button's title is "一覧を読み込み直す"

  Scenario: localize() leaves placeholders in the texts as they are
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <span data-lcty-t="messageCount">{n} messages</span>
    When localize() runs
    Then the span's text is "{n}件"

  Scenario: localize(root) localizes only the elements inside root
    Given the page's lang is "ja" and the Japanese table is loaded
    And the body has <div id="root"><b data-lcty-t="delete">Delete</b></div><i data-lcty-t="delete">Delete</i>
    When localize() runs on the div
    Then the text of b is "削除"
    And the text of i is still "Delete"
