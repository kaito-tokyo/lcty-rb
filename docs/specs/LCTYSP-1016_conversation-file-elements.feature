# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/c/lcty.v1.mjs and the classic script generated from it, public/c/lcty.v1.js (LCTYSP-0003
# "File layout", "Elements" and "Characters XML cannot represent"; LCTYSP-0005 "The lcty.v1 files", "Custom elements"
# and "UI texts"; LCTYSP-0010 for the sidebar's cached list). The attributes the elements read are the ones
# lib/conv_html.rb writes (LCTYSP-3002). Each Scenario is a test of the same title in
# tests/unit/conversation-file-elements.spec.js, whose steps are the lines below.

Feature: LCTYSP-1016 The elements of a conversation file

  A conversation file loads /c/lcty.v1.js in its <head>, a classic script generated from /c/lcty.v1.mjs, which
  declares LctyT (the UI texts) and the custom elements, and defines them at its end: <lcty-c> (the frame), <lcty-setup>
  (the system prompt), <lcty-message>, <lcty-composer>, <lcty-sidebar> and its <lcty-conv-list>. They build their
  structure in Shadow DOM from their own attributes only, so the page is settled at the first paint, before any module
  has loaded; the features are /c/lcty.v1.module.js, which <lcty-c> imports once the page has loaded. In these steps
  that module is an empty module, and a text in quotes is a JSON string ("\u001b" is ESC).

  Background:
    Given a page on the server's origin
    And /c/lcty.v1.module.js is an empty module

  # ---- lcty.v1.js and lcty.v1.mjs ----

  Scenario: lcty.v1.js is lcty.v1.mjs converted by the command in its head
    When /c/lcty.v1.mjs and /c/lcty.v1.js are fetched
    Then lcty.v1.mjs's head comment holds the command that turns "export" at a line start into "/*export*/" and drops "//?" at a line start
    And lcty.v1.js is lcty.v1.mjs with those two replacements, ending with a newline

  Scenario: lcty.v1.js defines the elements with the classes it declares
    Then "lcty-conv-list", "lcty-sidebar", "lcty-c", "lcty-setup", "lcty-message" and "lcty-composer" are defined
    And each is defined by its global class: LctyConvListElement, LctySidebarElement, LctyCElement, LctySetupElement, LctyMessageElement and LctyComposerElement
    And "lcty-cmd" is not defined

  Scenario: lcty.v1.mjs defines nothing by itself and defineLctyV1CustomElements defines the elements in a registry
    When /c/lcty.v1.mjs is imported as a module
    Then it exports LctyT, the six element classes and defineLctyV1CustomElements
    And "lcty-c" is still defined by the global LctyCElement
    When defineLctyV1CustomElements is given a registry that records what is defined
    Then the registry is given "lcty-conv-list", "lcty-sidebar", "lcty-c", "lcty-setup", "lcty-message" and "lcty-composer", in that order, with the module's classes

  # ---- LctyT ----

  Scenario: LctyT._ returns the text of the page's language
    Given the page is in Japanese
    When LctyT._("stop", "Stop") is called
    Then it returns "停止"
    And with the language "en" given, it returns "Stop"

  Scenario Outline: LctyT._ falls back to the given text
    Given LctyT.addLang("xx", {"word": "Word", "empty": ""}) has been called
    When LctyT._("<key>", "Text", "<lang>") is called
    Then it returns "<result>"

    Examples:
      | case                              | key      | lang        | result |
      | a translated key                  | word     | xx          | Word   |
      | an empty translation              | empty    | xx          | Text   |
      | a missing key                     | other    | xx          | Text   |
      | a key inherited from Object       | toString | xx          | Text   |
      | a language that is not registered | word     | yy          | Text   |
      | a language inherited from Object  | word     | constructor | Text   |

  Scenario: LctyT._ without a text shows undefined
    When LctyT._("noSuchKey") is called
    Then it returns "undefined"

  Scenario: A registered table is frozen
    When LctyT.addLang("xx", {"word": "Word"}) is called
    Then LctyT.dicts.xx is frozen
    And assigning "Other" to its "word" leaves LctyT._("word", "Text", "xx") returning "Word"

  # ---- <lcty-setup> ----

  Scenario: The system prompt is shown collapsed
    Given the body holds <lcty-setup data-instructions="Be brief.&#10;Use Ruby."></lcty-setup>
    Then its Shadow DOM is a closed <details> (part lcty-setup__details) holding the <summary> "System prompt" (part lcty-setup__summary) and a <pre> (part lcty-setup__text)
    And the <pre> is its field text and reads "Be brief.\nUse Ruby."

  Scenario Outline: The system prompt is read from data-instructions-base64 when it is there
    Given the body holds <lcty-setup <attributes>></lcty-setup>
    Then its text reads "<text>"

    Examples:
      | case                     | attributes                                                | text            |
      | base64 alone             | data-instructions-base64="G1sxbeaXpeacrOiqng=="           | \u001b[1m日本語 |
      | base64 over the plain    | data-instructions="plain" data-instructions-base64="AW9r" | \u0001ok        |
      | a leading BOM            | data-instructions-base64="77u/eA=="                       | \ufeffx         |
      | an empty base64          | data-instructions="plain" data-instructions-base64=""     |                 |
      | base64 that is invalid   | data-instructions="plain" data-instructions-base64="!!!"  |                 |
      | bytes that are not UTF-8 | data-instructions="plain" data-instructions-base64="/w==" |                 |
      | no attribute             | class="none"                                              |                 |

  Scenario: Changing the attributes changes the system prompt
    Given the body holds <lcty-setup data-instructions="first"></lcty-setup>
    When data-instructions is set to "second"
    Then its text reads "second"
    When data-instructions-base64 is set to "AW9r"
    Then its text reads "\u0001ok"
    When data-instructions-base64 is removed
    Then its text reads "second"

  # ---- <lcty-message> ----

  Scenario: A user message has a head with undo and fork, its content and a hidden foot
    Given the body holds <lcty-message data-role="user"><div class="user-text">Hi</div></lcty-message>
    Then its Shadow DOM is the head (part lcty-message__head), a <slot> and the foot (part lcty-message__foot), which is hidden
    And the head holds the who "You" (part lcty-message__who) and the actions (part lcty-message__actions) "Undo" and "Fork from here"
    And the actions are its fields undoButton and forkButton, with the parts "lcty-message__action lcty-message__action--undo lcty-button" and "lcty-message__action lcty-message__action--fork lcty-button"
    And its fields regenerateButton, thinking, thinkingSummary and thinkingBody are null
    And the <slot> shows the div.user-text

  Scenario: An assistant message has a head with regenerate and a hidden thinking
    Given the body holds <lcty-message data-role="assistant"><article>Hello</article></lcty-message>
    Then its Shadow DOM is the head, the thinking (part lcty-message__thinking), a <slot> and the foot
    And the head holds the who "Assistant" and the action "Regenerate", its field regenerateButton, with the part "lcty-message__action lcty-message__action--regenerate lcty-button"
    And its fields undoButton and forkButton are null
    And the thinking is a closed, hidden <details> holding a <summary> (part lcty-message__thinking-summary) and a <div> (part lcty-message__thinking-body)

  Scenario: Setting the role rebuilds the head and replaces the fields
    Given a <lcty-message> is created without a role
    Then its who is empty and it has no actions
    When data-role is set to "user"
    Then its Shadow DOM is built again, with the actions "Undo" and "Fork from here"
    When data-role is set to "assistant"
    Then its Shadow DOM is built again, with the action "Regenerate", and undoButton is null

  Scenario Outline: A reply's thinking is shown from its attributes
    Given the body holds <lcty-message data-role="assistant" <attributes>></lcty-message>
    Then the thinking is <shown>, with the summary "<summary>" and the body "<body>"

    Examples:
      | case                   | attributes                                        | shown  | summary                 | body     |
      | data-thinking          | data-thinking="abc"                               | shown  | Thinking (3 characters) | abc      |
      | base64 over the plain  | data-thinking="plain" data-thinking-base64="AW9r" | shown  | Thinking (3 characters) | \u0001ok |
      | a leading BOM          | data-thinking-base64="77u/eA=="                   | shown  | Thinking (2 characters) | \ufeffx  |
      | base64 that is invalid | data-thinking="plain" data-thinking-base64="!!!"  | hidden | Thinking (0 characters) |          |
      | an empty data-thinking | data-thinking=""                                  | hidden | Thinking (0 characters) |          |

  Scenario: A thinking set before the role is shown once the role is assistant
    Given a <lcty-message> is created without a role
    And data-thinking is set to "abc"
    When data-role is set to "assistant"
    Then the thinking is shown, with the summary "Thinking (3 characters)" and the body "abc"

  Scenario: A user message never shows a thinking
    Given the body holds <lcty-message data-role="user" data-thinking="abc"></lcty-message>
    Then its Shadow DOM has no <details>
    And its field thinking is null

  Scenario Outline: The foot shows why a reply ended and the timings button
    Given the body holds <lcty-message data-role="assistant" <attributes>></lcty-message>
    Then the status reads "<status>", the ⓘ is <info> and the foot is <foot>

    Examples:
      | case                    | attributes                                    | status         | info   | foot   |
      | completed               | data-status="completed"                       |                | hidden | hidden |
      | stopped                 | data-status="incomplete"                      | Stopped        | hidden | shown  |
      | failed                  | data-status="incomplete" data-error="Timeout" | Error: Timeout | hidden | shown  |
      | an error of a completed | data-status="completed" data-error="Timeout"  |                | hidden | hidden |
      | timings                 | data-status="completed" data-timings="{}"     |                | shown  | shown  |
      | client                  | data-status="completed" data-client="{}"      |                | shown  | shown  |

  Scenario: The foot follows its attributes as they change
    Given the body holds <lcty-message data-role="assistant" data-status="incomplete"></lcty-message>
    When data-status is set to "completed"
    Then the status reads "", the ⓘ is hidden and the foot is hidden
    When data-timings is set to "{}"
    Then the status reads "", the ⓘ is shown and the foot is shown

  Scenario: The ⓘ opens the timings popover
    Given the body holds <lcty-message data-role="assistant" data-timings="{}"></lcty-message>
    Then the ⓘ is its field info, a button labelled "Timings" whose popovertarget is "timings"
    And its field timings is the <div id="timings"> with popover="auto" (part lcty-message__timings)
    When the ⓘ is clicked
    Then the timings popover is open

  # ---- <lcty-composer> ----

  Scenario: The composer is a form with a textarea, a send button and a stop button
    Given the body holds <lcty-composer></lcty-composer>
    Then its Shadow DOM is its field form (part lcty-composer__form)
    And the form holds its field input, a <textarea> with 2 rows, the placeholder "Message (Enter to send, Shift+Enter for a new line)" and the part lcty-composer__input
    And then a <div> (part lcty-composer__buttons) holding its field sendButton, the submit button "Send" (part "lcty-composer__send lcty-button lcty-button--primary"), and its field stopButton, the button "Stop" (part "lcty-composer__stop lcty-button")
    And its Shadow DOM adopts one style sheet, which styles the textarea

  # ---- <lcty-c> ----

  Scenario: The frame holds the sidebar, the header, the messages, the dock, the memory dialog and the end
    Given the document's title is "My chat"
    And the body holds <lcty-c id="c-conv"></lcty-c>
    Then its Shadow DOM is lcty-sidebar#sidebar, header#conv-header, <slot>, div#log-spacer, div#dock, dialog#memory-dialog and the end (part lcty-c__end)
    And the header holds its fields titleInput, tags (holding tagList and tagPicker), proposeMemoryButton and deleteButton
    And the dock holds div#float (holding its field toEndButton and <slot name="float">) and its field composer
    And its fields sidebar, dock and memoryDialog are those elements
    And the title field reads "My chat"
    And the sidebar exports the parts of the sidebar and its list, and the composer the parts of the composer

  Scenario: The frame's children are shown through its slots
    Given the body holds <lcty-c id="c-conv"> with a <lcty-setup>, a <lcty-message> and a <div slot="float">
    Then the default <slot> shows the <lcty-setup> and the <lcty-message>
    And <slot name="float"> shows the <div slot="float">

  Scenario: The tag chips follow data-setup-tags while there are no tag definitions
    Given the body holds <lcty-c id="c-conv" data-setup-tags="ruby  concise"></lcty-c>
    Then the tag list holds the chips "ruby" and "concise", neither marked unknown
    And the chip "ruby" has the title "Search tag:ruby" and a remove button "×" labelled "Remove ruby"
    And the picker has only the option "+ Tag" and is enabled

  Scenario: Tag definitions mark the unknown chips and fill the picker
    Given the body holds <lcty-c id="c-conv" data-setup-tags="ruby concise" data-tag-defs="go ruby python"></lcty-c>
    Then the chip "concise" is marked unknown, with the class "tag-chip unknown", the part "lcty-c__tag lcty-c__tag--unknown" and the title "Undefined tag"
    And the chip "ruby" is not marked unknown
    And the picker has the options "+ Tag", "go" and "python" and is enabled

  Scenario: Defined tags show their display names from data-tag-names
    Given the body holds <lcty-c id="c-conv" data-setup-tags="c~23 gone" data-tag-defs="c~23 ruby" data-tag-names="C# Ruby"></lcty-c>
    Then the chip "c~23" shows "C#", has the title "Search tag:C#" and a remove button labelled "Remove C#"
    And the chip "gone" is marked unknown and shows "gone"
    And the picker has the options "+ Tag" and "Ruby", whose value is "ruby"

  Scenario Outline: The picker is disabled when there is no tag to add
    Given the body holds <lcty-c id="c-conv" data-setup-tags="ruby" data-tag-defs="<defs>"></lcty-c>
    Then the picker has only the option "+ Tag" and is disabled

    Examples:
      | case                     | defs |
      | every definition is used | ruby |
      | no tag is defined        |      |

  Scenario: Changing data-setup-tags rebuilds the chips
    Given the body holds <lcty-c id="c-conv" data-setup-tags="ruby" data-tag-defs="ruby go"></lcty-c>
    When data-setup-tags is set to "go"
    Then the tag list holds the chip "go" only
    And the picker has the options "+ Tag" and "ruby" and is enabled

  Scenario: The frame marks its conversation as the current one in the sidebar
    Given the body holds <lcty-c id="c-abc"></lcty-c>
    When its sidebar's list is shown the conversations "abc" and "def"
    Then the item "abc" is current, with aria-current="true" and the part "lcty-conv-list__item lcty-conv-list__item--current"
    And the item "def" is not current

  Scenario: The frame imports the page's features once, after the page has loaded
    Given the body holds two <lcty-c> elements
    When the page has loaded
    Then /c/lcty.v1.module.js has been requested once

  Scenario: "Scroll to bottom" shows while the end of the page is out of view
    Given the body holds <lcty-c id="c-conv"> with a message 3000px tall
    Then the toEndButton "Scroll to bottom" is shown
    When it is clicked
    Then the page is scrolled to its bottom
    And the toEndButton is hidden

  # ---- <lcty-conv-list> and <lcty-sidebar> ----

  Scenario: The conversation list shows each conversation as a link
    Given the body holds <lcty-conv-list></lcty-conv-list>
    When show() is given "a" titled "Alpha" with 2 messages, the tag "ruby" and a snippet, and "b" without a title for the chunk "0190abcd"
    Then the list is a <ul> (part lcty-conv-list__items) of two <li> (part lcty-conv-list__entry)
    And the first is a link to "../c/a.html" with data-id "a" holding the title "Alpha", the snippet, the tag chip "ruby" titled "Search tag:ruby" and the meta "2026-11-02 03:04 · 2 messages"
    And the second is a link to "../c/b.html#c-msg-0190abcd" with data-chunk "0190abcd" holding the title "(untitled)" and the meta "2026-11-02 03:04"

  Scenario: An empty list shows its empty text when it is given one
    Given the body holds <lcty-conv-list></lcty-conv-list>
    When show() is given no conversations and the text "No chats"
    Then the list is a <p> (part lcty-conv-list__empty) reading "No chats"
    When show() is given no conversations and no text
    Then the list is an empty <ul>

  Scenario: Cached items are shown only until show() has been called
    Given the body holds <lcty-conv-list></lcty-conv-list>
    When showCached() is given the conversation "a"
    Then the list shows "a"
    When show() is given the conversation "b"
    And showCached() is given the conversation "c"
    Then the list shows "b"

  Scenario Outline: A click on an item is offered to the page first
    Given the body holds <lcty-conv-list> showing the conversation "a" for the chunk "c1"
    And the page <handles> select
    When the item is clicked <how>
    Then select is <fired>
    And the link is <followed>

    Examples:
      | case                   | handles         | how                     | fired                                   | followed     |
      | handled                | cancels         | with the primary button | fired with {"id": "a", "chunkId": "c1"} | not followed |
      | not handled            | does not cancel | with the primary button | fired with {"id": "a", "chunkId": "c1"} | followed     |
      | with a modifier        | cancels         | with Ctrl held          | not fired                               | followed     |
      | with the middle button | cancels         | with the middle button  | not fired                               | followed     |

  Scenario: A click on a tag chip fires tag instead of select
    Given the body holds <lcty-conv-list> showing the conversation "a" with the tag "ruby"
    When the tag name "ruby" is clicked
    Then tag is fired with {"name": "ruby"}
    And select is not fired
    And the link is not followed

  Scenario: A tag chip shows the display name of its reference
    Given the body holds <lcty-conv-list data-tag-defs="c~23 ruby" data-tag-names="C# Ruby"></lcty-conv-list>
    When show() is given "a" with the tags "c~23" and "gone"
    Then the chips show "C#" titled "Search tag:C#" with data-tag "c~23", and "gone" titled "Search tag:gone" with data-tag "gone"

  Scenario: Setting the tag names redraws the chips, and a click fires the shown name
    Given the body holds <lcty-conv-list> showing the conversation "a" with the tag "c~23"
    When data-tag-defs is set to "c~23" and data-tag-names to "C#"
    Then the chip shows "C#"
    When the tag name "C#" is clicked
    Then tag is fired with {"name": "C#"}

  Scenario: The sidebar holds its links, the search box and the list
    Given the body holds <lcty-sidebar></lcty-sidebar>
    Then its Shadow DOM is its field nav, the search box and its field list (part lcty-sidebar__list)
    And the nav holds the link "+ New chat" to "../c/" opening in a new window, and the buttons "Tags", "↻" and "⚙︎" titled "Edit tags", "Reload the list" and "Settings"
    And they have the parts "lcty-sidebar__new lcty-sidebar__link lcty-button lcty-button--primary", "lcty-sidebar__tags lcty-sidebar__link lcty-button", "lcty-sidebar__refresh lcty-sidebar__link lcty-button" and "lcty-sidebar__settings lcty-sidebar__link lcty-button"
    And the search box holds its field search, a search field with the placeholder "Search chats", and its field searchStatus

  Scenario: The sidebar's list is filled from the snapshot in localStorage
    Given localStorage "lcty.meta.v1" holds "a" updated on 2026-11-01, "b" updated on 2026-11-03, "c" updated on 2026-11-03 and a broken entry
    And the database "lcty_c" holds "z" in "c_meta"
    When a <lcty-sidebar> is put into the body
    Then its list shows "c", "b" and "a", in that order
    And the item "a" shows its tags_hint as tags and its messages_hint as the count

  Scenario Outline: The sidebar's list is filled from IndexedDB when there is no usable snapshot
    Given localStorage "lcty.meta.v1" <snapshot>
    And the database "lcty_c" holds "a" updated on 2026-11-01 and "b" updated on 2026-11-03 in "c_meta"
    When a <lcty-sidebar> is put into the body
    Then its list shows "b" and "a", in that order

    Examples:
      | snapshot         |
      | is not set       |
      | holds []         |
      | holds "not json" |
      | holds {"a": 1}   |

  Scenario: The sidebar names its list's tags from the browser's copy of the tags
    Given "t_full" of the database "lcty_t" holds the tag file "00010-c~23.html" named "C#" and "00020-ruby.html" named "Ruby"
    When a <lcty-sidebar> is put into the body
    Then its list's data-tag-defs becomes "c~23 ruby" and data-tag-names "C# Ruby"

  Scenario: The sidebar never creates the database
    Given there is no database "lcty_c"
    When a <lcty-sidebar> is put into the body
    Then its list is empty
    And there is still no database "lcty_c"

  # ---- Languages ----

  Scenario: The elements' texts follow the page's language
    Given the page is in Japanese
    When the body is given <lcty-setup data-instructions="x">, a user message, an assistant message with data-status="incomplete" and data-thinking="abc", <lcty-composer> and <lcty-conv-list> showing an untitled conversation
    Then the system prompt's summary reads "システムプロンプト"
    And the messages' who read "あなた" and "アシスタント"
    And the assistant's status reads "停止しました" and its thinking "思考（3 文字）"
    And the composer's buttons read "送信" and "停止"
    And the untitled conversation reads "(無題)"
