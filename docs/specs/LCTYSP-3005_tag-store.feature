# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/tag_store.rb (LCTYSP-0009, LCTYSP-0010). Each Scenario is a test of the same title in
# tests/backend/tag_store_test.rb, whose steps are the lines below.

Feature: LCTYSP-3005 The tag store

  Chatty::TagStore keeps the tag definitions, their memory and the current tags of conversations in a SQLite file, the
  source of truth. all lists the tags in their order with their memory, replace_all saves the whole tag editor in one
  transaction (renames included), add_memory, edit_memory and delete_memory change one memory item of a defined tag,
  and conversation_tags keeps the tags a conversation was given after it was created. A file of an older format is
  migrated, never rebuilt, and a newer one is refused.

  Scenario: A new store is empty
    Given a new tag store
    Then it is empty
    And all lists no tags

  Scenario: Saved tags are listed in the order given
    Given a new tag store
    When the tags "ruby" with the prompt "Use Ruby 2.6" and "notes" without a prompt are saved
    Then the store is not empty
    And all lists "ruby" and then "notes", with their prompts and no memory
    When they are saved again as "notes" and then "ruby"
    Then all lists "notes" and then "ruby"

  Scenario: Saving memory keeps its time and source, and gives a time to an item without one
    Given a new tag store
    When the tag "ruby" is saved with an item that has a time and a source, and an item without a time
    Then all lists both items of "ruby" in the order of their times
    And the first keeps its time and its source
    And the second has a time of now and no source

  Scenario: Renaming a tag in the editor moves its memory
    Given a tag store with the tag "ruby" and its memory item "m1"
    When the tags are saved with "ruby" renamed to "rb" and the same item
    Then all lists only "rb", with the item "m1" and its text

  Scenario: Tags and items left out of the editor are deleted
    Given a tag store with the tag "a" with the items "a1" and "a2", and the tag "b" with the item "b1"
    When the tags are saved with only "a" and its item "a1"
    Then all lists only "a" with only "a1"
    And the item "b1" can no longer be edited under "b"

  Scenario: Saving no tags empties the store
    Given a tag store with the tag "ruby"
    When no tags are saved
    Then it is empty

  Scenario: Memory added to a tag is listed with an id, a time and its source
    Given a tag store with the tag "ruby"
    When the memory "WEBrick paths are ASCII-8BIT" is added to "ruby" from the conversation "c1" and the message "m1"
    Then the new item has an id of "mem-" and 12 hex digits, the text and a time of now
    And its source is the conversation "c1" and the message "m1"
    And all lists it under "ruby"

  Scenario: Memory added without a source has no source
    Given a tag store with the tag "ruby"
    When the memory "no source" is added to "ruby" without a source
    Then the new item has no source
    And all lists it without a source

  Scenario: Memory cannot be added to an undefined tag
    Given a new tag store
    Then adding memory to "missing" fails with 404 "no such tag"
    And the store stays empty

  Scenario: A memory item is edited in place
    Given a tag store with the tag "ruby" and a memory item added to it
    When its text is edited to "edited"
    Then the result has its id, the text "edited" and its time
    And all lists it with the text "edited"

  Scenario: Editing memory fails for an undefined tag or an item of another tag
    Given a tag store with the tags "a" and "b" and a memory item added to "a"
    Then editing the item under "missing" fails with 404 "no such tag"
    And editing the item under "b" fails with 404 "no such memory item"
    And editing an unknown id under "a" fails with 404 "no such memory item"
    And the item keeps its text

  Scenario: A memory item is deleted
    Given a tag store with the tag "ruby" and two memory items added to it
    When the first is deleted
    Then all lists only the second under "ruby"

  Scenario: Deleting memory fails for an undefined tag, an unknown item, and an item of another tag
    Given a tag store with the tags "a" and "b" and a memory item added to "a"
    Then deleting the item under "missing" fails with 404 "no such tag"
    And deleting an unknown id under "a" fails with 404 "no such memory item"
    And deleting the item under "b" fails with 404 "no such memory item" and leaves it under "a"

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

  Scenario: Deleting a tag definition keeps it on conversations
    Given a tag store with the tag "ruby" and the conversation "c1" tagged "ruby"
    When no tags are saved
    Then the current tags of "c1" are still "ruby"

  Scenario: A store is kept when it is opened again
    Given a tag store with the tag "ruby", a memory item and the conversation "c1" tagged "ruby"
    When the file is opened again
    Then all lists "ruby" with its memory item
    And the current tags of "c1" are "ruby"

  Scenario: A store of format 1 is migrated without losing data
    Given a tags file of format 1 with the tag "ruby" and its memory item "m1"
    When it is opened
    Then it has format 2
    And all lists "ruby" with the item "m1"
    And the tags of a conversation can be set

  Scenario: A store of a newer format is refused
    Given a tags file of format 3
    Then opening it fails with "tags.sqlite has format 3, newer than this version (2); it cannot be opened"
