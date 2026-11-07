# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/search/search-panel.js (LCTYSP-0005, LCTYSP-0007, LCTYSP-0008, LCTYSP-0010). Each Scenario
# is a test of the same title in tests/unit/search-panel.spec.js, whose steps are the lines below.

Feature: LCTYSP-1019 The search panel of the sidebar

  createSearchPanel({list, box, status, getSettings}) gives the sidebar's <lcty-conv-list>, search box and status
  their behaviour on every page. With an empty box the list is the browser's copy of every conversation's meta
  (api/meta-db.js), newest first, read again whenever a sync stores a new list. tag:name terms filter by tag; other
  text is searched by keywords on the server (POST /v1/search) and, when an embedding model is set, semantically in
  the browser (the query embedded by llama-server, scored by the search worker against the distribution files), and
  the two are merged with RRF, keeping the best round of each conversation. Rounds without a snippet get one from
  POST /v1/snippets. The panel's refresh() reloads the list and asks for a sync, setQuery(q) searches at once, and
  current marks the conversation of the page.

  Background:
    Given a page on the server's origin
    And a search box, a status and a <lcty-conv-list> in the page
    And GET /v1/meta-all.json, POST /v1/search, POST /v1/snippets, GET /v1/conversations, GET /v1/defaults.json, the distribution files and the embeddings of http://llm.test are answered by the test
    And the copy of the meta will hold "a" (tags "x" and "y", newest), "b" (tag "x") and "c" (no tags, oldest)

  Scenario: Opening the panel waits for the first sync, then lists the copy
    Given createSearchPanel has made the panel
    When refresh() is called before there is a copy
    Then the list is shown empty, with no message
    And after the sync the browser runs when idle, the list shows "a", "b" and "c", newest first
    And each item has its title, tags and number of messages

  Scenario: An empty copy says there are no conversations
    Given the copy of the meta will hold no conversations
    And the panel has loaded the copy after a sync
    Then the list is shown empty with "No conversations yet"

  Scenario: The list marks the current conversation
    Given the panel has loaded the copy after a sync
    When current is set to "b"
    Then the item "b" is marked as current
    When the list is shown again by a search
    Then the item "b" is still marked as current

  Scenario: tag: alone lists the conversations with every tag, newest first
    Given the panel has loaded the copy after a sync
    When setQuery searches "tag:x"
    Then the list shows "a" and "b"
    When setQuery searches "tag:x tag:y"
    Then the list shows "a"
    And the box holds "tag:x tag:y", the status is empty and nothing was sent to POST /v1/search

  Scenario: A tag no conversation has finds nothing
    Given the panel has loaded the copy after a sync
    When setQuery searches "tag:none"
    Then the list is shown empty with "No matching conversations"

  Scenario: Clicking a tag of an item searches that tag
    Given the panel has loaded the copy after a sync
    When the tag "y" of the item "a" is clicked
    Then the box holds "tag:y"
    And the list shows "a"

  Scenario: Clearing the box lists every conversation again
    Given the panel has loaded the copy after a sync
    And setQuery has searched "tag:y"
    When setQuery searches "  "
    Then the list shows "a", "b" and "c"

  Scenario: A keyword search shows the rounds the server found, in rank order
    Given the panel has loaded the copy after a sync
    And POST /v1/search returns the rounds "r-b" of "b" and "r-a" of "a" with snippets
    When setQuery searches "  hello   world  "
    Then POST /v1/search is sent the query "hello world", no tags and the limit 50
    And the list shows "b" and "a", each linked to its round with its snippet
    And the sources of both are "keyword" and the status is empty
    And nothing was sent to GET /v1/defaults.json or POST /v1/snippets

  Scenario: A keyword search keeps the best round of each conversation in the list
    Given the panel has loaded the copy after a sync
    And POST /v1/search returns the rounds "r-a1" of "a", "r-z" of "z", which is not in the list, "r-a2" of "a" and "r-c" of "c"
    When setQuery searches "hello"
    Then the list shows "a" with the round "r-a1" and "c" with the round "r-c"

  Scenario: tag: filters are sent with the keyword search
    Given the panel has loaded the copy after a sync
    And POST /v1/search returns the rounds "r-a" of "a"
    When setQuery searches "tag:x hello tag: tag:y"
    Then POST /v1/search is sent the query "hello" and the tags "x" and "y"

  Scenario: A failed keyword search says why and keeps the list
    Given the panel has loaded the copy after a sync
    And POST /v1/search answers with the status 500 and "boom"
    When setQuery searches "hello"
    Then the status says "Search failed: 500 boom"
    And the list still shows "a", "b" and "c"

  Scenario: Typing searches once the box has been still for 250 ms
    Given the panel has loaded the copy after a sync
    And POST /v1/search returns the rounds "r-a" of "a"
    When "hel" and then "hello" are typed into the box within 250 ms
    Then nothing is sent to POST /v1/search before 250 ms have passed
    And then one search is sent, for "hello"
    And the list shows "a"

  Scenario: An older search that ends later is dropped
    Given the panel has loaded the copy after a sync
    And POST /v1/search answers "first" late with the round "r-a" of "a" and "second" at once with the round "r-b" of "b"
    When setQuery searches "first" and then "second"
    And the answer to "first" arrives last
    Then the list shows "b"

  Scenario: Clearing the box drops a search still in flight
    Given the panel has loaded the copy after a sync
    And POST /v1/search answers "hello" late with the round "r-a" of "a"
    When setQuery searches "hello"
    And setQuery clears the box before the answer arrives
    And the answer to "hello" arrives
    Then the list still shows "a", "b" and "c"
    And the status is empty

  Scenario: A semantic search is merged with the keyword search by RRF
    Given the panel has loaded the copy after a sync
    And the settings have the embedding model "emb" at http://llm.test and GET /v1/defaults.json says "emb"
    And GET /v1/conversations maps the rounds "r-a" to "a", "r-b" to "b" and "r-c" to "c"
    And the distribution files hold the rounds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267
    And POST /v1/search returns the round "r-b" of "b" with a snippet
    And POST /v1/snippets returns snippets for "r-a" and "r-c"
    When setQuery searches "hello"
    Then the query "task: search result | query: hello" is embedded by http://llm.test/v1/embeddings with the model "emb"
    And the list shows "b", "a" and "c", in the order of 1/61 + 1/62, 1/61 and 1/63
    And the sources of "b" are "keyword" and "semantic:0.535", of "a" "semantic:0.802" and of "c" "semantic:0.267"
    And POST /v1/snippets is sent the rounds "r-a" and "r-c" with the query "hello", and their snippets are shown
    And the status is empty

  Scenario: tag: filters limit the semantic hits to the conversations with the tags
    Given the panel has loaded the copy after a sync
    And the settings have the embedding model "emb" at http://llm.test and GET /v1/defaults.json says "emb"
    And GET /v1/conversations maps the rounds "r-a" to "a", "r-b" to "b" and "r-c" to "c"
    And the distribution files hold the rounds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267
    And POST /v1/search returns no rounds
    When setQuery searches "hello tag:x"
    Then the list shows "a" and "b"

  Scenario: The rounds of the conversations are fetched once until the list changes
    Given the panel has loaded the copy after a sync
    And the settings have the embedding model "emb" at http://llm.test and GET /v1/defaults.json says "emb"
    And GET /v1/conversations maps the rounds "r-a" to "a", "r-b" to "b" and "r-c" to "c"
    And the distribution files hold the rounds "r-a", "r-b" and "r-c", which the query scores 0.802, 0.535 and 0.267
    When setQuery searches "hello" and then "world"
    Then GET /v1/conversations was fetched once
    When a sync stores a new list
    Then the search runs again and GET /v1/conversations is fetched again

  Scenario Outline: Without semantic search the keyword results are shown with a notice
    Given the panel has loaded the copy after a sync
    And the settings have the embedding model "emb" at http://llm.test and GET /v1/defaults.json says "emb"
    And <failure>
    And POST /v1/search returns the rounds "r-a" of "a"
    When setQuery searches "hello"
    Then the list shows "a"
    And the status says "Semantic search is unavailable (<error>); searching by keywords only"

    Examples:
      | failure                                                      | error                              |
      | GET /v1/defaults.json says "other"                           | the vectors are for other, not emb |
      | the embeddings answer with the status 503 and "down"         | down                               |
      | GET /v1/defaults.json answers with the status 500 and "boom" | 500 boom                           |

  Scenario: Without an embedding model only the keywords are searched
    Given the panel has loaded the copy after a sync
    And the settings have no embedding model
    And POST /v1/search returns the rounds "r-a" of "a"
    When setQuery searches "hello"
    Then the list shows "a" and the status is empty
    And nothing was sent to GET /v1/defaults.json, GET /v1/conversations or the embeddings
