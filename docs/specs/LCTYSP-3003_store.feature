# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/store.rb (LCTYSP-0003, LCTYSP-0009, LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/store_test.rb, whose steps are the lines below.

Feature: LCTYSP-3003 Reading the conversations of LCTYSP-0003

  Chatty::Store reads every conversation file data/c/<id>.html for the HTTP API, which serves reads only: one
  conversation with its meta, title, current tags and messages, and the list of them. The current tags of a
  conversation are those of data/lcty_t.sqlite once they were changed, else the tags it was created with. Nothing
  writes the format of LCTYSP-0003 any more (the pages write the format of LCTYSP-0013 through /v1/rpc), but files with
  an older head are rewritten at startup, whole, through a temporary file and a rename.

  In the steps a conversation is a file of LCTYSP-0003 with the current head that the test writes, as the HTTP API
  once wrote it.

  Background:
    Given the data directory is opened with Chatty.open_data

  Scenario: A conversation is read as its meta, title, tags and messages
    Given a conversation with the tags "ruby", the instructions "Be brief", the title "First" and a user message
    When Store.conversation reads it
    Then it returns the meta, the title "First", the tags ["ruby"] and the message

  Scenario: The current tags are those of lcty_t.sqlite once they were changed
    Given a conversation created with the tags "a" and "b"
    When its tags are changed to ["c"] in lcty_t.sqlite
    Then Store.conversation returns the tags ["c"]
    And the file still says data-setup-tags="a b"

  Scenario: Store.conversation of an unknown or invalid id is an error
    Then Store.conversation raises HttpError 404 "not found" for an unknown id
    And HttpError 400 "invalid id" for an id that is not a string

  Scenario: The list summarizes every conversation, newest first
    Given two conversations, the second modified later, one with the title "Listed" and an inherited message
    When Store.list_conversations lists them
    Then the newer one comes before the older one
    And each has its id, title, created_at, updated_at_hint, the number of messages and its current tags
    And message_ids are the ids of its own user messages, not the inherited ones

  Scenario: message_rounds pair each own message with its round
    Given a conversation of a round, an inherited question with its reply, and another round
    Then its message_rounds pair each own user message with itself and each reply with the question before it
    And a reply to an inherited question has no round

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

  Scenario: A file in the lcty-msg format is read too
    Given a conversation file in the lcty-msg format with a user message and a model message
    Then Store.conversation reads its messages

  Scenario: A whole file is replaced atomically
    Given a directory that does not exist yet
    When Store.write_atomic writes a file in it twice
    Then the file holds what was written last
    And no temporary file is left in the directory

  Scenario: Store.document turns format errors into HttpError
    Then Store.document raises HttpError 500 "a conversation needs a meta" for lines without a meta
    And HttpError 400 for an id holding U+0001
