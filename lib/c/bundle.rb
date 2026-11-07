# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# A tiny ES module bundler (LCTYSP-0005): an entry and the modules it imports become one module file, with regular
# expressions on whole lines only. It builds the new conversation page's entry, /index.js (LCTYSP-0011).
#
# Each module becomes a block, in evaluation order (depth-first, dependencies first), and its code is never rewritten:
#
#   // js/common.js
#   {
#   const uuidv7 = $8$uuidv7;              ← import { uuidv7 } from "./uuid.js";
#   function newMsgId() { … }              ← export function newMsgId() { … }
#   var $12$newMsgId = newMsgId;           ← the exports, published as $<index>$<name>
#   }
#
# A block keeps every name of a module local to it (lexical declarations and, in module code, function declarations
# are block-scoped), so modules may use the same names; the var at its end is scoped to the whole bundle, which makes
# the exports visible to the blocks after it.
#
# It works because the modules follow these conventions, and it refuses (the server does not start) when they do not:
#   - import: only `import { a, b } from "./x.js";` at the start of a line (the names may be wrapped over several
#     lines; relative path; no default, * as, as, bare import or import()); the imports form a DAG, and an imported
#     name must be exported by its module
#   - export: only `export const NAME = <literal>;` and `export [async] function NAME(…) { … }` at the start of a line
#   - every module except the entry holds at its top level only function declarations and const literals (number,
#     string, regular expression, true / false / null, or an object / array of those), written at the start of a line;
#     so evaluating it has no side effects. Top-level await is not allowed.

require 'pathname'

module Chatty
  module C
    module Bundle
      class Error < StandardError; end

      ID = '[A-Za-z_$][\w$]*'
      IMPORT_RE = /^import \{([^}]*)\} from (["'])(\.\.?\/[^"']+)\2;[ \t]*$/.freeze
      FUNCTION_RE = /^(export )?(?:async )?function\*? ?(#{ID}) ?\(/.freeze
      CONST_RE = /^(export )?const (#{ID}) =[ \t]*(.*)$/.freeze # the value may be on the next line (a formatter wraps long ones)
      STRING_RE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/.freeze

      module_function

      def bundle(root, entry)
        mods = {} # id => { src:, exports: }, in evaluation order
        load(File.expand_path(root), entry, entry, mods, [])
        index = mods.keys.each_with_index.to_h
        mods.map do |id, m|
          body = m[:src].gsub(IMPORT_RE) do
            dep = resolve(id, $3)
            "const #{names($1).map { |n| "#{n} = $#{index[dep]}$#{n}" }.join(', ')};"
          end
          body = body.gsub(/^export /, '')
          publish = m[:exports].map { |n| "$#{index[id]}$#{n} = #{n}" }
          "// #{id}\n{\n#{body.strip}\n#{publish.empty? ? '' : "var #{publish.join(', ')};\n"}}\n"
        end.join("\n")
      end

      def load(root, id, entry, mods, stack)
        raise Error, "import cycle: #{(stack + [id]).join(' -> ')}" if stack.include?(id)
        return if mods.key?(id)
        path = File.join(root, id)
        raise Error, "cannot find the entry #{id}" if stack.empty? && !File.file?(path)
        raise Error, "#{stack.last}: cannot find #{id}" unless File.file?(path)
        src = File.read(path, encoding: 'UTF-8')
        check(id, src, id == entry)
        src.scan(IMPORT_RE) do |list, _, spec|
          dep = resolve(id, spec)
          raise Error, "#{id}: #{spec} is outside the bundle's root" if dep == '..' || dep.start_with?('../', '/')
          load(root, dep, entry, mods, stack + [id])
          missing = names(list) - mods[dep][:exports]
          raise Error, "#{id}: #{dep} does not export #{missing.join(', ')}" unless missing.empty?
        end
        exports = src.scan(FUNCTION_RE).select(&:first).map(&:last) + src.scan(CONST_RE).select(&:first).map { |r| r[1] }
        mods[id] = { src: src, exports: exports }
      end

      def names(list)
        list.split(',').map(&:strip).reject(&:empty?)
      end

      def resolve(id, spec)
        Pathname.new(File.dirname(id)).join(spec).cleanpath.to_s
      end

      # The conventions, line by line
      def check(id, src, entry)
        lines = src.lines.map(&:chomp)
        lines.each_with_index do |l, i|
          err = ->(why) { raise Error, "#{id}:#{i + 1}: #{why}: #{l.strip[0, 80]}" }
          err.('import() is not allowed') if l =~ /\bimport\s*\(/
          err.('import / export must start a line') if l =~ /^\s+(?:import|export)\s/
          if l.start_with?('import')
            stmt = lines[i..-1].take_while.with_index { |_, k| k.zero? || !lines[i + k - 1].include?(';') }.join("\n") # up to its ";"
            err.('only import { a, b } from "./x.js"; is allowed') unless stmt =~ /\A#{IMPORT_RE.source}/ && stmt !~ /\{[^}]*\bas\b/
          elsif l.start_with?('export') && l !~ FUNCTION_RE && l !~ CONST_RE
            err.('only export const NAME = <literal>; and export [async] function NAME() are allowed')
          end
          if entry
            # A line at the top level (not indented, a comment or a closing brace) that uses await, at its start too
            err.('top-level await is not allowed') if l =~ %r{\A(?![\s/*\}]).*\bawait\b}
            next
          end
          next if l.empty? || l =~ %r{\A(?:\s|//|/\*|\*|[\}\])])} || l.start_with?('import ') || l =~ FUNCTION_RE
          md = l.match(CONST_RE) or err.('the top level may only hold function declarations and const literals')
          value, following = md[3].empty? ? [lines[i + 1].to_s.strip, lines[(i + 2)..-1]] : [md[3], lines[(i + 1)..-1]]
          literal?(value, following) or err.('a top-level const must be a literal (a number, string, regular expression, true / false / null, or an object / array of those)')
        end
      end

      def literal?(rest, following)
        return true if rest =~ %r{\A/.*/[a-z]*;\s*(//.*)?\z} # a regular expression
        code = ->(l) { l.gsub(STRING_RE) { |s| s.include?('${') ? '(' : '""' }.sub(%r{\s*//.*\z}, '') } # strings and comments out
        first = code.(rest)
        return first =~ /\A(?:-?[\d.]|""|true\b|false\b|null\b)[^()\[\]{}=`]*;\z/ unless first =~ /\A[\[{]/
        lines = first.end_with?(';') ? [first] : [first, *following.take_while { |l| l !~ /\A[}\]]/ }, following.find { |l| l =~ /\A[}\]]/ }].map(&code)
        lines.join("\n") !~ /[()]|=>|\bnew\b|\bawait\b/ # an object / array of literals, up to its closing line
      end
    end
  end
end
