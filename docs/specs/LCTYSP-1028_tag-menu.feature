# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/ui/tag-menu.js that needs no browser (LCTYSP-0007, LCTYSP-0009). Each Scenario is a test
# of the same title in tests/unit/tag-menu.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1028 The tag menu's search term

  Choosing a tag in the sidebar's tag menu puts tag:<name> in the search box (LCTYSP-0009). addTagTerm adds the term at
  the end of the query and keeps the other terms, so tags combine (the search wants every tag: term, LCTYSP-0007); a
  query that already has a tag: term for the same tag, as a part (tag:C# and tag:c~23 are one tag), keeps its terms as
  they are. The terms come back joined by single spaces. The menu itself, in the browser, is LCTYSP-2003.

  Scenario Outline: addTagTerm adds the tag to the query
    When addTagTerm is given the query <query> and the name <name>
    Then it returns <result>

    Examples:
      | case                        | query             | name   | result                   |
      | an empty query              | ""                | "Ruby" | "tag:Ruby"               |
      | a query of blanks           | "  "              | "Ruby" | "tag:Ruby"               |
      | words kept                  | "rails  api"      | "Ruby" | "rails api tag:Ruby"     |
      | another tag kept            | "tag:Go"          | "Ruby" | "tag:Go tag:Ruby"        |
      | the same tag                | "tag:Ruby x"      | "Ruby" | "tag:Ruby x"             |
      | the same tag in other case  | "tag:ruby"        | "Ruby" | "tag:ruby"               |
      | the same tag escaped        | "tag:c~23"        | "C#"   | "tag:c~23"               |
      | a word that is not a tag    | "Ruby"            | "Ruby" | "Ruby tag:Ruby"          |
      | a Japanese name             | "献立"            | "料理"  | "献立 tag:料理"           |
