# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The sidebar shared by every page (<lcty-sidebar>, js/ui/sidebar.js): the conversation list, search, the settings
# dialog and the tags dialog (LCTYSP-0005, LCTYSP-0007, LCTYSP-0009, LCTYSP-0010). Each Scenario is a test of the same
# title in tests/ui/sidebar.spec.js, whose steps are the lines below.

Feature: LCTYSP-2003 The sidebar

  Every page has the sidebar: the button for a new conversation and the tag button next to it, a search box, the list
  of the saved conversations with links to their pages, and a button for the settings dialog. The Scenarios make the
  conversations and tags they need through the HTTP API, with unique words in their titles, since every test shares one
  server and the list shows every conversation the tests have made. The browser settings point at the fake
  llama-server.

  Scenario: Conversations are listed as links to their pages
    Given a conversation with a unique title and two messages
    When the new conversation page /c/ is opened
    Then the conversation is listed with the link "../c/<id>.html", relative to the page
    And the item shows the title
    And clicking it opens the page /c/<id>.html

  # The list follows /v1/rpc (LCTYSP-0014): c.batch.updated and t.batch.updated, whoever made the change
  Scenario: A change made elsewhere shows up in the list without a reload
    Given the new conversation page /c/ is open
    When a conversation with a unique title is created through /v1/rpc
    Then it is listed, without a reload
    When its tags are changed to a unique tag through the HTTP API
    Then its item shows the tag
    When it is deleted through the HTTP API
    Then it is no longer listed

  # sync_full of LCTYSP-0009: the tags are synced when the page is shown, without waiting for idle time or a save
  Scenario: Every page takes the server's tags as soon as it is shown
    Given the tag file "00010-<part>.html" named "<PART>", in upper case
    And a conversation tagged "<part>"
    When the new conversation page /c/ is opened
    Then the conversation's tag chip reads "<PART>"
    When the tag is renamed "<Part>" on the server, not through the browser
    And the new conversation page /c/ is opened again
    Then the conversation's tag chip reads "<Part>"

  Scenario: The open conversation is marked as current
    Given a conversation
    When its page is opened
    Then its item in the list has the part "lcty-conv-list__item--current"

  # The keyword search of LCTYSP-0007
  Scenario: Keyword search finds a conversation by a word in its messages
    Given a conversation with a unique word in its first message
    And another conversation without the word
    When the new conversation page /c/ is opened
    Then the other conversation is listed
    When the word is typed into the search box
    Then the conversation with the word is listed
    And the other conversation is not
    And the item links to the matching round, "../c/<id>.html#c-msg-…"

  Scenario: A query in the URL is put into the search box
    When the page /c/?q=<word> is opened
    Then the search box holds the word

  # The browser settings of LCTYSP-0010, kept in localStorage "lcty.settings.v1"
  Scenario: The settings dialog shows the browser settings and saves changes
    Given the new conversation page /c/ is opened
    When the settings button is clicked
    Then the settings dialog is shown
    And its base URL is the fake llama-server's
    When the model "test-model" is typed and the form is submitted
    Then localStorage "lcty.settings.v1" holds the base URL and the model "test-model"
    When 閉じる is clicked
    Then the settings dialog is hidden

  # The tags dialog of LCTYSP-0009
  Scenario: The tag button next to 新しい会話 opens the tags dialog, and a saved tag shows up in the picker
    Given there are no tags
    And the new conversation page /c/ is opened
    Then the sidebar's nav holds the new conversation button and then the tag button, which reads "タグ"
    When the tag button is clicked
    Then the tags dialog is shown
    When a new tag with a unique name is added with "＋ 新しいタグ" and saved with "保存"
    Then the tag picker of the page has the tag
    When 閉じる is clicked
    Then the tags dialog is hidden

  Scenario: The tag button opens the tags dialog on a conversation page too
    Given a conversation with two messages
    And its page is opened
    When the tag button is clicked
    Then the tags dialog is shown
