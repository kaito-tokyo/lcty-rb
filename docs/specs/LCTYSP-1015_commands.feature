# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/ui/lcty-cmd.js (LCTYSP-0003 "Elements", LCTYSP-0004 "Commands: deferred and volatile
# execution", LCTYSP-0005 "Elements" and "Rendering streams"). Each Scenario is a test of the same title in
# tests/unit/lcty-cmd.spec.js, whose steps are the lines below.

Feature: LCTYSP-1015 Command tags

  A command tag <lcty-cmd data-op="…" data-at="…"> is a command object. defineCommands(table) registers the operations
  (name → async (cmd, controller)) and defines <lcty-cmd>, so the commands already in the document are upgraded then.
  A command that is the last element of <lcty-c> runs its operation once: while it runs its state attribute is
  "running" and it sets slot="float" on itself (it floats above the composer with its spinner and stop button); when
  the operation ends its state is "done", "aborted" or "failed" and the slot is removed. A command followed by other
  elements has already run and is "done"; an unknown operation is "unknown" and does nothing. appendCommand(container,
  op) adds a command in memory only, which runs at once. In these steps, an operation waits until the test releases it
  or until its AbortSignal is aborted, and /c/lcty.v1.module.js (imported by <lcty-c>) is an empty module.

  Background:
    Given a page on the server's origin
    And /c/lcty.v1.module.js is an empty module
    And the module /js/ui/lcty-cmd.js is imported

  Scenario: Importing the module defines nothing
    Then <lcty-cmd> is not defined

  Scenario: A command that is the last element of <lcty-c> runs when the commands are defined
    Given <lcty-c> holds a message and then <lcty-cmd data-op="send">
    When defineCommands is given the operation "send"
    Then "send" has been called once, with the command and an AbortController whose signal is not aborted
    And the command's state is "running" and its slot is "float"
    When the operation "send" is released
    Then the command's state is "done" and it has no slot

  Scenario: A command followed by other elements has already run
    Given <lcty-c> holds <lcty-cmd data-op="send"> and then a message
    When defineCommands is given the operation "send"
    Then "send" has not been called
    And the command's state is "done" and it has no slot

  Scenario: A command outside <lcty-c> does not run
    Given a <div> holds a message and then <lcty-cmd data-op="send">
    When defineCommands is given the operation "send"
    Then "send" has not been called
    And the command's state is "done" and it has no slot

  Scenario Outline: An unknown operation does nothing
    Given <lcty-c> holds a message and then <lcty-cmd data-op="<op>">
    When defineCommands is given the operation "send"
    Then "send" has not been called
    And the command's state is "unknown" and it has no slot

    Examples:
      | op          |
      | regenerate  |
      | constructor |
      | __proto__   |

  Scenario: appendCommand adds a command in memory that runs at once
    Given defineCommands has been given the operation "send"
    And <lcty-c> holds a message
    When appendCommand appends "send" to <lcty-c>
    Then it returns the <lcty-cmd> that is now the last element of <lcty-c>
    And its data-op is "send" and its data-at is the time it was appended, as an ISO string
    And "send" has been called once, with the command and an AbortController whose signal is not aborted
    And the command's state is "running" and its slot is "float"

  Scenario Outline: A running command can be stopped
    Given defineCommands has been given the operation "send"
    And appendCommand has appended "send" to <lcty-c>
    When <how>
    Then the AbortSignal given to "send" is aborted
    And the command's state is "aborted" and it has no slot

    Examples:
      | how                                       |
      | the stop button of the command is clicked |
      | abort() of the command is called          |

  Scenario: abort() does nothing when the command is not running
    Given defineCommands has been given the operation "send"
    And appendCommand has appended "send" to <lcty-c>
    And the operation "send" is released
    When abort() of the command is called
    Then the AbortSignal given to "send" is not aborted
    And the command's state is "done" and it has no slot

  Scenario: A failing operation marks the command failed
    Given defineCommands has been given the operation "send", which throws an error
    When appendCommand appends "send" to <lcty-c>
    Then the command's state is "failed" and it has no slot
    And the console shows the error "lcty-cmd send failed"

  Scenario: A command runs only once
    Given defineCommands has been given the operation "send"
    And appendCommand has appended "send" to <lcty-c>
    And the operation "send" is released
    When the command is removed and appended to <lcty-c> again
    Then "send" has been called once
    And the command's state is "done" and it has no slot

  Scenario: Calling run() on a finished command does not run it again
    Given defineCommands has been given the operation "send"
    And appendCommand has appended "send" to <lcty-c>
    And the operation "send" is released
    When run() of the command is called
    Then "send" has been called once
    And the command's state is "done" and it has no slot

  Scenario: defineCommands can be called again to add operations
    Given defineCommands has been given the operation "send"
    When defineCommands is given the operation "summarize"
    Then <lcty-cmd> is still defined by the same class
    And appendCommand appending "summarize" to <lcty-c> calls "summarize" once
    And "send" has not been called

  Scenario: A command shows a spinner, a label and a stop button in its Shadow DOM
    Given defineCommands has been given the operation "send"
    When a <lcty-cmd> is created
    Then its Shadow DOM is a box holding a spinner, the label "Generating…" and the button "Stop"
    And they have the parts lcty-cmd__box, lcty-cmd__spinner, lcty-cmd__label and "lcty-cmd__stop lcty-button"
    And its fields label and stopButton are the label and the button

  Scenario: A command's texts follow the page's language
    Given the page is in Japanese
    And defineCommands has been given the operation "send"
    When a <lcty-cmd> is created
    Then its label reads "生成中…" and its button "停止"
