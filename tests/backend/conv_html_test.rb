# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3002: the scenarios of docs/specs/LCTYSP-3002_conversation-html.feature, written by hand. Each test has the
# title of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by
# side.

require_relative 'helper'
require 'conv_html'
require 'uuid'

class ConvHtmlTest < Lcty::Scenarios
  ConvHtml = Chatty::ConvHtml
  ID1 = '0190f3a1-7c2e-7abc-8def-0123456789ab'
  ID2 = '0190f3a1-7c2e-7abc-8def-0123456789ac'
  AT = '2026-11-07T10:00:00+09:00'

  def meta(extra = {})
    { 'type' => 'meta', 'id' => 'conv-1', 'created_at' => AT, 'tags' => [], 'instructions' => 'sys' }.merge(extra)
  end

  # The line objects that ConvHtml.decode reads from what ConvHtml.document wrote
  def round_trip(lines)
    ConvHtml.decode(ConvHtml.document(lines)).map(&:first)
  end

  def messages(objs)
    objs.select { |o| o['type'] == 'message' }
  end

  # The elements (line 5 and later) of a document as a strict XML fragment
  def elements(doc)
    Nokogiri::XML::DocumentFragment.parse(ConvHtml.body_text(doc)).element_children.to_a
  end

  # A document whose body (from line 5) is replaced by body
  def with_body(body)
    ConvHtml.document([meta]).lines.take(ConvHtml::HEAD_LINES).join + body
  end

  scenario 'A document has the four head lines and then the elements' do
    m = lines = doc = nil
    step('Given a meta with the id "conv-1", the tags "ruby" and "concise", a creation time and the instructions "Be brief"') do
      m = meta('tags' => %w[ruby concise], 'instructions' => 'Be brief')
    end
    step('And the title "Hello" and a user message') do
      lines = [m, { 'type' => 'title', 'title' => 'Hello' },
               { 'type' => 'message', 'id' => ID1, 'role' => 'user', 'at' => AT, 'content' => 'hi' }]
    end
    step('When ConvHtml.document writes them') { doc = ConvHtml.document(lines).lines }
    step('Then line 1 is the doctype with <html lang="ja" /> and line 2 is the <head> ending with </head>') do
      assert_equal %(<!DOCTYPE html><html lang="ja" />\n), doc[0]
      assert doc[1].start_with?('<head>'), doc[1]
      assert doc[1].end_with?("</head>\n"), doc[1]
      assert_equal ConvHtml::HEADER, doc[0] + doc[1]
    end
    step('And line 3 is the title slot of 512 bytes holding "Hello"') do
      line = doc[2].chomp
      assert line.start_with?('<title id="__512">Hello</title><!--'), line
      start, size = ConvHtml.slot_range(line)
      assert_equal ['<title id="__512">'.bytesize, 512], [start, size]
      assert_equal 'Hello', ConvHtml.slot_title(line)
    end
    step('And line 4 is <lcty-c id="c-conv-1" data-setup-tags="ruby concise" data-created-at="…" />') do
      assert_equal %(<lcty-c id="c-conv-1" data-setup-tags="ruby concise" data-created-at="#{AT}" />\n), doc[3]
    end
    step('And line 5 is the lcty-setup with data-instructions="Be brief" and line 6 is the lcty-message') do
      assert_equal %(<lcty-setup data-instructions="Be brief"></lcty-setup>\n), doc[4]
      assert doc[5].start_with?(%(<lcty-message id="c-msg-#{ID1}" data-role="user")), doc[5]
      assert_equal 6, doc.size
    end
    step('And ConvHtml.head_lines accepts the first four lines') do
      assert_equal doc.take(4), ConvHtml.head_lines(doc.join)
    end
  end

  scenario 'A document reads back as the lines it was written from' do
    lines = doc = objs = nil
    user = { 'type' => 'message', 'id' => ID1, 'role' => 'user', 'at' => AT, 'content' => "Hi\nthere" }
    assistant = { 'type' => 'message', 'id' => ID2, 'role' => 'assistant', 'at' => AT, 'status' => 'completed',
                  'content' => '# Hello', 'thinking' => 'hmm' }
    cmd = { 'type' => 'cmd', 'op' => 'send', 'at' => AT }
    step('Given a document with a title, a meta, a user message, an assistant message and a send command') do
      lines = [{ 'type' => 'title', 'title' => 'T' }, meta('tags' => %w[a b]), user, assistant, cmd]
      doc = ConvHtml.document(lines)
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(doc).map(&:first) }
    step('Then the first line object is the title and the second is the meta with the instructions of the lcty-setup') do
      assert_equal({ 'type' => 'title', 'title' => 'T' }, objs[0])
      assert_equal meta('tags' => %w[a b]), objs[1]
    end
    step('And the messages and the command follow in order with every field as written') do
      assert_equal [user, assistant, cmd], objs[2..-1]
    end
    step('And the message ids are read without their c-msg- prefix') do
      assert_includes doc, %(id="c-msg-#{ID1}")
      assert_equal [ID1, ID2], messages(objs).map { |o| o['id'] }
    end
  end

  scenario 'A document needs a meta' do
    err = nil
    step('When ConvHtml.document is given lines without a meta') do
      err = assert_raises(ConvHtml::FormatError) { ConvHtml.document([{ 'type' => 'title', 'title' => 'x' }]) }
    end
    step('Then it raises FormatError "a conversation needs a meta"') do
      assert_equal 'a conversation needs a meta', err.message
    end
  end

  scenario 'A frame without tags has no data-setup-tags' do
    line = nil
    step('When ConvHtml.frame_line writes a meta with no tags') { line = ConvHtml.frame_line(meta('id' => 'x_1')) }
    step('Then the line is <lcty-c id="c-…" data-created-at="…" /> and a newline') do
      assert_equal %(<lcty-c id="c-x_1" data-created-at="#{AT}" />\n), line
    end
    step('And ConvHtml.frame_meta reads it back with the tags [] and the empty instructions') do
      assert_equal({ 'type' => 'meta', 'id' => 'x_1', 'created_at' => AT, 'tags' => [], 'instructions' => '' },
                   ConvHtml.frame_meta(line))
    end
  end

  scenario 'ConvHtml.frame_meta reads only a frame line' do
    step('Then ConvHtml.frame_meta returns nil for a line that does not start with "<lcty-c "') do
      assert_nil ConvHtml.frame_meta('<lcty-setup data-instructions="x"></lcty-setup>')
      assert_nil ConvHtml.frame_meta(' <lcty-c id="c-x" />')
      assert_nil ConvHtml.frame_meta(nil)
    end
  end

  {
    '"a\rb" (CR)' => "a\rb",
    '"a\r\nb" (CRLF)' => "a\r\nb",
    '"\ta\n\nb " (tab, newlines)' => "\ta\n\nb ",
    '"\u0085\u009f" (C1 controls)' => "\u0085\u009f",
    '"😀 U+2028 " (emoji)' => "😀 U+2028 ",
    '"﻿bom" (BOM)' => "﻿bom",
    '"&#0; &amp;" (references)' => '&#0; &amp;',
    %q("<b>\"'</b>" (markup)) => %(<b>"'</b>),
    '"�" (U+FFFD)' => "�"
  }.each do |label, text|
    scenario "A text string is kept byte for byte in a plain attribute (#{label})" do
      line = doc = objs = nil
      step("Given a user message whose content is #{label}") do
        line = { 'type' => 'message', 'id' => ID1, 'role' => 'user', 'at' => AT, 'content' => text }
      end
      step('When it is written and read back') do
        doc = ConvHtml.document([meta, line])
        objs = ConvHtml.decode(doc)
      end
      step('Then the content is the same string') do
        content = messages(objs.map(&:first))[0]['content']
        assert_equal text, content
        assert_equal text.b, content.b
      end
      step('And it is written in data-content, not in data-content-base64') do
        e = objs.last[1]
        assert_equal text, e['data-content']
        assert_nil e['data-content-base64']
      end
    end
  end

  [
    ['content of a user', 'U+0000', 'data-content'],
    ['thinking of an assistant', 'ESC', 'data-thinking'],
    ['instructions of the meta', 'U+0007', 'data-instructions'],
    ['content of an assistant', 'U+FFFF', 'data-content']
  ].each do |field, char, attribute|
    scenario "A text string with a character XML cannot represent is written as base64 (#{field})" do
      c = { 'U+0000' => "\u0000", 'ESC' => "\e", 'U+0007' => "\u0007", 'U+FFFF' => "￿" }[char]
      text = "x#{c}y\n"
      lines = doc = objs = el = nil
      step("Given a message whose #{field} holds #{char}") do
        lines =
          case field
          when 'content of a user' then [meta, { 'type' => 'message', 'role' => 'user', 'content' => text }]
          when 'thinking of an assistant'
            [meta, { 'type' => 'message', 'role' => 'assistant', 'content' => 'a', 'thinking' => text }]
          when 'instructions of the meta' then [meta('instructions' => text)]
          else [meta, { 'type' => 'message', 'role' => 'assistant', 'content' => text }]
          end
      end
      step('When it is written and read back') do
        doc = ConvHtml.document(lines)
        objs = ConvHtml.decode(doc).map(&:first)
        el = elements(doc).last
      end
      step("Then the element has #{attribute}-base64 and not #{attribute}") do
        assert_equal [text.b].pack('m0'), el["#{attribute}-base64"]
        assert_nil el[attribute]
      end
      step('And the read value is the original string') do
        value =
          case field
          when 'thinking of an assistant' then messages(objs)[0]['thinking']
          when 'instructions of the meta' then ConvHtml.current_meta(objs)['instructions']
          else messages(objs)[0]['content']
          end
        assert_equal text, value
      end
    end
  end

  scenario 'The presentation of a user message shows unwritable characters as Control Pictures' do
    doc = nil
    step('When a user message with the content "a\u001bb\u0000" is written') do
      doc = ConvHtml.document([meta, { 'type' => 'message', 'role' => 'user', 'content' => "a\u001bb\u0000" }])
    end
    step('Then its div.user-text reads "a␛b␀"') do
      assert_equal 'a␛b␀', elements(doc).last.at_xpath('div[@class="user-text"]').text
    end
    step('And ConvHtml.visible turns U+FFFE into U+FFFD') { assert_equal "a�b", ConvHtml.visible("a￾b") }
  end

  scenario 'A broken base64 attribute is ignored with a warning' do
    doc = objs = err = nil
    step('Given a message element whose data-content-base64 is not valid UTF-8') do
      broken = [[0xff, 0xfe].pack('C*')].pack('m0')
      doc = with_body(%(<lcty-message data-role="user" data-content-base64="#{broken}"></lcty-message>\n))
    end
    step('When ConvHtml.decode reads it') { _, err = capture_io { objs = ConvHtml.decode(doc).map(&:first) } }
    step('Then it warns that data-content-base64 is broken') { assert_match(/data-content-base64 is broken/, err) }
    step('And the content is the empty string') { assert_equal '', messages(objs)[0]['content'] }
  end

  scenario 'ConvHtml.check_chars! names where an unwritable character is' do
    err = nil
    step('When ConvHtml.check_chars! checks a line whose id holds U+0001 at index 3') do
      err = assert_raises(ConvHtml::InvalidCharError) { ConvHtml.check_chars!('type' => 'message', 'id' => "abc\u0001") }
    end
    step('Then it raises InvalidCharError "line.id contains a character that XML cannot represent: U+0001 at 3"') do
      assert_equal 'line.id contains a character that XML cannot represent: U+0001 at 3', err.message
    end
    step('And in a meta whose second tag holds U+FFFE the path is "meta.tags[1]"') do
      e = assert_raises(ConvHtml::InvalidCharError) { ConvHtml.check_chars!({ 'tags' => ['ok', "￾"] }, 'meta') }
      assert_equal 'meta.tags[1] contains a character that XML cannot represent: U+FFFE at 0', e.message
    end
  end

  scenario 'ConvHtml.check_chars! leaves the text strings alone' do
    step('Then ConvHtml.check_chars! accepts U+0000 in content, thinking, instructions, content_html, title and error') do
      line = {}
      %w[content thinking instructions content_html title error].each { |k| line[k] = "a\u0000" }
      ConvHtml.check_chars!(line) # raises InvalidCharError otherwise
      ConvHtml.check_chars!([line], 'lines')
      pass
    end
  end

  scenario 'Encoding a line with an unwritable character outside the text strings is rejected' do
    err = nil
    step('When ConvHtml.encode is given a message whose role holds U+0002') do
      err = assert_raises(ConvHtml::InvalidCharError) do
        ConvHtml.encode([{ 'type' => 'message', 'role' => "user\u0002", 'content' => 'x' }])
      end
    end
    step('Then it raises InvalidCharError, which is a FormatError') do
      assert_kind_of ConvHtml::FormatError, err
      assert_match(/\Amessage\.role contains/, err.message)
    end
  end

  scenario 'An unknown line type cannot be encoded' do
    err = nil
    step('When ConvHtml.encode is given a line of the type "tags"') do
      err = assert_raises(ConvHtml::FormatError) { ConvHtml.encode([{ 'type' => 'tags', 'tags' => [] }]) }
    end
    step(%q(Then it raises FormatError 'unknown line type: "tags"')) do
      assert_equal 'unknown line type: "tags"', err.message
    end
  end

  {
    '"Send" (uppercase)' => 'Send',
    '"" (empty)' => '',
    '"-send" (leading hyphen)' => '-send',
    '33 letters (too long)' => 'a' * 33,
    'nil' => nil
  }.each do |label, op|
    scenario "A command name must be lowercase letters, digits and hyphens (#{label})" do
      err = nil
      step("When ConvHtml.encode is given a command named #{label}") do
        err = assert_raises(ConvHtml::FormatError) { ConvHtml.encode([{ 'type' => 'cmd', 'op' => op }]) }
      end
      step('Then it raises FormatError "invalid command"') do
        assert_equal "invalid command: #{op.inspect}", err.message
      end
    end
  end

  scenario 'Encoded elements are well-formed XML that also reads as HTML' do
    out = nil
    step('When ConvHtml.encode writes a send command and an assistant message') do
      out = ConvHtml.encode([{ 'type' => 'cmd', 'op' => 'send', 'at' => AT },
                             { 'type' => 'message', 'role' => 'assistant', 'content' => "a\nb" }])
    end
    step('Then the command is <lcty-cmd data-op="send" data-at="…"></lcty-cmd>, with an explicit end tag') do
      assert_equal %(<lcty-cmd data-op="send" data-at="#{AT}"></lcty-cmd>), out.lines[0].chomp
    end
    step('And the elements are separated by single newlines and the output ends with a newline') do
      assert_equal 2, out.lines.size
      assert out.end_with?("</lcty-message>\n"), out
      assert_includes out, 'data-content="a&#10;b"'
    end
    step('And the output parses as strict XML') do
      frag = Nokogiri::XML::DocumentFragment.parse(out, Nokogiri::XML::ParseOptions::STRICT)
      assert_equal %w[lcty-cmd lcty-message], frag.element_children.map(&:name)
    end
  end

  scenario 'Presentation HTML is filtered through the allowlist' do
    html = '<h1>Title</h1><script>alert(1)</script><custom-x>kept <em>text</em></custom-x>' \
           '<a href="javascript:alert(1)" target="_blank" onclick="x()">bad</a>' \
           '<a href="https://example.com/" target="_top" rel="noopener noreferrer">good</a>' \
           '<pre><code data-lang="ruby" class="x">p 1</code></pre>'
    doc = obj = article = nil
    step('Given an assistant message whose content_html holds a heading, a script, an unknown element, a javascript: link and a code block') do
      obj = { 'type' => 'message', 'role' => 'assistant', 'content' => 'x', 'content_html' => html }
    end
    step('When it is written and read back') do
      doc = ConvHtml.document([meta, obj])
      article = elements(doc).last.at_xpath('article')
    end
    step('Then the article has data-generator="lcty.v1.gfm"') { assert_equal 'lcty.v1.gfm', article['data-generator'] }
    step('And the script is dropped with its contents and the unknown element keeps only its contents') do
      inner = article.to_xhtml
      refute_includes inner, 'script'
      refute_includes inner, 'alert'
      refute_includes inner, 'custom-x'
      assert_includes inner, 'kept <em>text</em>'
    end
    step('And the link keeps only its allowed attributes and the code keeps data-lang') do
      links = article.xpath('a')
      assert_equal [{ 'target' => '_blank' }, { 'href' => 'https://example.com/', 'rel' => 'noopener noreferrer' }],
                   links.map { |a| a.attributes.map { |k, v| [k, v.value] }.to_h }
      assert_equal({ 'data-lang' => 'ruby' }, article.at_xpath('pre/code').attributes.map { |k, v| [k, v.value] }.to_h)
    end
    step('And the content_html read back is the filtered HTML') do
      assert_equal '<h1>Title</h1>kept <em>text</em><a target="_blank">bad</a>' \
                   '<a href="https://example.com/" rel="noopener noreferrer">good</a>' \
                   '<pre><code data-lang="ruby">p 1</code></pre>',
                   messages(ConvHtml.decode(doc).map(&:first))[0]['content_html']
    end
  end

  scenario 'A class is kept only where LCTYSP-0017 lists it' do
    html = '<div class="table-wrap"><table><thead><tr><th class="align-right">a</th><th style="text-align:left">b</th></tr></thead>' \
           '<tbody><tr><td class="align-center">1</td><td class="x">2</td></tr></tbody></table></div>' \
           '<p><span class="task done">☑</span> <span class="codeblock">x</span>' \
           '<button type="button" class="suggestion">s</button><button type="button" class="copy">c</button></p>'
    out = nil
    step('Given an assistant message whose content_html holds aligned cells, a cell with a style, task and suggestion classes and classes of other elements') do
      out = { 'type' => 'message', 'role' => 'assistant', 'content' => 'x', 'content_html' => html }
    end
    step('When it is written and read back') do
      out = messages(ConvHtml.decode(ConvHtml.document([meta, out])).map(&:first))[0]['content_html']
    end
    step('Then the alignment classes, "task done" and "suggestion" are kept, and a style and the other classes are dropped') do
      assert_equal '<div class="table-wrap"><table><thead><tr><th class="align-right">a</th><th>b</th></tr></thead>' \
                   '<tbody><tr><td class="align-center">1</td><td>2</td></tr></tbody></table></div>' \
                   '<p><span class="task done">☑</span> <span>x</span>' \
                   '<button type="button" class="suggestion">s</button><button type="button">c</button></p>',
                   out
    end
  end

  scenario 'Without content_html the article is empty' do
    doc = objs = nil
    step('When an assistant message without content_html is written and read back') do
      doc = ConvHtml.document([meta, { 'type' => 'message', 'role' => 'assistant', 'content' => '# x' }])
      objs = ConvHtml.decode(doc).map(&:first)
    end
    step('Then the article is empty and has no data-generator') do
      assert_includes doc, '<article></article>'
    end
    step('And the read message has no content_html') { refute messages(objs)[0].key?('content_html') }
  end

  scenario 'An article that the renderer did not mark is not read as content_html' do
    doc = objs = nil
    step('Given an assistant message whose article has no data-generator') do
      doc = with_body(%(<lcty-message data-role="assistant" data-content="x"><article><p>x</p></article></lcty-message>\n))
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(doc).map(&:first) }
    step('Then the read message has no content_html') { refute messages(objs)[0].key?('content_html') }
  end

  scenario 'The JSON attributes, the error and inherited round trip' do
    obj = objs = nil
    step('Given an assistant message with timings, client, usage, the status "incomplete", an error holding ESC and inherited') do
      obj = { 'type' => 'message', 'id' => ID1, 'role' => 'assistant', 'content' => 'x', 'status' => 'incomplete',
              'timings' => { 'cache_n' => 3, 'ms' => [1.5, 2] }, 'client' => { 'ua' => 'a"b' },
              'usage' => { 'tokens' => 10 }, 'error' => "boom\e[0m", 'inherited' => true }
    end
    step('When it is written and read back') { objs = round_trip([meta, obj]) }
    step('Then timings, client and usage are the same objects') do
      m = messages(objs)[0]
      %w[timings client usage status].each { |k| assert_equal obj[k], m[k], k }
    end
    step('And the error reads with ESC as "␛", and inherited is true') do
      assert_equal 'boom␛[0m', messages(objs)[0]['error']
      assert_equal true, messages(objs)[0]['inherited']
    end
    step('And a message that is not inherited has no data-inherited and no inherited') do
      doc = ConvHtml.document([meta, { 'type' => 'message', 'role' => 'user', 'content' => 'y', 'inherited' => false }])
      refute_includes doc, 'data-inherited'
      refute messages(ConvHtml.decode(doc).map(&:first))[0].key?('inherited')
    end
  end

  scenario 'A broken JSON attribute reads as nil' do
    doc = objs = nil
    step('Given a message element whose data-timings is not JSON') do
      doc = with_body(%(<lcty-message data-role="assistant" data-timings="{oops" data-content="x"><article></article></lcty-message>\n))
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(doc).map(&:first) }
    step('Then its timings are nil') do
      m = messages(objs)[0]
      assert m.key?('timings')
      assert_nil m['timings']
    end
  end

  scenario 'A blank slot is a ruler of digits ending in 0' do
    slot = nil
    step('When ConvHtml.blank_slot makes a slot of 512 bytes') { slot = ConvHtml.blank_slot(512) }
    step('Then it is 512 digits and ends with "7890"') do
      assert_match(/\A\d{512}\z/, slot)
      assert slot.end_with?('7890'), slot[-10..-1]
      refute_includes slot, '--'
    end
  end

  scenario 'A title is written over the head of the ruler' do
    slot = nil
    step('When ConvHtml.title_slot writes the title "A & <B>"') { slot = ConvHtml.title_slot('A & <B>') }
    step('Then the slot is 512 bytes starting with "A &amp; &lt;B&gt;</title><!--" and then the rest of the ruler') do
      head = 'A &amp; &lt;B&gt;</title><!--'
      assert_equal 512, slot.bytesize
      assert slot.start_with?(head), slot
      assert_equal ConvHtml.blank_slot(512)[head.bytesize..-1], slot[head.bytesize..-1]
    end
    step('And ConvHtml.slot_title reads "A & <B>" from the title line') do
      assert_equal 'A & <B>', ConvHtml.slot_title(ConvHtml.title_line('A & <B>'))
    end
  end

  scenario 'Newlines and unwritable characters in a title are made visible' do
    line = nil
    step('When ConvHtml.title_slot writes the title " a\r\nb\u0007 "') { line = ConvHtml.title_line(" a\r\nb\u0007 ") }
    step('Then the title read back is "a b␇"') { assert_equal 'a b␇', ConvHtml.slot_title(line) }
  end

  scenario 'A long title is cut at a character boundary to fit the slot' do
    slot = nil
    step('When ConvHtml.title_slot writes a title of 300 "あ"') { slot = ConvHtml.title_slot('あ' * 300) }
    step('Then the slot is still 512 bytes') { assert_equal 512, slot.bytesize }
    step('And the title read back is the first 166 "あ" (498 bytes, the most that fits in 500)') do
      line = %(<title id="__512">) + slot + ConvHtml::SLOT_END
      assert_equal 'あ' * 166, ConvHtml.slot_title(line)
    end
  end

  scenario 'A slot too small even for an empty title is nil' do
    step('Then ConvHtml.title_slot returns nil for a slot of 11 bytes') do
      assert_nil ConvHtml.title_slot('', 11)
      assert_equal '</title><!--', ConvHtml.title_slot('abc', 12)
    end
  end

  {
    'a slot shorter than its id says' => -> { ConvHtml.title_line('x').sub('__512', '__513') },
    'a slot without the "<!---->" after it' => -> { ConvHtml.title_line('x').sub(/<!---->\z/, '') },
    'a slot that does not hold "</title><!--"' => -> { %(<title id="__10">0123456789<!---->) },
    'a hand-written <title>' => -> { '<title>Hand</title>' },
    'nil' => -> {}
  }.each do |label, make|
    scenario "ConvHtml.slot_range finds only a valid title slot (#{label})" do
      step("Then ConvHtml.slot_range returns nil for #{label}") do
        assert_nil ConvHtml.slot_range(make.call)
        assert_nil ConvHtml.slot_title(make.call)
      end
    end
  end

  scenario 'A hand-written title line is read as a loose title' do
    text = objs = nil
    step('Given a file whose line 3 is "<title>Hand &amp; made</title>"') do
      lines = ConvHtml.document([meta('tags' => ['t'])]).lines
      lines[2] = "<title>Hand &amp; made</title>\n"
      text = lines.join
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(text).map(&:first) }
    step('Then the title is "Hand & made" and the meta is read from line 4') do
      assert_equal({ 'type' => 'title', 'title' => 'Hand & made' }, objs[0])
      assert_equal meta('tags' => ['t']), objs[1]
    end
    step('And ConvHtml.head_lines rejects the head') { assert_nil ConvHtml.head_lines(text) }
  end

  scenario 'A file in the head format before 2026-11-07 is still read' do
    text = nil
    step('Given a file with the old three-line head: data-lcty-tlrange, the title slot and an unclosed <lcty-c>') do
      slot = '<title>Old &amp; gold</title><!--0123456789-->'
      line1 = %(<!doctype html><html data-lcty-tlrange="0x%04x,0x%04x"><head></head>\n)
      start = format(line1, 0, 0).bytesize + ConvHtml::LEGACY_MARK.bytesize
      text = format(line1, start, start + slot.bytesize) +
             ConvHtml::LEGACY_MARK + slot + "\n" +
             ConvHtml::LEGACY_MARK + %(<lcty-c id="c-old-1" data-setup-tags="x y" data-created-at="#{AT}">\n) +
             %(<lcty-setup data-instructions="old sys"></lcty-setup>\n) +
             %(<lcty-message id="c-msg-#{ID1}" data-role="user" data-content="hello"><div class="user-text">hello</div></lcty-message>\n)
    end
    step('Then ConvHtml.legacy? is true and ConvHtml.head_lines is nil') do
      assert ConvHtml.legacy?(text)
      assert_nil ConvHtml.head_lines(text)
    end
    step('And ConvHtml.decode reads its title, its meta and the elements after the lines starting with "<!"') do
      objs = ConvHtml.decode(text).map(&:first)
      assert_equal({ 'type' => 'title', 'title' => 'Old & gold' }, objs[0])
      assert_equal({ 'type' => 'meta', 'id' => 'old-1', 'created_at' => AT, 'tags' => %w[x y], 'instructions' => 'old sys' },
                   objs[1])
      assert_equal [{ 'type' => 'message', 'id' => ID1, 'role' => 'user', 'at' => nil, 'content' => 'hello' }], objs[2..-1]
    end
  end

  scenario 'Only the first lcty-setup counts' do
    doc = objs = nil
    step('Given a document whose elements hold a second lcty-setup') do
      doc = ConvHtml.document([meta('instructions' => 'first')]) + %(<lcty-setup data-instructions="second"></lcty-setup>\n)
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(doc).map(&:first) }
    step('Then the meta has the instructions of the first one') do
      assert_equal 'first', ConvHtml.current_meta(objs)['instructions']
    end
    step('And no setup line is returned') { assert_equal %w[meta], objs.map { |o| o['type'] } }
  end

  scenario 'Unknown elements are skipped' do
    doc = objs = nil
    step('Given a document with an unknown element between two messages') do
      doc = ConvHtml.document([meta, { 'type' => 'message', 'role' => 'user', 'content' => 'a' }]) +
            %(<lcty-unknown data-x="1"><p>?</p></lcty-unknown>\n) +
            ConvHtml.encode([{ 'type' => 'message', 'role' => 'user', 'content' => 'b' }])
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(doc).map(&:first) }
    step('Then only the two messages are returned') do
      assert_equal %w[meta message message], objs.map { |o| o['type'] }
      assert_equal %w[a b], messages(objs).map { |o| o['content'] }
    end
  end

  scenario 'A last element broken by an interrupted write is dropped' do
    doc = objs = err = nil
    step('Given a document whose last element was cut off in the middle') do
      doc = ConvHtml.document([meta, { 'type' => 'message', 'role' => 'user', 'content' => 'a' },
                               { 'type' => 'message', 'role' => 'assistant', 'content' => 'b' }])
      doc += %(<lcty-message data-role="user" data-con)
    end
    step('When ConvHtml.decode reads it') { _, err = capture_io { objs = ConvHtml.decode(doc, 'c1.html').map(&:first) } }
    step('Then it warns that the file is not well-formed and drops the last element') do
      assert_match(/conversation file c1\.html is not well-formed .*; dropping the last element/, err)
    end
    step('And the complete elements before it are returned') do
      assert_equal %w[a b], messages(objs).map { |o| o['content'] }
    end
  end

  scenario 'A complete last element is kept when the error is elsewhere' do
    doc = objs = err = nil
    step('Given a document whose elements are all complete, followed by a stray line with a bare "&"') do
      doc = ConvHtml.document([meta, { 'type' => 'message', 'role' => 'user', 'content' => 'a' },
                               { 'type' => 'message', 'role' => 'assistant', 'content' => 'b' }])
      doc += "stray & text\n"
    end
    step('When ConvHtml.decode reads it') { _, err = capture_io { objs = ConvHtml.decode(doc, 'c1.html').map(&:first) } }
    step('Then it warns that the file is not well-formed without dropping anything') do
      assert_match(/conversation file c1\.html is not well-formed/, err)
      refute_match(/dropping/, err)
    end
    step('And every element is returned, the last one included') do
      assert_equal %w[a b], messages(objs).map { |o| o['content'] }
    end
  end

  scenario 'ConvHtml.current_title and ConvHtml.current_meta pick their lines' do
    first = { 'type' => 'meta', 'id' => 'a' }
    second = { 'type' => 'meta', 'id' => 'b' }
    step('Then ConvHtml.current_title returns the last title line, or nil when there is none') do
      lines = [{ 'type' => 'title', 'title' => '1' }, first, { 'type' => 'title', 'title' => '2' }]
      assert_equal '2', ConvHtml.current_title(lines)['title']
      assert_nil ConvHtml.current_title([first])
    end
    step('And ConvHtml.current_meta returns the first meta line, or {} when there is none') do
      assert_same first, ConvHtml.current_meta([first, second])
      assert_equal({}, ConvHtml.current_meta([{ 'type' => 'title', 'title' => 'x' }]))
    end
  end

  # ---- The lcty-msg format (LCTYSP-0013) ----

  # A file in the lcty-msg format: the head as /v1/rpc writes it (no data-setup-tags), then body
  def lcty_msg_file(body = '')
    ConvHtml::HEADER + ConvHtml.title_line('T') + "\n" + %(<lcty-c id="c-conv-n" data-created-at="#{AT}" />\n) + body
  end

  scenario 'A file in the lcty-msg format is read as messages and lines of its own' do
    objs = text = nil
    step('Given a file in the lcty-msg format with a system message, a user message, a thinking, a model message and an lcty-cmd') do
      text = lcty_msg_file(
        %(<lcty-msg data-role="system" id="sys-#{ID1}" data-tag="ruby" data-content="be brief"><article>be brief</article></lcty-msg>\n) +
        %(<lcty-msg data-role="user" id="msg-u-#{ID1}" data-at="#{AT}" data-content="hi"><article>hi</article></lcty-msg>\n) +
        %(<lcty-thinking id="think-#{ID2}" data-at="#{AT}" data-content="hmm"><article>hmm</article></lcty-thinking>\n) +
        %(<lcty-msg data-role="model" id="msg-m-#{ID2}" data-at="#{AT}" data-content="hello"><article><p>hello</p></article></lcty-msg>\n) +
        %(<lcty-cmd id="cmd-#{ID2}" data-op="send" data-at="#{AT}" data-error="stopped"></lcty-cmd>\n)
      )
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(text).map(&:first) }
    step('Then the user and model messages are messages of the roles user and assistant, with the bare ids') do
      assert_equal [{ 'type' => 'message', 'id' => ID1, 'role' => 'user', 'at' => AT, 'content' => 'hi' },
                    { 'type' => 'message', 'id' => ID2, 'role' => 'assistant', 'at' => AT, 'content' => 'hello' }],
                   messages(objs)
    end
    step('And the system message is a system line, the thinking a thinking line and the lcty-cmd a cmd line with its bare id') do
      assert_equal({ 'type' => 'system', 'id' => ID1, 'role' => 'system', 'tag' => 'ruby', 'content' => 'be brief' },
                   objs.find { |o| o['type'] == 'system' })
      assert_equal({ 'type' => 'thinking', 'id' => ID2, 'at' => AT, 'content' => 'hmm' }, objs.find { |o| o['type'] == 'thinking' })
      assert_equal({ 'type' => 'cmd', 'op' => 'send', 'at' => AT, 'id' => ID2, 'error' => 'stopped' },
                   objs.find { |o| o['type'] == 'cmd' })
    end
    step('And the meta has no tags') do
      assert_equal [], ConvHtml.current_meta(objs)['tags']
    end
  end

  scenario 'The instructions of a file in the lcty-msg format are its system messages without a tag' do
    text = objs = nil
    step('Given a file in the lcty-msg format with the system messages "a", "b" of the tag "ruby" and "c", and a memory') do
      sys = lambda do |content, extra = ''|
        %(<lcty-msg data-role="system" id="sys-#{Chatty::Uuid.v7}"#{extra} data-content="#{content}"><article>#{content}</article></lcty-msg>\n)
      end
      text = lcty_msg_file(sys.('a') + sys.('b', ' data-tag="ruby"') + sys.('c') +
                           %(<lcty-msg data-role="memory" id="mem-#{ID1}" data-tag="ruby" data-content="m"><article>m</article></lcty-msg>\n))
    end
    step('When ConvHtml.decode reads it') { objs = ConvHtml.decode(text).map(&:first) }
    step('Then the meta\'s instructions are "a", a blank line and "c"') do
      assert_equal "a\n\nc", ConvHtml.current_meta(objs)['instructions']
    end
  end

  {
    'a document ConvHtml.document wrote' => [-> { ConvHtml.document([meta]) }, false],
    'a file of the head before 2026-11-07' => [-> { %(<!doctype html><html data-lcty-tlrange="0x0000,0x0000"><head></head>\n) }, false],
    'a file of lcty-msg elements' => [lambda {
      lcty_msg_file(%(<lcty-msg data-role="user" id="msg-u-#{ID1}" data-at="#{AT}" data-content="a"><article>a</article></lcty-msg>\n))
    }, true],
    'a file with nothing after the head' => [-> { lcty_msg_file }, true]
  }.each do |label, (make, answer)|
    scenario "ConvHtml.lcty_msg? tells the lcty-msg format from the one before (#{label})" do
      text = nil
      step("Given #{label}") { text = instance_exec(&make) }
      step("Then ConvHtml.lcty_msg? is #{answer}") { assert_equal answer, ConvHtml.lcty_msg?(text) }
    end
  end
end
