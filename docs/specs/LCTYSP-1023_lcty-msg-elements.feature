# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/ui/lcty-msg.js: the elements of LCTYSP-0013 as the page builds them. Each Scenario is a
# test of the same title in tests/unit/lcty-msg.spec.js, whose steps are the lines below.

Feature: LCTYSP-1023 The elements of lcty-msg built by the page

  The page builds every element it appends (fat client, thin server): its attributes in their one order and its
  <article>. The same element goes to /v1/rpc and into the document. js/ui/lcty-msg.js runs in a real browser on the
  empty unit page, which loads /c/lcty.v1.js for the custom elements.

  Background:
    Given a page on the server's origin
    And js/ui/lcty-msg.js is imported as window.M

  Scenario: msgAttrs writes the attributes in their one order with the integrity placeholder
    When msgAttrs builds a user message "hi" at a time, and a system message "be brief" of the tag "ruby"
    Then the user's keys are data-role, id, data-at, data-content-integrity and data-content, its id msg-u- and a UUIDv7
    And the system's are data-role, id, data-tag, data-content-integrity and data-content, its id sys- and a UUIDv7
    And data-content-integrity is "sha384-", for the server to fill in

  Scenario: A text an attribute cannot hold goes to data-content-base64
    When msgAttrs builds a model message whose text holds U+0001
    Then it has data-content-base64, the base64 of the text's UTF-8 bytes, and no data-content

  Scenario: thinkingAttrs and cmdAttrs give new ids and keep the order
    When thinkingAttrs builds a thinking and cmdAttrs a send with the error "boom"
    Then the thinking's keys are id, data-at, data-content-integrity and data-content, its id think- and a UUIDv7
    And the command's are id, data-op, data-at and data-error, its id cmd- and a UUIDv7

  Scenario: A user message's article is its text alone, and a reply's its Markdown
    Then userArticle of "<b>&\r" is <article>&lt;b&gt;&amp;&#13;</article>
    And replyArticle of "**bold**" is an <article> holding <p><strong>bold</strong></p>

  Scenario: elementOf builds the element from its attributes and presentation
    When elementOf builds an lcty-msg from the attributes of a user message and its article
    Then the element has the attributes in their order and the <article> as its only child

  Scenario: lastElement is the last element of the file, skipping what is not written
    Given a container holding a system message, a user message and a draft <lcty-message data-draft>
    Then lastElement is the user message
    And lastElement of an empty container is null

  Scenario: historyOf gives the instructions and the messages the model is sent
    Given a container holding a system message "a", a memory "b", a user message "q", a thinking and a model message "r"
    Then historyOf gives the instructions "a", a blank line and "b"
    And the messages user "q" and assistant "r", with their bare ids
