# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3009: the scenarios of docs/specs/LCTYSP-3009_module-bundler.feature, written by hand. Each test has the title
# of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
# The modules of each test are written into a new temporary folder.

require_relative 'helper'
require 'c/bundle'

class BundleTest < Lcty::Scenarios
  Bundle = Chatty::C::Bundle

  def setup
    @root = Dir.mktmpdir('lcty-bundle-')
  end

  def teardown
    FileUtils.rm_rf(@root)
  end

  # Writes the module `path` (relative to the root) with the given lines
  def write(path, *lines)
    file = File.join(@root, path)
    FileUtils.mkdir_p(File.dirname(file))
    File.write(file, lines.map { |l| "#{l}\n" }.join)
  end

  def bundle(entry = 'index.js')
    Bundle.bundle(@root, entry)
  end

  # The error the bundler raises
  def error(entry = 'index.js')
    assert_raises(Bundle::Error) { bundle(entry) }.message
  end

  # The paths of the blocks of a bundle, in order
  def blocks(out)
    out.scan(%r{^// (\S+\.js)$}).flatten
  end

  scenario 'An entry without imports becomes one block' do
    out = nil
    step('Given the entry "index.js" holds "run();"') { write('index.js', 'run();') }
    step('When it is bundled') { out = bundle }
    step('Then the bundle is "// index.js", "{", "run();", "}"') { assert_equal "// index.js\n{\nrun();\n}\n", out }
  end

  scenario 'An imported module comes before the entry and publishes its exports' do
    out = nil
    step('Given the entry "index.js" imports a and b from "./js/x.js" and calls run(a, b)') do
      write('index.js', 'import { a, b } from "./js/x.js";', 'run(a, b);')
    end
    step('And "js/x.js" exports the const a and the function b') do
      write('js/x.js', 'export const a = 1;', 'export function b() {', '  return a;', '}')
    end
    step('When it is bundled') { out = bundle }
    step('Then the block of "js/x.js" comes first, without "export ", and ends with "var $0$b = b, $0$a = a;"') do
      x = "// js/x.js\n{\nconst a = 1;\nfunction b() {\n  return a;\n}\nvar $0$b = b, $0$a = a;\n}\n"
      assert out.start_with?(x), out
    end
    step('And the import line of the entry becomes "const a = $0$a, b = $0$b;"') do
      assert_includes out, "// index.js\n{\nconst a = $0$a, b = $0$b;\n"
    end
    step('And the rest of the entry is kept as it is') { assert out.end_with?("\nrun(a, b);\n}\n"), out }
  end

  scenario 'An import wrapped over several lines becomes one line of aliases' do
    out = nil
    step('Given the entry imports a and b from "./x.js" with one name per line and single quotes') do
      write('index.js', 'import {', "\ta,", "\tb,", "} from './x.js';", 'run(a, b);')
    end
    step('And "x.js" exports the consts a and b') { write('x.js', 'export const a = 1;', "export const b = 'x';") }
    step('When it is bundled') { out = bundle }
    step('Then the import becomes "const a = $0$a, b = $0$b;"') do
      assert_includes out, "// index.js\n{\nconst a = $0$a, b = $0$b;\nrun(a, b);\n}\n"
    end
  end

  scenario 'Modules are listed depth-first, dependencies first, each once' do
    out = nil
    step('Given the entry imports "./a.js" and then "./b.js"') do
      write('index.js', 'import { a } from "./a.js";', 'import { b } from "./b.js";', 'run(a, b);')
    end
    step('And both of them import "./c.js"') do
      write('a.js', 'import { c } from "./c.js";', 'export const a = 1;')
      write('b.js', 'import { c } from "./c.js";', 'export const b = 2;')
      write('c.js', 'export const c = 3;')
    end
    step('When it is bundled') { out = bundle }
    step('Then the blocks are "c.js", "a.js", "b.js" and "index.js" in this order') do
      assert_equal %w[c.js a.js b.js index.js], blocks(out)
    end
    step('And a.js and b.js both alias $0$c') do
      assert_includes out, "// a.js\n{\nconst c = $0$c;\nconst a = 1;\nvar $1$a = a;\n}\n"
      assert_includes out, "// b.js\n{\nconst c = $0$c;\nconst b = 2;\nvar $2$b = b;\n}\n"
    end
  end

  scenario 'Import paths are resolved against the importing module' do
    out = nil
    step('Given the entry imports "./js/ui/a.js", which imports "../b.js"') do
      write('index.js', 'import { a } from "./js/ui/a.js";', 'run(a);')
      write('js/ui/a.js', 'import { b } from "../b.js";', 'export const a = 1;')
      write('js/b.js', 'export const b = 2;')
    end
    step('When it is bundled') { out = bundle }
    step('Then the blocks are "js/b.js", "js/ui/a.js" and "index.js"') do
      assert_equal %w[js/b.js js/ui/a.js index.js], blocks(out)
    end
  end

  scenario 'Each module keeps its own names in its block' do
    out = nil
    step('Given the entry and the module "a.js" both declare the const x at their top level') do
      write('index.js', 'import { a } from "./a.js";', 'const x = 1;', 'run(a, x);')
      write('a.js', 'const x = 2;', 'export function a() {', '  return x;', '}')
    end
    step('When it is bundled') { out = bundle }
    step('Then both declarations are kept as they are, each in its own block') do
      assert_equal "// a.js\n{\nconst x = 2;\nfunction a() {\n  return x;\n}\nvar $0$a = a;\n}\n\n" \
                   "// index.js\n{\nconst a = $0$a;\nconst x = 1;\nrun(a, x);\n}\n", out
    end
  end

  scenario 'The top level of a module may hold every kind of literal' do
    out = code = nil
    step('Given "a.js" holds regular expression, boolean, null, number, string, object and array consts, a const ' \
         'wrapped onto the next line, comments, and async and generator functions') do
      code = [
        'export const re = /a(b)\/+$/g;',
        'export const yes = true;',
        'export const none = null;',
        'export const n = -1.5;',
        'export const s = "f() => new X";',
        'export const obj = {',
        '  k: [1, "x"],',
        '  m: { n: false },',
        '};',
        'const list = [',
        '  1,',
        '];',
        'export const wrapped =',
        '  "a long string";',
        '// a comment with f()',
        '/* a block comment',
        ' * with new X() */',
        'export async function load() {',
        '  return await fetch(list);',
        '}',
        'export function* gen() {}'
      ]
      write('a.js', *code)
      write('index.js', 'import { re } from "./a.js";', 'run(re);')
    end
    step('When it is bundled') { out = bundle }
    step('Then its code is kept as it is') do
      assert_includes out, "// a.js\n{\n#{code.join("\n").gsub(/^export /, '')}\n"
    end
    step('And it publishes its function exports and then its const exports') do
      assert_includes out, "\nvar $0$load = load, $0$gen = gen, $0$re = re, $0$yes = yes, $0$none = none, " \
                           "$0$n = n, $0$s = s, $0$obj = obj, $0$wrapped = wrapped;\n}\n"
    end
  end

  scenario 'The entry may run code at its top level' do
    out = nil
    step('Given the entry defines an async function that awaits, and calls it') do
      write('index.js', 'async function main() {', '  await start();', '}', 'main();')
    end
    step('When it is bundled') { out = bundle }
    step('Then the entry is kept as it is') do
      assert_equal "// index.js\n{\nasync function main() {\n  await start();\n}\nmain();\n}\n", out
    end
  end

  scenario 'An import cycle is rejected' do
    msg = nil
    step('Given the entry imports "./a.js", "a.js" imports "./b.js" and "b.js" imports "./a.js"') do
      write('index.js', 'import { a } from "./a.js";')
      write('a.js', 'import { b } from "./b.js";', 'export const a = 1;')
      write('b.js', 'import { a } from "./a.js";', 'export const b = 2;')
    end
    step('When it is bundled') { msg = error }
    step('Then it fails with "import cycle: index.js -> a.js -> b.js -> a.js"') do
      assert_equal 'import cycle: index.js -> a.js -> b.js -> a.js', msg
    end
  end

  scenario 'A missing module is rejected' do
    msg = nil
    step('Given the entry imports "./missing.js", which does not exist') do
      write('index.js', 'import { a } from "./missing.js";')
    end
    step('When it is bundled') { msg = error }
    step('Then it fails with "index.js: cannot find missing.js"') do
      assert_equal 'index.js: cannot find missing.js', msg
    end
  end

  scenario 'A missing entry is rejected' do
    msg = nil
    step('Given there is no "nope.js"') { write('index.js', 'run();') }
    step('When "nope.js" is bundled') { msg = error('nope.js') }
    step('Then it fails with "cannot find the entry nope.js"') { assert_equal 'cannot find the entry nope.js', msg }
  end

  ['"../a.js"', '"./x/../../a.js"'].each do |spec|
    scenario "An import from outside the bundle's root is rejected (#{spec})" do
      msg = nil
      step("Given the entry imports { a } from #{spec}") { write('index.js', "import { a } from #{spec};", 'a();') }
      step('When it is bundled') { msg = error }
      step("Then it fails with \"index.js: #{spec[1..-2]} is outside the bundle's root\"") do
        assert_equal "index.js: #{spec[1..-2]} is outside the bundle's root", msg
      end
    end
  end

  scenario 'Importing a name the module does not export is rejected' do
    msg = nil
    step('Given the entry imports a and z from "./a.js", which exports only a') do
      write('index.js', 'import { a, z } from "./a.js";')
      write('a.js', 'export const a = 1;', 'const z = 2;')
    end
    step('When it is bundled') { msg = error }
    step('Then it fails with "index.js: a.js does not export z"') { assert_equal 'index.js: a.js does not export z', msg }
  end

  [
    'import x from "./a.js";',
    'import { a as b } from "./a.js";',
    'import * as a from "./a.js";',
    'import "./a.js";',
    'import { a } from "a.js";'
  ].each do |line|
    scenario "Imports other than import { a, b } from \"./x.js\"; are rejected (#{line})" do
      msg = nil
      step("Given the entry starts with #{line}") do
        write('index.js', line, 'run();')
        write('a.js', 'export const a = 1;')
      end
      step('When it is bundled') { msg = error }
      step('Then it fails with "index.js:1: only import { a, b } from "./x.js"; is allowed: " and the line') do
        assert_equal %(index.js:1: only import { a, b } from "./x.js"; is allowed: #{line}), msg
      end
    end
  end

  scenario 'A dynamic import() is rejected' do
    msg = nil
    step('Given the entry holds const m = import("./a.js");') { write('index.js', 'const m = import("./a.js");') }
    step('When it is bundled') { msg = error }
    step('Then it fails with "index.js:1: import() is not allowed: " and the line') do
      assert_equal 'index.js:1: import() is not allowed: const m = import("./a.js");', msg
    end
  end

  scenario 'An import inside a block is rejected' do
    msg = nil
    step('Given the entry holds an import on its second line, indented in an if block') do
      write('index.js', 'if (ready) {', '  import { a } from "./a.js";', '}')
      write('a.js', 'export const a = 1;')
    end
    step('When it is bundled') { msg = error }
    step('Then it fails with "index.js:2: import / export must start a line: " and the line') do
      assert_equal 'index.js:2: import / export must start a line: import { a } from "./a.js";', msg
    end
  end

  ['export default 1;', 'export let a = 1;', 'export class A {}', 'export { a };', 'export * from "./a.js";'].each do |line|
    scenario "Exports other than export const and export function are rejected (#{line})" do
      msg = nil
      step("Given the entry holds #{line}") { write('index.js', line) }
      step('When it is bundled') { msg = error }
      step('Then it fails with "index.js:1: only export const NAME = <literal>; and export [async] function NAME() ' \
           'are allowed: " and the line') do
        assert_equal "index.js:1: only export const NAME = <literal>; and export [async] function NAME() are allowed: " \
                     "#{line}", msg
      end
    end
  end

  ['const data = await load();', 'await init();'].each do |line|
    scenario "Top-level await is rejected in the entry (#{line})" do
      msg = nil
      step("Given the entry holds #{line}") { write('index.js', line) }
      step('When it is bundled') { msg = error }
      step('Then it fails with "index.js:1: top-level await is not allowed: " and the line') do
        assert_equal "index.js:1: top-level await is not allowed: #{line}", msg
      end
    end
  end

  ['run();', 'let a = 1;', 'class A {}', 'await ready;'].each do |line|
    scenario "A module other than the entry may not run code at its top level (#{line})" do
      msg = nil
      step("Given \"a.js\", imported by the entry, holds #{line} on its second line") do
        write('index.js', 'import { b } from "./a.js";')
        write('a.js', 'export const b = 1;', line)
      end
      step('When it is bundled') { msg = error }
      step('Then it fails with "a.js:2: the top level may only hold function declarations and const literals: " ' \
           'and the line') do
        assert_equal "a.js:2: the top level may only hold function declarations and const literals: #{line}", msg
      end
    end
  end

  {
    'f(); (a call)' => ['export const a = f();'],
    'new Map(); (new)' => ['export const a = new Map();'],
    '() => 1; (an arrow)' => ['export const a = () => 1;'],
    '`x${y}`; (a template)' => ['export const a = `x${y}`;'],
    'an object holding a call' => ['export const a = {', '  k: f(),', '};']
  }.each do |label, lines|
    scenario "A top-level const of a module other than the entry must be a literal (#{label})" do
      msg = nil
      step("Given \"a.js\", imported by the entry, holds export const a = #{label}") do
        write('index.js', 'import { a } from "./a.js";')
        write('a.js', *lines)
      end
      step('When it is bundled') { msg = error }
      step('Then it fails with "a.js:1: a top-level const must be a literal" and the line') do
        assert msg.start_with?('a.js:1: a top-level const must be a literal ('), msg
        assert msg.end_with?(": #{lines.first}"), msg
      end
    end
  end
end
