# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/convert/tail.js, the tail converter of LCTYSP-0018, which shows the tail of a reply
# streaming in until it is committed. Each Scenario is a test of the same title in tests/unit/gfm-tail.test.js (in
# Node.js) or, when it puts the nodes into a page, in tests/unit/gfm-tail.spec.js (in the browser), whose steps are the
# lines below.

Feature: LCTYSP-1027 Showing the tail of a reply

  tailNodes(text, options) reads a tail with a heuristic of its own, which shares nothing with the GFM parser, and
  gives the nodes that show it: strings, and elements as [tag, attributes, children]. drawTail(parent, nodes) makes
  parent's children those nodes, keeping each node drawn already where it is the same and appending to a text that
  grows at its end. A complete text reads as GFM reads it where the heuristic can; a tail whose last line may still
  grow shows nothing that the next characters often undo. In the steps, \n in a quoted text or in a table cell is a
  newline, \| is | and \\ is \; the HTML of the nodes is written as LCTYSP-0017's one form, and (nothing) is no
  HTML.

  Scenario Outline: A complete text reads as GFM reads it
    When <markdown> and a line end are read by tailNodes
    Then the HTML of its nodes is what gfmHtml writes of the same text

    Examples:
      | case                     | markdown                                                                |
      | a heading and inlines    | "# H\n\npara **b** *e* ~~d~~ `c` [l](https://x.org) <https://a.b>\nnext" |
      | a nested list            | "- a\n- b\n  - c"                                                       |
      | a loose list             | "- a\n\n- b"                                                            |
      | an ordered list from 3   | "3) x\n4) y"                                                            |
      | a block quote            | "> q *e*\n> r"                                                          |
      | a table                  | "\| a \| b \|\n\| :- \| -: \|\n\| 1 \| 2 \|"                            |
      | a code block             | "```js\nlet x;\n```"                                                    |
      | task list items          | "- [ ] t\n- [x] u"                                                      |
      | a suggested next message | "a <suggestion-for-user-turn>Go *on*</suggestion-for-user-turn> b"      |
      | setext headings          | "foo\n===\nbar\n---"                                                    |
      | nested emphasis          | "***x** y*"                                                             |
      | a link definition        | "[ref]: https://e.org\n\ntext"                                          |
      | character references     | "&amp; &copy; &#35; &notit;"                                            |
      | an image                 | "![alt *x*](https://e.org/i.png)"                                       |
      | extended autolinks       | "see www.e.org, https://e.org/a) and a.b@e.org."                        |

  Scenario Outline: A tail that may still grow is shown without a guess
    When <markdown> is read by tailNodes, its last line growing
    Then the HTML of its nodes is <html>

    Examples:
      | case                         | markdown                       | html                                                                                                                                              |
      | an unclosed strong           | "a **b"                        | <p>a **b</p>                                                                                                                                      |
      | an unclosed code span        | "a `b"                         | <p>a `b</p>                                                                                                                                       |
      | an unfinished link           | "[a](http"                     | <p>[a](http</p>                                                                                                                                   |
      | a reference link             | "[a][b]"                       | <p>[a][b]</p>                                                                                                                                     |
      | a table row without its rule | "\| a \| b \|\n\| -"           | <p>\| a \| b \|<br>\| -</p>                                                                                                                       |
      | a one-character underline    | "a\n-"                         | <p>a<br>-</p>                                                                                                                                     |
      | an open code block           | "```js\nlet a"                 | <div class="codeblock"><div class="codebar"><span class="lang">js</span><button type="button" class="select">Select all</button></div><pre><code data-lang="js">let a</code></pre></div> |
      | a suggestion without its end | "<suggestion-for-user-turn>Go" | <p><button type="button" class="suggestion">Go</button></p>                                                                                       |
      | a link definition            | "[a]: https://e"               | (nothing)                                                                                                                                         |

  Scenario: Every prefix of every example shows only the elements and attributes of LCTYSP-0017
    Given the 672 examples of tests/gfm/spec.txt, with → read as a tab
    When every prefix of each example is read by tailNodes
    Then the HTML of the nodes of each has only the elements and attributes of LCTYSP-0017, each closed in order

  Scenario: A long tail is read in about linear time
    When texts of 20000 repetitions of "*a ", "_a ", "`a ", "[", "<a ", "a@" and "- a\n  " are read by tailNodes
    Then it takes less than 5 seconds in all

  Scenario: Drawing again keeps the nodes that are the same
    Given a page on the server's origin
    And the module /js/convert/tail.js is imported
    When "a **b**" is drawn into an empty element, then "a **b** c"
    Then the paragraph and the strong are the same elements as before
    And the element holds <p>a <strong>b</strong> c</p>

  Scenario: An open code block grows in one text node
    Given a page on the server's origin
    And the module /js/convert/tail.js is imported
    When "```\nx" is drawn into an empty element, then "```\nxy"
    Then the code's text node is the same as before and holds "xy"

  Scenario: What differs is replaced and what is left over is removed
    Given a page on the server's origin
    And the module /js/convert/tail.js is imported
    When "# h\n\npara" is drawn into an empty element, then "para2"
    Then the element holds <p>para2</p>
