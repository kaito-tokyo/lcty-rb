# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/tag_files.rb (LCTYSP-0009, "Revision: one HTML file per tag", and LCTYSP-0010). Each Scenario is
# a test of the same title in tests/backend/tag_files_test.rb, whose steps are the lines below.

Feature: LCTYSP-3014 Tag files

  Chatty::TagFiles keeps the tag definitions and their memory as one HTML file per tag in t/, named
  <file-name part>.html, the source of truth. The order of the tags is inside the files, as data-order on <lcty-t>.
  Get-all reads every tag file and parses it into JSON, in the order of data-order (the files without one last, ties
  by file name), with one ETag for the whole set. Replace-all takes the complete set, checks the file names
  mechanically, writes each file's HTML, with data-order from its place in the set, through a temporary file and a
  rename, and deletes the tag files left out; it needs If-Match with the current ETag. Add-memory appends one item to
  one file. Every operation takes flock on t.lock. Names are never normalized or rewritten. A tag file without <lcty-t>
  is listed as invalid, named after its file name; replace-all keeps it as it is when it is sent back as invalid, and
  add-memory refuses it. Opening a tag directory renames the tag files of the old form NNNNN-<part>.html to
  <part>.html, the number kept as data-order.

  Scenario: A new tag directory has no tags
    Given a new tag directory
    Then get-all lists no tags
    And its ETag is a quoted SHA-256
    And the lock file t.lock exists

  Scenario: A tag is written in the tag file markup
    Given a new tag directory
    When replace-all writes the tag "C#" in "c~23.html" with an add-memory policy, the prompt "# 指示" and a memory item with a source
    Then t/c~23.html is the header of a conversation file, <body>, then <lcty-t data-tag="C#" data-order="10">
    And inside it come the <lcty-tagop>, the <lcty-system> and the <lcty-memory>, one per line, each with data-tag="C#"
    And the <lcty-memory> has the id "t-mem-" and the item id, data-at, data-source-conv, data-source-msg and data-content
    And the file ends with </lcty-t>, </body> and </html>

  Scenario: Tags are read back as they were written, in the order sent
    Given a new tag directory
    When replace-all writes "b.html" and then "a.html", each with a display name, an add-memory policy, a prompt and memory
    Then t/b.html has data-order="10" and t/a.html has data-order="20"
    And get-all lists "b.html" and then "a.html"
    And each is the same {file, name, ops, prompt, memory} as was written, with the order 10 and 20
    And each has the keys file, name, order, ops, prompt and memory, in this order

  Scenario: Get-all lists the tags by data-order, the tag files without one last
    Given a new tag directory with the tag files "a.html" and "b.html"
    And the tag file "c.html" made by hand with data-order="5"
    And the tag file "d.html" made by hand without data-order and "e.html" with data-order="x"
    And the tag file "broken.html" without <lcty-t>
    Then get-all lists "c.html", "a.html", "b.html", "broken.html", "d.html" and then "e.html"
    And "c.html", "a.html" and "b.html" have the order 5, 10 and 20, and the others the order null

  Scenario: Replace-all ignores an order sent with a tag
    Given a new tag directory
    When replace-all writes "a.html" with the order 999 and then "b.html" with the order 1
    Then get-all lists "a.html" with the order 10 and then "b.html" with the order 20

  Scenario: A tag without a prompt, policies or memory
    Given a new tag directory
    When replace-all writes the tag "empty" with no prompt, no ops and no memory
    Then its file has <lcty-t> with nothing inside
    And get-all lists it with the prompt "", no ops and no memory

  Scenario: Text that XML cannot hold is written as base64 and read back exactly
    Given a new tag directory
    When replace-all writes a tag whose prompt, policy and memory text contain ESC and whose display name contains U+FFFF
    Then the file has data-content-base64 and data-tag-base64 instead of data-content and data-tag
    And get-all returns the strings exactly

  Scenario: Names are written as they were sent, without normalization
    Given a new tag directory
    When replace-all writes the display name "Café" in decomposed form in "café.html", also decomposed
    Then t/ has a tag file whose name is exactly the bytes sent
    And get-all returns the display name exactly as sent

  Scenario: A memory item without a time gets the current time; one with a time keeps it
    Given a new tag directory
    When replace-all writes a tag with an item without "at" and an item with the "at" "2026-01-01T00:00:00Z"
    Then get-all gives the first item the time of the request and the second "2026-01-01T00:00:00Z"

  Scenario: Unknown operation types are ignored when read and not written
    Given a new tag directory
    When replace-all writes a tag with the ops "add-memory" and "x-unknown"
    Then its file has only the <lcty-tagop> of "add-memory"
    When a <lcty-tagop data-type="x-other"> is added to the file by hand
    Then get-all lists only the "add-memory" policy

  Scenario: Files that are not tag files are ignored
    Given a new tag directory with the tag file "a.html"
    And the files ".tmp-1.html", "lcty.v1.js", "lcty.v1.x.html", "index.html" and "ruby.htm" in t/
    Then get-all lists only "a.html"
    And replace-all with no tags deletes only "a.html"

  Scenario: A tag file without <lcty-t> is listed as invalid, with a warning
    Given a new tag directory with the tag file "a.html"
    And the tag file "c~23~2a.html" without <lcty-t>
    Then get-all lists "a.html" and then "c~23~2a.html", and warns about "c~23~2a.html"
    And the second is named "c#*", with the order null, no ops, the prompt "", no memory and invalid true
    And the first has no invalid

  Scenario Outline: The name of a tag file without <lcty-t> is its part with the escapes undone
    Then the part <part> gives the name <name>

    Examples:
      | part                                               | name                 |
      | "ruby"                                             | "ruby"               |
      | "c~23"                                             | "c#"                 |
      | "~21~23~24~25~26~28~29~2a~3c~3e~3f~5b~5d~5e~7b~7d" | "!#$%&()*<>?[]^{}"   |
      | "a~7e~20"                                          | "a~7e~20"            |
      | "a~2A"                                             | "a~2A"               |
      | "日本語"                                           | "日本語"             |

  Scenario: Replace-all keeps a tag file sent back as invalid
    Given a new tag directory with the tag file "a.html" and the tag file "broken.html" without <lcty-t>
    When replace-all sends "a.html" with the prompt "new" and "broken.html" as invalid, with another name and a prompt
    Then "broken.html" is unchanged
    And get-all lists "a.html" with the prompt "new"

  Scenario: A tag file kept as invalid takes no place in the order
    Given a new tag directory with the tag file "a.html" and the tag file "broken.html" without <lcty-t>
    When replace-all sends "broken.html" as invalid, then "b.html" and "a.html"
    Then t/b.html has data-order="10" and t/a.html has data-order="20"
    And "broken.html" is unchanged

  Scenario: Replace-all deletes a tag file without <lcty-t> left out of the set
    Given a new tag directory with the tag file "a.html" and the tag file "broken.html" without <lcty-t>
    When replace-all sends "a.html" only
    Then t/ has only the tag file "a.html"

  Scenario Outline: Only a tag file without <lcty-t> is kept as invalid
    Given a new tag directory with the tag file "a.html" and the tag file "broken.html" without <lcty-t>
    When replace-all sends "broken.html" as invalid and <file> as invalid
    Then it fails with 400 "only a tag file that cannot be read is kept as it is: <file>"
    And t/ is unchanged

    Examples:
      | file     |
      | "a.html" |
      | "c.html" |

  Scenario: No tag is written over a tag file kept as invalid
    Given a new tag directory with the tag file "broken.html" without <lcty-t>
    And "alias.html" in t/ that is the same file as "broken.html"
    When replace-all sends "broken.html" as invalid and a tag in "alias.html"
    Then it fails with 400 "the tag file "alias.html" cannot be read, so it cannot be overwritten"
    And t/ is unchanged

  Scenario: Replace-all deletes the tag files left out of the set
    Given a new tag directory with the tag files "a.html", "b.html" and "c.html"
    When replace-all sends "a.html" and "d.html"
    Then t/ has the tag files "a.html" and "d.html"

  Scenario: Replace-all with the tags in a new order rewrites data-order and keeps the file names
    Given a new tag directory with the tag files "a.html" and "b.html"
    When replace-all sends the same tags in the order "b.html", "a.html"
    Then get-all lists "b.html" with the order 10 and then "a.html" with the order 20, their contents unchanged
    And t/ still has the tag files "a.html" and "b.html"

  Scenario: A file just written is not deleted when the directory lists it under another name
    Given a new tag directory with the tag file "a.html"
    And "alias.html" in t/ that is the same file as "a.html"
    When replace-all sends "a.html" only
    Then "alias.html" is not deleted

  Scenario: The ETag follows the set
    Given a new tag directory with the tag file "a.html"
    Then get-all gives the same ETag twice
    And the ETag after replace-all is the one get-all gives next
    When the file is changed by hand
    Then get-all gives another ETag
    When a tag file is added by hand
    Then get-all gives another ETag again

  Scenario Outline: Replace-all needs the current ETag in If-Match
    Given a new tag directory with the tag file "a.html"
    When replace-all sends a new set with <if-match>
    Then it fails with <status> "<error>"
    And t/ still has only "a.html", unchanged

    Examples:
      | if-match                           | status | error                 |
      | no If-Match                        | 428    | If-Match is required  |
      | an empty If-Match                  | 428    | If-Match is required  |
      | the ETag of an earlier set         | 412    | the tags have changed |

  Scenario Outline: If-Match is accepted in its other forms
    Given a new tag directory with the tag file "a.html"
    When replace-all sends a new set with <if-match>
    Then it succeeds

    Examples:
      | if-match                                    |
      | "*"                                         |
      | the ETag in a list with an older one        |
      | the ETag as a weak validator                |

  Scenario Outline: File names are checked mechanically
    Then the file name <name> is <verdict>

    Examples:
      | name                        | verdict                                                                                |
      | "ruby.html"                 | accepted                                                                               |
      | "c~23.html"                 | accepted                                                                               |
      | "日本語.html"               | accepted                                                                               |
      | "00010-ruby.html"           | accepted                                                                               |
      | a name of 255 bytes         | accepted                                                                               |
      | a name of 256 bytes         | rejected: "must be at most 255 bytes"                                                  |
      | "index.html"                | rejected: "must be <name>.html, not index.html, and not start with . or lcty.v1"       |
      | ".hidden.html"              | rejected: "must be <name>.html, not index.html, and not start with . or lcty.v1"       |
      | ".html"                     | rejected: "must be <name>.html, not index.html, and not start with . or lcty.v1"       |
      | "lcty.v1.js.html"           | rejected: "must be <name>.html, not index.html, and not start with . or lcty.v1"       |
      | "ruby.htm"                  | rejected: "must be <name>.html, not index.html, and not start with . or lcty.v1"       |
      | "a/b.html"                  | rejected: "must not contain /, \, : or NUL"                                            |
      | a name with a backslash     | rejected: "must not contain /, \, : or NUL"                                            |
      | "a:b.html"                  | rejected: "must not contain /, \, : or NUL"                                            |
      | a name with NUL             | rejected: "must not contain /, \, : or NUL"                                            |
      | bytes that are not UTF-8    | rejected: "must be valid UTF-8"                                                        |
      | a number                    | rejected: "must be a string"                                                           |

  Scenario Outline: A set that is not valid is rejected as a whole, writing nothing
    Given a new tag directory with the tag file "a.html"
    When replace-all sends "b.html" and <bad>
    Then it fails with 400 "<error>"
    And t/ still has only "a.html", unchanged

    Examples:
      | bad                                         | error                                                                                                      |
      | the file name "index.html"                  | invalid tag file name "index.html": must be <name>.html, not index.html, and not start with . or lcty.v1    |
      | "b.html" again                              | tag file names must be unique                                                                              |
      | a tag that is not an object                 | each tag must be an object                                                                                 |
      | a tag without a display name                | name must be a non-empty string                                                                            |
      | a tag whose prompt is a number              | prompt must be a string                                                                                    |
      | a tag whose ops is not an array             | ops must be an array of {type, content}                                                                    |
      | a tag with an op type in upper case         | ops must be an array of {type, content}                                                                    |
      | a tag with two ops of the same type         | ops must have one entry per type                                                                           |
      | a memory item with a blank text             | memory must be an array of {id, text}                                                                      |
      | a memory item whose id has a space          | memory must be an array of {id, text}                                                                      |
      | a memory item whose at contains ESC         | memory[0].at contains a character that XML cannot represent: U+001B at 0                                   |
      | a memory item with the id of another tag's  | memory ids must be unique                                                                                  |

  Scenario: A body that is not a set of tags is rejected
    Given a new tag directory
    Then replace-all with an array fails with 400 "body must be {"tags": [...]}"

  Scenario: Add-memory appends an item to one tag file
    Given a new tag directory with the tag files "a.html" with one memory item and "b.html"
    When add-memory adds "  remember this  " with the source conversation "c1" and message "m1" to "a.html"
    Then it returns an item with a UUIDv7 id, the text "remember this", the time of the request and that source
    And get-all lists the old item and then the new one under "a.html"
    And "b.html" is unchanged
    And the ETag has changed

  Scenario: Add-memory keeps the order of the tag
    Given a new tag directory with the tag files "a.html" and "b.html"
    And the data-order of "b.html" changed by hand to "5"
    When add-memory adds "x" to "b.html"
    Then t/b.html still has data-order="5"
    And get-all lists "b.html" and then "a.html"

  Scenario: Add-memory without a source records none
    Given a new tag directory with the tag file "a.html"
    When add-memory adds "x" to "a.html" with the source "nope"
    Then the item has no source

  Scenario Outline: Add-memory that cannot be done
    Given a new tag directory with the tag file "a.html"
    When add-memory adds <text> to <file>
    Then it fails with <status> "<error>"
    And "a.html" is unchanged

    Examples:
      | text      | file            | status | error                                                                                       |
      | "x"       | "b.html"        | 404    | no such tag file                                                                            |
      | "x"       | "index.html"    | 400    | invalid tag file name: must be <name>.html, not index.html, and not start with . or lcty.v1 |
      | "   "     | "a.html"        | 400    | text is required                                                                            |
      | a number  | "a.html"        | 400    | text is required                                                                            |

  Scenario: Add-memory refuses a tag file without <lcty-t>
    Given a new tag directory with the tag file "broken.html" without <lcty-t>
    When add-memory adds "x" to "broken.html"
    Then it fails with 409 "the tag file cannot be read"
    And "broken.html" is unchanged

  Scenario: The tag files of the old form are renamed when the tag directory is opened, the number kept as data-order
    Given a tag directory with "00020-a.html" and "00010-b.html" made by hand with <lcty-t> and no data-order
    When the tag directory is opened
    Then t/ has the tag files "a.html" and "b.html" and no file of the old form
    And t/a.html has data-order="20" and t/b.html has data-order="10", their tags otherwise unchanged
    And get-all lists "b.html" and then "a.html"

  Scenario: A tag file of the old form without <lcty-t> is only renamed
    Given a tag directory with "00010-broken.html" without <lcty-t>
    When the tag directory is opened
    Then t/ has "broken.html" with the same contents, and no "00010-broken.html"
    And get-all lists "broken.html" with the order null

  Scenario Outline: A tag file of the old form that cannot be renamed stays, with a warning
    Given a tag directory with <old> made by hand with <lcty-t> and <other>
    When the tag directory is opened
    Then it warns about <old>
    And t/ is unchanged

    Examples:
      | old                | other                     |
      | "00010-a.html"     | "a.html" already there    |
      | "00010-index.html" | nothing else              |
