# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/tag_files.rb (LCTYSP-0009, "Revision: one HTML file per tag", and LCTYSP-0010). Each Scenario is
# a test of the same title in tests/backend/tag_files_test.rb, whose steps are the lines below.

Feature: LCTYSP-3014 Tag files

  Chatty::TagFiles keeps the tag definitions and their memory as one HTML file per tag in t/, named
  NNNNN-<file-name part>.html, the source of truth. Get-all reads every tag file in file-name order and parses it into
  JSON, with one ETag for the whole set. Replace-all takes the complete set, checks the file names mechanically, writes
  each file's HTML through a temporary file and a rename, and deletes the tag files left out; it needs If-Match with
  the current ETag. Add-memory appends one item to one file. Every operation takes flock on t.lock. Names are never
  normalized or rewritten.

  Scenario: A new tag directory has no tags
    Given a new tag directory
    Then get-all lists no tags
    And its ETag is a quoted SHA-256
    And the lock file t.lock exists

  Scenario: A tag is written in the tag file markup
    Given a new tag directory
    When replace-all writes the tag "C#" in "00010-c~23.html" with an add-memory policy, the prompt "# 指示" and a memory item with a source
    Then t/00010-c~23.html is the header of a conversation file, <body>, then <lcty-t data-tag="C#">
    And inside it come the <lcty-tagop>, the <lcty-system> and the <lcty-memory>, one per line, each with data-tag="C#"
    And the <lcty-memory> has the id "t-mem-" and the item id, data-at, data-source-conv, data-source-msg and data-content
    And the file ends with </lcty-t>, </body> and </html>

  Scenario: Tags are read back as they were written, in file-name order
    Given a new tag directory
    When replace-all writes "00020-b.html" and then "00010-a.html", each with a display name, an add-memory policy, a prompt and memory
    Then get-all lists "00010-a.html" and then "00020-b.html"
    And each is the same {file, name, ops, prompt, memory} as was written

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
    When replace-all writes the display name "Café" in decomposed form in "00010-café.html", also decomposed
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
    Given a new tag directory with the tag file "00010-a.html"
    And the files ".tmp-1.html", "lcty.v1.js", "notes.html", "0010-short.html" and "00020-.html" in t/
    Then get-all lists only "00010-a.html"
    And replace-all with no tags deletes only "00010-a.html"

  Scenario: A tag file without <lcty-t> is ignored with a warning
    Given a new tag directory with the tag file "00010-a.html"
    And the tag file "00020-broken.html" without <lcty-t>
    Then get-all lists only "00010-a.html" and warns about "00020-broken.html"

  Scenario: Replace-all deletes the tag files left out of the set
    Given a new tag directory with the tag files "00010-a.html", "00020-b.html" and "00030-c.html"
    When replace-all sends "00010-a.html" and "00040-d.html"
    Then t/ has the tag files "00010-a.html" and "00040-d.html"

  Scenario: Renumbering renames the files and keeps their contents
    Given a new tag directory with the tag files "00010-a.html" and "00020-b.html"
    When replace-all sends the same tags as "00010-b.html" and "00020-a.html"
    Then get-all lists "00010-b.html" and then "00020-a.html" with their contents unchanged

  Scenario: A file just written is not deleted when the directory lists it under another name
    Given a new tag directory with the tag file "00010-a.html"
    And "00010-alias.html" in t/ that is the same file as "00010-a.html"
    When replace-all sends "00010-a.html" only
    Then "00010-alias.html" is not deleted

  Scenario: The ETag follows the set
    Given a new tag directory with the tag file "00010-a.html"
    Then get-all gives the same ETag twice
    And the ETag after replace-all is the one get-all gives next
    When the file is changed by hand
    Then get-all gives another ETag
    When a tag file is added by hand
    Then get-all gives another ETag again

  Scenario Outline: Replace-all needs the current ETag in If-Match
    Given a new tag directory with the tag file "00010-a.html"
    When replace-all sends a new set with <if-match>
    Then it fails with <status> "<error>"
    And t/ still has only "00010-a.html", unchanged

    Examples:
      | if-match                           | status | error                 |
      | no If-Match                        | 428    | If-Match is required  |
      | an empty If-Match                  | 428    | If-Match is required  |
      | the ETag of an earlier set         | 412    | the tags have changed |

  Scenario Outline: If-Match is accepted in its other forms
    Given a new tag directory with the tag file "00010-a.html"
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
      | name                        | verdict                                            |
      | "00010-ruby.html"           | accepted                                           |
      | "00010-c~23.html"           | accepted                                           |
      | "99999-日本語.html"         | accepted                                           |
      | a name of 255 bytes         | accepted                                           |
      | a name of 256 bytes         | rejected: "must be at most 255 bytes"              |
      | "0010-ruby.html"            | rejected: "must be NNNNN-<name>.html"              |
      | "00010ruby.html"            | rejected: "must be NNNNN-<name>.html"              |
      | "00010-.html"               | rejected: "must be NNNNN-<name>.html"              |
      | "00010-ruby.htm"            | rejected: "must be NNNNN-<name>.html"              |
      | "０００１０-ruby.html"      | rejected: "must be NNNNN-<name>.html"              |
      | "00010-a/b.html"            | rejected: "must not contain /, \, : or NUL"        |
      | a name with a backslash     | rejected: "must not contain /, \, : or NUL"        |
      | "00010-a:b.html"            | rejected: "must not contain /, \, : or NUL"        |
      | a name with NUL             | rejected: "must not contain /, \, : or NUL"        |
      | bytes that are not UTF-8    | rejected: "must be valid UTF-8"                    |
      | a number                    | rejected: "must be a string"                       |

  Scenario Outline: A set that is not valid is rejected as a whole, writing nothing
    Given a new tag directory with the tag file "00010-a.html"
    When replace-all sends "00020-b.html" and <bad>
    Then it fails with 400 "<error>"
    And t/ still has only "00010-a.html", unchanged

    Examples:
      | bad                                         | error                                                                     |
      | the file name "bad.html"                    | invalid tag file name "bad.html": must be NNNNN-<name>.html               |
      | "00030-b.html", the same part again         | tag file names must be unique                                             |
      | a tag that is not an object                 | each tag must be an object                                                |
      | a tag without a display name                | name must be a non-empty string                                           |
      | a tag whose prompt is a number              | prompt must be a string                                                   |
      | a tag whose ops is not an array             | ops must be an array of {type, content}                                   |
      | a tag with an op type in upper case         | ops must be an array of {type, content}                                   |
      | a tag with two ops of the same type         | ops must have one entry per type                                          |
      | a memory item with a blank text             | memory must be an array of {id, text}                                     |
      | a memory item whose id has a space          | memory must be an array of {id, text}                                     |
      | a memory item whose at contains ESC         | memory[0].at contains a character that XML cannot represent: U+001B at 0  |
      | a memory item with the id of another tag's  | memory ids must be unique                                                 |

  Scenario: A body that is not a set of tags is rejected
    Given a new tag directory
    Then replace-all with an array fails with 400 "body must be {"tags": [...]}"

  Scenario: Add-memory appends an item to one tag file
    Given a new tag directory with the tag files "00010-a.html" with one memory item and "00020-b.html"
    When add-memory adds "  remember this  " with the source conversation "c1" and message "m1" to "00010-a.html"
    Then it returns an item with a UUIDv7 id, the text "remember this", the time of the request and that source
    And get-all lists the old item and then the new one under "00010-a.html"
    And "00020-b.html" is unchanged
    And the ETag has changed

  Scenario: Add-memory without a source records none
    Given a new tag directory with the tag file "00010-a.html"
    When add-memory adds "x" to "00010-a.html" with the source "nope"
    Then the item has no source

  Scenario Outline: Add-memory that cannot be done
    Given a new tag directory with the tag file "00010-a.html"
    When add-memory adds <text> to <file>
    Then it fails with <status> "<error>"
    And "00010-a.html" is unchanged

    Examples:
      | text      | file              | status | error                                                 |
      | "x"       | "00020-a.html"    | 404    | no such tag file                                      |
      | "x"       | "a.html"          | 400    | invalid tag file name: must be NNNNN-<name>.html      |
      | "   "     | "00010-a.html"    | 400    | text is required                                      |
      | a number  | "00010-a.html"    | 400    | text is required                                      |
