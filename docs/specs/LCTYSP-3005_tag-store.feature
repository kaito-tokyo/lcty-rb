# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/tag_store.rb (LCTYSP-0009, LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/tag_store_test.rb, whose steps are the lines below. Tag definitions and memory are tag files in t/
# (LCTYSP-3014).

Feature: LCTYSP-3005 The tag store

  Chatty::TagStore keeps the current tags of conversations, the tags a conversation was given after it was created, in a
  SQLite file, the source of truth. The tags are references (file-name parts of tag files), stored as given. A file of an
  older format is migrated, never rebuilt: format 3 drops the tables of tag definitions and memory without conversion
  and keeps conversation_tags. A newer format is refused.

  Scenario: A conversation has no current tags until they are set
    Given a new tag store
    Then the current tags of "c1" are nil

  Scenario: The current tags of a conversation are set, replaced and deleted
    Given a new tag store
    When the tags of "c1" are set to "z", "a" and "undefined-tag"
    Then the current tags of "c1" are "z", "a" and "undefined-tag" in that order
    When the tags of "c1" are set to no tags
    Then the current tags of "c1" are an empty list
    When the tags of "c1" are deleted
    Then the current tags of "c1" are nil

  Scenario: A store is kept when it is opened again
    Given a tag store with the conversation "c1" tagged "ruby"
    When the file is opened again
    Then the current tags of "c1" are "ruby"

  Scenario: A new store has format 3 and no tables of tag definitions
    Given a new tag store
    Then it has format 3
    And it has the table conversation_tags and no tables tags or memory

  Scenario: A store of format 2 loses its tag definitions and memory and keeps conversation_tags
    Given a tags file of format 2 with the tag "ruby", its memory item "m1" and the conversation "c1" tagged "ruby"
    When it is opened
    Then it has format 3
    And it has the table conversation_tags and no tables tags or memory
    And the current tags of "c1" are "ruby"

  Scenario: A store of format 1 loses its tag definitions and memory and gains conversation_tags
    Given a tags file of format 1 with the tag "ruby" and its memory item "m1"
    When it is opened
    Then it has format 3
    And it has the table conversation_tags and no tables tags or memory
    And the tags of a conversation can be set

  Scenario: A store of a newer format is refused
    Given a tags file of format 4
    Then opening it fails with "tags.sqlite has format 4, newer than this version (3); it cannot be opened"
