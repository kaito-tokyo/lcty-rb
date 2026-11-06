# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Reading and writing conversation files (HTML fragments of Custom Elements. LCTYSP-003).
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
    # A character XML 1.0 cannot represent, found outside the text strings (ids, tag names, …. LCTYSP-003)
    class InvalidCharError < FormatError; end

    # C0 controls other than tab, LF and CR, plus U+FFFE / U+FFFF (not even as character references; surrogates never appear in UTF-8 strings)
    XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.freeze
    # Text strings (the attribute is the source of truth; base64 only when it has unwritable characters) and display-only values. Not checked
    TEXT_KEYS = %w[content thinking instructions content_html title error].freeze
    CMD_OP_RE = /\A[a-z][a-z0-9-]{0,31}\z/.freeze # Command names (lcty-cmd data-op)
    GENERATOR = 'lcty.v1' # The renderer that produced the presentation HTML (data-generator)

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

    # Allowlist for presentation HTML (only the elements and attributes markdown.js emits). Other elements keep only their contents; DROP removes them with their contents
    ALLOWED = {
      'p' => [], 'br' => [], 'hr' => [], 'strong' => [], 'em' => [], 'del' => [], 'blockquote' => [],
      'h1' => [], 'h2' => [], 'h3' => [], 'h4' => [], 'h5' => [], 'h6' => [],
      'ul' => [], 'ol' => ['start'], 'li' => [], 'pre' => [], 'code' => ['data-lang'],
      'table' => [], 'thead' => [], 'tbody' => [], 'tr' => [], 'th' => ['style'], 'td' => ['style'],
      'a' => %w[href target rel], 'div' => ['class'], 'span' => ['class'], 'button' => %w[type class]
    }.freeze
    DROP = %w[script style template iframe object embed noscript svg math head title meta link base form input textarea select].freeze
    ATTR_OK = {
      'href' => %r{\A(?:https?:|mailto:)}i, 'target' => /\A_blank\z/, 'rel' => /\Anoopener noreferrer\z/,
      'style' => /\Atext-align:(?:left|center|right)\z/, 'start' => /\A\d{1,9}\z/,
      'class' => /\A[\w -]{1,100}\z/, 'type' => /\Abutton\z/, 'data-lang' => /\A[^<>"]{0,40}\z/
    }.freeze

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
            attrs.each { |a| (v = n[a]) && ATTR_OK[a].match?(v) && (e[a] = v) }
            copy_clean(n.children, e, doc)
            parent.add_child(e)
          elsif !DROP.include?(name)
            copy_clean(n.children, parent, doc)
          end
        end
      end
    end

    # The head of a conversation file (LCTYSP-003), three lines that all start with "<!" (so the element parser skips
    # them; Ruby reads lines 2 and 3 on their own):
    #   1. the header: the scripts and the stylesheet the file loads. Opened over HTTP, the file shows as the conversation.
    #   2. <!--lcty-meta--> and the title slot <title>…</title><!--…-->. The <title> is the document's own title.
    #   3. <!--lcty-meta--> and the frame's opening tag <lcty-c id="c-<id>" data-setup-tags data-created-at>:
    #      what the frame needs to know, written once at creation. <lcty-c> is never closed: the HTML parser closes it at
    #      the end of the file, so every element from line 4 on becomes its child and appending is just adding to the end.
    # Lines 4 and later are elements, a well-formed XML fragment; line 4 is lcty-setup (the system prompt).
    # The "<!" lines hold only what a list of conversations needs (title, id, tags, created_at), so collecting
    # them is enough to build the sidebar's database; the system prompt, which may be long, is on line 4.
    # data-lcty-tlrange is the title slot: the half-open byte range from the "<" of <title> to the end of line 2 (just
    # after "-->"), as two fixed-width hex numbers (so the header length never depends on them). The slot is overwritten
    # in place when the title changes.
    TITLE_SLOT = 512 # Default slot length (bytes)
    HEADER_FORMAT = %(<!doctype html><html data-lcty-tlrange="0x%04x,0x%04x" lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="lcty.v1.module.js"></script><link rel="stylesheet" href="lcty.v1.css"><script src="lcty.v1.js"></script><script src="lcty.v1.lang-ja.js"></script><script>defineLctyV1CustomElements();</script>\n).freeze
    HEAD_MARK = '<!--lcty-meta-->' # starts lines 2 and 3, so they start with "<!" (the meta lines)
    HEADER = begin
      start = format(HEADER_FORMAT, 0, 0).bytesize + HEAD_MARK.bytesize
      format(HEADER_FORMAT, start, start + TITLE_SLOT).freeze
    end
    SLOT_END = '-->'

    # The blank slot of size bytes: a ruler of digits ending with "0-->" (aligned so the digit just before "-->" is
    # always 0, which makes a broken slot easy to spot). Overwriting its head with "<title>…</title><!--" turns the rest
    # of the ruler into the comment body: digits never form "--", so the result is always a valid comment, and the slot
    # length never changes.
    def blank_slot(size)
      n = size - SLOT_END.bytesize
      (1..n).map { |i| ((i - n) % 10).to_s }.join + SLOT_END
    end

    # The title slot, exactly size bytes. The escaped title is cut at a character boundary so the slot never exceeds
    # TITLE_SLOT; nil when even that does not fit in size (the caller rewrites the file).
    # Newlines become spaces and unwritable characters become Control Pictures (display only).
    def title_line(title, size = TITLE_SLOT)
      chars = visible(title.to_s.gsub(/[\r\n]+/, ' ')).strip.chars
      head = ->(cs) { "<title>#{cs.join.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;')}</title><!--" }
      chars.pop while head.(chars).bytesize > TITLE_SLOT - SLOT_END.bytesize
      h = head.(chars)
      return nil if h.bytesize > size - SLOT_END.bytesize
      slot = blank_slot(size)
      slot[0, h.bytesize] = h
      slot
    end

    # The title slot [start, end) declared by a header line, or nil when the line has none.
    def tlrange(header)
      m = header.to_s.b[/data-lcty-tlrange="0x\h{4},0x\h{4}"/]
      m && m.scan(/0x(\h{4})/).flatten.map { |h| h.to_i(16) }
    end

    # Whether the bytes of a slot look like one (so it can be overwritten in place)
    def slot?(bytes)
      bytes = bytes.to_s.b
      bytes.start_with?('<title>') && bytes.end_with?(SLOT_END) && !bytes.include?("\n")
    end

    # The title written in the slot [start, end) of text, or nil when there is none
    def slot_title(text)
      range = tlrange(text.each_line.first)
      return nil unless range && range[1] > range[0]
      bytes = text.b[range[0]...range[1]].to_s
      return nil unless slot?(bytes)
      t = bytes[%r{\A<title>([^<]*)</title><!--}, 1] or return nil
      t.force_encoding(Encoding::UTF_8).gsub('&lt;', '<').gsub('&gt;', '>').gsub('&amp;', '&')
    end

    # The current title (the last title line)
    def current_title(lines)
      lines.reverse.find { |l| l['type'] == 'title' }
    end

    # The meta: line 3's <lcty-c> attributes (id, tags at creation, created_at) and the first lcty-setup's
    # instructions. Written once when the conversation is created and never overridden (LCTYSP-003).
    def current_meta(lines)
      lines.find { |l| l['type'] == 'meta' } || {}
    end

    # The whole conversation file: the header, the title slot, <lcty-c>, then lcty-setup and the other elements
    # (LCTYSP-003)
    def document(lines)
      title = current_title(lines)
      meta = current_meta(lines)
      raise FormatError, 'a conversation needs a meta' if meta.empty?
      rest = lines.reject { |l| %w[title meta].include?(l['type']) }
      HEADER + HEAD_MARK + title_line(title ? title['title'] : '') + "\n" + frame_line(meta) +
        encode([meta.merge('type' => 'setup')] + rest)
    end

    # Line 3: <!--lcty-meta--><lcty-c …> (written once; never closed)
    def frame_line(meta)
      check_chars!(meta, 'meta')
      tags = Array(meta['tags'])
      e = node(Nokogiri::HTML5::Document.parse(''), 'lcty-c',
               'id' => "c-#{meta['id']}", 'data-setup-tags' => tags.empty? ? nil : tags.join(' '),
               'data-created-at' => meta['created_at'])
      HEAD_MARK + e.to_xhtml(save_with: SAVE).sub(%r{</lcty-c>\z}, '') + "\n"
    end

    # The meta from line 3, or nil when the line is not one
    def frame_meta(line)
      return nil unless line.to_s.start_with?(HEAD_MARK + '<lcty-c ')
      e = Nokogiri::XML::DocumentFragment.parse(line.chomp.delete_prefix(HEAD_MARK) + '</lcty-c>').at_xpath('lcty-c')
      return nil unless e
      { 'type' => 'meta', 'id' => e['id'].to_s.sub(/\Ac-/, ''), 'created_at' => e['data-created-at'],
        'tags' => split_tags(e['data-setup-tags']), 'instructions' => '' }
    end

    # Rule: lines starting with "<!" are skipped when reading: lines 1 to 3. Text escapes < as &lt;, so a text line never
    # starts with a raw "<!".
    def strip_directives(text)
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
        # The system prompt, line 4. Written once, when the conversation is created (LCTYSP-003).
        e = node(doc, 'lcty-setup')
        set_text(e, 'data-instructions', obj['instructions'].to_s)
        e
      when 'cmd'
        # A command tag: an operation to run, written at the end of the file. The page runs it when the file ends with it
        # (send = generate a reply at once. LCTYSP-004)
        raise FormatError, "invalid command: #{obj['op'].inspect}" unless CMD_OP_RE.match?(obj['op'].to_s)
        node(doc, 'lcty-cmd', 'data-op' => obj['op'], 'data-at' => obj['at'])
      when 'message'
        attrs = {
          # id is "c-msg-" + the message UUIDv7, so #c-msg-… links to it (LCTYSP-003)
          'id' => obj['id'] && "c-msg-#{obj['id']}", 'data-role' => obj['role'], 'data-at' => obj['at'], 'data-status' => obj['status'],
          'data-error' => obj['error'] && visible(obj['error']), 'data-inherited' => obj['inherited'] ? 'true' : nil
        }
        JSON_ATTRS.each { |k, a| attrs[a] = JSON.generate(obj[k]) if obj[k] }
        e = node(doc, 'lcty-message', attrs)
        # The attribute is the source of truth; children are for display (dual recording. LCTYSP-003)
        set_text(e, 'data-content', obj['content'].to_s)
        if obj['role'] == 'user'
          e.add_child(node(doc, 'div', { 'class' => 'user-text' }, visible(obj['content'])))
        else
          # Thinking is the attribute only: it has no presentation in the file (the page builds one from it, LCTYSP-003)
          thinking = obj['thinking'].to_s
          set_text(e, 'data-thinking', thinking) unless thinking.empty?
          # The browser renders the presentation HTML with markdown.js and sends it. Without it, leave this empty and the module renders from the attribute
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

    # [[line object, element], …], starting with the title read from the slot and the meta read from line 3 and the
    # first lcty-setup (element nil). A last element broken by an interrupted write is dropped.
    def decode(text, label = '')
      title = slot_title(text)
      meta = frame_meta(text.each_line.take(3)[2])
      els = decode_elements(text, label)
      setup = els.find { |o, _| o['type'] == 'setup' }
      meta['instructions'] = setup[0]['instructions'] if meta && setup
      head = title.nil? || title.empty? ? [] : [[{ 'type' => 'title', 'title' => title }, nil]]
      head << [meta, nil] if meta
      head + els.reject { |o, _| o['type'] == 'setup' }
    end

    def decode_elements(text, label)
      frag = Nokogiri::XML::DocumentFragment.parse(strip_directives(text))
      els = frag.element_children.to_a
      unless frag.errors.empty?
        warn "conversation file #{label} is not well-formed (#{frag.errors.first.message.strip}); dropping the last element"
        els.pop
      end
      els.map { |e| (o = from_element(e)) && [o, e] }.compact
    end

    def from_element(e)
      a = ->(k) { e[k] }
      case e.name
      when 'lcty-setup'
        { 'type' => 'setup', 'instructions' => get_text(e, 'data-instructions').to_s }
      when 'lcty-cmd'
        { 'type' => 'cmd', 'op' => a.('data-op'), 'at' => a.('data-at') }
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
