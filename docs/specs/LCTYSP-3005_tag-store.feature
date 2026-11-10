# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/tag_store.rb (LCTYSP-0009, LCTYSP-0010, LCTYSP-0014). Each Scenario is a test of the same title
# in tests/backend/tag_store_test.rb, whose steps are the lines below. Tag definitions and memory are tag files in t/
# (LCTYSP-3014).

Feature: LCTYSP-3005 The tag store

  Chatty::TagStore keeps the current tags of conversations in a SQLite file, lcty_t.sqlite, the source of truth: the
  table t_has_many_c has one row per tag and conversation, the tag a reference (the file-name part of a tag file), each
  conversation's rows in the order its tags were given. Every change is announced through Chatty.commit as one
  t.batch.updated whose records delete the rows that went and put the rows that came. A file of an older format is
  migrated, never rebuilt: format 3 dropped the tables of tag definitions and memory without conversion, and format 4
  converts conversation_tags, a JSON array per conversation, into rows of t_has_many_c. A newer format is refused. The
  file of the layout before, tags.sqlite, is renamed to lcty_t.sqlite at startup, its format kept.

  Scenario: A conversation has no current tags until they are set
    Given a new tag store
    Then the current tags of "c1" are nil

  Scenario: The current tags of a conversation are set, replaced and removed
    Given a new tag store
    When the tags of "c1" are set to "z", "a" and "undefined-tag"
    Then the current tags of "c1" are "z", "a" and "undefined-tag" in that order
    When the tags of "c1" are set to "a" and "b"
    Then the current tags of "c1" are "a" and "b"
    When the tags of "c1" are set to no tags
    Then the current tags of "c1" are nil
    When the tags of "c1" are set to "a" and then deleted
    Then the current tags of "c1" are nil

  Scenario: Each change is announced as one t.batch.updated with the rows that went and came
    Given a new tag store whose changes are recorded through Chatty.commit
    When the tags of "c1" are set to "a" and "b", then to "b" and "c", then to the same, then deleted
    Then the changes are announced as t.batch.updated
    And their records are put a and b; delete a and put c; none; delete b and delete c

  Scenario: The rows of every conversation are listed in the order their tags were given
    Given a tag store with "c1" tagged "z" and "a", and "c2" tagged "a"
    When its rows are listed
    Then they are z of c1, a of c1 and a of c2, each only tag and cid

  Scenario: A store is kept when it is opened again
    Given a tag store with the conversation "c1" tagged "ruby"
    When the file is opened again
    Then the current tags of "c1" are "ruby"

  Scenario: A new store has format 4 and only the table t_has_many_c
    Given a new tag store
    Then it has format 4
    And it has the table t_has_many_c and no other

  Scenario: A store of format 3 has its conversation_tags converted into rows
    Given a tags file of format 3 with "c1" tagged "z" and "a", "c2" tagged with no tags, and "c3" tagged "a" twice
    When it is opened
    Then it has format 4
    And it has the table t_has_many_c and no other
    And the current tags of "c1" are "z" and "a" in that order
    And "c2" has no current tags
    And the current tags of "c3" are "a"

  Scenario: A store of format 2 loses its tag definitions and memory and keeps the tags of conversations
    Given a tags file of format 2 with the tag "ruby", its memory item "m1" and the conversation "c1" tagged "ruby"
    When it is opened
    Then it has format 4
    And it has the table t_has_many_c and no other
    And the current tags of "c1" are "ruby"

  Scenario: A store of format 1 loses its tag definitions and memory and gains t_has_many_c
    Given a tags file of format 1 with the tag "ruby" and its memory item "m1"
    When it is opened
    Then it has format 4
    And it has the table t_has_many_c and no other
    And the tags of a conversation can be set

  Scenario: A store of a newer format is refused
    Given a tags file of format 5
    Then opening it fails with "lcty_t.sqlite has format 5, newer than this version (4); it cannot be opened"

  # ---- The file of the layout before ----

  Scenario: tags.sqlite is renamed to lcty_t.sqlite at startup, keeping its tags and its format
    Given a tags.sqlite with the conversation "c1" tagged "ruby", still in its WAL, and no lcty_t.sqlite
    When TagStore.rename_former renames it
    Then it returns true, and tags.sqlite, its -wal and its -shm are gone
    And lcty_t.sqlite has format 4 and the current tags of "c1" are "ruby"

  Scenario: tags.sqlite is left as it is when lcty_t.sqlite exists
    Given a tags.sqlite with "c1" tagged "old" and a lcty_t.sqlite with "c1" tagged "new"
    When TagStore.rename_former is called
    Then it returns false, tags.sqlite is still there and the current tags of "c1" are "new"
