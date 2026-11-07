# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/ui/markdown.js (LCTYSP-0005 "Rendering streams", LCTYSP-0003 "Presentation allowlist").
# Each Scenario is a test of the same title in tests/unit/markdown.test.js (in Node.js) or, when it puts the HTML into a
# page, in tests/unit/markdown.spec.js (in the browser), whose steps are the lines below.

Feature: LCTYSP-1014 Rendering Markdown to HTML

  The module turns Markdown into an HTML string with pure functions, on every page: renderMarkdown(src) renders a whole
  text, and for a reply that is still streaming in, scanBlocks(src, final) cuts the text into blocks and
  renderBlock(block) renders one, so a page fixes the complete blocks and redraws only the last one. fenceParts(block)
  and codeBlockHTML(lang, code) are the parts of a code block, also used to grow an unfinished one. Text is always
  escaped and only http:, https: and mailto: links are made, so the output never carries markup from the model; the
  one tag it reads is <suggestion-for-user-turn>, shown as a button. In the steps, \n in a quoted text or in a table
  cell is a newline, \| is | and \\ is \.

  Scenario Outline: A block renders as its HTML element
    When renderMarkdown renders "<markdown>"
    Then the HTML is <html>

    Examples:
      | block                                | markdown                | html                                                                           |
      | a paragraph                          | Hello\nworld            | <p>Hello<br>world</p>                                                          |
      | two paragraphs                       | one\n\ntwo              | <p>one</p><p>two</p>                                                           |
      | a level-1 heading                    | # Title                 | <h1>Title</h1>                                                                 |
      | a level-6 heading with closing marks | ###### Six ##           | <h6>Six</h6>                                                                   |
      | seven hashes                         | ####### seven           | <p>####### seven</p>                                                           |
      | a hash without a space               | #tag                    | <p>#tag</p>                                                                    |
      | a heading right after a paragraph    | para\n# head            | <p>para</p><h1>head</h1>                                                       |
      | rules                                | ---\n***\n_ _ _         | <hr><hr><hr>                                                                   |
      | a quote with blocks inside           | > quote **b**\n> - item | <blockquote><p>quote <strong>b</strong></p><ul><li>item</li></ul></blockquote> |
      | a quote's lazy line                  | > a\nlazy               | <blockquote><p>a<br>lazy</p></blockquote>                                      |
      | quotes split by a blank line         | > a\n\n> b              | <blockquote><p>a</p></blockquote><blockquote><p>b</p></blockquote>             |
      | a tight list                         | - a\n- b                | <ul><li>a</li><li>b</li></ul>                                                  |
      | a loose list                         | - a\n\n- b              | <ul><li><p>a</p></li><li><p>b</p></li></ul>                                    |
      | an ordered list                      | 1. one\n2. two          | <ol><li>one</li><li>two</li></ol>                                              |
      | an ordered list from 3               | 3. three\n4. four       | <ol start="3"><li>three</li><li>four</li></ol>                                 |
      | a parenthesis marker                 | 1) x                    | <ol><li>x</li></ol>                                                            |
      | a nested list                        | - a\n  - nested\n- b    | <ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>                          |
      | a new marker starting a new list     | - a\n1. b               | <ul><li>a</li></ul><ol><li>b</li></ol>                                         |
      | a lazy continuation of an item       | - a\nlazy               | <ul><li>a<br>lazy</li></ul>                                                    |
      | a rule ending a list                 | - a\n---                | <ul><li>a</li></ul><hr>                                                        |
      | CRLF line ends                       | line1\r\nline2          | <p>line1<br>line2</p>                                                          |

  Scenario: An empty text renders as nothing
    When renderMarkdown renders ""
    Then the HTML is empty

  Scenario Outline: Inline formatting
    When renderMarkdown renders "<markdown>"
    Then the HTML is <html>

    Examples:
      | formatting                 | markdown                       | html                                                                                                                     |
      | bold                       | **b**                          | <p><strong>b</strong></p>                                                                                                |
      | italic                     | *i*                            | <p><em>i</em></p>                                                                                                        |
      | strikethrough              | ~~d~~                          | <p><del>d</del></p>                                                                                                      |
      | inline code                | `**a**` <b>                    | <p><code>**a**</code> &lt;b&gt;</p>                                                                                      |
      | code holding a backtick    | ``a ` b``                      | <p><code>a ` b</code></p>                                                                                                |
      | code padded with spaces    | ` x `                          | <p><code>x</code></p>                                                                                                    |
      | asterisks inside words     | a*b*c 2*3*4                    | <p>a*b*c 2*3*4</p>                                                                                                       |
      | an unclosed bold           | **unclosed                     | <p>**unclosed</p>                                                                                                        |
      | a line break               | a  \nb                         | <p>a<br>b</p>                                                                                                            |
      | a link                     | [link](https://e.com/?b=1&c=2) | <p><a href="https://e.com/?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">link</a></p>                           |
      | a link with emphasis       | [**b**](https://e.com)         | <p><a href="https://e.com/" target="_blank" rel="noopener noreferrer"><strong>b</strong></a></p>                         |
      | a mailto link              | [mail](mailto:a@e.com)         | <p><a href="mailto:a@e.com" target="_blank" rel="noopener noreferrer">mail</a></p>                                       |
      | a bare URL before a period | see https://e.com/x.           | <p>see <a href="https://e.com/x" target="_blank" rel="noopener noreferrer">https://e.com/x</a>.</p>                      |
      | a bare URL in parentheses  | (https://e.com/y)              | <p>(<a href="https://e.com/y" target="_blank" rel="noopener noreferrer">https://e.com/y</a>)</p>                         |
      | a bare URL in Japanese     | 見てhttps://e.com/パス。       | <p>見て<a href="https://e.com/%E3%83%91%E3%82%B9" target="_blank" rel="noopener noreferrer">https://e.com/パス</a>。</p> |
      | bold and italic            | ***x***                        | <p><strong><em>x</em></strong></p>                                                                                       |
      | a bare URL in quotes       | say \"https://e.com\" ok       | <p>say &quot;<a href="https://e.com/" target="_blank" rel="noopener noreferrer">https://e.com</a>&quot; ok</p>           |
      | a bare URL in brackets     | <https://e.com>                | <p>&lt;<a href="https://e.com/" target="_blank" rel="noopener noreferrer">https://e.com</a>&gt;</p>                      |

  Scenario Outline: Only http, https and mailto links are made
    Given a page on the server's origin
    And the module /js/ui/markdown.js is imported
    When renderMarkdown renders "<markdown>"
    Then the HTML is <html>
    And the HTML put into a page has no element but <p> and <a>, and no attribute but href, target and rel

    Examples:
      | link                      | markdown                          | html                                                                                           |
      | a javascript: link        | [bad](javascript:alert(1))        | <p>[bad](javascript:alert(1))</p>                                                              |
      | a data: link              | [x](data:text/html,<script>)      | <p>[x](data:text/html,&lt;script&gt;)</p>                                                      |
      | a bare ftp: URL           | ftp://e.com                       | <p>ftp://e.com</p>                                                                             |
      | a quote inside a link URL | [x](https://e.com/\"onmouseover=) | <p><a href="https://e.com/%22onmouseover=" target="_blank" rel="noopener noreferrer">x</a></p> |

  Scenario: HTML in the text is escaped
    Given a page on the server's origin
    And the module /js/ui/markdown.js is imported
    When renderMarkdown renders "<script>alert(1)</script> <img src=x onerror=\"alert(1)\"> & 'a'"
    Then the HTML is <p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;a&#39;</p>
    And the HTML put into a page has no element but <p>, and the text reads as written

  Scenario Outline: A suggested next message is a button
    When renderMarkdown renders "<markdown>"
    Then the HTML is <html>

    Examples:
      | suggestion                    | markdown                                                          | html                                                                                   |
      | a closed one                  | <suggestion-for-user-turn>Tell me more</suggestion-for-user-turn> | <p><button type="button" class="suggestion">Tell me more</button></p>                  |
      | one without its closing tag   | <suggestion-for-user-turn>open\nnext                              | <p><button type="button" class="suggestion">open</button><br>next</p>                  |
      | an empty one                  | <suggestion-for-user-turn>  </suggestion-for-user-turn>           | <p></p>                                                                                |
      | one holding Markdown and HTML | <suggestion-for-user-turn>**b** <i></suggestion-for-user-turn>    | <p><button type="button" class="suggestion">**b** &lt;i&gt;</button></p>               |
      | one inside a code span        | `<suggestion-for-user-turn>x</suggestion-for-user-turn>`          | <p><code>&lt;suggestion-for-user-turn&gt;x&lt;/suggestion-for-user-turn&gt;</code></p> |

  Scenario Outline: A code block shows its language and its code as text
    Given a page on the server's origin
    And the module /js/ui/markdown.js is imported
    When renderMarkdown renders "<markdown>"
    Then the HTML put into a page is one code block with the language "<lang>" and the code "<code>"

    Examples:
      | fence                                | markdown                         | lang   | code             |
      | backticks with a language            | ```js\nconst a = 1 < 2;\n```     | js     | const a = 1 < 2; |
      | backticks without a language         | ```\nplain\n```                  |        | plain            |
      | tildes with words after the lang     | ~~~~ python extra\nx\n~~~\n~~~~  | python | x\n~~~           |
      | a fence that is never closed         | ```\nunclosed                    |        | unclosed         |
      | markup in the code                   | ```html\n<b>&amp;</b>\n```       | html   | <b>&amp;</b>     |
      | an indented fence                    | \n   ```\n   a\n    b\n   ```    |        | a\n b            |
      | a fence after a paragraph            | para\n```\ncode\n```             |        | code             |
      | a fence with a blank line in an item | - item\n  ```\n  a\n\n  b\n  ``` |        | a\n\nb           |

  Scenario: A code block's language is escaped
    When renderMarkdown renders "```<x>\n<b>\n```"
    Then the HTML is <div class="codeblock"><div class="codebar"><span class="lang">&lt;x&gt;</span><button type="button" class="select">Select all</button></div><pre><code data-lang="&lt;x&gt;">&lt;b&gt;</code></pre></div>

  Scenario: A table aligns its columns and fills missing cells
    Given a page on the server's origin
    And the module /js/ui/markdown.js is imported
    When renderMarkdown renders "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 |\n| x \\| y | z | w |"
    Then the HTML put into a page is one table inside div.table-wrap
    And its header cells are "a", "b" and "c", aligned left, center and right
    And its rows are "1", "2", "" and "x | y", "z", "w", aligned as the header

  Scenario: A table without alignment ends at a line without a pipe
    When renderMarkdown renders "a | b\n--|--\n1 | 2\ntext"
    Then the HTML is <div class="table-wrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div><p>text</p>

  Scenario: A line with pipes but no separator is a paragraph
    When renderMarkdown renders "a|b\nnot sep"
    Then the HTML is <p>a|b<br>not sep</p>

  Scenario: scanBlocks cuts a text into blocks with their kinds, offsets and lines
    When scanBlocks reads "para\n\n# h\n---\n- a\n- b\n\n> q\n```js\nx\n```\n| a |\n|---|\nlast" as final
    Then the blocks are para, heading, hr, list, quote, fence, table and para
    And the first is para from 0 to 5 with the lines "para"
    And the list is from 14 to 23 with the lines "- a", "- b" and ""
    And every block is complete

  Scenario: The last line still being written leaves its block incomplete
    When scanBlocks reads "para\n\npartial" as not final
    Then the blocks are para, complete, and para, not complete
    And read as final, both blocks are complete

  Scenario: A paragraph stays incomplete until a blank line ends it
    When scanBlocks reads "a\nb\n" as not final
    Then the blocks are para, not complete

  Scenario: A block closed by the line still being written is not complete yet
    When scanBlocks reads "para\n# h" as not final
    Then the blocks are para, not complete, and heading, not complete
    And scanBlocks reading "para\n# h\n" as not final gives both blocks complete

  Scenario Outline: A code block is complete only once its closing fence line has ended
    When scanBlocks reads "<text>" as not final
    Then the blocks are fence, <state>

    Examples:
      | text               | state        |
      | ```js\ncode\n      | not complete |
      | ```js\ncode\n```   | not complete |
      | ```js\ncode\n```\n | complete     |

  Scenario: A complete block never changes as the text grows
    Given a document with every kind of block
    When scanBlocks reads every prefix of it as not final
    Then every block marked complete has the kind, offsets and lines of the same block of the whole document

  Scenario: Rendering the blocks one by one gives the HTML of the whole text
    Given a document with every kind of block
    When renderBlock renders each block of scanBlocks
    Then the joined HTML is the HTML of renderMarkdown

  Scenario Outline: fenceParts splits a code block into its language, code and whether it is closed
    When fenceParts is given the lines <lines>
    Then the language is "<lang>", the code is "<code>" and closed is <closed>

    Examples:
      | case                              | lines                              | lang | code   | closed |
      | words after the language          | ["```js extra", "x", "```"]        | js   | x      | true   |
      | no closing fence                  | ["```", "x"]                       |      | x      | false  |
      | an indented fence                 | ["  ~~~", "  a", "    b", "  ~~~"] |      | a\n  b | true   |
      | a shorter closing fence           | ["````", "a", "```"]               |      | a\n``` | false  |
      | a closing fence of the wrong kind | ["```py", "a", "~~~"]              | py   | a\n~~~ | false  |
      | only the opening line             | ["```"]                            |      |        | false  |

  Scenario: codeBlockHTML builds the code block with a "Select all" button
    When codeBlockHTML is given the language "j\"s" and the code "a<b"
    Then the HTML is <div class="codeblock"><div class="codebar"><span class="lang">j&quot;s</span><button type="button" class="select">Select all</button></div><pre><code data-lang="j&quot;s">a&lt;b</code></pre></div>

  Scenario: codeBlockHTML without a language has no data-lang
    When codeBlockHTML is given the language "" and the code "x"
    Then the HTML is <div class="codeblock"><div class="codebar"><span class="lang"></span><button type="button" class="select">Select all</button></div><pre><code>x</code></pre></div>

  Scenario: The "Select all" button follows the page's language
    Given a page on the server's origin
    And the module /js/ui/markdown.js is imported
    Given the page is in Japanese
    When codeBlockHTML is given the language "" and the code "x"
    Then the button reads "すべて選択"

  Scenario: renderBlock renders a paragraph without <p> when tight
    When renderBlock renders the para block with the lines "a" and " b " with tight set
    Then the HTML is a<br>b

  Scenario: renderBlock renders a heading and a rule from their lines
    When renderBlock renders the heading block "## Sub #" and the hr block "***"
    Then the HTMLs are <h2>Sub</h2> and <hr>
