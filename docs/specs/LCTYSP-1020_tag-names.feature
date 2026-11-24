# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/tag-names.js (LCTYSP-0006, LCTYSP-0009). Each Scenario is a test of the same title in
# tests/unit/tag-names.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1020 Tag names, file names and references

  A tag is a file t/<part>.html on the server (LCTYSP-0009): <part> is derived from its display name in the browser,
  which does all the Unicode handling, and the order of the tags is kept inside the files; the server only checks file
  names mechanically. js/tag-names.js holds those rules and has no imports, so js/tags.js, the search and the reorder
  page share it. tagNameError checks a display name as it will be saved (NFC, 1 to TAG_NAME_MAX code points, no
  character of the categories Z and C and none of : ; / " ' ` ~ \ |, and a part that is not reserved: index, or one
  starting with . or lcty.v1). tagPart derives the file-name part, which is also the reference conversations use:
  NFC, lowercase with the final sigma as sigma, NFC again, and the ASCII symbols ! # $ % & ( ) * < > ? [ ] ^ { }
  escaped as ~ and two hex digits. tagFileName and tagRef make and read file names (a file system may list them
  decomposed, so tagRef composes), tagDisplayName and sortTags look references up in the tag files, and
  assignFileNames gives the tags their file names when the editor saves them. tagFileOfPath reads the file name of a
  tag file's page (/t/<part>.html) from its URL path.

  In the steps a name such as "a" U+00A0 "b" is the strings joined with that code point, and the definitions "a",
  "b", … are the tag files "a.html", "b.html", … named "a", "b", …, in that order.

  Scenario: The longest display name is 40 code points
    Then TAG_NAME_MAX is 40

  Scenario Outline: A display name that can be used
    When tagNameError checks <name>
    Then it returns null

    Examples:
      | case                    | name                  |
      | a plain name            | "Ruby"                |
      | Japanese                | "日本語"               |
      | an escaped symbol       | "C#"                  |
      | a percent sign          | "100%"                |
      | an emoji                | "🦀"                  |
      | 40 astral characters    | 40 times "𝒳"          |
      | 40 decomposed letters   | 40 times "e" U+0301   |
      | index at the start      | "indexes"             |
      | index after a dot       | "my.index"            |

  Scenario Outline: A display name of the wrong length
    When tagNameError checks <name>
    Then it returns "length"

    Examples:
      | case                    | name                  |
      | empty                   | ""                    |
      | 41 code points          | 41 times "x"          |
      | 41 astral characters    | 41 times "𝒳"          |
      | 41 decomposed letters   | 41 times "e" U+0301   |

  Scenario Outline: A display name with a forbidden character
    When tagNameError checks <name>
    Then it returns "character"

    Examples:
      | case                     | name               |
      | a space                  | "a b"              |
      | only a space             | " "                |
      | a no-break space         | "a" U+00A0 "b"     |
      | an ideographic space     | "a" U+3000 "b"     |
      | a line separator         | "a" U+2028 "b"     |
      | a tab                    | "a" U+0009 "b"     |
      | a control character      | "a" U+0007 "b"     |
      | a zero width joiner      | "a" U+200D "b"     |
      | a private use character  | "a" U+E000 "b"     |
      | a lone surrogate         | "a" U+D800 "b"     |
      | an unassigned code point | "a" U+0378 "b"     |
      | a colon                  | "a:b"              |
      | a semicolon              | "a;b"              |
      | a slash                  | "a/b"              |
      | a double quote           | "a" U+0022 "b"     |
      | a single quote           | "a'b"              |
      | a backquote              | "a`b"              |
      | a tilde                  | "a~b"              |
      | a backslash              | "a\b"              |
      | a vertical bar           | "a\|b"             |

  Scenario Outline: A reserved display name
    When tagNameError checks <name>
    Then it returns "reserved"

    Examples:
      | case                     | name               |
      | the reorder page         | "index"            |
      | index in upper case      | "Index"            |
      | a leading dot            | ".net"             |
      | the frame's prefix       | "lcty.v1x"         |

  Scenario Outline: The file-name part of a display name
    When tagPart derives the part of <name>
    Then it is <part>

    Examples:
      | case                      | name                | part                                              |
      | upper case                | "Ruby"              | "ruby"                                            |
      | a number sign             | "C#"                | "c~23"                                            |
      | a percent sign            | "100%"              | "100~25"                                          |
      | every escaped symbol      | "!#$%&()*<>?[]^{}"  | "~21~23~24~25~26~28~29~2a~3c~3e~3f~5b~5d~5e~7b~7d" |
      | other ASCII               | "a-b.c_d+e@f=g,h"   | "a-b.c_d+e@f=g,h"                                 |
      | a capital final sigma     | "ΟΔΟΣ"              | "οδοσ"                                            |
      | a written final sigma     | "οδος"              | "οδοσ"                                            |
      | a decomposed letter       | "Cafe" U+0301       | "caf" U+00E9                                      |
      | Japanese                  | "日本語"             | "日本語"                                           |
      | a capital dotted I        | "İ"                 | "i" U+0307                                        |

  Scenario: The part of a part is the same part
    Given the display names "Ruby", "C#", "100%", "!#$%&()*<>?[]^{}", "ΟΔΟΣ", "Cafe" U+0301 and "İ"
    When tagPart derives the part of each and then the part of that part
    Then the second part is the first one each time

  Scenario: A file name is the part and .html
    When tagFileName makes the file names of "c~23" and of "ruby"
    Then they are "c~23.html" and "ruby.html"

  Scenario: The reference of a file name
    Given the tag file "c~23.html"
    Then tagRef gives "c~23"

  Scenario: The reference of a decomposed file name is composed
    Given the tag file "cafe" U+0301 ".html", listed decomposed
    When tagRef gives its reference
    Then it is "caf" U+00E9

  Scenario: The display name of a reference
    Given the tag files "c~23.html" named "C#" and "ruby.html" named "Ruby"
    Then tagDisplayName gives "C#" for "c~23" and "Ruby" for "ruby"
    And it gives "zig" for the undefined "zig"

  Scenario: References are sorted in the order of the tag files
    Given the definitions "ruby", "go" and "rust"
    When sortTags sorts "rust", "zig", "ruby", "ada" and "rust"
    Then it returns "ruby", "rust", "zig" and "ada"

  Scenario: A decomposed file name sorts its composed reference
    Given the tag files "cafe" U+0301 ".html" and "ruby.html"
    When sortTags sorts "ruby" and "caf" U+00E9
    Then it returns "caf" U+00E9 and "ruby"

  Scenario: A tag takes the part of its name as its file
    Given the tags "ruby.html" named "Ruby" with a prompt, "go.html" named "Go" and a new tag "C#"
    When assignFileNames gives them file names
    Then the files are "ruby.html", "go.html" and "c~23.html"
    And the names, the prompt and the other fields are kept

  Scenario: A renamed tag takes its new part's file and an invalid tag keeps its own
    Given the invalid tag "Broken~2A.html" named "Broken~2A", the tag "go.html" renamed "Golang" and a new tag "b"
    When assignFileNames gives them file names
    Then the files are "Broken~2A.html", "golang.html" and "b.html", in the same order
    And the invalid tag is the same object

  Scenario: A decomposed name takes a composed file name
    Given a new tag named "Cafe" U+0301
    When assignFileNames gives it a file name
    Then its file is "caf" U+00E9 ".html"

  Scenario Outline: The file of a tag file's page is read from its path
    When tagFileOfPath reads the path <path>
    Then it returns <file>

    Examples:
      | case                     | path                                       | file                    |
      | an ASCII name            | "/t/ruby.html"                             | "ruby.html"             |
      | an escape                | "/t/c~23.html"                             | "c~23.html"             |
      | percent-encoded          | "/t/%E6%96%99%E7%90%86.html"               | "料理.html"              |
      | decomposed               | "/t/cafe%CC%81.html"                       | "caf" U+00E9 ".html"    |
      | below another directory  | "/site/t/ruby.html"                        | "ruby.html"             |
      | a broken escape          | "/t/%E6.html"                              | "%E6.html"              |
