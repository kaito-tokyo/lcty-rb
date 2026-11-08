# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The new conversation page /c/ (public/c/index.html and js/pages/new.js), following LCTYSP-0004 "Starting a
# conversation", LCTYSP-0005 and LCTYSP-0009. Each Scenario is a test of the same title in
# tests/ui/new-conversation.spec.js, whose steps are the lines below.

Feature: LCTYSP-2001 The new conversation page /c/

  The new conversation page is where a conversation begins: a card with the system prompt draft, the tags to start
  with and the composer, beside the sidebar (LCTYSP-0005). Sending the first message creates the conversation through
  the HTTP API, moves to its page and generates the reply (LCTYSP-0004); choosing a tag fills the draft from the tag's
  prompt and memory (LCTYSP-0009); a fork (/c/?fork=<id>&at=<n>) starts from another conversation's system prompt and
  messages. The fake llama-server answers each generation with the reply a Scenario queued, or with "了解しました。"
  when none is queued. Tag definitions are global, so every Scenario leaves the server with no tags afterwards.

  Scenario: The new conversation page shows the sidebar and the creation card
    When the new conversation page /c/ is opened
    Then the sidebar is shown
    And the card is headed "新しい会話", in Japanese as the page is
    And the system prompt draft is shown
    And the composer has the focus

  Scenario: The root of the site moves to the new conversation page /c/, and /c with its query
    When the root of the site / is opened
    Then the browser is on /c/
    When /c?q=abc is opened
    Then the browser is on /c/?q=abc

  Scenario: Sending the first message creates the conversation and generates the reply
    Given the model will reply "こんにちは、テストです。"
    When a conversation is started on /c/ with the first message "はじめまして"
    Then the page shows two messages
    And the user message is "はじめまして"
    And the assistant message is "こんにちは、テストです。"
    And the page title is "はじめまして", the first line of the first message
    And the model got one request, which contains "はじめまして"
    And the server has saved both messages

  Scenario: Shift+Enter inserts a newline instead of sending
    Given the new conversation page /c/ is open
    When "一行目" is typed in the composer
    And Shift+Enter is pressed
    And "二行目" is typed
    Then the composer holds "一行目", a newline and "二行目"
    And the browser is still on /c/

  Scenario: An empty message is not sent
    Given the new conversation page /c/ is open
    When the composer holds only spaces and Enter is pressed
    Then the browser is still on /c/

  Scenario: Choosing a tag fills the system prompt draft from its prompt and memory
    Given a tag with a prompt and a memory
    And the new conversation page /c/ is open
    When the tag is checked
    Then the system prompt draft contains the tag's prompt
    And the system prompt draft contains the tag's memory
    When the tag is unchecked
    Then the untouched draft is empty again
    When the tag is checked again and the first message "タグ付きの会話" is sent
    Then the conversation's page has the tag in data-setup-tags
    And the model got the tag's prompt in its instructions
    And the server has saved the conversation with the tag

  Scenario: A fork starts from the source's system prompt and puts the chosen message into the composer
    Given a conversation with the system prompt "分岐元のシステムプロンプト" and two questions with their answers
    When the new conversation page is opened with fork=<the source's id> and at=2
    Then the fork note is shown
    And it links to the source's page c/<id>.html on the site
    And the system prompt draft is "分岐元のシステムプロンプト"
    And the composer holds the chosen message "二番目の質問"
    When the composer's text is replaced with "書き換えた二番目の質問" and Enter is pressed
    Then the browser moves to the new conversation's page
    And the page shows four messages, the last user message being "書き換えた二番目の質問"
    And the new conversation is not the source
    And the server has saved four messages, of which the first two are inherited
    And the source still has its four messages
