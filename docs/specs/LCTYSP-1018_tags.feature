# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/tags.js (LCTYSP-0002, LCTYSP-0006, LCTYSP-0009). Each Scenario is a test of the same title
# in tests/unit/tags.test.js (in Node.js) or tests/unit/tags.spec.js (in the browser), whose steps are the lines below.

Feature: LCTYSP-1018 Tags, drafts and memory

  The tags of LCTYSP-0009 in the browser. A tag is a tag file {file, name, ops, prompt, memory}: its file name
  NNNNN-<part>.html gives the draft order, and conversations refer to the tag by the part (the reference, see
  LCTYSP-1020), while the editor and the model see its display name. composeDraft builds the system prompt draft of a
  new conversation from the chosen references. renderTagsEditor draws the editor of the definitions and their memory
  and saves them with PUT /v1/tags, sending the ETag they were read with as If-Match and giving each tag its file name;
  the order is changed on the reorder page /t/, not in the editor. initTagsDialog puts the editor in a modal
  <dialog id="tags-dialog"> opened by a button (the sidebar's on every page). proposeMemory asks the model, as a
  continuation of a conversation, for memory items for its defined tags, and openMemoryDialog lets the user adopt, edit
  or drop each one and adds the adopted ones with POST /v1/tags/:file/memory. The server's answers and llama-server are
  answered by the test.

  In the steps the definitions "a", "b", … are the tag files "00010-a.html", "00020-b.html", … named "a", "b", … with
  no ops, unless a step gives the file or the name.

  Background:
    Given /v1/tags, /v1/tags/:file/memory and the llama-server at http://llm.test are answered by the test

  Scenario: The draft follows the tag files, not the order of the choice
    Given the tag files "00010-ruby.html" named "Ruby" with a prompt and two memory items and "00020-go.html" named "Go" with a prompt and no memory
    When composeDraft composes the draft of "go" and "ruby"
    Then it is the prompt of "Ruby", its memory under "# Memory (Ruby)" and the prompt of "Go", joined by blank lines

  Scenario: The draft chooses tags by their reference, not by their display name
    Given the tag file "00010-c~23.html" named "C#" with the prompt "Sharp" and the memory item "x"
    When composeDraft composes the draft of "C#" and of "c~23"
    Then the draft of "C#" is ""
    And the draft of "c~23" is "Sharp\n\n# Memory (C#)\n- x"

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
    And isDirty() is false

  Scenario: The order is changed on the reorder page, not in the editor
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    Then the head of each tag has its name and only the button "Delete"
    And the hint has the link "Change the order" to /t/ of the site

  Scenario: Saving puts the definitions and takes the saved ones back
    Given a page on the server's origin
    Given the editor of the definitions "ruby" with the memory items "fact" and "  ", and "go", read with the ETag "e1"
    And GET /v1/tags will return the definitions with timestamps and the ETag "e2"
    When the prompt of "ruby" is changed to "New prompt", a new tag "rust" is added and Save is clicked
    Then PUT /v1/tags is sent with If-Match "e1"
    And it is sent "00010-ruby.html" with the new prompt and only the memory item "fact", "00020-go.html" and "00030-rust.html" without memory
    And onSaved is called with the definitions GET /v1/tags returned
    And the toast says "Tags saved", the status is empty and isDirty() is false
    When the prompt of "go" is changed and Save is clicked
    Then the second PUT /v1/tags is sent with If-Match "e2"

  Scenario: Saving gives each tag its file name
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to "Golang", the new tags "C#" and "Café" typed decomposed are added and Save is clicked
    Then PUT /v1/tags is sent "00010-ruby.html" named "ruby", "00020-golang.html" named "Golang", "00030-c~23.html" named "C#" and "00040-café.html" named "Café", composed

  Scenario: A new tag is numbered after the largest number
    Given a page on the server's origin
    Given the editor of the tag files "00010-ruby.html" named "ruby" and "00050-go.html" named "go"
    When a new tag "rust" is added and Save is clicked
    Then PUT /v1/tags is sent the files "00010-ruby.html", "00050-go.html" and "00060-rust.html"

  Scenario: A tag name that breaks the rules is not saved, and the status says the rules
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to "a b" and Save is clicked
    Then the status says 'The tag name "a b" cannot be used (1 to 40 characters, no spaces, control characters or : ; / " ' ` ~ \ |)'
    And nothing is sent to PUT /v1/tags
    And isDirty() is true

  Scenario Outline: A tag name that cannot be used is not saved
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to <name> and Save is clicked
    Then the status says that the tag name <name> cannot be used
    And nothing is sent to PUT /v1/tags
    And isDirty() is true

    Examples:
      | case                  | name                  |
      | a colon               | "a:b"                 |
      | a semicolon           | "a;b"                 |
      | a slash               | "a/b"                 |
      | a tilde               | "a~b"                 |
      | a backslash           | "a\b"                 |
      | a vertical bar        | "a\|b"                |
      | a no-break space      | "a" U+00A0 "b"        |
      | a zero width joiner   | "a" U+200D "b"        |
      | a control character   | "a" U+0007 "b"        |
      | empty                 | ""                    |
      | 41 code points        | 41 times "x"          |
      | 41 astral characters  | 41 times "𝒳"          |

  Scenario Outline: A tag name with the file-name part of another tag is not saved
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to <name> and Save is clicked
    Then the status says "Tag names must be unique"
    And nothing is sent to PUT /v1/tags

    Examples:
      | case          | name   |
      | the same name | "ruby" |
      | another case  | "Ruby" |
      | upper case    | "RUBY" |

  Scenario: An invalid tag is shown without fields and sent back as it is
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and the invalid tag "00020-broken.html" named "broken"
    Then the second section has the name "broken", the button "Delete" and the note that "00020-broken.html" cannot be read, and no field
    When the prompt of "ruby" is changed to "New prompt" and Save is clicked
    Then PUT /v1/tags is sent "00010-ruby.html" with the new prompt and "00020-broken.html" as it was, with invalid true

  Scenario: A new tag with the file-name part of an invalid tag is not saved
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and the invalid tag "00020-broken.html" named "broken"
    When a new tag "Broken" is added and Save is clicked
    Then the status says "Tag names must be unique"
    And nothing is sent to PUT /v1/tags

  Scenario: A name is trimmed and may have 40 code points
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go"
    When the name of "go" is changed to " 40 times "𝒳" " and Save is clicked
    Then PUT /v1/tags is sent the tags "ruby" and 40 times "𝒳"

  Scenario: A save made stale elsewhere loads the tags again
    Given a page on the server's origin
    Given the editor of the definitions "ruby" and "go", read with the ETag "e1"
    And PUT /v1/tags answers with the status 412
    And GET /v1/tags will return the definitions "ruby", "go" and "rust" with the ETag "e2"
    When the name of "go" is changed to "golang" and Save is clicked
    Then the status says "The tags were changed elsewhere, so they were loaded again. Make the edit again."
    And the tags are "ruby", "go" and "rust" and isDirty() is false
    And onSaved is not called
    When the prompt of "rust" is changed and Save is clicked
    Then the second PUT /v1/tags is sent with If-Match "e2"

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
    Then PUT /v1/tags was sent "00010-ruby.html" with only the memory item "fact"
    And the status says "Could not save: 500 boom"
    And isDirty() is false
    When "+ New tag" is clicked
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
    And GET /v1/tags returns the definitions "ruby" and "go" with the ETag "e1"
    When the button is clicked
    Then the modal dialog "#tags-dialog" is open with the editor of "ruby" and "go"
    And Save in it sends PUT /v1/tags with If-Match "e1"
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
    Given the tag files "00010-ruby.html" named "Ruby" with the memory item "existing", "00020-go.html" named "Go" without memory and "00030-python.html" named "Python"
    And a conversation with the tags "ruby", "unknown" and "go", the instructions "Be brief" and a user message, a reply and an empty reply
    And the model replies with proposals for "Ruby", "ruby", "Python", "Go" with blank text and "Go"
    When proposeMemory asks for proposals with the backend "m" at http://llm.test/ and the key "k"
    Then one request is sent to http://llm.test/v1/responses with the key as a bearer token
    And its body has the backend's extra, the model "m", stream, the instructions and the conversation's user message and reply
    And its last input is the temporary user message listing the current memory of "Ruby" and "Go"
    And its response_format is the JSON schema "memory_proposals" with the tags "Ruby" and "Go"
    And it returns the trimmed proposals for "Ruby" and "Go" with their files, the tags "Ruby" and "Go" with their files and the timings of the reply
    And the conversation's messages are unchanged

  Scenario: A conversation without defined tags gets no proposal
    Given the definitions "ruby"
    And a conversation with the tags "unknown"
    When proposeMemory asks for proposals
    Then it throws "The conversation has no defined tags"
    And nothing is sent to the model

  Scenario: An invalid tag gets no proposal, like an undefined one
    Given the definitions "ruby" and the invalid tag "00020-broken.html" named "broken"
    And a conversation with the tags "broken"
    When proposeMemory asks for proposals
    Then it throws "The conversation has no defined tags"
    And nothing is sent to the model

  Scenario: A reply without proposals proposes nothing
    Given the definitions "ruby"
    And a conversation with the tags "ruby"
    And the model replies with "{}"
    When proposeMemory asks for proposals
    Then it returns no proposals and the tag "ruby" with the file "00010-ruby.html"

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
    When openMemoryDialog shows the proposals "A" for "Ruby" and "B" for "Go" with the tags "Ruby" of "00010-ruby.html" and "Go" of "00020-go.html"
    Then "#memory-dialog" is open as a modal dialog
    And it shows two proposals, each with a checked "Adopt" box, a choice of "Ruby" and "Go" with its tag chosen, and its text
    And the choices are the files "00010-ruby.html" and "00020-go.html"
    And it has the buttons "Close" and "Add the adopted items"

  Scenario: The adopted proposals are added as edited
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    And openMemoryDialog shows the proposals "A" for "Ruby", "B" for "Go" and "C" for "Ruby" with the source of the conversation
    When the text of "A" is changed to "  A2  ", the tag of "B" to "Ruby", "C" is not adopted and Add the adopted items is clicked
    Then POST /v1/tags/00010-ruby.html/memory is sent "A2" and then "B", each with the source
    And the dialog is closed, onDone is called and the toast says "Added 2 items to memory"

  Scenario: Adding nothing adopted sends nothing
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    And openMemoryDialog shows the proposals "A" for "Ruby" and "B" for "Go"
    When "A" is not adopted, the text of "B" is made blank and Add the adopted items is clicked
    Then nothing is sent to POST /v1/tags/:file/memory
    And the dialog is closed, onDone is called and the toast says "Nothing was added"

  Scenario: A failed addition keeps the dialog open
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    And openMemoryDialog shows the proposal "A" for "Ruby"
    And POST /v1/tags/00010-ruby.html/memory answers with the status 404 and "no such tag file"
    When Add the adopted items is clicked
    Then the dialog says "Could not add: 404 no such tag file"
    And the dialog is still open and onDone is not called

  Scenario: The memory dialog without proposals says so
    Given a page on the server's origin
    Given a <dialog id="memory-dialog"> in the page
    When openMemoryDialog shows no proposals
    Then it says "Nothing to add was found."
    And it has only the button "Close"
    When Close is clicked
    Then the dialog is closed and onDone is not called
