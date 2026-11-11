# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/convert/text-attr.js (LCTYSP-0003, "Characters XML cannot represent"). Each Scenario is a test
# of the same title in tests/unit/text-attr.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1005 Reading text strings from attributes

  A text string of a conversation file (a message's content or thinking, the system prompt) is kept byte-exact in an
  attribute. Ruby writes it as name, or, only when it has characters XML cannot represent (C0 controls other than tab,
  LF and CR, U+FFFE, U+FFFF), as name-base64: base64 of its UTF-8 bytes. textAttr(el, name) of js/convert/text-attr.js
  reads the string back, whichever form was written. name-base64 is the one read when it is there; when it is not
  base64 of valid UTF-8 the text is unreadable and textAttr returns null, as it does when neither attribute is there.
  textAttrOf(name, text) is the other way, for the elements a page appends: {name: text}, or {name-base64: …} when
  XML cannot hold the text.

  Scenario: A plain attribute is read as it is
    Given an element with data-content "Hello, <world> & \"you\"\nsecond line"
    When textAttr() reads "data-content"
    Then it returns "Hello, <world> & \"you\"\nsecond line"

  Scenario: An empty attribute is the empty string
    Given an element with data-content ""
    When textAttr() reads "data-content"
    Then it returns ""

  Scenario: An element without the attribute has no text
    Given an element without data-content or data-content-base64
    When textAttr() reads "data-content"
    Then it returns null

  Scenario Outline: The base64 form is decoded as UTF-8
    Given an element with data-content-base64 holding the UTF-8 bytes of <text>
    When textAttr() reads "data-content"
    Then it returns <text>, byte-exact

    Examples:
      | text                                          |
      | "a\u001bb" (ESC between letters)              |
      | "\u0000" (only NUL)                           |
      | "日本語\u0007" (Japanese and BEL)                |
      | "x\u{ffff}y\u{fffe}z" (U+FFFF and U+FFFE)     |
      | "🙂\u0001\t\r\n" (an emoji, SOH and spaces)    |

  Scenario: A leading byte order mark of the base64 form is kept
    Given an element with data-content-base64 holding the UTF-8 bytes of "\u{feff}\u0001x"
    When textAttr() reads "data-content"
    Then it returns "\u{feff}\u0001x", byte-exact

  Scenario: The base64 form wins over the plain one
    Given an element with data-content "plain" and data-content-base64 holding the UTF-8 bytes of "a\u001bb"
    When textAttr() reads "data-content"
    Then it returns "a\u001bb"

  Scenario: An empty base64 form is the empty string
    Given an element with data-content "plain" and data-content-base64 ""
    When textAttr() reads "data-content"
    Then it returns ""

  Scenario: Each name is read from its own attributes
    Given an element with data-content "answer" and data-thinking-base64 holding the UTF-8 bytes of "think\u0002"
    When textAttr() reads "data-content" and "data-thinking"
    Then it returns "answer" and "think\u0002"

  Scenario Outline: A base64 form that cannot be read is no text
    Given an element with data-content "plain" and data-content-base64 <value>
    When textAttr() reads "data-content"
    Then it returns null

    Examples:
      | value                                        |
      | "!!!!" (not base64)                          |
      | "abcde" (a length base64 cannot have)        |
      | "/w==" (the byte ff, not UTF-8)              |
      | "wA==" (the byte c0, an incomplete sequence) |
      | "7aCA" (ed a0 80, a surrogate in UTF-8)      |

  # The other way: a page writes the attributes of the elements it appends (js/ui/lcty-msg.js) with textAttrOf
  Scenario: textAttrOf writes a text as it is, or as base64 when XML cannot hold it, and textAttr reads it back
    When textAttrOf writes "a\u0009b" and "a\u0001b" under "data-content"
    Then the first is {"data-content": "a\u0009b"} and the second has only data-content-base64
    And textAttr reads each back as it was
