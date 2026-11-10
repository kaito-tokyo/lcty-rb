# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The conversation page /c/<id>.html (LCTYSP-0003 for the title, LCTYSP-0004 for sending, undo, regenerate, fork,
# stopping and errors, LCTYSP-0005 for the page, its elements and the rendering of a reply, LCTYSP-0009 for the tags).
# Each Scenario is a test of the same title in tests/ui/conversation.spec.js, whose steps are the lines below.

Feature: LCTYSP-2002 The conversation page

  A conversation file is a page of its own: /c/<id>.html shows the frame <lcty-c> with the sidebar, the header (the
  title, the tags and the delete button), the messages and the composer, and its features module lets the user send a
  message, undo the last turn, regenerate the last reply, fork from a user message, stop a generation and delete the
  conversation, and saves every change on the server. Each Scenario creates its conversation through the HTTP API
  (LCTYSP-0006), most of them one of two finished turns ("最初の質問", "最初の答え", "二番目の質問", "二番目の答え"),
  and llama-server is the fake of tests/ui/fixtures.js, whose replies each Scenario queues. A message is sent by typing
  it into the composer and pressing Enter. The action buttons of a message show only while it is hovered, so a step
  that looks at one or clicks it hovers the message first.

  # ---- Opening ----

  Scenario: Opening a conversation loads its frame, its features and the sidebar
    Given a tag whose display name is its file-name part in upper case
    And a conversation with that tag, created through the API
    When its page /c/<id>.html is opened, while the page errors and the answers of the site are recorded
    Then the frame <lcty-c> is defined
    And the features module has started: <lcty-c> has data-tag-defs
    And the sidebar lists the conversation as current
    And the tag chip in the header shows the tag's display name
    And no page error happened and no request of the site was answered with a status of 400 or more

  # ---- Sending ----

  Scenario: A message sent on the conversation page gets a reply and both are saved
    Given a conversation of two finished turns is open
    And llama-server will reply "三番目の答え"
    When "三番目の質問" is sent
    Then the composer is emptied
    And the page shows six messages
    And the last reply is written with the text "三番目の答え", and neither the lock nor the draft is left
    And the whole history went to llama-server
    And the server has saved six messages
    And after a reload the page shows six messages

  Scenario: A reply starting with a level-1 heading becomes the title
    Given a conversation of two finished turns is open
    And llama-server will reply "# 見出しのタイトル\n\n本文です。"
    When "タイトルを付けて" is sent
    Then the page's title is "見出しのタイトル"
    And the title field in the header holds "見出しのタイトル"

  Scenario: Editing the title in the header saves it
    Given a conversation of two finished turns is open
    When "手で付けたタイトル" is typed into the title field in the header, Enter is pressed and the field loses focus
    Then the page's title is "手で付けたタイトル"
    And the server has saved the title "手で付けたタイトル"

  # ---- Rendering a reply (LCTYSP-0005) ----

  Scenario: Markdown is rendered and raw HTML or script URLs never reach the DOM
    Given a conversation of two finished turns is open
    And llama-server will reply with bold text, code, a raw <img> with an onerror, a javascript: link and an https link
    When "Markdown を返して" is sent
    Then the last reply is written
    And the bold text is a <strong> and the code a <code>
    And the reply has no <img> and shows the raw <img> as text
    And the reply has no javascript: link, and the https link is a link with its text
    And no script of the reply has run

  Scenario: A reply's thinking is shown collapsed
    Given a conversation of two finished turns is open
    And llama-server will reply with the thinking "まず考えます。" and the text "考えた結果です。"
    When "考えて" is sent
    Then an lcty-thinking of "まず考えます。" is written just before the last reply
    And it is shown collapsed, under "思考（7 文字）"

  Scenario: Suggested next messages are buttons that fill the composer
    Given a conversation of two finished turns is open
    And llama-server will reply "答えです。" with the suggestions "もっと詳しく" and "例を挙げて"
    When "提案して" is sent
    Then the last reply shows the suggestions as the buttons "もっと詳しく" and "例を挙げて"
    When the button "例を挙げて" is clicked
    Then the composer holds "例を挙げて" and has the focus

  Scenario: A long suggestion wraps inside the reply instead of overflowing
    Given a conversation of two finished turns is open
    And llama-server will reply "答えです。" with one suggestion of "とても長い提案の文章です。" repeated 20 times
    When "長い提案を" is sent
    Then the last reply shows the suggestion as a button
    And the button ends inside the reply's text
    And the button is more than one line high

  # ---- Undo, regenerate and fork (LCTYSP-0004) ----

  Scenario: Only the last user message has undo, and only the last reply has regenerate
    Given a conversation of two finished turns is open
    Then undo is hidden on the first user message and shown on the second
    And regenerate is hidden on the first reply and shown on the second
    And fork is shown on both user messages

  Scenario: The actions show only while the message is hovered
    Given a conversation of two finished turns is open
    When the mouse is moved to the top left corner of the page
    Then the fork button of the first user message is hidden
    When the first user message is hovered
    Then its fork button is shown

  Scenario: Undo removes the last turn and puts the message back into the composer
    Given a conversation of two finished turns is open
    When undo is clicked on the last user message
    Then the page shows two messages
    And the composer holds "二番目の質問" and has the focus
    And the server has saved two messages
    When undo is clicked on the last user message again
    Then the page shows no message
    And the server has saved no message

  Scenario: Regenerate replaces only the last reply
    Given a conversation of two finished turns is open
    And llama-server will reply "作り直した答え"
    When regenerate is clicked on the last reply
    Then the page shows four messages
    And the last reply shows "作り直した答え" and the first one still "最初の答え"
    And the last message the server has saved is "作り直した答え"

  Scenario: Fork from here moves to the new conversation page /c/ with the source and the message index
    Given a conversation of two finished turns is open
    When fork is clicked on the first user message
    Then the browser goes to /c/?fork=<id>&at=0
    And the composer holds "最初の質問"

  # ---- Stopping and errors (LCTYSP-0004) ----

  Scenario: The stop button ends the generation and leaves the lock with the error
    Given a conversation of two finished turns is open
    And llama-server will never answer
    When "止める質問" is sent
    Then the draft reply is streaming after the lock and <lcty-c> is busy
    When the stop button is clicked
    Then the lock is the last element with the error "停止しました", and the draft is gone
    And it reads "中断しました: 停止しました" with Retry and Remove
    And <lcty-c> is no longer busy
    And the server has saved five messages

  Scenario: An error from llama-server leaves the lock with the error
    Given a conversation of two finished turns is open
    And llama-server will answer the status 500 with the error "model is not loaded"
    When "失敗する質問" is sent
    Then the lock is the last element with an error that holds "model is not loaded"
    And the server has saved five messages
    When Remove is clicked
    Then the lock is gone and the last element is the user message "失敗する質問"

  Scenario: Retry takes the lock again and generates the reply
    Given a conversation of two finished turns is open
    And llama-server will answer the status 500 with the error "model is not loaded" and then reply "やり直した答え"
    When "やり直す質問" is sent and Retry is clicked once the lock shows its error
    Then the last reply is written with the text "やり直した答え"
    And the server has saved six messages

  # ---- Locks and other tabs (LCTYSP-0013, LCTYSP-0014) ----

  Scenario: A lock that no tab holds is shown with Retry and Remove
    Given a conversation of one user message whose file ends with an lcty-cmd send that no page holds
    When it is opened
    Then the lock reads "返信が途中のまま残っています" with Retry and Remove
    And llama-server is sent nothing

  Scenario: A change by another tab makes the page ask for a reload
    Given a conversation of two finished turns is open
    When another connection appends a user message to it through /v1/rpc
    Then the composer is disabled and asks for a reload
    And the page sends nothing more when "送らない質問" is typed and Enter is pressed

  Scenario: A conversation of the format before lcty-msg is shown read-only
    Given a conversation of two finished turns created through the HTTP API, in the format of LCTYSP-0003
    When it is opened
    Then the page shows its four messages
    And the composer is disabled and says that the conversation is in the former format

  # ---- Deleting ----

  Scenario: Deleting the conversation asks first and returns to the new conversation page /c/
    Given a conversation of two finished turns is open
    When the delete button is clicked and the confirmation is dismissed
    Then the page stays at /c/<id>.html
    When the delete button is clicked and the confirmation is accepted
    Then the browser goes to /c/
    And GET /v1/conversations/<id> answers 404
