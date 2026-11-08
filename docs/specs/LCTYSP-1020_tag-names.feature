# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/tag-names.js (LCTYSP-0006, LCTYSP-0009). Each Scenario is a test of the same title in
# tests/unit/tag-names.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1020 Tag names, file names and references

  A tag is a file t/NNNNN-<part>.html on the server (LCTYSP-0009): NNNNN is its place in the draft order and <part> is
  derived from its display name in the browser, which does all the Unicode handling; the server only checks file names
  mechanically. js/tag-names.js holds those rules and has no imports, so js/tags.js, the search and the reorder page
  share it. tagNameError checks a display name as it will be saved (NFC, 1 to TAG_NAME_MAX code points, no character
  of the categories Z and C and none of : ; / " ' ` ~ \ |). tagPart derives the file-name part, which is also the
  reference conversations use: NFC, lowercase with the final sigma as sigma, NFC again, and the ASCII symbols
  ! # $ % & ( ) * < > ? [ ] ^ { } escaped as ~ and two hex digits. tagFileName, tagNumber and tagRef make and read
  file names (a file system may list them decomposed, so tagRef composes), tagDisplayName and sortTags look
  references up in the tag files, and assignFileNames and renumber give the tags their file names when the editor
  and the reorder page save them. tagFileOfPath reads the file name of a tag file's page (/t/NNNNN-<part>.html) from
  its URL path.

  In the steps a name such as "a" U+00A0 "b" is the strings joined with that code point, and the definitions "a",
  "b", … are the tag files "00010-a.html", "00020-b.html", … named "a", "b", ….

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

  Scenario: A file name is the number in five digits and the part
    When tagFileName makes the file names of 10 and "c~23" and of 99999 and "ruby"
    Then they are "00010-c~23.html" and "99999-ruby.html"

  Scenario: The number and the reference of a file name
    Given the tag file "00120-c~23.html"
    Then tagNumber gives 120
    And tagRef gives "c~23"

  Scenario: The reference of a decomposed file name is composed
    Given the tag file "00010-cafe" U+0301 ".html", listed decomposed
    When tagRef gives its reference
    Then it is "caf" U+00E9

  Scenario: The display name of a reference
    Given the tag files "00010-c~23.html" named "C#" and "00020-ruby.html" named "Ruby"
    Then tagDisplayName gives "C#" for "c~23" and "Ruby" for "ruby"
    And it gives "zig" for the undefined "zig"

  Scenario: References are sorted in the order of the tag files
    Given the definitions "ruby", "go" and "rust"
    When sortTags sorts "rust", "zig", "ruby", "ada" and "rust"
    Then it returns "ruby", "rust", "zig" and "ada"

  Scenario: A decomposed file name sorts its composed reference
    Given the tag files "00010-cafe" U+0301 ".html" and "00020-ruby.html"
    When sortTags sorts "ruby" and "caf" U+00E9
    Then it returns "caf" U+00E9 and "ruby"

  Scenario: A tag keeps its number and takes the part of its name
    Given the tags "00010-ruby.html" named "Ruby" with a prompt, "00020-go.html" named "Golang" and a new tag "C#"
    When assignFileNames gives them file names
    Then the files are "00010-ruby.html", "00020-golang.html" and "00030-c~23.html"
    And the names, the prompt and the other fields are kept

  Scenario: New tags are numbered after the largest number, in order
    Given a new tag "a", the tag "00050-b.html" named "b", a new tag "c" and the tag "00020-d.html" named "d"
    When assignFileNames gives them file names
    Then the files are "00060-a.html", "00050-b.html", "00070-c.html" and "00020-d.html"

  Scenario: The first new tags are numbered from 00010
    Given the new tags "a" and "b"
    When assignFileNames gives them file names
    Then the files are "00010-a.html" and "00020-b.html"

  Scenario: A new tag that would need six digits is full
    Given the tag "99990-a.html" named "a" and a new tag "b"
    When assignFileNames gives them file names
    Then it throws "full"
    And the tag "99999-a.html" named "a" alone keeps its file

  Scenario: An invalid tag keeps its file name as it is
    Given the invalid tag "00020-Broken~2A.html" named "Broken~2A", the tag "00030-a.html" named "a" and a new tag "b"
    When assignFileNames gives them file names
    Then the files are "00020-Broken~2A.html", "00030-a.html" and "00040-b.html"
    And the invalid tag is the same object

  Scenario: Renumbering numbers the tags in the given order and keeps their parts
    Given the tags "00050-go.html" named "Go", "00010-c~23.html" named "C#" and "00011-ruby.html" named "Ruby", in this order
    When renumber renumbers them
    Then the files are "00010-go.html", "00020-c~23.html" and "00030-ruby.html"
    And the names are kept

  Scenario: Renumbering composes a decomposed file name
    Given the tag "00070-cafe" U+0301 ".html" named "Café", listed decomposed
    When renumber renumbers it
    Then its file is "00010-caf" U+00E9 ".html"

  Scenario Outline: The file of a tag file's page is read from its path
    When tagFileOfPath reads the path <path>
    Then it returns <file>

    Examples:
      | case                     | path                                             | file                          |
      | an ASCII name            | "/t/00010-ruby.html"                             | "00010-ruby.html"             |
      | an escape                | "/t/00020-c~23.html"                             | "00020-c~23.html"             |
      | percent-encoded          | "/t/00030-%E6%96%99%E7%90%86.html"               | "00030-料理.html"              |
      | decomposed               | "/t/00040-cafe%CC%81.html"                       | "00040-caf" U+00E9 ".html"    |
      | below another directory  | "/site/t/00010-ruby.html"                        | "00010-ruby.html"             |
      | a broken escape          | "/t/00010-%E6.html"                              | "00010-%E6.html"              |
