# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/convert/gfm/committed.js, the committed converter of LCTYSP-0018, which writes the tree of
# public/js/convert/gfm/ as the output of LCTYSP-0017. Each Scenario is a test of the same title in
# tests/unit/gfm-committed.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1026 Writing GFM as the HTML of lcty-rb

  gfmHtml(text, decodeName) parses a complete text with GFM's grammar (LCTYSP-1025) and writes it as LCTYSP-0017's
  output, an HTML string in one form; writeCommitted writes a committed block, or the whole document, into a sink, the
  same walk building either that string or DOM nodes. To check the output against GFM itself, the HTML of each example
  of the GFM spec is mapped by LCTYSP-0017's tables, element by element, where those tables only rename what GFM's
  reference writes; what LCTYSP-0017 writes in a way of its own is checked by its own examples.

  Background:
    Given the 672 examples of tests/gfm/spec.txt, with → read as a tab
    And named character references resolved with tests/gfm/entities.json

  # Mapped: code blocks get their bar, links their target and rel and no title, a link of another scheme only its
  # text, tables their wrapper, an alignment its class, <hr /> and <br /> their short form; the newlines GFM's
  # reference writes between blocks are left out
  Scenario: An example without raw HTML, images, soft line breaks or task list items gives its HTML mapped by LCTYSP-0017
    When each example whose tree has no raw HTML, image, soft line break or task list item is written by gfmHtml
    Then each gives the HTML of its example mapped by the tables of LCTYSP-0017, byte for byte
    And at least 500 examples are compared

  Scenario: Every example writes only the elements and attributes of LCTYSP-0017
    When each example is written by gfmHtml
    Then every element and attribute it writes is one that LCTYSP-0017 lists
    And every element it opens is closed in order, br and hr opening none

  Scenario Outline: What LCTYSP-0017 writes in a way of its own
    When <markdown> is written by gfmHtml
    Then it gives <html>

    Examples:
      | case                          | markdown                                | html                                                                                                                                                                                 |
      | inline raw HTML               | "<b>bold</b>"                           | <p>&lt;b&gt;bold&lt;/b&gt;</p>                                                                                                                                                       |
      | an HTML block                 | "<div>\na\n</div>"                      | <p>&lt;div&gt;<br>a<br>&lt;/div&gt;</p>                                                                                                                                              |
      | an image                      | "![alt *x*](https://e.org/i.png \"t\")" | <p><a href="https://e.org/i.png" target="_blank" rel="noopener noreferrer">alt x</a></p>                                                                                             |
      | an image of a relative URL    | "![alt](/i.png)"                        | <p>alt</p>                                                                                                                                                                           |
      | a soft line break             | "a\nb"                                  | <p>a<br>b</p>                                                                                                                                                                        |
      | a hard line break             | "a  \nb"                                | <p>a<br>b</p>                                                                                                                                                                        |
      | task list items               | "- [ ] a\n- [x] b"                      | <ul><li><span class="task">☐</span> a</li><li><span class="task done">☑</span> b</li></ul>                                                                                           |
      | a task in a loose list        | "- [x] a\n\n- b"                        | <ul><li><p><span class="task done">☑</span> a</p></li><li><p>b</p></li></ul>                                                                                                         |
      | a link's title                | "[a](http://e.org \"t\")"               | <p><a href="http://e.org" target="_blank" rel="noopener noreferrer">a</a></p>                                                                                                        |
      | a link of another scheme      | "[a](javascript:alert(1))"              | <p>a</p>                                                                                                                                                                             |
      | a relative link               | "[a](/x)"                               | <p>a</p>                                                                                                                                                                             |
      | an email autolink             | "<a@b.co>"                              | <p><a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">a@b.co</a></p>                                                                                                  |
      | an image in a link            | "[![i](http://e.org/i)](http://e.org)"  | <p><a href="http://e.org" target="_blank" rel="noopener noreferrer">i</a></p>                                                                                                        |
      | a strong inside a strong      | "****a****"                             | <p><strong>a</strong></p>                                                                                                                                                            |
      | an ordered list from 3        | "3. a"                                  | <ol start="3"><li>a</li></ol>                                                                                                                                                        |
      | a code block without info     | "```\nx\n```"                           | <div class="codeblock"><div class="codebar"><span class="lang"></span><button type="button" class="select">Select all</button></div><pre><code>x\n</code></pre></div>                |
      | a code block's language       | "```js x\na\n```"                       | <div class="codeblock"><div class="codebar"><span class="lang">js</span><button type="button" class="select">Select all</button></div><pre><code data-lang="js">a\n</code></pre></div> |
      | a thematic break              | "***"                                   | <hr>                                                                                                                                                                                 |
      | character references          | "&amp;&lt;&quot;"                       | <p>&amp;&lt;"</p>                                                                                                                                                                    |
      | a suggested next message      | "a <suggestion-for-user-turn>Tell *me*</suggestion-for-user-turn> b" | <p>a <button type="button" class="suggestion">Tell *me*</button> b</p>                                                                                    |
      | a suggestion without its end  | "<suggestion-for-user-turn>Go on\nnext"  | <p><button type="button" class="suggestion">Go on</button><br>next</p>                                                                                                               |
      | an empty suggestion           | "a <suggestion-for-user-turn></suggestion-for-user-turn>" | <p>a </p>                                                                                                                                                         |
      | a suggestion in a code span   | "`<suggestion-for-user-turn>x`"         | <p><code>&lt;suggestion-for-user-turn&gt;x</code></p>                                                                                                                                |

  Scenario: A table writes its alignments as classes, and a body only when it has rows
    When "\| a \| b \|\n\| :- \| -: \|\n\| 1 \|" and "\| a \|\n\| - \|" are written by gfmHtml
    Then the first gives a table-wrap, a head of th class="align-left" and th class="align-right", and a body whose row has an empty second cell
    And the second gives a table-wrap and a head, without a body

  Scenario: The HTML string and the DOM of a sink are the same output
    When each example is written by writeCommitted once into an HtmlSink and once into a DomSink of a document that records what it is given
    Then the DOM serialized is the HTML string, byte for byte

  Scenario: A long text is written in about linear time
    When a text of 100000 repetitions of "*a* [b](http://e.org) `c`\n" is written by gfmHtml
    Then it takes less than 5 seconds
