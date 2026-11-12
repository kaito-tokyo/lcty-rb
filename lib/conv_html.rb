# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Reading and writing conversation files (HTML fragments of Custom Elements. LCTYSP-0003).
#
#   Write: line objects ({type: meta|title|cmd|message, …}) → build elements with the Nokogiri DOM → to_xhtml
#          → reparse as strict XML to make sure it is well-formed
#   Read:  Nokogiri::XML::DocumentFragment.parse (works without a root element) → line objects
#
# to_xhtml writes empty Custom Elements as <x></x> and HTML void elements as <br />, so it reads the same as XML and as HTML.
# & < > \r in text and newlines/tabs in attributes are escaped automatically and read back exactly as saved either way.

require 'nokogiri'
require 'json'

module Chatty
  module ConvHtml
    module_function

    SAVE = Nokogiri::XML::Node::SaveOptions::AS_XHTML | Nokogiri::XML::Node::SaveOptions::NO_DECLARATION
    JSON_ATTRS = { 'timings' => 'data-timings', 'client' => 'data-client', 'usage' => 'data-usage' }.freeze

    class FormatError < StandardError; end
    # A character XML 1.0 cannot represent, found outside the text strings (ids, tag names, …. LCTYSP-0003)
    class InvalidCharError < FormatError; end

    # C0 controls other than tab, LF and CR, plus U+FFFE / U+FFFF (not even as character references; surrogates never appear in UTF-8 strings)
    XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.freeze
    # Text strings (the attribute is the source of truth; base64 only when it has unwritable characters) and display-only values. Not checked
    TEXT_KEYS = %w[content thinking instructions content_html title error].freeze
    CMD_OP_RE = /\A[a-z][a-z0-9-]{0,31}\z/.freeze # Command names (lcty-cmd data-op)
    GENERATOR = 'lcty.v1.gfm' # The renderer that produced the presentation HTML (data-generator)

    # Check the strings in a line object (except the text strings)
    def check_chars!(obj, path = 'line')
      case obj
      when String
        if (m = XML_FORBIDDEN.match(obj))
          raise InvalidCharError, format('%s contains a character that XML cannot represent: U+%04X at %d', path, m[0].ord, m.begin(0))
        end
      when Hash then obj.each { |k, v| check_chars!(v, "#{path}.#{k}") unless TEXT_KEYS.include?(k) }
      when Array then obj.each_with_index { |v, i| check_chars!(v, "#{path}[#{i}]") }
      end
    end

    # For display: replace unwritable characters with visible symbols (Control Pictures; ESC becomes ␛)
    def visible(s)
      s.to_s.gsub(XML_FORBIDDEN) { |c| c.ord < 0x20 ? (0x2400 + c.ord).chr(Encoding::UTF_8) : "\uFFFD" }
    end

    # Write a text string to an attribute. Only when it has unwritable characters, write base64 of its UTF-8 bytes to name-base64
    def set_text(e, name, s)
      return if s.nil?
      s = s.to_s
      if XML_FORBIDDEN.match?(s)
        e["#{name}-base64"] = [s.b].pack('m0')
      else
        e[name] = s
      end
    end

    def get_text(e, name)
      b = e["#{name}-base64"]
      return e[name] if b.nil?
      s = b.unpack1('m0').force_encoding(Encoding::UTF_8)
      raise ArgumentError, 'not UTF-8' unless s.valid_encoding?
      s
    rescue ArgumentError => err
      warn "#{name}-base64 is broken (#{err.message}); ignoring it"
      nil
    end

    # Allowlist for presentation HTML: the elements and attributes of LCTYSP-0017's output ("Nothing else") and no
    # more. Other elements keep only their contents; DROP removes them with their contents
    ALLOWED = {
      'p' => [], 'br' => [], 'hr' => [], 'strong' => [], 'em' => [], 'del' => [], 'blockquote' => [],
      'h1' => [], 'h2' => [], 'h3' => [], 'h4' => [], 'h5' => [], 'h6' => [],
      'ul' => [], 'ol' => ['start'], 'li' => [], 'pre' => [], 'code' => ['data-lang'],
      'table' => [], 'thead' => [], 'tbody' => [], 'tr' => [], 'th' => ['class'], 'td' => ['class'],
      'a' => %w[href target rel], 'div' => ['class'], 'span' => ['class'], 'button' => %w[type class]
    }.freeze
    DROP = %w[script style template iframe object embed noscript svg math head title meta link base form input textarea select].freeze
    ATTR_OK = {
      'href' => %r{\A(?:https?:|mailto:)}i, 'target' => /\A_blank\z/, 'rel' => /\Anoopener noreferrer\z/,
      'start' => /\A\d{1,9}\z/, 'type' => /\Abutton\z/, 'data-lang' => /\A[^<>"]{0,40}\z/
    }.freeze
    # The classes each element may have, as LCTYSP-0017 lists them
    ALIGN_CLASSES = %w[align-left align-center align-right].freeze
    CLASSES = {
      'div' => %w[codeblock codebar table-wrap], 'span' => ['lang', 'task', 'task done'],
      'button' => %w[select suggestion], 'th' => ALIGN_CLASSES, 'td' => ALIGN_CLASSES
    }.freeze

    # Whether element name may have the attribute attr of value
    def attr_ok?(name, attr, value)
      return false unless ALLOWED[name]&.include?(attr)
      return CLASSES[name].include?(value) if attr == 'class'
      ATTR_OK[attr].match?(value)
    end

    # Parse presentation HTML with gumbo, filter it through the allowlist, and add it as children of parent
    def add_presentation(parent, html, doc)
      copy_clean(Nokogiri::HTML5.fragment(html.to_s).children, parent, doc)
    end

    def copy_clean(nodes, parent, doc)
      nodes.each do |n|
        if n.text?
          parent.add_child(Nokogiri::XML::Text.new(visible(n.text), doc))
        elsif n.element?
          name = n.name.downcase
          if (attrs = ALLOWED[name])
            e = Nokogiri::XML::Node.new(name, doc)
            attrs.each { |a| (v = n[a]) && attr_ok?(name, a, v) && (e[a] = v) }
            copy_clean(n.children, e, doc)
            parent.add_child(e)
          elsif !DROP.include?(name)
            copy_clean(n.children, parent, doc)
          end
        end
      end
    end

    # The head of a conversation file (LCTYSP-0003): lines 1 to 4. Ruby reads them on their own (the conversation list
    # needs only these), and the elements start on line 5:
    #   1. <!DOCTYPE html><html lang="ja" />
    #   2. <head> with the files it loads: lcty.v1.js and lcty.v1.lang-ja.js (classic scripts, so a file opened directly
    #      still builds its frame) and lcty.v1.css. </head> ends the line. lcty.v1.module.js is not here: <lcty-c>
    #      imports it once the page has loaded (from the HTTP cache when it has not changed).
    #   3. The title slot: <title id="__512">[512 bytes]<!---->. The id carries the slot length right next to it. The
    #      slot starts as a ruler of digits; a title is written over its head as "<title text></title><!--", so the rest
    #      of the ruler and the fixed "<!---->" become a comment. Digits never form "--", so whatever the title, the
    #      comment always closes at the last ">". The parser moves the <title> into <head>.
    #   4. The frame <lcty-c id="c-<id>" data-setup-tags data-created-at />: what the frame needs to know, written once
    #      at creation. In HTML the "/>" is ignored, so <lcty-c> stays open and every element after it becomes its child
    #      (appending is just adding to the end); as XML the line is a complete element on its own.
    # Lines 5 and later are elements, a well-formed XML fragment; line 5 is lcty-setup (the system prompt).
    HEAD_LINES = 4
    TITLE_SLOT = 512 # Slot length (bytes)
    HEADER = %(<!DOCTYPE html><html lang="ja" />\n) +
             %(<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />) +
             %(<script src="lcty.v1.js"></script><script src="lcty.v1.lang-ja.js"></script>) +
             %(<link rel="stylesheet" href="lcty.v1.css" /></head>\n)
    TITLE_OPEN_RE = /\A<title id="__(\d+)">/.freeze
    SLOT_END = '<!---->' # after the slot, never overwritten

    # The blank slot of size bytes: a ruler of digits aligned so the last one is always 0 ("…7890"), which makes the
    # end of the slot easy to check by eye just before "<!---->".
    def blank_slot(size)
      (1..size).map { |i| ((i - size) % 10).to_s }.join
    end

    # The slot holding title, exactly size bytes: "<title text></title><!--" over the head of the ruler. The escaped
    # title is cut at a character boundary so it fits; nil when even an empty title does not (the caller rewrites).
    # Newlines become spaces and unwritable characters become Control Pictures (display only).
    def title_slot(title, size = TITLE_SLOT)
      chars = visible(title.to_s.gsub(/[\r\n]+/, ' ')).strip.chars
      head = ->(cs) { "#{cs.join.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;')}</title><!--" }
      chars.pop while !chars.empty? && head.(chars).bytesize > size
      h = head.(chars)
      return nil if h.bytesize > size
      slot = blank_slot(size)
      slot[0, h.bytesize] = h
      slot
    end

    # Line 3, the whole title line (without the newline)
    def title_line(title)
      %(<title id="__#{TITLE_SLOT}">) + title_slot(title) + SLOT_END
    end

    # Where the slot of a title line is: [offset of the slot within the line, its size], or nil when the line is not one
    def slot_range(line)
      bytes = line.to_s.b
      m = TITLE_OPEN_RE.match(bytes) or return nil
      start = m[0].bytesize
      size = m[1].to_i
      return nil unless bytes.byteslice(start + size, SLOT_END.bytesize) == SLOT_END
      slot = bytes.byteslice(start, size).to_s
      return nil unless slot.bytesize == size && !slot.include?("\n") && slot.include?('</title><!--')
      [start, size]
    end

    # The title written in a title line, or nil when there is none
    def slot_title(line)
      range = slot_range(line) or return nil
      start, size = range
      t = line.to_s.b.byteslice(start, size)[%r{\A([^<]*)</title><!--}, 1] or return nil
      t.force_encoding(Encoding::UTF_8).gsub('&lt;', '<').gsub('&gt;', '>').gsub('&amp;', '&')
    end

    # The title of a line that holds a <title> but no valid slot (a head written by hand, or broken), or nil
    def loose_title(line)
      t = line.to_s[%r{<title[^>]*>([^<]*)</title>}, 1] or return nil
      t.gsub('&lt;', '<').gsub('&gt;', '>').gsub('&amp;', '&')
    end

    # The current title (the last title line)
    def current_title(lines)
      lines.reverse.find { |l| l['type'] == 'title' }
    end

    # The meta: line 4's <lcty-c> attributes (id, tags at creation, created_at) and the first lcty-setup's
    # instructions. Written once when the conversation is created and never overridden (LCTYSP-0003).
    def current_meta(lines)
      lines.find { |l| l['type'] == 'meta' } || {}
    end

    # The whole conversation file: the header (lines 1 and 2), the title line, <lcty-c>, then lcty-setup and the other
    # elements (LCTYSP-0003)
    def document(lines)
      title = current_title(lines)
      meta = current_meta(lines)
      raise FormatError, 'a conversation needs a meta' if meta.empty?
      rest = lines.reject { |l| %w[title meta].include?(l['type']) }
      HEADER + title_line(title ? title['title'] : '') + "\n" + frame_line(meta) +
        encode([meta.merge('type' => 'setup')] + rest)
    end

    # Line 4: <lcty-c … /> (written once)
    def frame_line(meta)
      check_chars!(meta, 'meta')
      tags = Array(meta['tags'])
      e = node(Nokogiri::HTML5::Document.parse(''), 'lcty-c',
               'id' => "c-#{meta['id']}", 'data-setup-tags' => tags.empty? ? nil : tags.join(' '),
               'data-created-at' => meta['created_at'])
      e.to_xhtml(save_with: SAVE).sub(%r{></lcty-c>\z}, ' />') + "\n"
    end

    # The meta from line 4, or nil when the line is not one
    def frame_meta(line)
      return nil unless line.to_s.start_with?('<lcty-c ')
      e = Nokogiri::XML::DocumentFragment.parse(line.chomp).at_xpath('lcty-c')
      return nil unless e
      { 'type' => 'meta', 'id' => e['id'].to_s.sub(/\Ac-/, ''), 'created_at' => e['data-created-at'],
        'tags' => split_tags(e['data-setup-tags']), 'instructions' => '' }
    end

    # The head lines (1 to 4) of a file in the current format, or nil when it has none (an older head, or broken)
    def head_lines(text)
      head = text.each_line.take(HEAD_LINES)
      return nil unless head.size == HEAD_LINES && head[0].start_with?('<!DOCTYPE html><html ') &&
                        head[1].start_with?('<head>') && slot_range(head[2]) && frame_meta(head[3])
      head
    end

    # Whether a file is in the format of LCTYSP-0013 (lcty-msg): one in the current head with no lcty-setup and no
    # lcty-message. A file of LCTYSP-0003 always has lcty-setup on line 5, so a file with nothing after the head (as
    # c.create writes it) is of LCTYSP-0013. Such a file is written only through /v1/rpc, never rewritten whole.
    def lcty_msg?(text)
      return false if legacy?(text)
      text.each_line.drop(HEAD_LINES).none? { |l| l.start_with?('<lcty-setup', '<lcty-message') }
    end

    # The elements: everything after the head
    def body_text(text)
      return legacy_body(text) if legacy?(text)
      text.each_line.drop(HEAD_LINES).join
    end

    # ---- The head before 2026-11-07 (read only; the server rewrites such files at startup, LCTYSP-0003) ----
    # Three lines starting with "<!": the header with data-lcty-tlrange="0x…,0x…" (the title slot's byte range), then
    # <!--lcty-meta--><title>…</title><!--…--> and <!--lcty-meta--><lcty-c …> (never closed).
    LEGACY_MARK = '<!--lcty-meta-->'

    def legacy?(text)
      text.to_s.b.start_with?('<!doctype html><html data-lcty-tlrange=')
    end

    def legacy_title(text)
      m = text.each_line.first.to_s.b[/data-lcty-tlrange="0x(\h{4}),0x(\h{4})"/] && [$1.to_i(16), $2.to_i(16)]
      return nil unless m && m[1] > m[0]
      bytes = text.b[m[0]...m[1]].to_s
      return nil unless bytes.start_with?('<title>') && bytes.end_with?('-->') && !bytes.include?("\n")
      t = bytes[%r{\A<title>([^<]*)</title><!--}, 1] or return nil
      t.force_encoding(Encoding::UTF_8).gsub('&lt;', '<').gsub('&gt;', '>').gsub('&amp;', '&')
    end

    def legacy_meta(text)
      line = text.each_line.take(3)[2].to_s
      return nil unless line.start_with?(LEGACY_MARK + '<lcty-c ')
      frame_meta(line.chomp.delete_prefix(LEGACY_MARK).sub(/>\z/, ' />'))
    end

    # Rule of that format: lines starting with "<!" (lines 1 to 3) are not elements
    def legacy_body(text)
      text.each_line.reject { |l| l.start_with?('<!') }.join
    end

    # ---- Writing ----

    def encode(lines)
      out = lines.map { |o| to_element(o).to_xhtml(save_with: SAVE) }.join("\n") + "\n"
      begin
        Nokogiri::XML::DocumentFragment.parse(out, Nokogiri::XML::ParseOptions::STRICT)
      rescue Nokogiri::XML::SyntaxError => e
        raise FormatError, "serialized fragment is not well-formed XML: #{e.message}"
      end
      out
    end

    def to_element(obj)
      check_chars!(obj, obj['type'].to_s)
      doc = Nokogiri::HTML5::Document.parse('')
      case obj['type']
      when 'setup'
        # The system prompt, line 4. Written once, when the conversation is created (LCTYSP-0003).
        e = node(doc, 'lcty-setup')
        set_text(e, 'data-instructions', obj['instructions'].to_s)
        e
      when 'cmd'
        # A command tag: an operation to run, written at the end of the file. The page runs it when the file ends with it
        # (send = generate a reply at once. LCTYSP-0004)
        raise FormatError, "invalid command: #{obj['op'].inspect}" unless CMD_OP_RE.match?(obj['op'].to_s)
        node(doc, 'lcty-cmd', 'data-op' => obj['op'], 'data-at' => obj['at'])
      when 'message'
        attrs = {
          # id is "c-msg-" + the message UUIDv7, so #c-msg-… links to it (LCTYSP-0003)
          'id' => obj['id'] && "c-msg-#{obj['id']}", 'data-role' => obj['role'], 'data-at' => obj['at'], 'data-status' => obj['status'],
          'data-error' => obj['error'] && visible(obj['error']), 'data-inherited' => obj['inherited'] ? 'true' : nil
        }
        JSON_ATTRS.each { |k, a| attrs[a] = JSON.generate(obj[k]) if obj[k] }
        e = node(doc, 'lcty-message', attrs)
        # The attribute is the source of truth; children are for display (dual recording. LCTYSP-0003)
        set_text(e, 'data-content', obj['content'].to_s)
        if obj['role'] == 'user'
          e.add_child(node(doc, 'div', { 'class' => 'user-text' }, visible(obj['content'])))
        else
          # Thinking is the attribute only: it has no presentation in the file (the page builds one from it, LCTYSP-0003)
          thinking = obj['thinking'].to_s
          set_text(e, 'data-thinking', thinking) unless thinking.empty?
          # The browser renders the presentation HTML with the committed converter (reply.js) and sends it. Without it, leave this empty and the module renders from the attribute
          html = obj['content_html']
          md = node(doc, 'article', html.is_a?(String) ? { 'data-generator' => GENERATOR } : {})
          add_presentation(md, html, doc) if html.is_a?(String)
          e.add_child(md)
        end
        e
      else
        raise FormatError, "unknown line type: #{obj['type'].inspect}"
      end
    end

    def node(doc, name, attrs = {}, text = nil)
      e = Nokogiri::XML::Node.new(name, doc)
      attrs.each { |k, v| e[k] = v.to_s unless v.nil? }
      e.add_child(Nokogiri::XML::Text.new(text.to_s, doc)) unless text.nil?
      e
    end

    # ---- Reading ----

    # [[line object, element], …], starting with the title read from the slot and the meta read from line 4 and the
    # first lcty-setup (element nil). A last element broken by an interrupted write is dropped.
    def decode(text, label = '')
      if legacy?(text)
        title = legacy_title(text)
        meta = legacy_meta(text)
      else
        head = text.each_line.take(HEAD_LINES)
        title = slot_title(head[2]) || loose_title(head[2])
        meta = frame_meta(head[3])
      end
      els = decode_elements(text, label)
      setup = els.find { |o, _| o['type'] == 'setup' }
      meta['instructions'] = setup[0]['instructions'] if meta && setup
      # LCTYSP-0013 has no lcty-setup: the instructions are its system messages without a tag, joined
      systems = els.map(&:first).select { |o| o['type'] == 'system' && o['role'] == 'system' && !o['tag'] }
      meta['instructions'] = systems.map { |o| o['content'] }.join("\n\n") if meta && !setup && !systems.empty?
      head = title.nil? || title.empty? ? [] : [[{ 'type' => 'title', 'title' => title }, nil]]
      head << [meta, nil] if meta
      head + els.reject { |o, _| o['type'] == 'setup' }
    end

    def decode_elements(text, label)
      body = body_text(text)
      frag = Nokogiri::XML::DocumentFragment.parse(body)
      els = frag.element_children.to_a
      unless frag.errors.empty?
        # A write cut short leaves the last element unclosed: drop it only then, not for an error elsewhere (stray text
        # after a whole element, for one), which would lose a message that was written whole
        last = els.last
        cut = last && !body.lines.drop(last.line - 1).join.include?("</#{last.name}>")
        warn "conversation file #{label} is not well-formed (#{frag.errors.first.message.strip})" \
             "#{cut ? '; dropping the last element, which is not closed' : ''}"
        els.pop if cut
      end
      els.map { |e| (o = from_element(e)) && [o, e] }.compact
    end

    def from_element(e)
      a = ->(k) { e[k] }
      case e.name
      when 'lcty-setup'
        { 'type' => 'setup', 'instructions' => get_text(e, 'data-instructions').to_s }
      when 'lcty-cmd'
        # An lcty-cmd of LCTYSP-0013 also has an id (cmd-…) and may have data-error
        o = { 'type' => 'cmd', 'op' => a.('data-op'), 'at' => a.('data-at') }
        o['id'] = a.('id').sub(/\Acmd-/, '') if a.('id')
        o['error'] = a.('data-error') if a.('data-error')
        o
      when 'lcty-msg'
        # LCTYSP-0013: user and model are the messages of today (model as assistant), with the bare id; system and
        # memory are lines of their own
        id = a.('id').to_s.sub(/\A(?:msg-[um]-|sys-|mem-)/, '')
        content = get_text(e, 'data-content').to_s
        case (role = a.('data-role'))
        when 'user', 'model'
          { 'type' => 'message', 'id' => id, 'role' => role == 'model' ? 'assistant' : 'user', 'at' => a.('data-at'),
            'content' => content }
        else
          { 'type' => 'system', 'id' => id, 'role' => role, 'template' => a.('data-template'), 'tag' => a.('data-tag'),
            'content' => content }.compact
        end
      when 'lcty-thinking'
        { 'type' => 'thinking', 'id' => a.('id').to_s.sub(/\Athink-/, ''), 'at' => a.('data-at'),
          'content' => get_text(e, 'data-content').to_s }
      when 'lcty-message'
        o = { 'type' => 'message', 'id' => a.('id') && a.('id').sub(/\Ac-msg-/, ''), 'role' => a.('data-role'), 'at' => a.('data-at') }
        o['status'] = a.('data-status') if a.('data-status')
        o['error'] = a.('data-error') if a.('data-error')
        o['inherited'] = true if a.('data-inherited') == 'true'
        JSON_ATTRS.each do |k, attr|
          next unless (v = a.(attr))
          o[k] = (JSON.parse(v) rescue nil)
        end
        o['content'] = get_text(e, 'data-content').to_s
        if o['role'] == 'assistant'
          r = get_text(e, 'data-thinking')
          o['thinking'] = r if r
          # Presentation HTML (kept so rewrites preserve it; never returned by the API)
          md = e.at_xpath('article')
          o['content_html'] = md.children.map { |c| c.to_xhtml(save_with: SAVE, encoding: 'UTF-8') }.join if md && md['data-generator'] == GENERATOR
        end
        o
      end
    end

    def split_tags(s)
      s.to_s.split(/\s+/).reject(&:empty?)
    end
  end
end
