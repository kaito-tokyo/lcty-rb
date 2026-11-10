# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/ui/lcty-elements.js (LCTYSP-0003, LCTYSP-0004, LCTYSP-0005). Each Scenario is a test of the
# same title in tests/unit/lcty-elements.spec.js, whose steps are the lines below.

Feature: LCTYSP-1017 Messages and the composer of a conversation

  The custom elements of /lcty.v1/lcty.v1.cjs build the structure of a message (<lcty-message>) and of the composer
  (<lcty-composer>) and expose their inner elements; this module adds the behaviour with plain functions. A page
  calls initConversationElements(container, handlers) once at startup, which prepares the messages already in the
  conversation file and wires the composer, or initComposer(composer, {onSend, onStop}) for a composer of its own.
  Messages made on screen are added with appendMessage and removed with removeFrom; while a reply streams in,
  appendText and appendThinking only collect the text, which is drawn once per animation frame, and finishMessage
  settles it. messageOf gives the message of an element: the one it was made with, or the one read from the
  attributes of the file.

  Background:
    Given a page on the server's origin
    And a container element with a <lcty-composer> as its composer

  Scenario: A user message is added as plain text
    When appendMessage adds the user message "a" with the content "<b>hi</b>"
    Then the container has one <lcty-message> with the id "c-msg-a", the role "user" and the status "completed"
    And its child div.user-text holds the text "<b>hi</b>"
    And messageOf returns the very object it was given

  Scenario: A finished reply is rendered as Markdown with its thinking
    When appendMessage adds the reply "r" with the content "# Head\n\nSome **bold**" and the thinking "hmm"
    Then its <article> shows a heading "Head" and the paragraph "Some bold" with "bold" in <strong>
    And it has data-thinking "hmm" and its thinking view says "Thinking (3 characters)"

  Scenario: A reply that is still streaming starts empty
    When appendMessage adds the reply "r" with the status "streaming", the content "ignored" and the thinking "hmm"
    Then its status is "streaming" and its <article> shows no text
    And it has no data-thinking and its thinking view is hidden

  Scenario: Only the last user message is marked
    When appendMessage adds a user message, a reply and a user message
    Then only the third message has data-last-user
    When removeFrom removes the messages from index 2
    Then two messages remain and only the first has data-last-user

  Scenario: removeFrom removes the messages from an index on
    Given the container holds four messages
    When removeFrom removes the messages from index 4
    Then four messages remain
    When removeFrom removes the messages from index 1
    Then only the first message remains
    And readMessages returns its message only

  Scenario: Streamed text is drawn once per animation frame
    Given a streaming reply
    When appendText adds "Hello **wor" and "ld**\n\nSecond" in one task
    Then its <article> shows no text before the next animation frame
    And after the next animation frame it shows "Hello world" in a fixed paragraph and "Second" in the unfinished tail

  Scenario: Finishing a streamed reply fixes every block
    Given a streaming reply with the text "Hello **world**\n\nSecond" appended
    And the status is removed from its message
    When finishMessage settles it
    Then its <article> holds the paragraphs "Hello world" and "Second" and an empty unfinished tail
    And its status is "completed"

  Scenario: An unfinished code block grows in one text node
    Given a streaming reply
    When appendText adds "```js\nlet a" and a frame is drawn
    Then the unfinished tail shows a code block "js" with the code "let a"
    When appendText adds " = 1;" and a frame is drawn
    Then the same text node now holds "let a = 1;"

  Scenario: Thinking is counted while it streams and shown when it is open
    Given a streaming reply
    When appendThinking adds "abc" and "de" and a frame is drawn
    Then its thinking view is shown with the summary "Thinking… (5 characters)" and an empty body
    When the thinking view is opened
    Then its body holds "abcde"
    When finishMessage settles it
    Then it has data-thinking "abcde" and the summary "Thinking (5 characters)"

  Scenario: A reply finished without thinking has no thinking
    Given a streaming reply
    When finishMessage settles it
    Then it has no data-thinking and its thinking view is hidden

  Scenario: Finishing shows how an incomplete reply ended and its timings
    Given a streaming reply
    And its message is given the status "incomplete", the error "boom", timings and a client time to first output
    When finishMessage settles it
    Then it has the status "incomplete", data-error "boom" and the timings and client as JSON attributes
    And its foot says "Error: boom" and shows the ⓘ
    And the timings popover says "Input 30 tok (cached 10 / computed 20, 0.50s)", "Output 5 tok, 12.3 tok/s" and "First output after 12.3s", one per line

  Scenario: A message of the file is read from its attributes
    Given the container holds a reply of the file with every attribute, its content in data-content-base64
    When messageOf reads it
    Then it returns the id, role, time, status, error, inherited, timings, client, usage, content and thinking
    And a second call returns the same object even after the attributes change

  Scenario: Attributes of the file that cannot be read are left out
    Given the container holds a user message of the file with broken JSON in data-timings, a bad data-content-base64 and data-thinking
    When messageOf reads it
    Then it returns only the id, role, time and the content ""

  Scenario Outline: isLctyMsgFile tells a file of LCTYSP-0013 from one of LCTYSP-0003
    Given the container holds <elements>
    Then isLctyMsgFile is <answer>

    Examples:
      | case                  | elements                                      | answer |
      | LCTYSP-0003           | an <lcty-setup> and an <lcty-message>          | false  |
      | messages of 0003 only | an <lcty-message>                              | false  |
      | LCTYSP-0013           | an <lcty-msg> and an <lcty-thinking>           | true   |
      | no element            | nothing                                       | true   |

  Scenario: readLctyMsgs reads the user and model messages of a file of LCTYSP-0013
    Given the container holds a system <lcty-msg>, a user one, an <lcty-thinking>, a model one with its text in data-content-base64, and an <lcty-cmd>
    When readLctyMsgs reads it
    Then it returns the user and model messages as id, role, time and content, with the bare ids and model as assistant

  Scenario: Starting prepares the messages of the file
    Given the container holds a user message, a reply with saved presentation HTML, a reply without it and an old <lcty-thinking> child, and a reply with timings
    When initConversationElements starts
    Then the reply with saved presentation HTML keeps it
    And the reply without it is rendered from data-content
    And the old <lcty-thinking> child is removed
    And the reply with timings has its timings popover filled in
    And only the user message has data-last-user

  Scenario: The buttons of a message call the handlers with the message
    Given the container holds a user message and a reply of the file
    When initConversationElements starts with the handlers onUndo, onFork and onRegenerate
    And appendMessage adds a user message
    And Undo and Fork from here of both user messages and Regenerate of the reply are clicked
    Then the handlers were called with those messages in order

  Scenario: A suggested next message goes into the composer
    Given the container holds a reply of the file whose content suggests "Tell me more"
    When initConversationElements starts
    And the suggestion button is clicked
    Then the composer holds "Tell me more" and has the focus

  Scenario: Select all selects the code of a code block
    Given the container holds a reply of the file with a saved code block whose button is the old "Copy"
    When initConversationElements starts
    Then the button says "Select all"
    When the button is clicked
    Then the selection is the code of the block

  Scenario: The composer of the conversation calls onSend and onStop
    When initConversationElements starts with the handlers onSend and onStop
    And "hello" is typed into the composer and Enter is pressed
    And the Stop button is clicked
    Then onSend was called with "hello" and onStop once

  Scenario: Enter sends the text without a new line
    Given initComposer has wired the composer
    When "hello" is typed into the composer and Enter is pressed
    Then onSend was called once with "hello"
    And the composer still holds "hello"

  Scenario: Shift+Enter inserts a new line
    Given initComposer has wired the composer
    When "a" is typed, Shift+Enter is pressed and "b" is typed
    Then onSend was not called
    And the composer holds "a\nb"

  Scenario Outline: Enter while composing text with an input method is ignored
    Given initComposer has wired the composer
    And the composer holds "hello"
    When Enter is pressed with <composing>
    Then onSend was not called
    And the keydown was not cancelled

    Examples:
      | composing       |
      | isComposing     |
      | the keyCode 229 |

  Scenario Outline: Nothing is sent from a blank or busy composer
    Given initComposer has wired the composer
    And <state>
    When Enter is pressed in the composer
    And the form is submitted
    Then onSend was not called

    Examples:
      | reason               | state                                  |
      | the text is blank    | the composer holds " \n "              |
      | the composer is busy | the composer holds "hello" and is busy |

  Scenario: Submitting the form sends and the Stop button stops
    Given initComposer has wired the composer
    And the composer holds "hello"
    When the Send button is clicked
    And the Stop button is clicked
    Then onSend was called once with "hello" and onStop once

  Scenario: The composer is set, marked busy and focused by functions
    When setComposerValue sets "x"
    And setComposerBusy marks it busy
    And focusComposer focuses it
    Then the composer holds "x", has the attribute busy and has the focus
    When setComposerBusy marks it not busy
    Then it has no attribute busy

  Scenario: The input grows with its text up to 40% of the window
    Given initComposer has wired the composer
    When the composer is given one line by typing
    And it is given 100 lines by typing
    Then its height grew, but not beyond 40% of the window's height
