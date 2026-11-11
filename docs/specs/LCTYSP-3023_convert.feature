# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/convert_c.rb and lib/c_store.rb: tools/convert.rb, which converts the conversation files of c/
# from LCTYSP-0003 to LCTYSP-0013 (Moving existing files). Each Scenario is a test of the same title in
# tests/backend/convert_c_test.rb, whose steps are the lines below.

Feature: LCTYSP-3023 Converting the conversation files

  Chatty::ConvertC.run converts every file of c/ in the format of LCTYSP-0003, once, by hand, with the server stopped.
  The tags at creation go to lcty_t.sqlite, the stats of the replies to lcty_c.sqlite, the file as it was is copied to
  c-former/, and the file is replaced by its conversion with its modification time kept. Every element is checked and
  written by the code of /v1/rpc. In the steps the files are in a directory of the test's own, and lcty_t.sqlite and
  lcty_c.sqlite are files of its own too.

  Background:
    Given a directory of conversations, a TagStore and a CStore of the test's own

  Scenario: Every element is converted into one /v1/rpc could have written
    Given a file with a title, the instructions "be brief", a user message, a reply with a thinking and a presentation, and a send command
    When ConvertC.run converts it
    Then it is reported as converted
    And lines 1 to 3 are kept and line 4 is <lcty-c> without data-setup-tags
    And the elements are a system message, the user message, a thinking, the model message and an lcty-cmd
    And the user and model messages have their ids behind msg-u- and msg-m-, and the reply keeps its presentation
    And every element has the SHA-384 of its text as data-content-integrity and is accepted by the check of /v1/rpc
    And the file's modification time is kept

  Scenario: A reply that is not completed is dropped
    Given a file with a user message and a reply whose data-status is incomplete
    When ConvertC.run converts it
    Then the file holds the user message only

  Scenario: The tags at creation go to lcty_t.sqlite unless the tags were changed
    Given a file created with the tags "ruby" and "x", and one created with "a" whose tags were changed to "b"
    When ConvertC.run converts them
    Then the first has the tags "ruby" and "x" in lcty_t.sqlite and the second still "b"

  Scenario: The stats of a reply go to lcty_c.sqlite
    Given a file with a reply that has timings and usage but no client
    When ConvertC.run converts it
    Then lcty_c.sqlite has them for the id of the model message, with no client

  Scenario: The file as it was is kept in c-former/
    Given a file in the format of LCTYSP-0003
    When ConvertC.run converts it
    Then c-former/ holds the file as it was, with its modification time

  Scenario: A copy in c-former/ already stops the conversion of the file
    Given a file in the format of LCTYSP-0003 and a file of the same name in c-former/
    When ConvertC.run runs
    Then the file is reported as failed and neither file has changed

  Scenario: A file in the lcty-msg format is left as it is
    Given a file in the lcty-msg format
    When ConvertC.run runs
    Then it is reported as current and has not changed, and c-former/ has no copy of it

  Scenario: A file that cannot be converted is left as it was and the others are converted
    Given a file whose user message has the data-at "yesterday", and a file that can be converted
    When ConvertC.run runs
    Then the first is reported as failed and has not changed, and the second is converted

  # tools/convert.rb runs ConvertC.main: ConvertC.run on c/ of the data directory, with its lcty_t.sqlite and
  # lcty_c.sqlite, and the counts
  Scenario: tools/convert.rb converts the files of the data directory of LCTY_DATA_DIR
    Given a file of LCTYSP-0003 with a user message and a reply
    When tools/convert.rb is run with LCTY_DATA_DIR the directory of the test
    Then it exits with the status 0 and prints "convert: 1 converted, 0 already lcty-msg, 0 failed"
    And c-former/ has the file as it was

  Scenario: tools/convert.rb takes no arguments
    When tools/convert.rb is run with "--all"
    Then it exits with the status 1 and prints its usage

  Scenario: lcty_c.sqlite of a newer format is refused
    Given lcty_c.sqlite whose user_version is 2
    When a CStore opens it
    Then it raises that the file has format 2, newer than this version (1)
