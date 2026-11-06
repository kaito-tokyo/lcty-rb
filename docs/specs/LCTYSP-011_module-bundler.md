<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-011: Module bundler

- Status: Accepted
- Related: [LCTYSP-005](LCTYSP-005_page-and-elements.md), [LCTYSP-010](LCTYSP-010_data-and-settings.md)
- Implementation: `lib/c/bundle.rb` (`Chatty::C::Bundle`), used by `lib/c/servlet.rb` (`data/c/lcty.v1.module.js`) and
  `lib/module_servlet.rb` (`/index.js`)

## Summary

At startup the server turns each page's module entry and every module it imports into one module file. The bundler is
a few regular expressions on whole lines: each module becomes a block, its import lines become `const` aliases, and a
`var` at the end of the block publishes its exports. The code of a module is never rewritten. This is correct only
because the modules follow strict conventions, and the bundler refuses to start the server when one does not.

## Why a bundler, and why this one

- **One file per page.** A conversation file loads `lcty.v1.module.js` from next to it (over HTTP the server serves
  the bundle from memory; a copy is published into `data/c/` at startup): the scripts belong
  to the user together with the conversations they render ([LCTYSP-010](LCTYSP-010_data-and-settings.md)), so a
  backup of `data/` keeps both. A single file is simple to keep there, and the modules themselves (`public/js/`) stay
  in the repository.
- **No external tools.** The server runs on macOS's `/usr/bin/ruby` with no Node.js or npm, so the bundler is part of
  the server and has to be small enough to read in one sitting.
- **No runtime.** The output has no loader, no module registry and no wrapper functions: it is the modules' own code
  in blocks.
- **No parsing.** The bundler never looks inside a statement. Instead of understanding JavaScript, it relies on
  conventions that make whole-line rewriting correct, and checks those conventions line by line.

## Output

Each module becomes a block, in evaluation order. For example, in the conversation page's bundle `js/uuid.js` is at
index 8 and `js/common.js` at index 12 (an excerpt of the block):

```js
// js/common.js
{
const uuidv7 = $8$uuidv7;
…
function newMsgId() {
  return uuidv7();
}
…
var …, $12$newMsgId = newMsgId, …;
}
```

from

```js
import { uuidv7 } from "./uuid.js";
export function newMsgId() {
	return uuidv7();
}
```

## Algorithm

1. **Order.** Starting from the entry, visit the imports depth-first and list each module after its dependencies
   (evaluation order). A module already listed is not listed again; a module met again while it is being visited is
   an import cycle, which is rejected.
2. **Imports.** Each `import { a, b } from "./x.js";` line becomes `const a = $<i>$a, b = $<i>$b;`, where `<i>` is the
   index of `x.js` in the list. An imported name that `x.js` does not export is rejected.
3. **Exports.** `export ` is removed from the start of each line, so the declaration stays as it is, and
   `var $<index>$<name> = <name>, …;` is added at the end of the block for the module's exports.
4. **Concatenate** the blocks in order, each after a `// <path>` comment line.

## Why blocks are correct

- **Names stay local to their module.** The bundle is module code, which is strict: `const`, `let`, `class` and
  function declarations in a block are scoped to the block. So two modules may declare the same name, a module's
  import aliases do not clash with another module's, and a module's own references to its exports (one exported
  function calling another) keep working. Shadowing inside functions is untouched, because function bodies are not
  rewritten.
- **Exports cross blocks through `var`.** A `var` in a block is scoped to the whole bundle (it is hoisted out of
  blocks), so the blocks after it can read `$<index>$<name>`. The `$<index>$` prefix cannot collide with the names of
  the modules (no module uses such names) and makes each export unique.
- **Evaluation order is the module order.** ES modules evaluate dependencies first, depth-first, in import order; the
  blocks are listed in exactly that order. A block's `const` aliases read exports that the earlier blocks have already
  published.
- **A snapshot of an export equals a live binding** because exports are immutable: an export is a function
  declaration or a `const`, so the value the alias copies never changes.

## Conventions

A module that breaks one of these is rejected with its file, line and the reason.

- **Imports:** only `import { a, b } from "./x.js";` at the start of a line, with a relative path (`./` or `../`);
  the names may be wrapped over several lines (as the formatter does).
  No default import, `import * as`, `as` aliases, bare `import "./x.js"` or `import()`. _Why:_ each import is a
  whole line that becomes `const` aliases; a namespace object, a renamed binding, a side-effect-only import or a
  computed specifier would need more than that. The imports form a DAG.
- **Exports:** only `export const NAME = <literal>;` and `export [async] function NAME(…) { … }` (also `function*`) at
  the start of a line; a long `const` value may be on the next line (as the formatter wraps it). No `export default`, `export let` / `var`, `export class`, `export { … }`, `export * from` or
  destructuring. _Why:_ the exported name is read from the line, and exports must be immutable (see above).
- **Every module except the entry only declares.** Its top level holds only function declarations and `const`
  literals (a number, string, regular expression, `true` / `false` / `null`, or an object / array of those, with no
  calls, `new`, arrows or `await`), written at the start of a line. _Why:_ evaluating such a module has no side
  effects, so nothing depends on when it runs. In practice:
  - module state is a `const state = { … }` literal mutated by functions; a `Map` / `WeakMap` is made on first use
    (`state.viewMap ??= new WeakMap()`);
  - a class is a class expression returned by a function (`cmdElementClass()`, `convListClass()`), and a custom
    element is defined by a function the page calls (`defineConvList()` from `initSidebar`);
  - only the entry runs code at the top level, which starts the page: `lcty.v1.module.js` holds the conversation
    page's code, and `public/index.js` calls an init function (`initNewPage()`).
- **No top-level await,** in the entry either: every module evaluates synchronously.

What the conventions do not restrict: the names a module uses (the same name in several modules, a key or string equal
to an export, `$`), and anything inside functions.

## Alternatives considered

- **A runtime loader** (each module an async factory in a registry, imported by id): works for any module, but puts a
  module system into every page and is not what the modules' code looks like.
- **Scope hoisting by renaming** (every top-level name gets a module prefix, as rollup does): needs a tokenizer and
  scope analysis to tell identifiers from keys, properties, strings and shadowed locals. Done with regular expressions
  instead, it breaks on exactly those (`'/v1/search'` when `search` is renamed, `{ toast }`, the `$` of `${` and of
  `/\/+$/`) and forces conventions on names.
- **Renaming only the exports at their declarations** without blocks: private names of different modules and the
  import aliases of different importers collide at the top level, and a module's own references to its exports break.
  The blocks fix exactly these.
