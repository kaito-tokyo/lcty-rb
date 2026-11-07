# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/c/bundle.rb (LCTYSP-0011, LCTYSP-0005). Each Scenario is a test of the same title in
# tests/backend/bundle_test.rb, whose steps are the lines below.

Feature: LCTYSP-3009 Module bundler

  Chatty::C::Bundle.bundle(root, entry) turns the ES module entry, a path relative to root, and every module it imports
  into one module file. Each module becomes a block after a "// <path>" line, in evaluation order (dependencies first,
  depth-first, each module once). Its import lines become const aliases of $<index>$<name>, "export " is removed from
  the start of its lines, and a var at the end of the block publishes its exports as $<index>$<name>; nothing else of
  its code changes. It relies on conventions (single-line imports and exports, immutable exports, modules other than
  the entry only declaring at their top level) and raises Chatty::C::Bundle::Error, naming the file, the line and the
  reason, when a module breaks one. Each scenario writes its modules into a new temporary folder.

  Scenario: An entry without imports becomes one block
    Given the entry "index.js" holds "run();"
    When it is bundled
    Then the bundle is "// index.js", "{", "run();", "}"

  Scenario: An imported module comes before the entry and publishes its exports
    Given the entry "index.js" imports a and b from "./js/x.js" and calls run(a, b)
    And "js/x.js" exports the const a and the function b
    When it is bundled
    Then the block of "js/x.js" comes first, without "export ", and ends with "var $0$b = b, $0$a = a;"
    And the import line of the entry becomes "const a = $0$a, b = $0$b;"
    And the rest of the entry is kept as it is

  Scenario: An import wrapped over several lines becomes one line of aliases
    Given the entry imports a and b from "./x.js" with one name per line and single quotes
    And "x.js" exports the consts a and b
    When it is bundled
    Then the import becomes "const a = $0$a, b = $0$b;"

  Scenario: Modules are listed depth-first, dependencies first, each once
    Given the entry imports "./a.js" and then "./b.js"
    And both of them import "./c.js"
    When it is bundled
    Then the blocks are "c.js", "a.js", "b.js" and "index.js" in this order
    And a.js and b.js both alias $0$c

  Scenario: Import paths are resolved against the importing module
    Given the entry imports "./js/ui/a.js", which imports "../b.js"
    When it is bundled
    Then the blocks are "js/b.js", "js/ui/a.js" and "index.js"

  Scenario: Each module keeps its own names in its block
    Given the entry and the module "a.js" both declare the const x at their top level
    When it is bundled
    Then both declarations are kept as they are, each in its own block

  Scenario: The top level of a module may hold every kind of literal
    Given "a.js" holds regular expression, boolean, null, number, string, object and array consts, a const wrapped onto the next line, comments, and async and generator functions
    When it is bundled
    Then its code is kept as it is
    And it publishes its function exports and then its const exports

  Scenario: The entry may run code at its top level
    Given the entry defines an async function that awaits, and calls it
    When it is bundled
    Then the entry is kept as it is

  Scenario: An import cycle is rejected
    Given the entry imports "./a.js", "a.js" imports "./b.js" and "b.js" imports "./a.js"
    When it is bundled
    Then it fails with "import cycle: index.js -> a.js -> b.js -> a.js"

  Scenario: A missing module is rejected
    Given the entry imports "./missing.js", which does not exist
    When it is bundled
    Then it fails with "index.js: cannot find missing.js"

  Scenario: A missing entry is rejected
    Given there is no "nope.js"
    When "nope.js" is bundled
    Then it fails with "cannot find the entry nope.js"

  Scenario Outline: An import from outside the bundle's root is rejected
    Given the entry imports { a } from <spec>
    When it is bundled
    Then it fails with "index.js: <spec> is outside the bundle's root"

    Examples:
      | spec             |
      | "../a.js"        |
      | "./x/../../a.js" |

  Scenario: Importing a name the module does not export is rejected
    Given the entry imports a and z from "./a.js", which exports only a
    When it is bundled
    Then it fails with "index.js: a.js does not export z"

  Scenario Outline: Imports other than import { a, b } from "./x.js"; are rejected
    Given the entry starts with <line>
    When it is bundled
    Then it fails with "index.js:1: only import { a, b } from "./x.js"; is allowed: " and the line

    Examples:
      | line                              |
      | import x from "./a.js";           |
      | import { a as b } from "./a.js";  |
      | import * as a from "./a.js";      |
      | import "./a.js";                  |
      | import { a } from "a.js";         |

  Scenario: A dynamic import() is rejected
    Given the entry holds const m = import("./a.js");
    When it is bundled
    Then it fails with "index.js:1: import() is not allowed: " and the line

  Scenario: An import inside a block is rejected
    Given the entry holds an import on its second line, indented in an if block
    When it is bundled
    Then it fails with "index.js:2: import / export must start a line: " and the line

  Scenario Outline: Exports other than export const and export function are rejected
    Given the entry holds <line>
    When it is bundled
    Then it fails with "index.js:1: only export const NAME = <literal>; and export [async] function NAME() are allowed: " and the line

    Examples:
      | line                    |
      | export default 1;       |
      | export let a = 1;       |
      | export class A {}       |
      | export { a };           |
      | export * from "./a.js"; |

  Scenario Outline: Top-level await is rejected in the entry
    Given the entry holds <line>
    When it is bundled
    Then it fails with "index.js:1: top-level await is not allowed: " and the line

    Examples:
      | line                       |
      | const data = await load(); |
      | await init();              |

  Scenario Outline: A module other than the entry may not run code at its top level
    Given "a.js", imported by the entry, holds <line> on its second line
    When it is bundled
    Then it fails with "a.js:2: the top level may only hold function declarations and const literals: " and the line

    Examples:
      | line                |
      | run();              |
      | let a = 1;          |
      | class A {}          |
      | await ready;        |

  Scenario Outline: A top-level const of a module other than the entry must be a literal
    Given "a.js", imported by the entry, holds export const a = <value>
    When it is bundled
    Then it fails with "a.js:1: a top-level const must be a literal" and the line

    Examples:
      | value                     |
      | f(); (a call)             |
      | new Map(); (new)          |
      | () => 1; (an arrow)       |
      | `x${y}`; (a template)     |
      | an object holding a call  |
