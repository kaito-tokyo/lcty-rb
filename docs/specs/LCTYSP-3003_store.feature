# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/store.rb (LCTYSP-0003, LCTYSP-0004, LCTYSP-0009, LCTYSP-0010). Each Scenario is a test of the
# same title in tests/backend/store_test.rb, whose steps are the lines below.

Feature: LCTYSP-3003 Storing conversations and their tags

  Chatty::Store keeps every conversation as a file data/c/<id>.html and the changed tags of conversations in
  data/lcty_t.sqlite (tag definitions and memory are tag files, LCTYSP-3014). Tags are references to tag files, checked
  mechanically. A conversation is created once with its meta, then only appended to; the title is
  overwritten in its slot, and one call of pop may remove at most the last turn. Every line of a request is checked
  before anything is written, and a bad request is an HttpError with the status and message the API returns. Whole
  files are written through a temporary file and a rename, and files with an older head are rewritten at startup.

  Background:
    Given the data directory is opened with Chatty.open_data

  Scenario: Creating a conversation writes its file with the current head
    When Store.create is given a new id, the tags "ruby", the instructions "Be brief", the title "First" and a user message without an id
    Then it returns the id and data/c/<id>.html starts with the head lines of the current format
    And Store.conversation returns the meta, the title "First", the tags ["ruby"] and the message
    And the message was given a UUIDv7 id

  Scenario: Only the id, the creation time, the tags and the instructions of the meta are kept
    When Store.create is given a meta that also has "forked_from" and "backend"
    Then the meta of the conversation has only id, created_at, tags and instructions

  Scenario: A new conversation may end with a send command
    When Store.create is given a user message and a send command
    Then the last line of the file is <lcty-cmd data-op="send" …></lcty-cmd>
    And Store.conversation returns only the message

  Scenario: Creating a conversation leaves the given objects as they were
    Given a meta without tags and a user message without an id
    When Store.create is given them
    Then the meta still has no tags
    And the message still has no id

  Scenario: A conversation cannot be created twice
    Given a conversation that exists
    When Store.create is given its id again
    Then it raises HttpError 409 "already exists"

  Scenario Outline: Store.create rejects a bad request with 400 and writes nothing
    When Store.create is given <request>
    Then it raises HttpError 400 <message>
    And no file is written

    Examples:
      | request                               | message                                                                     |
      | a body that is not an object          | "body must be an object"                                                    |
      | a meta that is not an object          | "meta must be an object"                                                    |
      | the id "a b"                          | "invalid id"                                                                |
      | the tags ["x", "x"]                   | "tags must be an array of unique tag references"                                 |
      | the tag "a:b"                         | "tags must be an array of unique tag references"                                 |
      | lines that are not an array           | "lines must be an array of objects"                                         |
      | a tags line                           | 'line type not allowed: "tags"'                                             |
      | a message id that is not a UUIDv7     | 'message id must be a UUIDv7: "1234"'                                       |
      | the command "Send"                    | 'invalid command: "Send"'                                                   |
      | a content_html that is not a string   | "content_html must be a string"                                             |
      | a role holding U+0001 in the 2nd line | "lines[1].role contains a character that XML cannot represent: U+0001 at 4" |
      | a tag of the meta holding U+0001      | "tags must be an array of unique tag references"                                 |
      | a tag of the meta holding U+3000      | "tags must be an array of unique tag references"                                 |

  Scenario: Appending adds the lines at the end of the file
    Given a conversation with one user message
    When Store.append is given an assistant message and a user message without an id
    Then the file starts with exactly what it held before
    And Store.conversation returns the three messages in order
    And the appended user message was given a UUIDv7 id

  Scenario: A text with a character XML cannot represent is appended as base64
    Given a conversation
    When Store.append is given a user message whose content holds U+0000 and ESC
    Then the file holds data-content-base64 for it
    And Store.conversation returns the content byte for byte

  Scenario: Appending to a file that does not end with a newline starts a new line
    Given a conversation whose file lost its last newline
    When Store.append is given a user message
    Then the message starts on a line of its own
    And Store.conversation returns every message

  Scenario: Appending a title line overwrites the title slot
    Given a conversation titled "Old"
    When Store.append is given the title line "New"
    Then Store.conversation returns the title "New"
    And the size of the file has not changed

  Scenario: Appending a tags line changes the current tags without touching the file
    Given a conversation created with the tags "a" and "b"
    When Store.append is given the tags line ["c"]
    Then Store.conversation returns the tags ["c"]
    And the file is unchanged and still says data-setup-tags="a b"

  Scenario: Appending no lines does nothing
    Given a conversation
    When Store.append is given no lines
    Then the file is unchanged

  Scenario Outline: Store.append rejects a bad request
    Given a conversation
    When Store.append is given <request>
    Then it raises HttpError <status> <message>
    And the file is unchanged

    Examples:
      | request                                      | status | message                                                                   |
      | a message for an unknown conversation        | 404    | "not found"                                                               |
      | a tags line for an unknown conversation      | 404    | "not found"                                                               |
      | a message for the id "../x"                  | 400    | "invalid id"                                                              |
      | no lines for an unknown conversation         | 404    | "not found"                                                               |
      | no lines for the id "../x"                   | 400    | "invalid id"                                                              |
      | a command line                               | 400    | 'line type not allowed: "cmd"'                                            |
      | a meta line                                  | 400    | 'line type not allowed: "meta"'                                           |
      | a tags line whose tags are not a list        | 400    | "tags must be an array of unique tag references"                               |
      | a good line and a line with U+0001 in its at | 400    | "lines[1].at contains a character that XML cannot represent: U+0001 at 0" |

  Scenario: Setting the title overwrites the slot in place
    Given a conversation with messages
    When Store.set_title sets the title "A & <B>"
    Then only the bytes of the title slot on line 3 have changed
    And Store.conversation returns the title "A & <B>"

  Scenario: A title too long for the slot is cut to fit
    Given a conversation
    When Store.set_title sets a title of 300 "あ"
    Then Store.conversation returns the first 166 "あ"
    And the size of the file has not changed

  Scenario: Setting the title of a file without a valid slot rewrites the file
    Given a conversation whose line 3 was replaced by a hand-written <title>
    When Store.set_title sets the title "Fixed"
    Then the file has the head lines of the current format again
    And Store.conversation returns the title "Fixed" with its meta and messages

  Scenario: Setting the title of an unknown conversation is 404
    Then Store.set_title raises HttpError 404 "not found" for an unknown id

  Scenario: Pop removes the last turn
    Given a conversation with the messages user, assistant, user, assistant
    When Store.pop is given from 2, the index of the last user message
    Then Store.conversation returns the first two messages
    And the title is kept

  Scenario: Pop may remove only the reply
    Given a conversation with the messages user, assistant
    When Store.pop is given from 1
    Then Store.conversation returns only the user message

  Scenario: Pop from the end or beyond does nothing
    Given a conversation with the messages user, assistant
    When Store.pop is given from 2
    Then the file is unchanged

  Scenario: Pop may not go back more than one turn
    Given a conversation with the messages user, assistant, user, assistant
    When Store.pop is given from 1
    Then it raises HttpError 409 "can only pop the last turn (from must be >= index of the last user message)"
    And the file is unchanged
    And a conversation without user messages raises the same 409 for from 0

  Scenario Outline: Store.pop rejects a bad from or id
    Given a conversation with the messages user, assistant
    Then Store.pop raises HttpError <status> <message> for <request>

    Examples:
      | request                 | status | message                   |
      | from "1"                | 400    | "from must be an integer" |
      | from -1                 | 400    | "from must be an integer" |
      | an unknown conversation | 404    | "not found"               |

  Scenario: Store.conversation of an unknown or invalid id is an error
    Then Store.conversation raises HttpError 404 "not found" for an unknown id
    And HttpError 400 "invalid id" for an id that is not a string

  Scenario: The list summarizes every conversation, newest first
    Given two conversations, the second modified later, one with the title "Listed" and an inherited message
    When Store.list_conversations lists them
    Then the newer one comes before the older one
    And each has its id, title, created_at, updated_at_hint, the number of messages and its current tags
    And message_ids are the ids of its own user messages, not the inherited ones

  Scenario: The meta of every conversation comes from the head lines
    Given a conversation with the title "Meta", the tags "x" and "y" and two messages
    When Store.meta_all lists the meta
    Then its entry has the id, the title "Meta", created_at, updated_at_hint and setup_tags ["x", "y"]
    And tags_hint is [] and messages_hint is nil until the search index records the conversation
    And after the index records it, tags_hint and messages_hint follow the index

  Scenario: A file without the head lines is left out of the meta with a warning
    Given a conversation file that holds no head lines
    When Store.meta_all lists the meta
    Then it warns "no head lines" for that file and leaves it out

  Scenario: A file whose name is not a conversation id is skipped once with a warning
    Given a file "copy of x.html" in data/c
    When Store.conversation_paths is called twice
    Then the file is not among the paths
    And the warning is given only the first time

  Scenario: Files with an older head are rewritten at startup
    Given a conversation file in the head format before 2026-11-07, with a title, tags and a message
    When Store.migrate_heads runs
    Then the file has the head lines of the current format
    And Store.conversation returns the same title, meta, tags and message
    And the modification time of the file is kept

  Scenario: Files with the current head or without a meta are left as they are
    Given a conversation file with the current head and a file whose meta cannot be read
    When Store.migrate_heads runs
    Then neither file has changed

  Scenario: Files in the lcty-msg format are left as they are at startup
    Given a conversation file in the lcty-msg format whose head loads no language file
    When Store.migrate_heads runs
    Then the file has not changed

  Scenario: A file in the lcty-msg format is written only through /v1/rpc
    Given a conversation file in the lcty-msg format with a user message and a model message
    When a message is appended to it and the last turn is popped
    Then both are refused with 409 and the file has not changed
    And Store.conversation reads its messages
    And appending a title overwrites the slot in place and leaves the elements as they are

  Scenario: A whole file is replaced atomically
    Given a directory that does not exist yet
    When Store.write_atomic writes a file in it twice
    Then the file holds what was written last
    And no temporary file is left in the directory

  Scenario: Store.document and Store.encode_lines turn format errors into HttpError
    Then Store.document raises HttpError 500 "a conversation needs a meta" for lines without a meta
    And HttpError 400 for an id holding U+0001
    And Store.encode_lines raises HttpError 500 for an unknown line type
