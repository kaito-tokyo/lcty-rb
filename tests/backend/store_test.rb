# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3003: the scenarios of docs/specs/LCTYSP-3003_store.feature, written by hand. Each test has the title of its
# Scenario (an Examples row is added in parentheses) and one step per line of it, the Background first, so the two read
# side by side.
#
# The data directory (Chatty::TAGS, INDEX and VECTORS) is shared by every test of the process, so each test makes
# conversations and tags with names of its own, and looks only at those.

require_relative 'helper'
require 'securerandom'
require 'store'

class StoreTest < Lcty::Scenarios
  Store = Chatty::Store
  ConvHtml = Chatty::ConvHtml
  HttpError = Chatty::HttpError
  AT = '2026-11-07T10:00:00+09:00'

  def background
    step('Given the data directory is opened with Chatty.open_data') { Lcty.open_data }
  end

  def new_id
    "s3003-#{SecureRandom.hex(6)}"
  end

  def path_of(id)
    File.join(Chatty::CONV_DIR, "#{id}.html")
  end

  def read(id)
    File.binread(path_of(id))
  end

  def user(content, extra = {})
    { 'type' => 'message', 'id' => Chatty::Uuid.v7, 'role' => 'user', 'at' => AT, 'content' => content }.merge(extra)
  end

  def assistant(content, extra = {})
    { 'type' => 'message', 'id' => Chatty::Uuid.v7, 'role' => 'assistant', 'at' => AT, 'status' => 'completed',
      'content' => content }.merge(extra)
  end

  # A conversation file of LCTYSP-0003 with the current head, as the HTTP API once wrote it; returns its id
  def create(lines = [], meta = {})
    id = new_id
    meta = { 'type' => 'meta', 'id' => id, 'created_at' => AT, 'tags' => [], 'instructions' => 'sys' }.merge(meta)
    Store.write_atomic(path_of(id), ConvHtml.document([meta] + lines))
    id
  end

  def assert_http(status, message, &block)
    assert_error(status, message, http_error(&block))
  end

  # The HttpError the block raises (fails when it raises none)
  def http_error
    assert_raises(HttpError) { yield }
  end

  def assert_error(status, message, err)
    assert_equal [status, message], [err.status, err.message]
  end

  def assert_current_head(id)
    text = File.read(path_of(id), mode: 'r:UTF-8')
    assert text.start_with?(ConvHtml::HEADER), text[0, 200]
    assert ConvHtml.head_lines(text), text[0, 200]
  end

  # A file in the head format before 2026-11-07 (LCTYSP-0003)
  def legacy_text(id, title, tags, message)
    slot = "<title>#{title}</title><!--0123456789-->"
    line1 = %(<!doctype html><html data-lcty-tlrange="0x%04x,0x%04x"><head></head>\n)
    start = format(line1, 0, 0).bytesize + ConvHtml::LEGACY_MARK.bytesize
    format(line1, start, start + slot.bytesize) +
      ConvHtml::LEGACY_MARK + slot + "\n" +
      ConvHtml::LEGACY_MARK + %(<lcty-c id="c-#{id}" data-setup-tags="#{tags.join(' ')}" data-created-at="#{AT}">\n) +
      ConvHtml.encode([{ 'type' => 'setup', 'instructions' => 'old sys' }, message])
  end

  # ---- Reading ----

  scenario 'A conversation is read as its meta, title, tags and messages' do
    background
    id = conv = nil
    step('Given a conversation with the tags "ruby", the instructions "Be brief", the title "First" and a user message') do
      id = create([{ 'type' => 'title', 'title' => 'First' }, user('Hello')], 'tags' => ['ruby'], 'instructions' => 'Be brief')
    end
    step('When Store.conversation reads it') { conv = Store.conversation(id) }
    step('Then it returns the meta, the title "First", the tags ["ruby"] and the message') do
      assert_equal({ 'id' => id, 'created_at' => AT, 'tags' => ['ruby'], 'instructions' => 'Be brief' }, conv['meta'])
      assert_equal 'First', conv['title']
      assert_equal ['ruby'], conv['tags']
      assert_equal [{ 'role' => 'user', 'at' => AT, 'content' => 'Hello' }], conv['messages'].map { |m| m.reject { |k, _| k == 'id' } }
    end
  end

  scenario 'The current tags are those of lcty_t.sqlite once they were changed' do
    background
    id = nil
    step('Given a conversation created with the tags "a" and "b"') { id = create([user('x')], 'tags' => %w[a b]) }
    step('When its tags are changed to ["c"] in lcty_t.sqlite') { Chatty::TAGS.set_conversation_tags(id, ['c']) }
    step('Then Store.conversation returns the tags ["c"]') { assert_equal ['c'], Store.conversation(id)['tags'] }
    step('And the file still says data-setup-tags="a b"') { assert_includes read(id), 'data-setup-tags="a b"' }
  end

  scenario 'Store.conversation of an unknown or invalid id is an error' do
    background
    step('Then Store.conversation raises HttpError 404 "not found" for an unknown id') do
      assert_http(404, 'not found') { Store.conversation(new_id) }
    end
    step('And HttpError 400 "invalid id" for an id that is not a string') do
      assert_http(400, 'invalid id') { Store.conversation(123) }
    end
  end

  # ---- Lists ----

  scenario 'The list summarizes every conversation, newest first' do
    background
    older = newer = list = nil
    inherited = user('old', 'inherited' => true)
    own = user('mine')
    step('Given two conversations, the second modified later, one with the title "Listed" and an inherited message') do
      older = create([user('a')])
      newer = create([{ 'type' => 'title', 'title' => 'Listed' }, inherited, assistant('b'), own], 'tags' => ['l'])
      File.utime(Time.now, Time.at(4_000_000_000), path_of(older))
      File.utime(Time.now, Time.at(4_000_000_100), path_of(newer))
    end
    step('When Store.list_conversations lists them') do
      capture_io { list = Store.list_conversations.select { |c| [older, newer].include?(c['id']) } }
    end
    step('Then the newer one comes before the older one') { assert_equal [newer, older], list.map { |c| c['id'] } }
    step('And each has its id, title, created_at, updated_at_hint, the number of messages and its current tags') do
      assert_equal({ 'id' => newer, 'title' => 'Listed', 'created_at' => AT, 'updated_at_hint' => Time.at(4_000_000_100).iso8601,
                     'messages' => 3, 'tags' => ['l'] }, list[0].reject { |k, _| %w[message_ids message_rounds].include?(k) })
      assert_nil list[1]['title']
      assert_equal 1, list[1]['messages']
    end
    step('And message_ids are the ids of its own user messages, not the inherited ones') do
      assert_equal [own['id']], list[0]['message_ids']
    end
  end

  scenario 'message_rounds pair each own message with its round' do
    background
    u1 = user('q1')
    a1 = assistant('r1')
    inherited = user('old', 'inherited' => true)
    a2 = assistant('reply to the inherited one')
    u2 = user('q2')
    a3 = assistant('r2')
    summary = nil
    step('Given a conversation of a round, an inherited question with its reply, and another round') do
      id = create([u1, a1, inherited, a2, u2, a3])
      summary = Store.summarize(path_of(id))
    end
    step('Then its message_rounds pair each own user message with itself and each reply with the question before it') do
      assert_equal [[u1['id'], u1['id']], [a1['id'], u1['id']], [u2['id'], u2['id']], [a3['id'], u2['id']]],
                   summary['message_rounds']
    end
    step('And a reply to an inherited question has no round') do
      refute_includes summary['message_rounds'].map(&:first), a2['id']
    end
  end

  scenario 'A file whose name is not a conversation id is skipped once with a warning' do
    background
    name = "copy of #{SecureRandom.hex(4)}.html"
    path = File.join(Chatty::CONV_DIR, name)
    first = second = paths = nil
    begin
      step('Given a file "copy of x.html" in data/c') { File.write(path, ConvHtml.document([{ 'type' => 'meta', 'id' => 'x' }])) }
      step('When Store.conversation_paths is called twice') do
        _, first = capture_io { paths = Store.conversation_paths }
        _, second = capture_io { Store.conversation_paths }
      end
      step('Then the file is not among the paths') { refute_includes paths, path }
      step('And the warning is given only the first time') do
        assert_includes first, "skip #{name}: the file name is not a valid conversation id"
        refute_includes second, name
      end
    ensure
      FileUtils.rm_f(path)
    end
  end

  # ---- Startup ----

  scenario 'Files with an older head are rewritten at startup' do
    background
    id = new_id
    message = user('legacy hello')
    mtime = Time.at(1_700_000_000)
    step('Given a conversation file in the head format before 2026-11-07, with a title, tags and a message') do
      File.write(path_of(id), legacy_text(id, 'Old &amp; title', %w[p q], message))
      File.utime(Time.now, mtime, path_of(id))
      refute ConvHtml.head_lines(File.read(path_of(id), mode: 'r:UTF-8'))
    end
    step('When Store.migrate_heads runs') { capture_io { Store.migrate_heads } }
    step('Then the file has the head lines of the current format') { assert_current_head(id) }
    step('And Store.conversation returns the same title, meta, tags and message') do
      conv = Store.conversation(id)
      assert_equal 'Old & title', conv['title']
      assert_equal({ 'id' => id, 'created_at' => AT, 'tags' => %w[p q], 'instructions' => 'old sys' }, conv['meta'])
      assert_equal %w[p q], conv['tags']
      assert_equal [message.reject { |k, _| k == 'type' }], conv['messages']
    end
    step('And the modification time of the file is kept') { assert_equal mtime, File.mtime(path_of(id)) }
  end

  scenario 'Files with the current head or without a meta are left as they are' do
    background
    current = nil
    broken = new_id
    before = {}
    begin
      step('Given a conversation file with the current head and a file whose meta cannot be read') do
        current = create([user('x')])
        File.write(path_of(broken), "<p>not a conversation</p>\n")
        [current, broken].each { |i| before[i] = [read(i), File.mtime(path_of(i))] }
      end
      step('When Store.migrate_heads runs') { capture_io { Store.migrate_heads } }
      step('Then neither file has changed') do
        [current, broken].each { |i| assert_equal before[i], [read(i), File.mtime(path_of(i))], i }
      end
    ensure
      FileUtils.rm_f(path_of(broken))
    end
  end

  # A conversation file in the lcty-msg format (LCTYSP-0013) with body after its head, as /v1/rpc writes it for lang;
  # returns its id
  def lcty_msg_file(body, lang: 'ja')
    id = new_id
    script = lang == 'ja' ? '<script src="lcty.v1.lang-ja.js"></script>' : ''
    File.write(path_of(id),
               %(<!DOCTYPE html><html lang="#{lang}" />\n) +
               %(<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />) +
               %(<script src="lcty.v1.js"></script>#{script}<link rel="stylesheet" href="lcty.v1.css" /></head>\n) +
               ConvHtml.title_line('T') + "\n" + %(<lcty-c id="c-#{id}" data-created-at="#{AT}" />\n) + body)
    id
  end

  def lcty_msg_round(u, m)
    %(<lcty-msg data-role="user" id="msg-u-#{u}" data-at="#{AT}" data-content="q"><article>q</article></lcty-msg>\n) +
      %(<lcty-msg data-role="model" id="msg-m-#{m}" data-at="#{AT}" data-content="a"><article>a</article></lcty-msg>\n)
  end

  scenario 'Files in the lcty-msg format are left as they are at startup' do
    background
    id = before = nil
    step('Given a conversation file in the lcty-msg format whose head loads no language file') do
      id = lcty_msg_file(lcty_msg_round(Chatty::Uuid.v7, Chatty::Uuid.v7), lang: 'en')
      before = [read(id), File.mtime(path_of(id))]
    end
    step('When Store.migrate_heads runs') { capture_io { Store.migrate_heads } }
    step('Then the file has not changed') { assert_equal before, [read(id), File.mtime(path_of(id))] }
  end

  scenario 'A file in the lcty-msg format is read too' do
    background
    id = nil
    u = Chatty::Uuid.v7
    step('Given a conversation file in the lcty-msg format with a user message and a model message') do
      id = lcty_msg_file(lcty_msg_round(u, Chatty::Uuid.v7))
    end
    step('Then Store.conversation reads its messages') do
      assert_equal [%w[user q], %w[assistant a]], Store.conversation(id)['messages'].map { |m| [m['role'], m['content']] }
      assert_equal u, Store.conversation(id)['messages'][0]['id']
    end
  end

  scenario 'A whole file is replaced atomically' do
    background
    dir = Dir.mktmpdir('lcty-store-')
    path = File.join(dir, 'sub', 'deeper', 'f.html')
    begin
      step('Given a directory that does not exist yet') { refute File.exist?(File.dirname(path)) }
      step('When Store.write_atomic writes a file in it twice') do
        Store.write_atomic(path, "first\n" * 100)
        Store.write_atomic(path, "second ✓\n")
      end
      step('Then the file holds what was written last') { assert_equal "second ✓\n", File.read(path, mode: 'r:UTF-8') }
      step('And no temporary file is left in the directory') { assert_equal ['f.html'], Dir.children(File.dirname(path)) }
    ensure
      FileUtils.rm_rf(dir)
    end
  end

  scenario 'Store.document turns format errors into HttpError' do
    background
    step('Then Store.document raises HttpError 500 "a conversation needs a meta" for lines without a meta') do
      assert_http(500, 'a conversation needs a meta') { Store.document([{ 'type' => 'title', 'title' => 'x' }]) }
    end
    step('And HttpError 400 for an id holding U+0001') do
      err = assert_raises(HttpError) { Store.document([{ 'type' => 'meta', 'id' => "a\u0001" }]) }
      assert_equal 400, err.status
      assert_match(/\Ameta\.id contains a character that XML cannot represent: U\+0001 at 1\z/, err.message)
    end
  end
end
