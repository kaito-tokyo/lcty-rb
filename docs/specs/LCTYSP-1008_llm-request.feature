# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/llm/history.js (LCTYSP-0002, LCTYSP-0003). Each Scenario is a test of the same title in
# tests/unit/history.spec.js, whose steps are the lines below.

Feature: LCTYSP-1008 Building the request from a conversation

  buildRequest({instructions, messages}) turns a saved conversation into the instructions and input of a Responses
  API request (js/llm/client.js): the conversation page calls it for each turn and js/tags.js for memory proposals.
  It is a pure function that lays out the saved strings as they are, so that every request starts with the same
  prefix as the one before and llama-server's prompt cache applies. A user message is sent as {role, content}, an
  assistant message as {type: "message", role, content}; past thinking and assistant messages with an empty body are
  not sent, and the instructions go to the top level.

  Background:
    Given a page on the server's origin

  Scenario: A user message is sent with its role and content
    Given the messages [{"role": "user", "content": "Hello"}]
    When buildRequest is called with them
    Then the input is [{"role": "user", "content": "Hello"}]

  Scenario: An assistant message is sent as a message item
    Given the messages [{"role": "assistant", "content": "Hi there"}]
    When buildRequest is called with them
    Then the input is [{"type": "message", "role": "assistant", "content": "Hi there"}]

  Scenario: A conversation is sent in its order
    Given a conversation of a user message "1", an assistant message "2", a user message "3" and an assistant message "4"
    When buildRequest is called with it
    Then the input holds the four messages in that order, with type "message" on the assistant's

  Scenario: The instructions go to the top level
    Given the instructions "Be brief" and a user message "Hello"
    When buildRequest is called with them
    Then the request is {"instructions": "Be brief", "input": [{"role": "user", "content": "Hello"}]}

  Scenario Outline: Missing instructions become an empty string
    Given a conversation whose instructions are <instructions>
    When buildRequest is called with it
    Then the request's instructions are ""

    Examples:
      | instructions |
      | not set      |
      | null         |
      | ""           |

  Scenario: Past thinking is not sent
    Given an assistant message with the thinking "Let me think" and the content "Answer"
    When buildRequest is called with it
    Then the input is [{"type": "message", "role": "assistant", "content": "Answer"}]

  Scenario Outline: An assistant message with an empty body is not sent
    Given a user message "Q", an assistant message whose content is <content> and a user message "Q again"
    When buildRequest is called with them
    Then the input holds only the two user messages

    Examples:
      | content |
      | ""      |
      | not set |
      | null    |

  Scenario: Messages copied by a fork are sent like any other
    Given a user message and an assistant message marked inherited, then a user message of this conversation
    When buildRequest is called with them
    Then the input holds the three messages, without the mark

  Scenario: Only the role and the content of a message are sent
    Given a user message and an assistant message that also have an id, a time, content_html and other fields
    When buildRequest is called with them
    Then each item of the input has only role and content, and type for the assistant's

  Scenario: The saved strings are sent exactly as they are
    Given a user message "  spaced\r\n**bold**\n\n" and an assistant message "```js\nx\n```\n "
    When buildRequest is called with them
    Then the contents in the input are those strings, unchanged

  Scenario: No messages give an empty input
    Given the instructions "Be brief" and no messages
    When buildRequest is called with them
    Then the request is {"instructions": "Be brief", "input": []}

  Scenario: The next turn starts with the input of the turn before
    Given a conversation of a user message and its reply
    When buildRequest is called with it, and again after a reply and the next user message are added
    Then the second input starts with the whole first input

  Scenario: The given conversation is left as it was
    Given a conversation with instructions, thinking and an assistant message with an empty body
    When buildRequest is called with it
    Then the conversation is still equal to a copy made before the call
