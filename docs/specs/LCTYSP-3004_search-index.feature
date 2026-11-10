# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/search_index.rb (LCTYSP-0007, LCTYSP-0009). Each Scenario is a test of the same title in
# tests/backend/search_index_test.rb, whose steps are the lines below.

Feature: LCTYSP-3004 The search index

  Chatty::SearchIndex keeps the derived index of the conversations in a SQLite file. SearchIndex.rounds_for turns the
  messages of a conversation into rounds (a user message and the reply that follows), and sync and full_sync bring the
  index in line with the files. keyword_search finds rounds by trigrams of the terms of three or more characters and
  requires the shorter terms in the text, snippets gives the snippets of rounds found elsewhere, and convs_with_tags
  answers from the tags recorded on every sync.

  Scenario: A user message and the reply that follows make a round
    Given a user message "u1" with "Hello" at "2026-01-01T00:00:00Z" and a reply "Hi there" at "2026-01-01T00:00:05Z"
    When SearchIndex.rounds_for derives the rounds of the conversation "c1"
    Then there is one round whose id is "u1" and whose conversation is "c1"
    And its one part is "Hello", a blank line and "Hi there"
    And it is at the time of the reply
    And its rev is the first 16 hex digits of the SHA-256 of its text

  Scenario: Rounds that are inherited, without an id or without a finished reply are left out
    Given an inherited user message with a reply, a user message without an id with a reply, and a user message followed by another user message
    And a last user message without a reply
    When SearchIndex.rounds_for derives the rounds
    Then there are none

  Scenario: A round without a time on its reply takes the time of the user message
    Given a user message at "2026-01-01T00:00:00Z" and a reply without a time
    When SearchIndex.rounds_for derives the rounds
    Then the round is at "2026-01-01T00:00:00Z"

  Scenario: A round with empty content has only the other message's text
    Given a user message with empty content and a reply "only the reply"
    When SearchIndex.rounds_for derives the rounds
    Then the round's text is "only the reply"

  Scenario: A round longer than 6000 characters is split into parts
    Given a user message of 4000 characters and a reply of 4000 characters
    When SearchIndex.rounds_for derives the rounds
    Then the round has two parts, of 6000 and 2002 characters, that join into its text

  Scenario: The rev of a round changes when its text changes
    When SearchIndex.rounds_for derives a round, and again after the reply was changed
    Then the two revs differ

  Scenario: Normalizing applies NFKC and lowercases
    Then SearchIndex.normalize turns "ＷＥＢｒｉｃｋ" into "webrick"
    And it turns nil into ""

  Scenario: A synced round is found by a keyword
    Given a new index
    When a conversation with a round about "WEBrick servers" is synced
    Then a keyword search for "webrick" finds that round with its conversation and its text as the snippet

  Scenario: Keyword search ignores width and case
    Given a new index with a round whose reply is "ＷＥＢｒｉｃｋ is a server"
    Then a keyword search for "WEBRICK" finds it

  Scenario: A two-character term such as 京都 is required in the text
    Given a new index with a round about 京都 and a round about 東京
    Then a keyword search for "京都" finds only the round about 京都
    And a keyword search for "都" finds only the round about 京都

  Scenario: Rounds found by short terms alone are newest first
    Given a new index with three rounds that mention 京都, at three different times
    Then a keyword search for "京都" finds them newest first

  Scenario: A short term next to a long one filters the rounds the long one finds
    Given a new index with a round about temples in 京都 and a round about temples in 奈良
    Then a keyword search for "temple 奈良" finds only the round about 奈良

  Scenario: Percent signs and underscores in a short term are matched literally
    Given a new index with a round that says "50% off" and a round that says "500 off"
    Then a keyword search for "%" finds only the round that says "50% off"
    And a keyword search for "_" finds nothing

  Scenario: The round with more of the query ranks first
    Given a new index with a round about "search" and a round about "search engines"
    Then a keyword search for "search engine" finds the round about "search engines" first

  Scenario: An empty query finds nothing
    Given a new index with a round
    Then a keyword search for "" finds nothing
    And a keyword search for spaces finds nothing

  Scenario: Keyword search keeps to the allowed conversations and the limit
    Given a new index with rounds about "pancakes" in the conversations "c1", "c2" and "c3"
    Then a keyword search for "pancakes" allowed only "c2" finds only the round of "c2"
    And a keyword search for "pancakes" allowed no conversations finds nothing
    And a keyword search for "pancakes" with the limit 2 finds two rounds

  Scenario: A round split into parts is found once
    Given a new index with a round of two parts that both mention "zebra"
    Then a keyword search for "zebra" finds the round once

  Scenario: The limit counts rounds, not their parts
    Given a new index with a round of two parts that both mention "zebra" three times, and two rounds that mention it once
    Then a keyword search for "zebra" with the limit 2 finds two rounds, the first of them first

  Scenario: A snippet starts shortly before the first matching term
    Given a new index with a round of 200 "x", the word "needle" and 200 "y"
    When a keyword search for "needle" finds it
    Then the snippet is "…" and the 140 characters that start 46 characters before "needle"

  Scenario: A snippet stays on the term when normalizing changes the length of the text before it
    Given a new index with a round of 100 "㍿", the word "needle" and 200 "y"
    When a keyword search for "needle" finds it
    Then the snippet is "…" and the 140 characters that start 46 characters before "needle"

  Scenario: Snippets are given for known rounds and left out for unknown ones
    Given a new index with a synced round "u1" in the conversation "c1"
    When snippets are asked for "u1" and an unknown id with the query "Hello"
    Then only "u1" has a snippet, with its conversation "c1"

  Scenario: Syncing again with the same messages changes nothing
    Given a new index with a listener and a synced conversation
    When the conversation is synced again with the same messages
    Then the listener is not called

  Scenario: Syncing a changed round replaces it and calls the listener
    Given a new index with a listener and a synced round about "apricots"
    When the round's reply is changed to be about "blueberries" and the conversation is synced
    Then the listener is called once
    And a keyword search for "apricots" finds nothing
    And a keyword search for "blueberries" finds the round

  Scenario: Syncing without a round deletes it
    Given a new index with a listener and a synced conversation of two rounds
    When the conversation is synced with only its first round
    Then the listener is called once
    And a keyword search finds only the first round

  Scenario: A message id already indexed for another conversation is skipped
    Given a new index with a round "u1" synced for the conversation "c1"
    When a copy of that round is synced for the conversation "c2"
    Then a warning names the message and both conversations
    And the round still belongs to "c1"

  Scenario: Sync records the tags
    Given a new index with a listener
    When a conversation of three messages, one inherited, is synced with the tags "b" and "a"
    Then convs_with_tags finds it for "b" and for "a"
    When it is synced again with only the tag "c"
    Then convs_with_tags finds it for "c" and no longer for "b"
    And the listener was called only for the first sync, which added a round

  Scenario: Conversations with all the given tags are found
    Given a new index with the conversation "c1" tagged "a" and "b" and the conversation "c2" tagged "a"
    Then convs_with_tags finds "c1" and "c2" for "a"
    And it finds only "c1" for "a" and "b"
    And it finds only "c1" for "a", "a" and "b"
    And it finds nothing for "a" and "z"
    And it finds nothing for no tags

  Scenario: A full sync drops conversations that no longer exist and calls the listener
    Given a new index with a listener and the synced conversations "c1" and "c2", both tagged
    When a full sync is given only "c1", without tags
    Then the round of "c2" is not found
    And convs_with_tags finds nothing for the tag of "c2"
    And nothing for the tag "c1" had before
    And the listener is called

  Scenario: Removing a deleted conversation leaves nothing of it
    Given a new index with a listener and the synced conversations "c1" and "c2", both tagged
    When "c2" is removed
    Then the round of "c2" is not found
    And convs_with_tags finds "c1" for its tag and nothing for the tag of "c2"
    And the listener is called once
    And removing "c2" again, or the never indexed "c9", leaves "c1" as it is without calling the listener

  Scenario: An index is kept when it is opened again
    Given an index with a synced round about "persimmons"
    When the file is opened again
    Then a keyword search for "persimmons" finds the round

  Scenario: An index is discarded, with its WAL, and opened anew empty, as at every start
    Given an index with a synced round about "medlars" and a cached count, closed
    When SearchIndex.discard is called on its file
    Then the file, its -wal and its -shm are gone
    When it is opened again
    Then a keyword search for "medlars" finds nothing, and the count of "rpc-1" is unknown
    And it has no table vectors and no schema version
