# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/conv_html.rb (LCTYSP-0003). Each Scenario is a test of the same title in
# tests/backend/conv_html_test.rb, whose steps are the lines below.

Feature: LCTYSP-3002 Conversation files as HTML

  Chatty::ConvHtml turns line objects (meta, title, setup, message, cmd) into a conversation file and back. The file
  starts with four head lines: the fixed header (lines 1 and 2), the title slot (line 3) and the frame <lcty-c />
  (line 4). The elements follow from line 5, one per line, as a well-formed XML fragment. Text strings live in
  attributes and are kept byte for byte, as base64 only when they hold a character XML cannot represent; any other
  string with such a character is rejected. Presentation HTML is filtered through an allowlist. Files in the head
  format before 2026-11-07 are still read, and so are files in the lcty-msg format (LCTYSP-0013), which it reads but
  never writes.

  Scenario: A document has the four head lines and then the elements
    Given a meta with the id "conv-1", the tags "ruby" and "concise", a creation time and the instructions "Be brief"
    And the title "Hello" and a user message
    When ConvHtml.document writes them
    Then line 1 is the doctype with <html lang="ja" /> and line 2 is the <head> ending with </head>
    And line 3 is the title slot of 512 bytes holding "Hello"
    And line 4 is <lcty-c id="c-conv-1" data-setup-tags="ruby concise" data-created-at="…" />
    And line 5 is the lcty-setup with data-instructions="Be brief" and line 6 is the lcty-message
    And ConvHtml.head_lines accepts the first four lines

  Scenario: A document reads back as the lines it was written from
    Given a document with a title, a meta, a user message, an assistant message and a send command
    When ConvHtml.decode reads it
    Then the first line object is the title and the second is the meta with the instructions of the lcty-setup
    And the messages and the command follow in order with every field as written
    And the message ids are read without their c-msg- prefix

  Scenario: A document needs a meta
    When ConvHtml.document is given lines without a meta
    Then it raises FormatError "a conversation needs a meta"

  Scenario: A frame without tags has no data-setup-tags
    When ConvHtml.frame_line writes a meta with no tags
    Then the line is <lcty-c id="c-…" data-created-at="…" /> and a newline
    And ConvHtml.frame_meta reads it back with the tags [] and the empty instructions

  Scenario: ConvHtml.frame_meta reads only a frame line
    Then ConvHtml.frame_meta returns nil for a line that does not start with "<lcty-c "

  Scenario Outline: A text string is kept byte for byte in a plain attribute
    Given a user message whose content is <text>
    When it is written and read back
    Then the content is the same string
    And it is written in data-content, not in data-content-base64

    Examples:
      | text                         |
      | "a\rb" (CR)                  |
      | "a\r\nb" (CRLF)              |
      | "\ta\n\nb " (tab, newlines)  |
      | "\u0085\u009f" (C1 controls) |
      | "😀 U+2028 " (emoji)    |
      | "﻿bom" (BOM)            |
      | "&#0; &amp;" (references)    |
      | "<b>\"'</b>" (markup)        |
      | "�" (U+FFFD)            |

  Scenario Outline: A text string with a character XML cannot represent is written as base64
    Given a message whose <field> holds <char>
    When it is written and read back
    Then the element has <attribute>-base64 and not <attribute>
    And the read value is the original string

    Examples:
      | field                    | char   | attribute         |
      | content of a user        | U+0000 | data-content      |
      | thinking of an assistant | ESC    | data-thinking     |
      | instructions of the meta | U+0007 | data-instructions |
      | content of an assistant  | U+FFFF | data-content      |

  Scenario: The presentation of a user message shows unwritable characters as Control Pictures
    When a user message with the content "a\u001bb\u0000" is written
    Then its div.user-text reads "a␛b␀"
    And ConvHtml.visible turns U+FFFE into U+FFFD

  Scenario: A broken base64 attribute is ignored with a warning
    Given a message element whose data-content-base64 is not valid UTF-8
    When ConvHtml.decode reads it
    Then it warns that data-content-base64 is broken
    And the content is the empty string

  Scenario: ConvHtml.check_chars! names where an unwritable character is
    When ConvHtml.check_chars! checks a line whose id holds U+0001 at index 3
    Then it raises InvalidCharError "line.id contains a character that XML cannot represent: U+0001 at 3"
    And in a meta whose second tag holds U+FFFE the path is "meta.tags[1]"

  Scenario: ConvHtml.check_chars! leaves the text strings alone
    Then ConvHtml.check_chars! accepts U+0000 in content, thinking, instructions, content_html, title and error

  Scenario: Encoding a line with an unwritable character outside the text strings is rejected
    When ConvHtml.encode is given a message whose role holds U+0002
    Then it raises InvalidCharError, which is a FormatError

  Scenario: An unknown line type cannot be encoded
    When ConvHtml.encode is given a line of the type "tags"
    Then it raises FormatError 'unknown line type: "tags"'

  Scenario Outline: A command name must be lowercase letters, digits and hyphens
    When ConvHtml.encode is given a command named <op>
    Then it raises FormatError "invalid command"

    Examples:
      | op                        |
      | "Send" (uppercase)        |
      | "" (empty)                |
      | "-send" (leading hyphen)  |
      | 33 letters (too long)     |
      | nil                       |

  Scenario: Encoded elements are well-formed XML that also reads as HTML
    When ConvHtml.encode writes a send command and an assistant message
    Then the command is <lcty-cmd data-op="send" data-at="…"></lcty-cmd>, with an explicit end tag
    And the elements are separated by single newlines and the output ends with a newline
    And the output parses as strict XML

  Scenario: Presentation HTML is filtered through the allowlist
    Given an assistant message whose content_html holds a heading, a script, an unknown element, a javascript: link and a code block
    When it is written and read back
    Then the article has data-generator="lcty.v1"
    And the script is dropped with its contents and the unknown element keeps only its contents
    And the link keeps only its allowed attributes and the code keeps data-lang
    And the content_html read back is the filtered HTML

  Scenario: Without content_html the article is empty
    When an assistant message without content_html is written and read back
    Then the article is empty and has no data-generator
    And the read message has no content_html

  Scenario: An article that the renderer did not mark is not read as content_html
    Given an assistant message whose article has no data-generator
    When ConvHtml.decode reads it
    Then the read message has no content_html

  Scenario: The JSON attributes, the error and inherited round trip
    Given an assistant message with timings, client, usage, the status "incomplete", an error holding ESC and inherited
    When it is written and read back
    Then timings, client and usage are the same objects
    And the error reads with ESC as "␛", and inherited is true
    And a message that is not inherited has no data-inherited and no inherited

  Scenario: A broken JSON attribute reads as nil
    Given a message element whose data-timings is not JSON
    When ConvHtml.decode reads it
    Then its timings are nil

  Scenario: A blank slot is a ruler of digits ending in 0
    When ConvHtml.blank_slot makes a slot of 512 bytes
    Then it is 512 digits and ends with "7890"

  Scenario: A title is written over the head of the ruler
    When ConvHtml.title_slot writes the title "A & <B>"
    Then the slot is 512 bytes starting with "A &amp; &lt;B&gt;</title><!--" and then the rest of the ruler
    And ConvHtml.slot_title reads "A & <B>" from the title line

  Scenario: Newlines and unwritable characters in a title are made visible
    When ConvHtml.title_slot writes the title " a\r\nb\u0007 "
    Then the title read back is "a b␇"

  Scenario: A long title is cut at a character boundary to fit the slot
    When ConvHtml.title_slot writes a title of 300 "あ"
    Then the slot is still 512 bytes
    And the title read back is the first 166 "あ" (498 bytes, the most that fits in 500)

  Scenario: A slot too small even for an empty title is nil
    Then ConvHtml.title_slot returns nil for a slot of 11 bytes

  Scenario Outline: ConvHtml.slot_range finds only a valid title slot
    Then ConvHtml.slot_range returns nil for <line>

    Examples:
      | line                                     |
      | a slot shorter than its id says          |
      | a slot without the "<!---->" after it    |
      | a slot that does not hold "</title><!--" |
      | a hand-written <title>                   |
      | nil                                      |

  Scenario: A hand-written title line is read as a loose title
    Given a file whose line 3 is "<title>Hand &amp; made</title>"
    When ConvHtml.decode reads it
    Then the title is "Hand & made" and the meta is read from line 4
    And ConvHtml.head_lines rejects the head

  Scenario: A file in the head format before 2026-11-07 is still read
    Given a file with the old three-line head: data-lcty-tlrange, the title slot and an unclosed <lcty-c>
    Then ConvHtml.legacy? is true and ConvHtml.head_lines is nil
    And ConvHtml.decode reads its title, its meta and the elements after the lines starting with "<!"

  Scenario: Only the first lcty-setup counts
    Given a document whose elements hold a second lcty-setup
    When ConvHtml.decode reads it
    Then the meta has the instructions of the first one
    And no setup line is returned

  Scenario: Unknown elements are skipped
    Given a document with an unknown element between two messages
    When ConvHtml.decode reads it
    Then only the two messages are returned

  Scenario: A last element broken by an interrupted write is dropped
    Given a document whose last element was cut off in the middle
    When ConvHtml.decode reads it
    Then it warns that the file is not well-formed and drops the last element
    And the complete elements before it are returned

  Scenario: A complete last element is kept when the error is elsewhere
    Given a document whose elements are all complete, followed by a stray line with a bare "&"
    When ConvHtml.decode reads it
    Then it warns that the file is not well-formed without dropping anything
    And every element is returned, the last one included

  Scenario: ConvHtml.current_title and ConvHtml.current_meta pick their lines
    Then ConvHtml.current_title returns the last title line, or nil when there is none
    And ConvHtml.current_meta returns the first meta line, or {} when there is none

  # ---- The lcty-msg format (LCTYSP-0013) ----

  Scenario: A file in the lcty-msg format is read as messages and lines of its own
    Given a file in the lcty-msg format with a system message, a user message, a thinking, a model message and an lcty-cmd
    When ConvHtml.decode reads it
    Then the user and model messages are messages of the roles user and assistant, with the bare ids
    And the system message is a system line, the thinking a thinking line and the lcty-cmd a cmd line with its bare id
    And the meta has no tags

  Scenario Outline: ConvHtml.lcty_msg? tells the lcty-msg format from the one before
    Given <file>
    Then ConvHtml.lcty_msg? is <answer>

    Examples:
      | file                                     | answer |
      | a document ConvHtml.document wrote       | false  |
      | a file of the head before 2026-11-07     | false  |
      | a file of lcty-msg elements              | true   |
      | a file with nothing after the head       | true   |
