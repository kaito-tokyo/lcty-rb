# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/migrate_tags.rb and TagFiles#add_all: tools/migrate_tags.rb, which moves the tag definitions
# and memory of tags.sqlite formats 1 and 2 to tag files in t/. Each Scenario is a test of the same title in
# tests/backend/migrate_tags_test.rb, whose steps are the lines below.

Feature: LCTYSP-3026 Migrating the old tags

  Chatty::MigrateTags reads the tables tags and memory of an old tags.sqlite (read-only) and writes each tag as a new
  tag file t/NNNNN-<part>.html, numbered after the largest number in t/, by the part js/tag-names.js would give its
  name. A tag whose part has a tag file already is left as it is, so running it again adds only the rest. When every
  tag was migrated, the references of conversations that are an old display name become its part. In the steps the
  old file, t/ and lcty_t.sqlite are files of the test's own.

  Background:
    Given an old tags.sqlite of format 2, an empty t/ and a TagStore of the test's own

  Scenario: Each old tag becomes a tag file with its prompt and memory
    Given the old tags "Ruby" with the prompt "be brief" and two memory items, one with a source, and "C#" with none
    When MigrateTags.migrate runs
    Then t/ has 00010-ruby.html named "Ruby" and 00020-c~23.html named "C#"
    And the first has the prompt "be brief" and the two memory items with their ids, times and source

  Scenario: The part is derived as the browser derives it
    Given the names "Ruby", "C#", "ΟΔΟΣ" and "Ａ(b)"
    When MigrateTags.part derives their parts
    Then they are "ruby", "c~23", "οδοσ" and "ａ~28b~29"

  Scenario: New tags are numbered after the tag files there are
    Given t/ has 00040-go.html
    When MigrateTags.migrate runs with the old tag "Ruby"
    Then t/ has 00040-go.html as it was and 00050-ruby.html

  Scenario: A tag whose part has a tag file is left as it is
    Given t/ has 00010-ruby.html with the prompt "new"
    When MigrateTags.migrate runs with the old tag "Ruby" with the prompt "old"
    Then "Ruby" is reported as present, and 00010-ruby.html still has the prompt "new"

  Scenario: Running it again migrates nothing twice
    Given the old tags "Ruby" and "Go" migrated once
    When MigrateTags.migrate runs again
    Then both are reported as present and t/ has the same two files

  Scenario: A name the tag editor refuses is reported and the others are migrated
    Given the old tags "a/b" and "Go"
    When MigrateTags.migrate runs
    Then "a/b" is reported as failed because of its characters, and t/ has 00010-go.html only

  Scenario: Two names with the same part migrate the first only
    Given the old tags "Ruby" and "ruby"
    When MigrateTags.migrate runs
    Then "Ruby" is migrated and "ruby" is reported as failed

  Scenario: An empty memory item is dropped and an id a tag file cannot hold is replaced
    Given the old tag "Ruby" with a memory item of blank text and one whose id is "a b"
    When MigrateTags.migrate runs
    Then 00010-ruby.html has one memory item, with a new id

  Scenario: The references of conversations become the parts
    Given conversations tagged "Ruby" and "x", and "ruby" and "Ruby"
    When MigrateTags.convert_refs runs with "Ruby" migrated to "ruby"
    Then the first has the tags "ruby" and "x" and the second "ruby"

  Scenario: TagFiles#add_all writes nothing when a part has a tag file
    Given t/ has 00010-ruby.html
    When TagFiles#add_all is given 00020-go.html and 00030-ruby.html
    Then it raises 409 and t/ has 00010-ruby.html only

  Scenario: A file of format 3 or later has nothing to migrate
    Given a tags.sqlite of format 3
    When MigrateTags.read_former reads it
    Then it returns nil

  # tools/migrate_tags.rb runs MigrateTags.main: the old tags of tags.sqlite of the data directory, then the references
  # of lcty_t.sqlite, which the server's migration then leaves without the tables tags and memory
  Scenario: tools/migrate_tags.rb migrates the tags of the data directory of LCTY_DATA_DIR
    Given tags.sqlite of format 2 in the data directory with the tag "Ruby", and a conversation tagged "Ruby"
    When tools/migrate_tags.rb is run with LCTY_DATA_DIR the directory of the test
    Then it exits with the status 0 and prints "migrate_tags: 1 migrated, 0 present already, 0 failed"
    And t/ has 00010-ruby.html and the conversation has the tag "ruby" in lcty_t.sqlite

  Scenario: tools/migrate_tags.rb refuses a file whose tables were dropped
    Given lcty_t.sqlite of format 4 in the data directory
    When tools/migrate_tags.rb is run with LCTY_DATA_DIR the directory of the test
    Then it exits with the status 1 and prints that it holds no tag definitions
