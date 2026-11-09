# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Conversation files in the format of LCTYSP-0013 (prototype). They live in their own directory,
# c-next/ of the data directory (or LCTY_RPC_DIR), so the prototype never touches the real conversations.
#
# A file changes only at its end, one line at a time: append one element after a named id, or remove the last element.
# Both look only at the last line. Every line from line 5 on is one element.

require 'base64'
require 'digest'
require 'fileutils'
require 'nokogiri'
require 'time'
require_relative '../config'
require_relative '../conv_html'

module Lcty
  module Rpc
    # An error answered as a JSON-RPC error object: code, message and optional data
    class Error < StandardError
      attr_reader :code, :data

      def initialize(code, message, data = nil)
        super(message)
        @code = code
        @data = data
      end
    end

    # Application error codes (outside the range JSON-RPC reserves)
    CONFLICT = 1 # the last element is not the one the request names
    LOCKED = 2 # the last element is an lcty-cmd
    INVALID = 3 # the element breaks a rule of the format
    NOT_FOUND = 4 # no such conversation
    EXISTS = 5 # the conversation already exists

    class << self
      # The search index (Chatty::SearchIndex) whose file, _index.sqlite, caches the number of elements of every
      # conversation (c_recordcount, LCTYSP-0014). The server sets it at startup, the tests to one of their own.
      attr_accessor :index
    end

    module ConvStore
      module_function

      DIR = File.expand_path(ENV['LCTY_RPC_DIR'].to_s.empty? ? File.join(Chatty::DATA_DIR, 'c-next') : ENV['LCTY_RPC_DIR'])
      HEAD_LINES = 4

      UUID = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      ROLE_PREFIX = { 'system' => 'sys-', 'memory' => 'mem-', 'user' => 'msg-u-', 'model' => 'msg-m-' }.freeze
      # The attributes of each element, in the one order they are written in
      ORDER = {
        'lcty-msg' => %w[data-role id data-at data-template data-tag data-content-integrity data-content data-content-base64],
        'lcty-thinking' => %w[id data-at data-content-integrity data-content data-content-base64],
        'lcty-cmd' => %w[id data-op data-at data-error]
      }.freeze
      AT_RE = /\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)\z/.freeze
      INTEGRITY_RE = %r{\Asha384-(?:[A-Za-z0-9+/]{64})?\z}.freeze # 48 bytes are 64 base64 characters; empty is the placeholder
      LAST_LINE_RE = /\A<(lcty-[a-z]+)\b[^>]*?\sid="([^"]*)"/.freeze

      def path(cid)
        raise Error.new(-32602, "invalid conversation id: #{cid.inspect}") unless cid.is_a?(String) && Chatty::ID_RE.match?(cid)
        File.join(DIR, "#{cid}.html")
      end

      LANG_RE = /\A[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\z/.freeze # a BCP 47 tag of the simple kind (ja, en, zh-Hant)
      LCTY_VERSIONS = %w[v1].freeze # the versions of the lcty.* files the head may load
      TITLE_MAX_SIZE = (16..4096).freeze # bytes of the title slot

      # Create the file: lines 1 to 4 only. Fails when it exists. The page chooses everything the head holds: the
      # language (<html lang> and the language file), the lcty version of the files the head loads, and the size of the
      # title slot.
      def create(cid, created_at:, title:, lang:, title_max_size:, lcty_version:)
        raise Error.new(INVALID, 'createdAt is not a time') unless AT_RE.match?(created_at.to_s)
        raise Error.new(INVALID, "invalid lang: #{lang.inspect}") unless LANG_RE.match?(lang.to_s)
        raise Error.new(INVALID, "unknown lctyVersion: #{lcty_version.inspect}") unless LCTY_VERSIONS.include?(lcty_version)
        unless title_max_size.is_a?(Integer) && TITLE_MAX_SIZE.cover?(title_max_size)
          raise Error.new(INVALID, "titleMaxSize must be an integer in #{TITLE_MAX_SIZE}")
        end
        raise Error.new(INVALID, 'title must be a string') unless title.is_a?(String)
        slot = Chatty::ConvHtml.title_slot(title, title_max_size)
        v = "lcty.#{lcty_version}"
        # English is the text built into lcty.<version>.js (x-default), so lang=en loads no language file
        lang_script = lang == 'en' ? '' : %(<script src="#{v}.lang-#{lang}.js"></script>)
        head = %(<!DOCTYPE html><html lang="#{lang}" />\n) +
               %(<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />) +
               %(<script src="#{v}.js"></script>#{lang_script}) +
               %(<link rel="stylesheet" href="#{v}.css" /></head>\n) +
               %(<title id="__#{title_max_size}">#{slot}#{Chatty::ConvHtml::SLOT_END}\n) +
               %(<lcty-c id="c-#{cid}" data-created-at="#{created_at}" />\n)
        FileUtils.mkdir_p(DIR)
        File.open(path(cid), File::WRONLY | File::CREAT | File::EXCL) do |f|
          f.write(head)
          Rpc.index.put_record_count(cid, 0)
        end
        nil
      rescue Errno::EEXIST
        raise Error.new(EXISTS, 'the conversation exists', 'cid' => cid)
      end

      # Append one element after the element whose id is after (nil: the file has no element yet). Returns the
      # attributes written (with the integrity filled in when the placeholder was sent) and the number of elements the
      # file holds now, counted and cached while it is still locked.
      def append(cid, after, tag, attrs, inner)
        attrs = check(tag, attrs, inner)
        line = build(tag, attrs, inner)
        count = locked(cid) do |f|
          last = last_element(f)
          raise Error.new(CONFLICT, 'the last element is not the one named', 'last' => last && last[:id]) if last&.dig(:id) != after
          raise Error.new(LOCKED, 'the conversation is locked by an lcty-cmd', 'last' => last[:id]) if last && last[:tag] == 'lcty-cmd'
          f.seek(0, IO::SEEK_END)
          f.write(line + "\n")
          f.flush
          record_count(f, cid)
        end
        [attrs, count]
      end

      # Remove the last element, which must have the id given. Returns the number of elements the file holds now, counted
      # and cached while it is still locked.
      def remove(cid, id)
        locked(cid) do |f|
          last = last_element(f)
          raise Error.new(CONFLICT, 'the last element is not the one named', 'last' => last && last[:id]) if last.nil? || last[:id] != id
          f.truncate(last[:offset])
          f.flush
          record_count(f, cid)
        end
      end

      # The number of elements of an open file, every one but lcty-c (LCTYSP-0014): each element is one line and line 4
      # is the last of the head, so it is the number of lines less 4. Only lines are counted; nothing is parsed. The
      # count of a file just written is cached in c_recordcount of _index.sqlite before the file is unlocked, so the
      # cache never holds the count of a file being written.
      def record_count(f, cid = nil)
        f.rewind
        n = 0
        f.each_line { n += 1 }
        n -= HEAD_LINES
        Rpc.index.put_record_count(cid, n) if cid
        n
      end

      # The cached number of elements of a conversation, or nil (unknown) when the cache has none. Never read from the
      # file.
      def cached_record_count(cid)
        path(cid) # checks the id
        Rpc.index.record_count(cid)
      end

      # At startup: fill the cache with the count of every conversation, replacing what it held. The names come from the
      # file system in the encoding of DIR (binary when it comes from an environment variable with no locale), and the
      # sqlite3 gem binds a binary string as a BLOB, which never equals the TEXT of a cid, so they are made UTF-8 (an id
      # is ASCII).
      def fill_record_counts
        counts = Dir.glob(File.join(DIR, '*.html')).map { |f| File.basename(f, '.html').dup.force_encoding(Encoding::UTF_8) }
                    .select { |cid| Chatty::ID_RE.match?(cid) }
                    .map { |cid| [cid, File.open(path(cid), 'r') { |f| f.flock(File::LOCK_SH); record_count(f) }] }
        Rpc.index.replace_record_counts(counts.to_h)
      end

      # What the list of conversations shows of one, the row of c_meta in the browser (LCTYSP-0014): {cid, lang, title,
      # titleTypeId, updatedAt, createdAt}, from lines 1, 3 and 4 and the file's modification time. titleTypeId is the id
      # of <title> as it is ("__" and the size of the slot).
      def meta(cid)
        head = File.foreach(path(cid)).first(4)
        { 'cid' => cid, 'lang' => head[0].to_s[/<html lang="([^"]*)"/, 1],
          'title' => Chatty::ConvHtml.slot_title(head[2].to_s.chomp),
          'titleTypeId' => head[2].to_s[/\A<title id="([^"]*)"/, 1],
          'updatedAt' => File.mtime(path(cid)).utc.iso8601(3),
          'createdAt' => head[3].to_s[/\A<lcty-c [^>]*data-created-at="([^"]*)"/, 1] }
      end

      # The id of the last element of the file (nil when it has none yet)
      def last_id(cid)
        File.open(path(cid), 'r') do |f|
          f.flock(File::LOCK_SH)
          last_element(f)&.dig(:id)
        end
      rescue Errno::ENOENT
        raise Error.new(NOT_FOUND, 'no such conversation', 'cid' => cid)
      end

      # The meta of every conversation, newest first by updatedAt: what the list of conversations shows
      def list_meta
        Dir.glob(File.join(DIR, '*.html')).map { |f| File.basename(f, '.html') }
           .select { |cid| Chatty::ID_RE.match?(cid) }
           .map { |cid| meta(cid) }
           .sort_by { |m| [m['updatedAt'], m['cid']] }.reverse
      end

      # Overwrite the title slot on line 3 in place with title, fitted into the slot by the server as today
      # (LCTYSP-0003). Returns the title as written. The slot is in the middle of the file, so no id guards it: the last
      # title written wins, which is enough for a value that is shown and never sent to the model.
      def update_title(cid, title)
        raise Error.new(INVALID, 'title must be a string') unless title.is_a?(String)
        locked(cid) do |f|
          f.rewind
          offset = f.gets.bytesize + f.gets.bytesize # lines 1 and 2
          line = f.gets.to_s.chomp
          start, size = Chatty::ConvHtml.slot_range(line)
          raise Error.new(INVALID, 'the file has no title slot') unless start
          slot = Chatty::ConvHtml.title_slot(title, size)
          f.seek(offset + start)
          f.write(slot)
          f.flush
          Chatty::ConvHtml.slot_title(line.b.byteslice(0, start) + slot + line.b.byteslice(start + size..).to_s)
        end
      end

      def locked(cid)
        File.open(path(cid), 'r+') do |f|
          f.flock(File::LOCK_EX)
          yield f
        end
      rescue Errno::ENOENT
        raise Error.new(NOT_FOUND, 'no such conversation', 'cid' => cid)
      end

      # {tag, id, offset} of the last line when it is an element (line 5 or later), else nil. Reads the file backwards
      # from its end only as far as the last line starts.
      def last_element(f)
        size = f.size
        return nil if size.zero?
        pos = size - 1 # the final newline
        buf = String.new(encoding: Encoding::BINARY)
        start = nil
        while pos.positive?
          n = [pos, 65_536].min
          pos -= n
          f.seek(pos)
          buf = f.read(n) + buf
          if (i = buf.rindex("\n", buf.bytesize - 2))
            start = pos + i + 1
            break
          end
        end
        start ||= 0
        f.seek(start)
        line = f.read(size - start).force_encoding(Encoding::UTF_8)
        m = LAST_LINE_RE.match(line)
        return nil unless m && m[1] != 'lcty-c' # line 4 (or an unreadable line): no element yet
        { tag: m[1], id: m[2], offset: start }
      end

      # Check one element; returns its attributes, with data-content-integrity computed for the placeholder
      def check(tag, attrs, inner)
        order = ORDER[tag] or raise Error.new(INVALID, "unknown element: #{tag.inspect}")
        raise Error.new(INVALID, 'attrs must be an object of strings') unless attrs.is_a?(Hash) && attrs.all? { |k, v| k.is_a?(String) && v.is_a?(String) }
        keys = attrs.keys
        unknown = keys - order
        raise Error.new(INVALID, "unknown attributes: #{unknown.join(', ')}") unless unknown.empty?
        raise Error.new(INVALID, "attributes out of order: #{keys.join(', ')}", 'order' => order) unless keys == order & keys
        attrs.each do |k, v|
          next if %w[data-content data-error].include?(k)
          raise Error.new(INVALID, "#{k} holds a character XML cannot represent") if Chatty::ConvHtml::XML_FORBIDDEN.match?(v)
        end
        case tag
        when 'lcty-msg'
          prefix = ROLE_PREFIX[attrs['data-role']] or raise Error.new(INVALID, "unknown data-role: #{attrs['data-role'].inspect}")
          check_id(attrs['id'], prefix)
          check_at(attrs['data-at'], %w[user model].include?(attrs['data-role']))
          attrs = check_text(attrs)
          check_article(inner, attrs['data-role'] == 'user' ? text_of(attrs) : nil)
        when 'lcty-thinking'
          check_id(attrs['id'], 'think-')
          check_at(attrs['data-at'], true)
          attrs = check_text(attrs)
          check_article(inner, nil)
        when 'lcty-cmd'
          check_id(attrs['id'], 'cmd-')
          raise Error.new(INVALID, 'invalid data-op') unless Chatty::ConvHtml::CMD_OP_RE.match?(attrs['data-op'].to_s)
          check_at(attrs['data-at'], true)
          if attrs.key?('data-error') && Chatty::ConvHtml::XML_FORBIDDEN.match?(attrs['data-error'])
            raise Error.new(INVALID, 'data-error holds a character XML cannot represent')
          end
          raise Error.new(INVALID, 'an lcty-cmd has no children in the file') unless inner.to_s.empty?
        end
        attrs
      end

      def check_id(id, prefix)
        raise Error.new(INVALID, "the id must be #{prefix} and a UUIDv7: #{id.inspect}") unless /\A#{Regexp.escape(prefix)}#{UUID}\z/.match?(id.to_s)
      end

      def check_at(at, required)
        return if at.nil? && !required
        raise Error.new(INVALID, "invalid data-at: #{at.inspect}") unless AT_RE.match?(at.to_s)
      end

      # Exactly one of data-content and data-content-base64, the base64 only for a text XML cannot hold, and the
      # integrity well formed (the placeholder is replaced by the digest)
      def check_text(attrs)
        plain = attrs.key?('data-content')
        b64 = attrs.key?('data-content-base64')
        raise Error.new(INVALID, 'exactly one of data-content and data-content-base64') unless plain ^ b64
        text = text_of(attrs)
        forbidden = Chatty::ConvHtml::XML_FORBIDDEN.match?(text)
        raise Error.new(INVALID, 'data-content holds a character XML cannot represent; use data-content-base64') if plain && forbidden
        raise Error.new(INVALID, 'data-content-base64 is only for a text XML cannot represent') if b64 && !forbidden
        integrity = attrs['data-content-integrity']
        return attrs if integrity.nil?
        raise Error.new(INVALID, "invalid data-content-integrity: #{integrity.inspect}") unless INTEGRITY_RE.match?(integrity)
        return attrs unless integrity == 'sha384-'
        attrs.merge('data-content-integrity' => "sha384-#{Base64.strict_encode64(Digest::SHA384.digest(text.b))}")
      end

      def text_of(attrs)
        return attrs['data-content'] if attrs.key?('data-content')
        Base64.strict_decode64(attrs['data-content-base64']).force_encoding(Encoding::UTF_8)
      rescue ArgumentError
        raise Error.new(INVALID, 'data-content-base64 is not base64')
      end

      # The presentation: one <article> whose content is within the allowlist; for user, the text alone
      def check_article(inner, user_text)
        frag = Nokogiri::HTML5.fragment(inner.to_s)
        roots = frag.children.reject { |n| n.text? && n.text.empty? }
        unless roots.size == 1 && roots[0].element? && roots[0].name == 'article' && roots[0].attributes.empty?
          raise Error.new(INVALID, 'the presentation must be one <article>')
        end
        article = roots[0]
        if user_text
          raise Error.new(INVALID, 'the <article> of a user message holds only its text') unless article.children.all?(&:text?) && article.text == user_text
          return
        end
        article.traverse do |n|
          next if n == article || n.text?
          raise Error.new(INVALID, "presentation: <#{n.name}> is not allowed") unless n.element? && Chatty::ConvHtml::ALLOWED.key?(n.name)
          n.attributes.each do |name, a|
            ok = Chatty::ConvHtml::ALLOWED[n.name].include?(name) && (re = Chatty::ConvHtml::ATTR_OK[name]) && re.match?(a.value)
            raise Error.new(INVALID, "presentation: #{n.name}[#{name}] is not allowed") unless ok
          end
        end
      end

      # One line: the attributes in their order, and the presentation written as XHTML with newlines as references
      def build(tag, attrs, inner)
        a = attrs.map { |k, v| %( #{k}="#{esc_attr(v)}") }.join
        body = inner.to_s.empty? ? '' : Nokogiri::HTML5.fragment(inner).children.map { |n| n.to_xhtml(save_with: Chatty::ConvHtml::SAVE) }.join
        body = body.gsub("\r", '&#13;').gsub("\n", '&#10;')
        "<#{tag}#{a}>#{body}</#{tag}>"
      end

      def esc_attr(v)
        v.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;').gsub('"', '&quot;')
         .gsub("\n", '&#10;').gsub("\r", '&#13;').gsub("\t", '&#9;')
      end
    end
  end
end
