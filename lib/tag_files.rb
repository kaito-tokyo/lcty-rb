# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Tag definitions and memory: one HTML file per tag in data/t/ (LCTYSP-0009, "Tag files"). Source-of-truth data.
#
#   t/NNNNN-<file-name part>.html   one tag: <lcty-t> with its display name, <lcty-tagop> policies, <lcty-system> (the
#                                   prompt) and <lcty-memory> items. The number is the draft order (file-name order)
#   t.lock                          holds no data: flock is taken on it, shared for get-all, exclusive for replace-all
#                                   and add-memory. One lock for all tags
#
# All Unicode processing (NFC, case mapping, character categories, the file-name part) is the browser's. The server
# passes names through untouched and checks file names mechanically only; what it writes is exactly what was sent. It
# builds the HTML from JSON and parses it back, so the markup and its escaping live here alone.

require 'digest'
require 'fileutils'
require 'securerandom'
require 'time'
require 'nokogiri'
require_relative 'config'
require_relative 'conv_html'
require_relative 'uuid'

module Chatty
  class TagFiles
    # A tag file as listed: 5 ASCII digits, '-', a non-empty part, '.html'. Anything else in t/ (temporary files, which
    # start with '.', the copies of lcty.v1.*) is ignored.
    LISTED_RE = /\A[0-9]{5}-.+\.html\z/m.freeze
    MAX_FILE_BYTES = 255
    OP_TYPE_RE = /\A[a-z0-9-]+\z/.freeze
    OP_TYPES = %w[add-memory].freeze # Known operations; other types are ignored on reading and not written
    MEMORY_ID_RE = /\A[A-Za-z0-9_-]{1,80}\z/.freeze # Goes into the HTML id t-mem-<id>
    MEMORY_ID_PREFIX = 't-mem-'
    SAVE = ConvHtml::SAVE

    # The same header as a conversation file, with lcty.v1.* by relative paths (copies sit next to the tag files)
    HEAD = <<~HTML
      <!DOCTYPE html>
      <html lang="ja">
      <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script src="lcty.v1.js"></script>
      <script src="lcty.v1.lang-ja.js"></script>
      <link rel="stylesheet" href="lcty.v1.css" />
      </head>
      <body>
    HTML
    FOOT = "</body>\n</html>\n"

    attr_reader :dir

    def initialize(dir, lock_path)
      @dir = dir
      @lock_path = lock_path
      FileUtils.mkdir_p(@dir)
    end

    # ---- File names (mechanical checks only) ----

    # nil when the name is acceptable, else why not
    def self.file_name_error(name)
      return 'must be a string' unless name.is_a?(String)
      name = String.new(name, encoding: Encoding::UTF_8)
      return 'must be valid UTF-8' unless name.valid_encoding?
      return "must be at most #{MAX_FILE_BYTES} bytes" if name.bytesize > MAX_FILE_BYTES
      return 'must not contain /, \\, : or NUL' if name.match?(%r{[/\\:\u0000]})
      return 'must be NNNNN-<name>.html' unless LISTED_RE.match?(name)
      nil
    end

    # The file-name part: the name without NNNNN- and .html
    def self.part(name)
      name[6...-5]
    end

    # The part composed to NFC, as the browser compares file names (tagRef of js/tag-names.js); HFS+ lists names
    # decomposed. A name that is not valid UTF-8 is returned as it is.
    def self.nfc_part(name)
      p = part(name)
      p.valid_encoding? ? p.unicode_normalize(:nfc) : p
    end

    # The ASCII symbols the browser escapes in a file-name part as ~ and two lowercase hex digits (tagPart of
    # js/tag-names.js)
    ESCAPED_HEX_RE = /~(2[13-689a]|3[cef]|5[bde]|7[bd])/.freeze

    # The display name a part stands for, as far as the file name tells it: the escapes undone, mechanically (a
    # display name cannot contain ~, so ~xx is always an escape). The case and the form the user typed are not in the
    # file name, so this is the name lowercased as the part is. Used for a tag file without <lcty-t>
    def self.name_of_part(part)
      part.gsub(ESCAPED_HEX_RE) { Regexp.last_match(1).hex.chr }
    end

    # ---- Get all ----

    # [{"tags" => [...]}, etag]: every tag file in file-name order, parsed back into JSON
    def all
      with_lock(File::LOCK_SH) do
        files = listed
        [{ 'tags' => files.map { |name, body| parse(name, body) }.compact }, etag_of(files)]
      end
    end

    def etag
      with_lock(File::LOCK_SH) { etag_of(listed) }
    end

    # ---- Replace all ----

    # Replace the whole set (the tag editor, the reorder page). if_match is the ETag the browser got with the set it
    # edited: nil is 428, a different one 412. A tag sent with invalid: true is a tag file without <lcty-t> that the
    # set keeps as it is: it is neither written nor deleted. Returns the new ETag.
    def replace_all(obj, if_match)
      tags = validate_set!(obj)
      with_lock(File::LOCK_EX) do
        raise HttpError.new(428, 'If-Match is required') if if_match.nil? || if_match.empty?
        before = listed
        raise HttpError.new(412, 'the tags have changed') unless etag_matches?(if_match, etag_of(before))
        kept, written = tags.partition { |t| t['invalid'] }
        kept = kept.map { |t| kept_path!(t['file'], before) }
        written.each do |t|
          path = File.join(@dir, t['file'])
          next unless File.exist?(path) && kept.any? { |k| File.identical?(k, path) }
          raise HttpError.new(400, "the tag file #{t['file'].inspect} cannot be read, so it cannot be overwritten")
        end
        written = written.map do |t|
          path = File.join(@dir, t['file'])
          write_atomic(path, build(t))
          path
        end
        # Delete the tag files that are not in the set. A file just written may be listed under a name that is not
        # byte-equal to the one sent (HFS+ decomposes names), so compare the files themselves, not their names.
        before.each_key do |name|
          path = File.join(@dir, name)
          next if (written + kept).any? { |w| File.identical?(w, path) }
          File.unlink(path) if File.exist?(path)
        end
        etag_of(listed)
      end
    end

    # ---- Add tags ----

    # Write the tags of obj ({"tags" => [...]}, checked as replace-all checks them) as new tag files, under the
    # exclusive lock, leaving every other file of t/ as it is (tools/migrate_tags.rb). 409 when one of them has the
    # file-name part of a listed file (any number) or a memory id that a listed file has; nothing is written then.
    def add_all(obj)
      tags = validate_set!(obj)
      raise HttpError.new(400, 'a tag to add cannot be invalid') if tags.any? { |t| t['invalid'] }
      with_lock(File::LOCK_EX) do
        before = listed
        # HFS+ lists names decomposed, so compare the parts composed
        parts = before.keys.map { |n| TagFiles.nfc_part(n) }
        ids = before.flat_map { |n, body| parse(n, body)['memory'].map { |m| m['id'] } }
        tags.each do |t|
          raise HttpError.new(409, "a tag file for #{t['file'].inspect} exists") if parts.include?(TagFiles.nfc_part(t['file']))
          clash = t['memory'].map { |m| m['id'] } & ids
          raise HttpError.new(409, "memory id #{clash.first.inspect} exists") unless clash.empty?
        end
        tags.each { |t| write_atomic(File.join(@dir, t['file']), build(t)) }
        etag_of(listed)
      end
    end

    # ---- Add memory ----

    # Append one item to the tag in file `file`, under the exclusive lock. 404 when there is no such file.
    def add_memory(file, text, source = nil)
      err = TagFiles.file_name_error(file)
      raise HttpError.new(400, "invalid tag file name: #{err}") if err
      raise HttpError.new(400, 'text is required') unless text.is_a?(String) && !text.strip.empty?
      src = source.is_a?(Hash) ? source.slice('conv_id', 'msg_id').select { |_, v| v.is_a?(String) && !v.empty? } : {}
      with_lock(File::LOCK_EX) do
        path = File.join(@dir, file)
        raise HttpError.new(404, 'no such tag file') unless File.file?(path)
        tag = parse(file, File.read(path, mode: 'r:UTF-8'))
        raise HttpError.new(409, 'the tag file cannot be read') if tag['invalid']
        item = { 'id' => Uuid.v7, 'text' => text.strip, 'at' => Time.now.iso8601 }
        item['source'] = src unless src.empty?
        tag['memory'] << item
        write_atomic(path, build(tag))
        item
      end
    end

    # ---- HTML ----

    # The HTML of one tag (LCTYSP-0009, "Tag file markup"): <lcty-t> closed normally, every child repeating data-tag
    def build(tag)
      doc = Nokogiri::HTML5::Document.parse('')
      name = tag['name']
      lines = []
      (tag['ops'] || []).each do |op|
        next unless OP_TYPES.include?(op['type'])
        e = node(doc, 'lcty-tagop', name, 'data-type' => op['type'])
        ConvHtml.set_text(e, 'data-content', op['content'].to_s)
        lines << e
      end
      prompt = tag['prompt'].to_s
      unless prompt.empty?
        e = node(doc, 'lcty-system', name)
        ConvHtml.set_text(e, 'data-content', prompt)
        lines << e
      end
      (tag['memory'] || []).each do |m|
        src = m['source'].is_a?(Hash) ? m['source'] : {}
        e = node(doc, 'lcty-memory', name, { 'data-at' => m['at'], 'data-source-conv' => src['conv_id'],
                                             'data-source-msg' => src['msg_id'] }, 'id' => MEMORY_ID_PREFIX + m['id'])
        ConvHtml.set_text(e, 'data-content', m['text'].to_s)
        lines << e
      end
      open = node(doc, 'lcty-t', name).to_xhtml(save_with: SAVE).sub(%r{</lcty-t>\z}, '')
      body = lines.map { |e| e.to_xhtml(save_with: SAVE) + "\n" }.join
      out = HEAD + open + "\n" + body + "</lcty-t>\n" + FOOT
      check_well_formed!(open + "\n" + body + '</lcty-t>')
      out
    end

    # One tag file as JSON ({file, name, ops, prompt, memory}). A file without <lcty-t> is still a tag (with a warning):
    # its name is taken from the file name, the rest is empty, and it is marked invalid: true. Replace-all keeps such a
    # file as it is and add-memory refuses it, so a file put in t/ by hand is never rewritten or deleted unasked.
    def parse(file, body)
      t = Nokogiri::HTML5.parse(body).at_css('lcty-t')
      unless t
        warn "tag file #{file} has no <lcty-t>; listing it as invalid"
        return { 'file' => file, 'name' => TagFiles.name_of_part(TagFiles.part(file)), 'ops' => [], 'prompt' => '',
                 'memory' => [], 'invalid' => true }
      end
      ops = []
      t.css('lcty-tagop').each do |e|
        type = e['data-type'].to_s
        next unless OP_TYPES.include?(type) && ops.none? { |o| o['type'] == type }
        ops << { 'type' => type, 'content' => ConvHtml.get_text(e, 'data-content').to_s }
      end
      system = t.at_css('lcty-system')
      memory = t.css('lcty-memory').map do |e|
        item = { 'id' => e['id'].to_s.sub(/\A#{MEMORY_ID_PREFIX}/o, ''), 'text' => ConvHtml.get_text(e, 'data-content').to_s,
                 'at' => e['data-at'] }
        src = { 'conv_id' => e['data-source-conv'], 'msg_id' => e['data-source-msg'] }.compact
        item['source'] = src unless src.empty?
        item
      end
      { 'file' => file, 'name' => ConvHtml.get_text(t, 'data-tag').to_s, 'ops' => ops,
        'prompt' => system ? ConvHtml.get_text(system, 'data-content').to_s : '', 'memory' => memory }
    end

    private

    # The path of the tag file `file` that replace-all keeps as it is: it must be listed (under this name, or under
    # another name of the same file: HFS+) and have no <lcty-t>
    def kept_path!(file, before)
      path = File.join(@dir, file)
      name = before.keys.find { |n| File.identical?(File.join(@dir, n), path) }
      return path if name && Nokogiri::HTML5.parse(before[name]).at_css('lcty-t').nil?

      raise HttpError.new(400, "only a tag file that cannot be read is kept as it is: #{file.inspect}")
    end

    # Check the whole request before taking the lock and writing anything; returns the tags with defaults filled in
    def validate_set!(obj)
      raise HttpError.new(400, 'body must be {"tags": [...]}') unless obj.is_a?(Hash) && obj['tags'].is_a?(Array)
      parts = []
      ids = []
      now = Time.now.iso8601
      tags = obj['tags'].map do |t|
        raise HttpError.new(400, 'each tag must be an object') unless t.is_a?(Hash)
        err = TagFiles.file_name_error(t['file'])
        raise HttpError.new(400, "invalid tag file name #{t['file'].inspect}: #{err}") if err
        parts << TagFiles.part(t['file']).b
        # A tag file without <lcty-t>, kept as it is: only its file name matters
        next({ 'file' => String.new(t['file'], encoding: Encoding::UTF_8), 'invalid' => true }) if t['invalid'] == true
        raise HttpError.new(400, 'name must be a non-empty string') unless t['name'].is_a?(String) && !t['name'].empty?
        raise HttpError.new(400, 'prompt must be a string') unless t['prompt'].nil? || t['prompt'].is_a?(String)
        ops = t['ops'] || []
        ok = ops.is_a?(Array) && ops.all? { |o| o.is_a?(Hash) && OP_TYPE_RE.match?(o['type'].to_s) && o['content'].is_a?(String) }
        raise HttpError.new(400, 'ops must be an array of {type, content}') unless ok
        types = ops.map { |o| o['type'] }
        raise HttpError.new(400, 'ops must have one entry per type') unless types.uniq.size == types.size
        mem = t['memory'] || []
        ok = mem.is_a?(Array) && mem.all? do |m|
          m.is_a?(Hash) && MEMORY_ID_RE.match?(m['id'].to_s) && m['text'].is_a?(String) && !m['text'].strip.empty? &&
            (m['at'].nil? || m['at'].is_a?(String))
        end
        raise HttpError.new(400, 'memory must be an array of {id, text}') unless ok
        mem.each_with_index do |m, i|
          ConvHtml.check_chars!({ 'at' => m['at'], 'source' => m['source'] }, "memory[#{i}]")
        rescue ConvHtml::InvalidCharError => e
          raise HttpError.new(400, e.message)
        end
        ids.concat(mem.map { |m| m['id'] })
        { 'file' => String.new(t['file'], encoding: Encoding::UTF_8), 'name' => t['name'], 'ops' => ops,
          'prompt' => t['prompt'].to_s, 'memory' => mem.map { |m| m.merge('at' => m['at'] || now) } }
      end
      raise HttpError.new(400, 'tag file names must be unique') unless parts.uniq.size == parts.size
      raise HttpError.new(400, 'memory ids must be unique') unless ids.uniq.size == ids.size
      tags
    end

    # {name => body} of the tag files in t/, in file-name order
    def listed
      Dir.children(@dir).map { |n| String.new(n, encoding: Encoding::UTF_8) }.select { |n| LISTED_RE.match?(n) }.sort
         .each_with_object({}) do |name, h|
        path = File.join(@dir, name)
        h[name] = File.read(path, mode: 'r:UTF-8') if File.file?(path)
      end
    end

    # One ETag for the whole set: the listed names and contents, so a change made outside the server changes it too
    def etag_of(files)
      d = Digest::SHA256.new
      files.each { |name, body| d << [name.bytesize].pack('N') << name.b << [body.bytesize].pack('N') << body.b }
      %("#{d.hexdigest}")
    end

    def etag_matches?(header, etag)
      header.split(',').map(&:strip).any? { |v| v == etag || v == '*' || v == "W/#{etag}" }
    end

    def with_lock(mode)
      FileUtils.mkdir_p(File.dirname(@lock_path))
      File.open(@lock_path, File::RDWR | File::CREAT, 0o644) do |f|
        f.flock(mode)
        yield
      end
    end

    # Via a temporary file whose name starts with '.', so the listing never sees it, and a rename
    def write_atomic(path, data)
      tmp = File.join(File.dirname(path), ".tmp-#{Process.pid}-#{SecureRandom.hex(4)}.html")
      File.open(tmp, 'w:UTF-8') do |f|
        f.write(data)
        f.flush
        f.fsync
      end
      File.rename(tmp, path)
    ensure
      File.unlink(tmp) if tmp && File.exist?(tmp)
    end

    # An element of the tag: `first` (the id), then data-tag (a text string: base64 when XML cannot hold it), then `attrs`
    def node(doc, element, tag_name, attrs = {}, first = {})
      e = Nokogiri::XML::Node.new(element, doc)
      first.each { |k, v| e[k] = v.to_s unless v.nil? }
      ConvHtml.set_text(e, 'data-tag', tag_name)
      attrs.each { |k, v| e[k] = v.to_s unless v.nil? }
      e
    end

    def check_well_formed!(xml)
      Nokogiri::XML::DocumentFragment.parse(xml, Nokogiri::XML::ParseOptions::STRICT)
    rescue Nokogiri::XML::SyntaxError => e
      raise HttpError.new(400, "the tag cannot be written as XML: #{e.message}")
    end
  end
end
