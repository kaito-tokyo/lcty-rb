# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/search/search-panel.js (LCTYSP-0005, LCTYSP-0007, LCTYSP-0014, LCTYSP-0019). Each Scenario
# is a test of the same title in tests/unit/search-panel.spec.js, whose steps are the lines below.

Feature: LCTYSP-1019 The search panel of the sidebar

  createSearchPanel({list, box, status, rpc}) gives the sidebar's <lcty-conv-list>, search box and status their
  behaviour on every page. With an empty box the list is the browser's copies of the list of conversations
  (LCTYSP-0014): their meta and number of elements (api/meta-db.js, lcty_c) and their tags (api/lcty-t.js,
  t_has_many_c of lcty_t, in the order of the tag files, undefined tags after), newest first, read again whenever this
  tab has stored a change of them. tag:name terms filter by tag; other text is searched by keywords on the server
  (POST /v1/search) and semantically: the server embeds the query (vectors.eg2_264.embed over the tab's /v1/rpc
  connection, rpc()) and the search worker scores it against its copy of the server's vector pair. A semantic hit is a
  user or model message; GET /v1/conversations says the round of each (message_rounds), and each round counts once,
  with its best message. The two are merged with RRF, keeping the best round of each conversation. Rounds without a
  snippet get one from POST /v1/snippets. The panel's refresh() reads the list from the copies again, setQuery(q)
  searches at once, and current marks the conversation of the page. The tab's /v1/rpc connection is a stand-in here:
  the copies are filled through the modules' own functions.

  Background:
    Given a page on the server's origin
    And a search box, a status and a <lcty-conv-list> in the page
    And GET /v1/tags, POST /v1/search, POST /v1/snippets, GET /v1/conversations and the vector pair are answered by the test, and vectors.eg2_264.embed by the tab's connection
    And GET /v1/tags defines the tags "y" and then "x"
    And the lists of the tab's connection hold at the version "b007.1" "a" (4 elements, tags "w", "x" and "y", newest), "b" (2 elements, tag "x") and "c" (6 elements, no tags, oldest)

  Scenario: Opening the panel waits for the first read of the lists, then lists the copies
    Given createSearchPanel has made the panel
    When refresh() is called before the lists have been read
    Then the list is shown empty, with no message
    When the tab's connection reads c.list, c.recordcount.list and t.c.list into the copies
    Then the list shows "a", "b" and "c", newest first
    And each item has its title, its tags in the order of the tag files with the undefined "w" last, and its number of messages

  Scenario: An empty copy says there are no conversations
    Given the lists of the tab's connection hold no conversations
    And the lists have been read into the copies and refresh() has shown them
    Then the list is shown empty with "No conversations yet"

  Scenario: A change stored in the copies is shown at once
    Given the lists have been read into the copies and refresh() has shown them
    When c.batch.updated puts "d" (3 elements, the newest) at the version "b007.2"
    Then the list shows "d", "a", "b" and "c"
    When t.batch.updated gives "d" the tag "x" at the version "b007.2"
    Then the item "d" has the tag "x" and 3 messages

  Scenario: The list marks the current conversation
    Given the lists have been read into the copies and refresh() has shown them
    When current is set to "b"
    Then the item "b" is marked as current
    When the list is shown again by a search
    Then the item "b" is still marked as current

  Scenario: tag: alone lists the conversations with every tag, newest first
    Given the lists have been read into the copies and refresh() has shown them
    When setQuery searches "tag:x"
    Then the list shows "a" and "b"
    When setQuery searches "tag:x tag:y"
    Then the list shows "a"
    And the box holds "tag:x tag:y", the status is empty and nothing was sent to POST /v1/search

  Scenario: A tag no conversation has finds nothing
    Given the lists have been read into the copies and refresh() has shown them
    When setQuery searches "tag:none"
    Then the list is shown empty with "No matching conversations"

  Scenario: Clicking a tag of an item searches that tag
    Given the lists have been read into the copies and refresh() has shown them
    When the tag "y" of the item "a" is clicked
    Then the box holds "tag:y"
    And the list shows "a"

  Scenario: Clearing the box lists every conversation again
    Given the lists have been read into the copies and refresh() has shown them
    And setQuery has searched "tag:y"
    When setQuery searches "  "
    Then the list shows "a", "b" and "c"

  Scenario: A keyword search shows the rounds the server found, in rank order
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search returns the rounds "r-b" of "b" and "r-a" of "a" with snippets
    When setQuery searches "  hello   world  "
    Then POST /v1/search is sent the query "hello world", no tags and the limit 50
    And the list shows "b" and "a", each linked to its round with its snippet
    And the sources of both are "keyword" and the status is empty
    And nothing was sent to POST /v1/snippets

  Scenario: A keyword search keeps the best round of each conversation in the list
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search returns the rounds "r-a1" of "a", "r-z" of "z", which is not in the list, "r-a2" of "a" and "r-c" of "c"
    When setQuery searches "hello"
    Then the list shows "a" with the round "r-a1" and "c" with the round "r-c"

  Scenario: tag: filters are sent with the keyword search
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search returns the rounds "r-a" of "a"
    When setQuery searches "tag:x hello tag: tag:y"
    Then POST /v1/search is sent the query "hello" and the tags "x" and "y"

  Scenario: A failed keyword search says why and keeps the list
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search answers with the status 500 and "boom"
    When setQuery searches "hello"
    Then the status says "Search failed: 500 boom"
    And the list still shows "a", "b" and "c"

  Scenario: Typing searches once the box has been still for 250 ms
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search returns the rounds "r-a" of "a"
    When "hel" and then "hello" are typed into the box within 250 ms
    Then nothing is sent to POST /v1/search before 250 ms have passed
    And then one search is sent, for "hello"
    And the list shows "a"

  Scenario: An older search that ends later is dropped
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search answers "first" late with the round "r-a" of "a" and "second" at once with the round "r-b" of "b"
    When setQuery searches "first" and then "second"
    And the answer to "first" arrives last
    Then the list shows "b"

  Scenario: Clearing the box drops a search still in flight
    Given the lists have been read into the copies and refresh() has shown them
    And POST /v1/search answers "hello" late with the round "r-a" of "a"
    When setQuery searches "hello"
    And setQuery clears the box before the answer arrives
    And the answer to "hello" arrives
    Then the list still shows "a", "b" and "c"
    And the status is empty

  Scenario: A semantic search is merged with the keyword search by RRF
    Given the lists have been read into the copies and refresh() has shown them
    And GET /v1/conversations gives "a" the round "r-a", "b" the round "r-b" and "c" the round "r-c"
    And the vector pair holds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267
    And POST /v1/search returns the round "r-b" of "b" with a snippet
    And POST /v1/snippets returns snippets for "r-a" and "r-c"
    When setQuery searches "hello"
    Then vectors.eg2_264.embed is asked for the text "hello"
    And the list shows "b", "a" and "c", in the order of 1/61 + 1/62, 1/61 and 1/63
    And the sources of "b" are "keyword" and "semantic:0.535", of "a" "semantic:0.802" and of "c" "semantic:0.267"
    And POST /v1/snippets is sent the rounds "r-a" and "r-c" with the query "hello", and their snippets are shown
    And the status is empty

  Scenario: A reply's hit counts once for its round, with the better score
    Given the lists have been read into the copies and refresh() has shown them
    And GET /v1/conversations gives "a" the round "r-a" with its reply "m-a", and "b" the round "r-b"
    And the vector pair holds "m-a", "r-b" and "r-a", which the query scores 0.802, 0.535 and 0.267
    And POST /v1/search returns no rounds
    When setQuery searches "hello"
    Then the list shows "a" with the round "r-a" and "b" with the round "r-b"
    And the sources of "a" are "semantic:0.802" and of "b" "semantic:0.535"

  Scenario: tag: filters limit the semantic hits to the conversations with the tags
    Given the lists have been read into the copies and refresh() has shown them
    And GET /v1/conversations gives "a" the round "r-a", "b" the round "r-b" and "c" the round "r-c"
    And the vector pair holds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267
    And POST /v1/search returns no rounds
    When setQuery searches "hello tag:x"
    Then the list shows "a" and "b"

  Scenario: The rounds of the conversations are fetched once until the list changes
    Given the lists have been read into the copies and refresh() has shown them
    And GET /v1/conversations gives "a" the round "r-a", "b" the round "r-b" and "c" the round "r-c"
    And the vector pair holds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267
    When setQuery searches "hello" and then "world"
    Then GET /v1/conversations was fetched once
    When the tab's connection reads c.list and c.recordcount.list again at the version "b007.2"
    Then the search runs again and GET /v1/conversations is fetched again

  Scenario Outline: Without semantic search the keyword results are shown with a notice
    Given the lists have been read into the copies and refresh() has shown them
    And GET /v1/conversations gives "a" the round "r-a", "b" the round "r-b" and "c" the round "r-c"
    And <failure>
    And POST /v1/search returns the rounds "r-a" of "a"
    When setQuery searches "hello"
    Then the list shows "a"
    And the status says "Semantic search is unavailable (<error>); searching by keywords only"

    Examples:
      | failure                                                                | error                                  |
      | vectors.eg2_264.embed answers the error 7 "no embedding server"        | no embedding server                    |
      | GET /v1/vectors.eg2_264.json answers with the status 503               | failed to fetch the vectors (HTTP 503) |
      | GET /v1/conversations answers with the status 500 and "boom"           | 500 boom                               |
