# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/tags.js (LCTYSP-0002, LCTYSP-0006, LCTYSP-0009). Each Scenario is a test of the same title
# in tests/unit/tags.test.js (in Node.js) or tests/unit/tags.spec.js (in the browser), whose steps are the lines below.

Feature: LCTYSP-1018 Tags, drafts and memory

  The tags of LCTYSP-0009 in the browser. sortTags puts tag names in the order of the definitions and composeDraft
  builds the system prompt draft of a new conversation from the chosen tags. renderTagsEditor draws the editor of the
  definitions and their memory and saves it with PUT /v1/tags; initTagsDialog puts it in a modal <dialog id="tags-dialog">
  opened by a button (the sidebar's on every page). proposeMemory asks the model, as a continuation of a conversation,
  for memory items for its defined tags, and openMemoryDialog lets the user adopt, edit or drop each one and adds the
  adopted ones with POST /v1/tags/:name/memory. The server's answers and llama-server are answered by the test.

  Background:
    Given /v1/tags, /v1/tags/:name/memory and the llama-server at http://llm.test are answered by the test

  Scenario: Tag names are sorted in the order of the definitions
    Given the definitions "ruby", "go" and "rust"
    When sortTags sorts "rust", "zig", "ruby", "ada" and "rust"
    Then it returns "ruby", "rust", "zig" and "ada"

  Scenario: The draft follows the definitions, not the order of the choice
    Given the definitions "ruby" with a prompt and two memory items and "go" with a prompt and no memory
    When composeDraft composes the draft of "go" and "ruby"
    Then it is the prompt of "ruby", its memory under "# Memory (ruby)" and the prompt of "go", joined by blank lines

  Scenario: Empty prompts and blank memory items are left out of the draft
    Given the definitions "a" with a blank prompt and the memory items " x " and "  ", "b" with neither and "c" with the prompt " only "
    When composeDraft composes the draft of "a", "b" and "c"
    Then it is "# Memory (a)\n- x\n\nonly"
    And the draft of no tags is ""

  Scenario: The memory heading of the draft is in the page's language
    Given the page is in Japanese
    When composeDraft composes the draft of a tag "ruby" with the memory item "x"
    Then it is "# メモリ（ruby）\n- x"

  Scenario: The editor shows every definition with its memory
    Given a page on the server's origin
    Given the definitions "ruby" with a prompt and two memory items, "go" with none and "big" with six memory items
    When renderTagsEditor draws them
    Then it shows a section per tag with its name and prompt, in order
    And "ruby" shows its two memory items under "Memory (2 items, about 9 characters)", open
    And "go" shows "Memory (0 items, about 0 characters)" and "big" its six items, both closed
    And ↑ is disabled for the first tag only and ↓ for the last tag only
    And isDirty() is false

  Scenario: Moving a tag makes the editor dirty
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When ↓ of "ruby" is clicked
    Then the tags are in the order "go", "ruby"
    And isDirty() is true

  Scenario: Saving puts the definitions and takes the saved ones back
    Given a page on the server's origin
    Given the editor of the definitions "ruby" with the memory items "fact" and "  ", and "go"
    And GET /v1/tags will return the definitions with timestamps
    When the prompt of "ruby" is changed to "New prompt", a new tag "rust" is added and Save is clicked
    Then PUT /v1/tags is sent "ruby" with the new prompt and only the memory item "fact", "go" and "rust" without memory
    And onSaved is called with the definitions GET /v1/tags returned
    And the toast says "Tags saved", the status is empty and isDirty() is false

  Scenario Outline: A tag name that cannot be used is not saved
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to <name> and Save is clicked
    Then the status says <message>
    And nothing is sent to PUT /v1/tags
    And isDirty() is true

    Examples:
      | case        | name         | message                                                                                                           |
      | a space     | "a b"        | 'The tag name "a b" cannot be used (no spaces or ":", up to 40 characters)'                                       |
      | a colon     | "a:b"        | 'The tag name "a:b" cannot be used (no spaces or ":", up to 40 characters)'                                       |
      | empty       | ""           | 'The tag name "" cannot be used (no spaces or ":", up to 40 characters)'                                          |
      | 41 letters  | 41 times "x" | 'The tag name "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" cannot be used (no spaces or ":", up to 40 characters)' |
      | a duplicate | "ruby"       | "Tag names must be unique"                                                                                        |

  Scenario: A name is trimmed and may have 40 characters
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to " 40 times "y" " and Save is clicked
    Then PUT /v1/tags is sent the tags "ruby" and 40 times "y"

  Scenario: A failed save keeps the edits
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    And PUT /v1/tags answers with the status 500 and "boom"
    When the prompt of "ruby" is changed and Save is clicked
    Then the status says "Could not save: 500 boom"
    And onSaved is not called and isDirty() is true

  Scenario: A failed save keeps the blank memory items
    Given a page on the server's origin
    Given the editor of the definitions "ruby" with the memory items "fact" and "  ", and "go"
    And PUT /v1/tags answers with the status 500 and "boom"
    When Save is clicked
    Then PUT /v1/tags was sent "ruby" with only the memory item "fact"
    And the status says "Could not save: 500 boom"
    And isDirty() is false
    When ↓ of "ruby" is clicked
    Then "ruby" shows the memory items "fact" and "  "

  Scenario: Deleting a tag asks first
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When Delete of "ruby" is clicked and the question is dismissed
    Then the question was 'Delete the tag "ruby"? (Conversations keep the tag name.)'
    And the tags are still "ruby" and "go"
    When Delete of "ruby" is clicked and the question is accepted
    Then the tags are "go"

  Scenario: Deleting a memory item removes it at once
    Given a page on the server's origin
    Given the editor of the definitions "ruby" with a prompt and two memory items
    When Delete of the first memory item is clicked
    Then "ruby" shows one memory item under "Memory (1 items, about 5 characters)"
    And isDirty() is true

  Scenario: Discarding the changes asks first and goes back to the saved state
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    And the name of "go" is changed to "golang"
    When Discard changes is clicked and the question is dismissed
    Then the tags are "ruby" and "golang"
    When Discard changes is clicked and the question is accepted
    Then the tags are "ruby" and "go"
    And isDirty() is false

  Scenario: The tags dialog opens on the saved definitions
    Given a page on the server's origin
    Given initTagsDialog has wired a button
    And GET /v1/tags returns the definitions "ruby" and "go"
    When the button is clicked
    Then the modal dialog "#tags-dialog" is open with the editor of "ruby" and "go"
    And the function it returned opens it as well after the dialog is closed

  Scenario: The tags dialog stays closed when the definitions cannot be loaded
    Given a page on the server's origin
    Given initTagsDialog has wired a button
    And GET /v1/tags answers with the status 500 and "boom"
    When the button is clicked
    Then the toast says "Failed to load the tags: 500 boom"
    And the dialog is closed

  Scenario Outline: The tags dialog closes at once without edits
    Given a page on the server's origin
    Given initTagsDialog has wired a button
    And GET /v1/tags returns the definitions "ruby" and "go"
    And the button is clicked
    When <closing>
    Then the dialog is closed and nothing was asked

    Examples:
      | closing                 |
      | Close is clicked        |
      | Escape is pressed       |
      | the backdrop is clicked |

  Scenario: Closing the tags dialog with unsaved edits asks first
    Given a page on the server's origin
    Given initTagsDialog has wired a button
    And GET /v1/tags returns the definitions "ruby" and "go"
    And the button is clicked
    And the name of "go" is changed to "golang"
    When Close is clicked and the question is dismissed
    Then the question was "Close without saving? The unsaved changes are discarded."
    And the dialog is still open
    When Close is clicked and the question is accepted
    Then the dialog is closed

  Scenario: A memory proposal continues the conversation with one temporary message
    Given the definitions "ruby" with the memory item "existing", "go" without memory and "python"
    And a conversation with the tags "ruby", "unknown" and "go", the instructions "Be brief" and a user message, a reply and an empty reply
    And the model replies with proposals for "ruby", "python", "go" with blank text and "go"
    When proposeMemory asks for proposals with the backend "m" at http://llm.test/ and the key "k"
    Then one request is sent to http://llm.test/v1/responses with the key as a bearer token
    And its body has the backend's extra, the model "m", stream, the instructions and the conversation's user message and reply
    And its last input is the temporary user message listing the current memory of "ruby" and "go"
    And its response_format is the JSON schema "memory_proposals" with the tags "ruby" and "go"
    And it returns the trimmed proposals for "ruby" and "go", the tags "ruby" and "go" and the timings of the reply
    And the conversation's messages are unchanged

  Scenario: A conversation without defined tags gets no proposal
    Given the definitions "ruby"
    And a conversation with the tags "unknown"
    When proposeMemory asks for proposals
    Then it throws "The conversation has no defined tags"
    And nothing is sent to the model

  Scenario: A reply without proposals proposes nothing
    Given the definitions "ruby"
    And a conversation with the tags "ruby"
    And the model replies with "{}"
    When proposeMemory asks for proposals
    Then it returns no proposals and the tags "ruby"

  Scenario Outline: A failed proposal throws
    Given the definitions "ruby"
    And a conversation with the tags "ruby"
    And the model <answer>
    When proposeMemory asks for proposals
    Then it throws "<message>"

    Examples:
      | answer                                 | message                             |
      | replies with text that is not JSON     | Could not read the proposal as JSON |
      | replies with "null"                    | Could not read the proposal as JSON |
      | replies with a list                    | Could not read the proposal as JSON |
      | replies with proposals that is a text  | Could not read the proposal as JSON |
      | sends the error event "overloaded"     | overloaded                          |
      | answers with the status 500 and "boom" | HTTP 500: boom                      |

  Scenario: Proposals that are not objects are skipped
    Given the definitions "ruby"
    And a conversation with the tags "ruby"
    And the model replies with the proposals null, 5, "x", a list and one for "ruby"
    When proposeMemory asks for proposals
    Then it returns only the proposal for "ruby"

  Scenario: The memory dialog shows every proposal, adopted
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    When openMemoryDialog shows the proposals "A" for "ruby" and "B" for "go" with the tags "ruby" and "go"
    Then "#memory-dialog" is open as a modal dialog
    And it shows two proposals, each with a checked "Adopt" box, a choice of "ruby" and "go" with its tag chosen, and its text
    And it has the buttons "Close" and "Add the adopted items"

  Scenario: The adopted proposals are added as edited
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    And openMemoryDialog shows the proposals "A" for "ruby", "B" for "go" and "C" for "ruby" with the source of the conversation
    When the text of "A" is changed to "  A2  ", the tag of "B" to "ruby", "C" is not adopted and Add the adopted items is clicked
    Then POST /v1/tags/ruby/memory is sent "A2" and then "B", each with the source
    And the dialog is closed, onDone is called and the toast says "Added 2 items to memory"

  Scenario: Adding nothing adopted sends nothing
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    And openMemoryDialog shows the proposals "A" for "ruby" and "B" for "go"
    When "A" is not adopted, the text of "B" is made blank and Add the adopted items is clicked
    Then nothing is sent to POST /v1/tags/:name/memory
    And the dialog is closed, onDone is called and the toast says "Nothing was added"

  Scenario: A failed addition keeps the dialog open
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    And openMemoryDialog shows the proposal "A" for "ruby"
    And POST /v1/tags/ruby/memory answers with the status 404 and "no such tag"
    When Add the adopted items is clicked
    Then the dialog says "Could not add: 404 no such tag"
    And the dialog is still open and onDone is not called

  Scenario: The memory dialog without proposals says so
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    When openMemoryDialog shows no proposals
    Then it says "Nothing to add was found."
    And it has only the button "Close"
    When Close is clicked
    Then the dialog is closed and onDone is not called
