# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The tag reorder page /t/ and the pages of the tag files, /t/NNNNN-<part>.html (LCTYSP-0005, LCTYSP-0009). Each
# Scenario is a test of the same title in tests/ui/tag-order.spec.js, whose steps are the lines below.

Feature: LCTYSP-2004 The tag pages: /t/ and the tag files

  The reorder page /t/ lists the tags in the order of their files, lets the user move them and saves the new order,
  which renumbers the files (LCTYSP-0009). Each tag's name is a link to its file, /t/NNNNN-<part>.html, a page of its
  own that edits that tag alone. Both pages show the sidebar, like every page (LCTYSP-0005). The Scenarios make their
  tags through PUT /v1/tags; A and B stand for names the test makes unique, and since tag definitions are global, the
  tags are removed after each Scenario.

  Scenario: The tags dialog links to /t/, where moving a tag and saving renumbers the files
    Given the tags A, with a prompt and a memory, and B, in that order
    When the tags dialog is opened on the new conversation page /c/
    Then it has the link "並び順を変える"
    When the link is followed
    Then the browser is on /t/
    And the reorder page lists A and B in that order
    When the button "B を上へ" is pressed
    Then the reorder page lists B and A in that order
    When the button "保存" is pressed
    Then the toast says "タグを保存しました"
    And the server has the files "00010-B.html" and "00020-A.html", in that order
    And A keeps its name, its prompt and its memory

  Scenario: The reorder page does not list an invalid tag and sends it back as it is
    Given the tags A and B, in that order
    And GET /v1/tags also lists the invalid tag "00015-broken.html", and PUT /v1/tags is answered by the test
    When the reorder page /t/ is opened
    Then it lists A and B in that order, without the invalid tag
    When the button "B を上へ" is pressed, then the button "保存"
    Then the toast says "タグを保存しました"
    And one PUT was sent, with the files "00010-B.html", "00020-A.html" and "00015-broken.html", in that order
    And the invalid tag is sent back as it was received

  Scenario: A tag's name on the reorder page opens its file, which edits the tag and moves to its new file on a rename
    Given the tags A, with a prompt and a memory, and B, in that order
    When the reorder page /t/ is opened and the name B is followed
    Then the browser is on /t/00020-B.html, whose title is B
    And the page shows the sidebar
    And it shows the editor of B alone, whose name field holds B and can be edited
    When the name is changed to "Bx" and the editor's button "保存" is pressed
    Then the browser is on /t/00020-Bx.html, whose name field holds "Bx"
    And the server has the files "00010-A.html" named A and "00020-Bx.html" named "Bx", in that order
    And A keeps its memory

  Scenario: Deleting the tag on its file's page saves at once and goes to the reorder page
    Given the tags A and B, in that order
    When the page of A's file /t/00010-A.html is opened
    And the editor's button "削除" is pressed and the confirmation is accepted
    Then the browser is on /t/
    And the reorder page lists B alone
    And the server has the file "00020-B.html" alone

  Scenario: The reorder page shows the sidebar, whose links lead to /c/
    Given a conversation with a question and its answer
    When /t is opened
    Then the browser is on /t/
    When the conversation's link in the sidebar is followed
    Then the browser goes to the conversation's page /c/<id>.html

  Scenario: A tag named C# is the file 00010-c~23.html, and a conversation refers to it as c~23
    Given there are no tags
    When the tags dialog is opened on the new conversation page /c/
    And a new tag named "C#" is saved in it
    Then the new conversation's tag list has the value "c~23"
    And the server has the file "00010-c~23.html" named "C#" alone
    And the tag list shows the chip "C#"

  # The file name is not ASCII: the link, the URL and the server's answer carry it percent-encoded
  Scenario: A tag named in Japanese has a page that opens from the reorder page and edits the tag
    Given the tag "料理"
    And the page's errors and the site's responses are recorded
    When the reorder page /t/ is opened and the name "料理" is followed
    Then the browser is on /t/00010-料理.html, whose title is "料理"
    And the name field holds "料理" and can be edited
    And the tag file's module /t/tag-file.js has been loaded
    And no page error happened, and no request of the site was answered with a status of 400 or more
