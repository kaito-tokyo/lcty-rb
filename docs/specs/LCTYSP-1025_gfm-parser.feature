# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/convert/gfm/converter.js and the modules beside it (LCTYSP-0017, "Input: GFM is the only
# grammar" and "Limits"). Each Scenario is a test of the same title in tests/unit/gfm-parser.test.js (in Node.js), whose
# steps are the lines below.

Feature: LCTYSP-1025 Parsing GitHub Flavored Markdown

  parseGfm(text, decodeName) reads a complete text with the grammar of GFM 0.29-gfm and gives its document tree: the
  blocks, and the inlines of each leaf block. It is the one reader of Markdown in the pages; what the tree is written as
  is LCTYSP-0017's output, not part of this feature. To check the reader against GFM itself, the tests write the tree as
  GFM's reference HTML (tests/unit/gfm-reference.js), the HTML the examples of the GFM spec give, and resolve named
  character references with the HTML Standard's table (tests/gfm/entities.json); a page resolves them with the
  browser's own parser.

  Background:
    Given the 672 examples of tests/gfm/spec.txt, with → read as a tab
    And named character references resolved with tests/gfm/entities.json

  Scenario: Every example of the GFM spec gives the HTML of its reference
    When each example is parsed and written as GFM's reference HTML, with an extension only when the example names it
    Then each gives the HTML of its example, byte for byte

  # The pages always make the extended autolinks; the examples outside their section are written without them
  Scenario: With the extended autolinks always on, only five examples change
    When each example is parsed with the extended autolinks on
    Then the examples that change are 610, 614, 616, 619 and 620, each a bare URL or address that becomes a link

  Scenario Outline: A pathological text is parsed in about linear time
    When a text of 100000 repetitions of <unit> is parsed
    Then it takes less than 5 seconds

    Examples:
      | text                       | unit         |
      | nested brackets            | "["          |
      | unclosed brackets          | "[a"         |
      | star runs                  | "*a"         |
      | underscore runs            | "_a_ "       |
      | backticks                  | "`a"         |
      | nested block quotes        | "> "         |
      | nested list items          | "- "         |
      | unclosed link destinations | "[]("        |
      | www autolinks              | "www.a.b "   |
      | email addresses            | "a@b.c "     |
      | lists and quotes by turns  | "- a\n> b\n" |

  Scenario: Block quotes and list items nest at most 32 deep
    When a line of 40 "> " and then "a" is parsed
    Then the document holds 32 block quotes, one in another
    And the innermost holds a paragraph of "> > > > > > > > a"

  # A BlockParser's one operation is advance: it takes the first top-level block of its head once the lines after it
  # end it, and a client pushing text into the head parses the inlines of each block as it is taken. A definition read
  # later is not known then, so the examples with one are left out.
  Scenario: A text pushed a character at a time gives, block by block, the HTML of the whole text
    When each of the 594 examples without a link reference definition is pushed a character at a time into one BlockParser, the inlines of each block its advance takes parsed at once, and the rest taken with end at the end
    Then the HTML of the blocks, one after another, is the HTML of the whole example, byte for byte

  # BlockWatch is the weak half: it says when advance is worth a try, and may say so when it is not
  Scenario: With BlockWatch deciding when to try advance, the HTML is still that of the whole text
    When each of the 594 examples is pushed a character at a time, advance tried only when BlockWatch says the head may have ended its block
    Then the HTML of the blocks, one after another, is the HTML of the whole example, byte for byte
