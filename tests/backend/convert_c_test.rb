# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3023: the scenarios of docs/specs/LCTYSP-3023_convert.feature, written by hand. Each test has the title of its
# Scenario and one step per line of it, the Background first, so the two read side by side.
#
# Every test converts files in a directory of its own, with a TagStore and a CStore of its own: the shared data
# directory of the other tests is never converted.

require_relative 'helper'
require 'stringio'
require 'base64'
require 'digest'
require 'tag_store'
require 'c_store'
require 'convert_c'
require 'open3'
require 'rbconfig'

class ConvertCTest < Lcty::Scenarios
  ConvHtml = Chatty::ConvHtml
  ConvertC = Chatty::ConvertC
  ConvStore = Lcty::Rpc::ConvStore
  AT = '2026-11-10T09:00:00+09:00'
  OLD = Time.utc(2026, 11, 1, 12, 0, 0)

  def teardown
    @c_store&.close
    FileUtils.rm_rf(@dir) if @dir
  end

  def background
    step('Given a directory of conversations, a TagStore and a CStore of the test\'s own') do
      @dir = Dir.mktmpdir('lcty-convert-')
      @conv_dir = File.join(@dir, 'c')
      @former_dir = File.join(@dir, 'c-former')
      FileUtils.mkdir_p(@conv_dir)
      @tags = Chatty::TagStore.new(File.join(@dir, 'lcty_t.sqlite'))
      @c_store = Chatty::CStore.new(File.join(@dir, 'lcty_c.sqlite'))
    end
  end

  def path_of(cid)
    File.join(@conv_dir, "#{cid}.html")
  end

  # Write a file of LCTYSP-0003 from line objects, with an old modification time; returns its text
  def old_file(cid, lines, meta = {})
    text = ConvHtml.document([{ 'type' => 'meta', 'id' => cid, 'created_at' => AT, 'tags' => [],
                                'instructions' => '' }.merge(meta)] + lines)
    File.write(path_of(cid), text)
    File.utime(OLD, OLD, path_of(cid))
    text
  end

  def user(content, id = Chatty::Uuid.v7)
    { 'type' => 'message', 'id' => id, 'role' => 'user', 'at' => AT, 'content' => content }
  end

  # A completed reply with the HTML lcty.v1 rendered (content_html), unless extra says otherwise
  def reply(content, extra = {})
    { 'type' => 'message', 'id' => Chatty::Uuid.v7, 'role' => 'assistant', 'at' => AT, 'status' => 'completed',
      'content' => content, 'content_html' => "<p>#{content}</p>" }.merge(extra)
  end

  def run_convert
    out = StringIO.new
    result = ConvertC.run(conv_dir: @conv_dir, former_dir: @former_dir, tags: @tags, c_store: @c_store, out: out)
    [result, out.string]
  end

  def read(cid)
    File.read(path_of(cid), mode: 'r:UTF-8')
  end

  # The elements of a converted file (line 5 on), parsed as XML
  def elements(cid)
    Nokogiri::XML::DocumentFragment.parse(read(cid).lines.drop(ConvHtml::HEAD_LINES).join).element_children.to_a
  end

  # What each line from line 5 on holds between its start tag and its end tag, as written
  def inners(cid)
    read(cid).lines.drop(ConvHtml::HEAD_LINES).map { |l| l.chomp[%r{\A<[^>]*>(.*)</lcty-[a-z]+>\z}, 1] }
  end

  scenario 'Every element is converted into one /v1/rpc could have written' do
    background
    text = result = out = u = r = nil
    step('Given a file with a title, the instructions "be brief", a user message, a reply with a thinking and a presentation, and a send command') do
      u = user('hi <there>')
      r = reply('# Hello', 'thinking' => 'hmm', 'content_html' => '<h1>Hello</h1>')
      text = old_file('conv-a', [{ 'type' => 'title', 'title' => 'Greeting' }, u, r,
                                 { 'type' => 'cmd', 'op' => 'send', 'at' => AT }], 'instructions' => 'be brief')
    end
    step('When ConvertC.run converts it') { result, out = run_convert }
    step('Then it is reported as converted') do
      assert_equal({ converted: ['conv-a.html'], current: [], failed: [] }, result)
      assert_match(/converted conv-a\.html/, out)
    end
    step('And lines 1 to 3 are kept and line 4 is <lcty-c> without data-setup-tags') do
      assert_equal text.lines.take(3), read('conv-a').lines.take(3)
      assert_equal %(<lcty-c id="c-conv-a" data-created-at="#{AT}" />\n), read('conv-a').lines[3]
    end
    els = nil
    step('And the elements are a system message, the user message, a thinking, the model message and an lcty-cmd') do
      els = elements('conv-a')
      assert_equal [%w[lcty-msg system], %w[lcty-msg user], ['lcty-thinking', nil], %w[lcty-msg model], ['lcty-cmd', nil]],
                   els.map { |e| [e.name, e['data-role']] }
      assert_equal ['be brief', 'hi <there>', 'hmm', '# Hello'], els[0, 4].map { |e| e['data-content'] }
      assert_equal 'send', els[4]['data-op']
    end
    step('And the user and model messages have their ids behind msg-u- and msg-m-, and the reply keeps its presentation') do
      assert_equal "msg-u-#{u['id']}", els[1]['id']
      assert_equal "msg-m-#{r['id']}", els[3]['id']
      assert_equal '<article><h1>Hello</h1></article>', inners('conv-a')[3]
      assert_equal '<article>hi &lt;there&gt;</article>', inners('conv-a')[1]
    end
    step('And every element has the SHA-384 of its text as data-content-integrity and is accepted by the check of /v1/rpc') do
      els[0, 4].each do |e|
        assert_equal "sha384-#{Base64.strict_encode64(Digest::SHA384.digest(e['data-content'].b))}", e['data-content-integrity']
      end
      els.zip(inners('conv-a')).each do |e, inner|
        attrs = e.attribute_nodes.map { |a| [a.name, a.value] }.to_h
        assert_equal attrs, ConvStore.check(e.name, attrs, inner)
      end
    end
    step('And the file\'s modification time is kept') { assert_equal OLD, File.mtime(path_of('conv-a')) }
  end

  scenario 'A reply that is not completed is dropped' do
    background
    step('Given a file with a user message and a reply whose data-status is incomplete') do
      old_file('conv-b', [user('q'), reply('part', 'status' => 'incomplete', 'error' => 'stopped')])
    end
    step('When ConvertC.run converts it') { run_convert }
    step('Then the file holds the user message only') do
      assert_equal [%w[user q]], elements('conv-b').map { |e| [e['data-role'], e['data-content']] }
    end
  end

  scenario 'The tags at creation go to lcty_t.sqlite unless the tags were changed' do
    background
    step('Given a file created with the tags "ruby" and "x", and one created with "a" whose tags were changed to "b"') do
      old_file('conv-c', [], 'tags' => %w[ruby x])
      old_file('conv-d', [], 'tags' => %w[a])
      @tags.set_conversation_tags('conv-d', %w[b])
    end
    step('When ConvertC.run converts them') { run_convert }
    step('Then the first has the tags "ruby" and "x" in lcty_t.sqlite and the second still "b"') do
      assert_equal %w[ruby x], @tags.conversation_tags('conv-c')
      assert_equal %w[b], @tags.conversation_tags('conv-d')
    end
  end

  scenario 'The stats of a reply go to lcty_c.sqlite' do
    background
    r = nil
    step('Given a file with a reply that has timings and usage but no client') do
      r = reply('a', 'timings' => { 'total' => 1.5 }, 'usage' => { 'output_tokens' => 3 })
      old_file('conv-e', [user('q'), r])
    end
    step('When ConvertC.run converts it') { run_convert }
    step('Then lcty_c.sqlite has them for the id of the model message, with no client') do
      assert_equal({ 'cid' => 'conv-e', 'timings' => { 'total' => 1.5 }, 'usage' => { 'output_tokens' => 3 }, 'client' => nil },
                   @c_store.message_stats("msg-m-#{r['id']}"))
    end
  end

  scenario 'The file as it was is kept in c-former/' do
    background
    text = nil
    step('Given a file in the format of LCTYSP-0003') { text = old_file('conv-f', [user('q')]) }
    step('When ConvertC.run converts it') { run_convert }
    step('Then c-former/ holds the file as it was, with its modification time') do
      former = File.join(@former_dir, 'conv-f.html')
      assert_equal text, File.read(former, mode: 'r:UTF-8')
      assert_equal OLD, File.mtime(former)
    end
  end

  scenario 'A copy in c-former/ already stops the conversion of the file' do
    background
    text = result = out = nil
    step('Given a file in the format of LCTYSP-0003 and a file of the same name in c-former/') do
      text = old_file('conv-g', [user('q')])
      FileUtils.mkdir_p(@former_dir)
      File.write(File.join(@former_dir, 'conv-g.html'), 'earlier')
    end
    step('When ConvertC.run runs') { result, out = run_convert }
    step('Then the file is reported as failed and neither file has changed') do
      assert_equal ['conv-g.html'], result[:failed]
      assert_match(%r{could not convert conv-g\.html: .*c-former/conv-g\.html exists already}, out)
      assert_equal text, read('conv-g')
      assert_equal 'earlier', File.read(File.join(@former_dir, 'conv-g.html'))
    end
  end

  scenario 'A file in the lcty-msg format is left as it is' do
    background
    text = result = nil
    step('Given a file in the lcty-msg format') do
      text = ConvHtml::HEADER + ConvHtml.title_line('T') + "\n" + %(<lcty-c id="c-conv-h" data-created-at="#{AT}" />\n)
      File.write(path_of('conv-h'), text)
    end
    step('When ConvertC.run runs') { result, = run_convert }
    step('Then it is reported as current and has not changed, and c-former/ has no copy of it') do
      assert_equal ['conv-h.html'], result[:current]
      assert_equal text, read('conv-h')
      refute File.exist?(File.join(@former_dir, 'conv-h.html'))
    end
  end

  scenario 'A file that cannot be converted is left as it was and the others are converted' do
    background
    text = result = nil
    step('Given a file whose user message has the data-at "yesterday", and a file that can be converted') do
      text = old_file('conv-i', [user('q').merge('at' => 'yesterday')])
      old_file('conv-j', [user('q')])
    end
    step('When ConvertC.run runs') { result, = run_convert }
    step('Then the first is reported as failed and has not changed, and the second is converted') do
      assert_equal({ converted: ['conv-j.html'], current: [], failed: ['conv-i.html'] }, result)
      assert_equal text, read('conv-i')
      refute File.exist?(File.join(@former_dir, 'conv-i.html'))
      assert ConvHtml.lcty_msg?(read('conv-j'))
    end
  end

  scenario 'A reply without the HTML of lcty.v1 leaves its file as it was' do
    background
    text = result = out = nil
    step('Given a file whose reply has no HTML written by lcty.v1, and a file that can be converted') do
      text = old_file('conv-k', [user('q'), reply('**bold**', 'content_html' => nil)])
      old_file('conv-l', [user('q'), reply('a')])
    end
    step('When ConvertC.run runs') { result, out = run_convert }
    step('Then the first is reported as failed, saying it would show its Markdown as text, and has not changed') do
      assert_equal({ converted: ['conv-l.html'], current: [], failed: ['conv-k.html'] }, result)
      assert_match(/could not convert conv-k\.html: .*has no HTML written by lcty\.v1; converted, it would show its Markdown as text/, out)
      assert_equal text, read('conv-k')
      refute File.exist?(File.join(@former_dir, 'conv-k.html'))
    end
    step('And the second is converted') { assert ConvHtml.lcty_msg?(read('conv-l')) }
  end

  TOOL = File.expand_path('../../tools/convert.rb', __dir__)

  # tools/convert.rb run in a new process with args, the data directory the test's own: [out, err, status]
  def run_tool(*args)
    env = { 'LCTY_DATA_DIR' => @dir, 'LCTY_BIND_IP' => nil, 'LCTY_BASE_URL' => nil, 'LCTY_ALLOWED_ORIGIN' => nil,
            'LCTY_BASIC_AUTH' => nil }
    Open3.capture3(env, RbConfig.ruby, TOOL, *args)
  end

  scenario 'tools/convert.rb converts the files of the data directory of LCTY_DATA_DIR' do
    background
    text = err = status = nil
    step('Given a file of LCTYSP-0003 with a user message and a reply') do
      text = old_file('conv-t', [user('q'), reply('a')])
      @c_store.close # the tool opens lcty_c.sqlite itself
      @c_store = nil
    end
    step('When tools/convert.rb is run with LCTY_DATA_DIR the directory of the test') { _, err, status = run_tool }
    step('Then it exits with the status 0 and prints "convert: 1 converted, 0 already lcty-msg, 0 failed"') do
      assert_equal 0, status.exitstatus, err
      assert_includes err, 'convert: 1 converted, 0 already lcty-msg, 0 failed'
      assert ConvHtml.lcty_msg?(read('conv-t'))
    end
    step('And c-former/ has the file as it was') do
      assert_equal text, File.read(File.join(@former_dir, 'conv-t.html'), mode: 'r:UTF-8')
    end
  end

  scenario 'tools/convert.rb takes no arguments' do
    background
    err = status = nil
    step('When tools/convert.rb is run with "--all"') { _, err, status = run_tool('--all') }
    step('Then it exits with the status 1 and prints its usage') do
      assert_equal 1, status.exitstatus
      assert err.start_with?('usage: tools/convert.rb'), err
    end
  end

  scenario 'lcty_c.sqlite of a newer format is refused' do
    background
    path = File.join(@dir, 'newer.sqlite')
    step('Given lcty_c.sqlite whose user_version is 2') do
      db = SQLite3::Database.new(path)
      db.execute('PRAGMA user_version = 2')
      db.close
    end
    err = nil
    step('When a CStore opens it') { err = assert_raises(RuntimeError) { Chatty::CStore.new(path) } }
    step('Then it raises that the file has format 2, newer than this version (1)') do
      assert_equal 'lcty_c.sqlite has format 2, newer than this version (1); it cannot be opened', err.message
    end
  end
end
