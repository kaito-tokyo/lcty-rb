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
  UUID_RE = /\A\h{8}-\h{4}-7\h{3}-[89ab]\h{3}-\h{12}\z/.freeze

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

  # Create a conversation and return its id
  def create(lines = [], meta = {})
    Store.create('meta' => { 'id' => new_id, 'created_at' => AT, 'tags' => [], 'instructions' => 'sys' }.merge(meta),
                 'lines' => lines)
  end

  def contents(id)
    Store.conversation(id)['messages'].map { |m| m['content'] }
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

  # ---- Creating ----

  scenario 'Creating a conversation writes its file with the current head' do
    background
    id = result = conv = nil
    step('When Store.create is given a new id, the tags "ruby", the instructions "Be brief", the title "First" and a user message without an id') do
      id = new_id
      result = Store.create('meta' => { 'id' => id, 'created_at' => AT, 'tags' => ['ruby'], 'instructions' => 'Be brief' },
                            'lines' => [{ 'type' => 'title', 'title' => 'First' },
                                        { 'type' => 'message', 'role' => 'user', 'at' => AT, 'content' => 'Hello' }])
    end
    step('Then it returns the id and data/c/<id>.html starts with the head lines of the current format') do
      assert_equal id, result
      assert_current_head(id)
    end
    step('And Store.conversation returns the meta, the title "First", the tags ["ruby"] and the message') do
      conv = Store.conversation(id)
      assert_equal({ 'id' => id, 'created_at' => AT, 'tags' => ['ruby'], 'instructions' => 'Be brief' }, conv['meta'])
      assert_equal 'First', conv['title']
      assert_equal ['ruby'], conv['tags']
      assert_equal [{ 'role' => 'user', 'at' => AT, 'content' => 'Hello' }], conv['messages'].map { |m| m.reject { |k, _| k == 'id' } }
    end
    step('And the message was given a UUIDv7 id') do
      assert Chatty::Uuid.valid?(conv['messages'][0]['id']), conv['messages'][0]['id']
    end
  end

  scenario 'Only the id, the creation time, the tags and the instructions of the meta are kept' do
    background
    id = nil
    step('When Store.create is given a meta that also has "forked_from" and "backend"') do
      id = create([], 'forked_from' => 'other', 'backend' => 'x')
    end
    step('Then the meta of the conversation has only id, created_at, tags and instructions') do
      assert_equal %w[created_at id instructions tags], Store.conversation(id)['meta'].keys.sort
      refute_includes read(id), 'other'
    end
  end

  scenario 'A new conversation may end with a send command' do
    background
    id = nil
    step('When Store.create is given a user message and a send command') do
      id = create([user('go'), { 'type' => 'cmd', 'op' => 'send', 'at' => AT }])
    end
    step('Then the last line of the file is <lcty-cmd data-op="send" …></lcty-cmd>') do
      assert_equal %(<lcty-cmd data-op="send" data-at="#{AT}"></lcty-cmd>), read(id).lines.last.chomp
    end
    step('And Store.conversation returns only the message') { assert_equal ['go'], contents(id) }
  end

  scenario 'Creating a conversation leaves the given objects as they were' do
    background
    meta = message = nil
    step('Given a meta without tags and a user message without an id') do
      meta = { 'id' => new_id, 'created_at' => AT }
      message = user('hi')
      message.delete('id')
    end
    step('When Store.create is given them') { Store.create('meta' => meta, 'lines' => [message]) }
    step('Then the meta still has no tags') { refute meta.key?('tags'), meta.inspect }
    step('And the message still has no id') { refute message.key?('id'), message.inspect }
  end

  scenario 'A conversation cannot be created twice' do
    background
    id = before = err = nil
    step('Given a conversation that exists') do
      id = create([user('a')])
      before = read(id)
    end
    step('When Store.create is given its id again') do
      err = http_error { Store.create('meta' => { 'id' => id }, 'lines' => [user('b')]) }
    end
    step('Then it raises HttpError 409 "already exists"') do
      assert_error(409, 'already exists', err)
      assert_equal before, read(id)
    end
  end

  {
    'a body that is not an object' => ['body must be an object', ->(_id) { [] }],
    'a meta that is not an object' => ['meta must be an object', ->(_id) { { 'meta' => 'x' } }],
    'the id "a b"' => ['invalid id', ->(_id) { { 'meta' => { 'id' => 'a b' } } }],
    'the tags ["x", "x"]' => ['tags must be an array of unique tag references',
                              ->(id) { { 'meta' => { 'id' => id, 'tags' => %w[x x] } } }],
    'the tag "a:b"' => ['tags must be an array of unique tag references', ->(id) { { 'meta' => { 'id' => id, 'tags' => ['a:b'] } } }],
    'lines that are not an array' => ['lines must be an array of objects', ->(id) { { 'meta' => { 'id' => id }, 'lines' => {} } }],
    'a tags line' => ['line type not allowed: "tags"',
                      ->(id) { { 'meta' => { 'id' => id }, 'lines' => [{ 'type' => 'tags', 'tags' => [] }] } }],
    'a message id that is not a UUIDv7' => ['message id must be a UUIDv7: "1234"',
                                            ->(id) { { 'meta' => { 'id' => id }, 'lines' => [{ 'type' => 'message', 'id' => '1234' }] } }],
    'the command "Send"' => ['invalid command: "Send"',
                             ->(id) { { 'meta' => { 'id' => id }, 'lines' => [{ 'type' => 'cmd', 'op' => 'Send' }] } }],
    'a content_html that is not a string' => ['content_html must be a string',
                                              ->(id) { { 'meta' => { 'id' => id }, 'lines' => [{ 'type' => 'message', 'content_html' => 1 }] } }],
    'a role holding U+0001 in the 2nd line' => [
      'lines[1].role contains a character that XML cannot represent: U+0001 at 4',
      ->(id) { { 'meta' => { 'id' => id }, 'lines' => [{ 'type' => 'title', 'title' => 't' }, { 'type' => 'message', 'role' => "user\u0001" }] } }
    ],
    'a tag of the meta holding U+0001' => ['tags must be an array of unique tag references',
                                           ->(id) { { 'meta' => { 'id' => id, 'tags' => ["a\u0001"] } } }],
    'a tag of the meta holding U+3000' => ['tags must be an array of unique tag references',
                                           ->(id) { { 'meta' => { 'id' => id, 'tags' => ["a　b"] } } }]
  }.each do |request, (message, body)|
    scenario "Store.create rejects a bad request with 400 and writes nothing (#{request})" do
      background
      id = new_id
      err = nil
      step("When Store.create is given #{request}") { err = http_error { Store.create(body.call(id)) } }
      step("Then it raises HttpError 400 #{message.include?('"') ? "'#{message}'" : "\"#{message}\""}") do
        assert_error(400, message, err)
      end
      step('And no file is written') { refute File.exist?(path_of(id)) }
    end
  end

  # ---- Appending ----

  scenario 'Appending adds the lines at the end of the file' do
    background
    id = before = added = nil
    step('Given a conversation with one user message') do
      id = create([user('one')])
      before = read(id)
    end
    step('When Store.append is given an assistant message and a user message without an id') do
      added = { 'type' => 'message', 'role' => 'user', 'at' => AT, 'content' => 'three' }
      Store.append(id, [assistant('two'), added])
    end
    step('Then the file starts with exactly what it held before') do
      assert read(id).start_with?(before)
      assert_equal 2, read(id).lines.size - before.lines.size
    end
    step('And Store.conversation returns the three messages in order') { assert_equal %w[one two three], contents(id) }
    step('And the appended user message was given a UUIDv7 id') do
      assert_match UUID_RE, Store.conversation(id)['messages'][2]['id']
    end
  end

  scenario 'A text with a character XML cannot represent is appended as base64' do
    background
    id = nil
    text = "nul\u0000 esc\e end"
    step('Given a conversation') { id = create }
    step('When Store.append is given a user message whose content holds U+0000 and ESC') { Store.append(id, [user(text)]) }
    step('Then the file holds data-content-base64 for it') do
      assert_includes read(id), %(data-content-base64="#{[text.b].pack('m0')}")
    end
    step('And Store.conversation returns the content byte for byte') { assert_equal [text], contents(id) }
  end

  scenario 'Appending to a file that does not end with a newline starts a new line' do
    background
    id = nil
    step('Given a conversation whose file lost its last newline') do
      id = create([user('one')])
      File.binwrite(path_of(id), read(id).chomp)
    end
    step('When Store.append is given a user message') { Store.append(id, [user('two')]) }
    step('Then the message starts on a line of its own') do
      assert read(id).lines.last.start_with?('<lcty-message '), read(id).lines.last
    end
    step('And Store.conversation returns every message') { assert_equal %w[one two], contents(id) }
  end

  scenario 'Appending a title line overwrites the title slot' do
    background
    id = size = nil
    step('Given a conversation titled "Old"') do
      id = create([{ 'type' => 'title', 'title' => 'Old' }, user('x')])
      size = File.size(path_of(id))
    end
    step('When Store.append is given the title line "New"') { Store.append(id, [{ 'type' => 'title', 'title' => 'New' }]) }
    step('Then Store.conversation returns the title "New"') { assert_equal 'New', Store.conversation(id)['title'] }
    step('And the size of the file has not changed') { assert_equal size, File.size(path_of(id)) }
  end

  scenario 'Appending a tags line changes the current tags without touching the file' do
    background
    id = before = nil
    step('Given a conversation created with the tags "a" and "b"') do
      id = create([user('x')], 'tags' => %w[a b])
      before = read(id)
    end
    step('When Store.append is given the tags line ["c"]') do
      Store.append(id, [{ 'type' => 'tags', 'tags' => ['c'], 'at' => AT }])
    end
    step('Then Store.conversation returns the tags ["c"]') { assert_equal ['c'], Store.conversation(id)['tags'] }
    step('And the file is unchanged and still says data-setup-tags="a b"') do
      assert_equal before, read(id)
      assert_includes read(id), 'data-setup-tags="a b"'
    end
  end

  scenario 'Appending no lines does nothing' do
    background
    id = before = nil
    step('Given a conversation') do
      id = create([user('x')])
      before = read(id)
    end
    step('When Store.append is given no lines') { assert_nil Store.append(id, []) }
    step('Then the file is unchanged') { assert_equal before, read(id) }
  end

  {
    'a message for an unknown conversation' => [404, 'not found', ->(t) { Store.append(t.new_id, [t.user('x')]) }],
    'a tags line for an unknown conversation' => [404, 'not found',
                                                  ->(t) { Store.append(t.new_id, [{ 'type' => 'tags', 'tags' => ['a'] }]) }],
    'a message for the id "../x"' => [400, 'invalid id', ->(t) { Store.append('../x', [t.user('x')]) }],
    'no lines for an unknown conversation' => [404, 'not found', ->(t) { Store.append(t.new_id, []) }],
    'no lines for the id "../x"' => [400, 'invalid id', ->(_t) { Store.append('../x', []) }],
    'a command line' => [400, 'line type not allowed: "cmd"', ->(t) { Store.append(t.id, [{ 'type' => 'cmd', 'op' => 'send' }]) }],
    'a meta line' => [400, 'line type not allowed: "meta"', ->(t) { Store.append(t.id, [{ 'type' => 'meta', 'id' => 'x' }]) }],
    'a tags line whose tags are not a list' => [400, 'tags must be an array of unique tag references',
                                                ->(t) { Store.append(t.id, [{ 'type' => 'tags', 'tags' => 'a' }]) }],
    'a good line and a line with U+0001 in its at' => [
      400, 'lines[1].at contains a character that XML cannot represent: U+0001 at 0',
      ->(t) { Store.append(t.id, [t.user('fine'), t.user('bad', 'at' => "\u0001")]) }
    ]
  }.each do |request, (status, message, call)|
    scenario "Store.append rejects a bad request (#{request})" do
      background
      before = nil
      step('Given a conversation') do
        @id = create([user('x')])
        before = read(@id)
      end
      err = nil
      step("When Store.append is given #{request}") { err = http_error { call.call(self) } }
      step("Then it raises HttpError #{status} #{message.include?('"') ? "'#{message}'" : "\"#{message}\""}") do
        assert_error(status, message, err)
      end
      step('And the file is unchanged') do
        assert_equal before, read(@id)
        assert_nil Chatty::TAGS.conversation_tags(@id)
      end
    end
  end

  attr_reader :id

  # ---- The title ----

  scenario 'Setting the title overwrites the slot in place' do
    background
    id = before = nil
    step('Given a conversation with messages') do
      id = create([{ 'type' => 'title', 'title' => 'Before' }, user('x'), assistant('y')])
      before = read(id)
    end
    step('When Store.set_title sets the title "A & <B>"') { Store.set_title(id, 'type' => 'title', 'title' => 'A & <B>') }
    step('Then only the bytes of the title slot on line 3 have changed') do
      after = read(id)
      assert_equal before.bytesize, after.bytesize
      start = before.lines[0, 2].join.bytesize + '<title id="__512">'.bytesize
      assert_equal before.byteslice(0, start), after.byteslice(0, start)
      assert_equal before.byteslice(start + 512..-1), after.byteslice(start + 512..-1)
      assert_equal ConvHtml.title_slot('A & <B>'), after.byteslice(start, 512)
    end
    step('And Store.conversation returns the title "A & <B>"') { assert_equal 'A & <B>', Store.conversation(id)['title'] }
  end

  scenario 'A title too long for the slot is cut to fit' do
    background
    id = size = nil
    step('Given a conversation') do
      id = create([user('x')])
      size = File.size(path_of(id))
    end
    step('When Store.set_title sets a title of 300 "あ"') { Store.set_title(id, 'type' => 'title', 'title' => 'あ' * 300) }
    step('Then Store.conversation returns the first 166 "あ"') { assert_equal 'あ' * 166, Store.conversation(id)['title'] }
    step('And the size of the file has not changed') { assert_equal size, File.size(path_of(id)) }
  end

  scenario 'Setting the title of a file without a valid slot rewrites the file' do
    background
    id = nil
    step('Given a conversation whose line 3 was replaced by a hand-written <title>') do
      id = create([user('x')], 'tags' => ['t'])
      lines = File.read(path_of(id), mode: 'r:UTF-8').lines
      lines[2] = "<title>Hand</title>\n"
      File.write(path_of(id), lines.join)
      assert_equal 'Hand', Store.conversation(id)['title']
    end
    step('When Store.set_title sets the title "Fixed"') { Store.set_title(id, 'type' => 'title', 'title' => 'Fixed') }
    step('Then the file has the head lines of the current format again') { assert_current_head(id) }
    step('And Store.conversation returns the title "Fixed" with its meta and messages') do
      conv = Store.conversation(id)
      assert_equal 'Fixed', conv['title']
      assert_equal ['t'], conv['meta']['tags']
      assert_equal 'sys', conv['meta']['instructions']
      assert_equal ['x'], contents(id)
    end
  end

  scenario 'Setting the title of an unknown conversation is 404' do
    background
    step('Then Store.set_title raises HttpError 404 "not found" for an unknown id') do
      assert_http(404, 'not found') { Store.set_title(new_id, 'type' => 'title', 'title' => 'x') }
    end
  end

  # ---- Pop ----

  scenario 'Pop removes the last turn' do
    background
    id = nil
    step('Given a conversation with the messages user, assistant, user, assistant') do
      id = create([{ 'type' => 'title', 'title' => 'Kept' }, user('u1'), assistant('a1'), user('u2'), assistant('a2')])
    end
    step('When Store.pop is given from 2, the index of the last user message') { Store.pop(id, 2) }
    step('Then Store.conversation returns the first two messages') { assert_equal %w[u1 a1], contents(id) }
    step('And the title is kept') do
      assert_equal 'Kept', Store.conversation(id)['title']
      assert_current_head(id)
    end
  end

  scenario 'Pop may remove only the reply' do
    background
    id = nil
    step('Given a conversation with the messages user, assistant') { id = create([user('u1'), assistant('a1')]) }
    step('When Store.pop is given from 1') { Store.pop(id, 1) }
    step('Then Store.conversation returns only the user message') { assert_equal %w[u1], contents(id) }
  end

  scenario 'Pop from the end or beyond does nothing' do
    background
    id = before = nil
    step('Given a conversation with the messages user, assistant') do
      id = create([user('u1'), assistant('a1')])
      before = read(id)
    end
    step('When Store.pop is given from 2') do
      assert_nil Store.pop(id, 2)
      assert_nil Store.pop(id, 99)
    end
    step('Then the file is unchanged') { assert_equal before, read(id) }
  end

  scenario 'Pop may not go back more than one turn' do
    background
    id = before = nil
    message = 'can only pop the last turn (from must be >= index of the last user message)'
    step('Given a conversation with the messages user, assistant, user, assistant') do
      id = create([user('u1'), assistant('a1'), user('u2'), assistant('a2')])
      before = read(id)
    end
    err = nil
    step('When Store.pop is given from 1') { err = http_error { Store.pop(id, 1) } }
    step('Then it raises HttpError 409 "can only pop the last turn (from must be >= index of the last user message)"') do
      assert_error(409, message, err)
    end
    step('And the file is unchanged') { assert_equal before, read(id) }
    step('And a conversation without user messages raises the same 409 for from 0') do
      other = create([assistant('a')])
      assert_http(409, message) { Store.pop(other, 0) }
    end
  end

  {
    'from "1"' => [400, 'from must be an integer', ->(id) { Store.pop(id, '1') }],
    'from -1' => [400, 'from must be an integer', ->(id) { Store.pop(id, -1) }],
    'an unknown conversation' => [404, 'not found', ->(_id) { Store.pop("s3003-#{SecureRandom.hex(6)}", 0) }]
  }.each do |request, (status, message, call)|
    scenario "Store.pop rejects a bad from or id (#{request})" do
      background
      id = nil
      step('Given a conversation with the messages user, assistant') { id = create([user('u1'), assistant('a1')]) }
      step("Then Store.pop raises HttpError #{status} \"#{message}\" for #{request}") do
        assert_http(status, message) { call.call(id) }
        assert_equal %w[u1 a1], contents(id)
      end
    end
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
                     'messages' => 3, 'tags' => ['l'] }, list[0].reject { |k, _| k == 'message_ids' })
      assert_nil list[1]['title']
      assert_equal 1, list[1]['messages']
    end
    step('And message_ids are the ids of its own user messages, not the inherited ones') do
      assert_equal [own['id']], list[0]['message_ids']
    end
  end

  scenario 'The meta of every conversation comes from the head lines' do
    background
    id = entry = nil
    find = lambda do
      found = nil
      capture_io { found = Store.meta_all.find { |c| c['id'] == id } }
      found
    end
    step('Given a conversation with the title "Meta", the tags "x" and "y" and two messages') do
      id = create([{ 'type' => 'title', 'title' => 'Meta' }, user('q'), assistant('a')], 'tags' => %w[x y])
    end
    step('When Store.meta_all lists the meta') { entry = find.call }
    step('Then its entry has the id, the title "Meta", created_at, updated_at_hint and setup_tags ["x", "y"]') do
      assert_equal id, entry['id']
      assert_equal 'Meta', entry['title']
      assert_equal AT, entry['created_at']
      assert_equal File.mtime(path_of(id)).iso8601, entry['updated_at_hint']
      assert_equal %w[x y], entry['setup_tags']
    end
    step('And tags_hint is [] and messages_hint is nil until the search index records the conversation') do
      assert_equal [], entry['tags_hint']
      assert_nil entry['messages_hint']
    end
    step('And after the index records it, tags_hint and messages_hint follow the index') do
      Store.append(id, [{ 'type' => 'tags', 'tags' => %w[z] }])
      Chatty::INDEX.sync(id, *Store.index_state(path_of(id)))
      entry = find.call
      assert_equal %w[z], entry['tags_hint']
      assert_equal 2, entry['messages_hint']
    end
  end

  scenario 'A file without the head lines is left out of the meta with a warning' do
    background
    id = new_id
    list = err = nil
    begin
      step('Given a conversation file that holds no head lines') do
        File.write(path_of(id), %(<lcty-message data-role="user" data-content="x"></lcty-message>\n))
      end
      step('When Store.meta_all lists the meta') { _, err = capture_io { list = Store.meta_all } }
      step('Then it warns "no head lines" for that file and leaves it out') do
        assert_includes err, "skip #{id}.html: no head lines"
        refute_includes list.map { |c| c['id'] }, id
      end
    ensure
      FileUtils.rm_f(path_of(id))
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

  scenario 'A file in the lcty-msg format is written only through /v1/rpc' do
    background
    id = before = errors = nil
    u = Chatty::Uuid.v7
    step('Given a conversation file in the lcty-msg format with a user message and a model message') do
      id = lcty_msg_file(lcty_msg_round(u, Chatty::Uuid.v7))
      before = read(id)
    end
    step('When a message is appended to it and the last turn is popped') do
      errors = [http_error { Store.append(id, [user('more')]) }, http_error { Store.pop(id, 0) }]
    end
    step('Then both are refused with 409 and the file has not changed') do
      message = 'the conversation is in the lcty-msg format (LCTYSP-0013); it is written only through /v1/rpc'
      errors.each { |e| assert_error(409, message, e) }
      assert_equal before, read(id)
    end
    step('And Store.conversation reads its messages') do
      assert_equal [%w[user q], %w[assistant a]], Store.conversation(id)['messages'].map { |m| [m['role'], m['content']] }
      assert_equal u, Store.conversation(id)['messages'][0]['id']
    end
    step('And appending a title overwrites the slot in place and leaves the elements as they are') do
      Store.append(id, [{ 'type' => 'title', 'title' => 'New' }])
      assert_equal 'New', Store.conversation(id)['title']
      assert_equal before.lines.drop(ConvHtml::HEAD_LINES), read(id).lines.drop(ConvHtml::HEAD_LINES)
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

  scenario 'Store.document and Store.encode_lines turn format errors into HttpError' do
    background
    step('Then Store.document raises HttpError 500 "a conversation needs a meta" for lines without a meta') do
      assert_http(500, 'a conversation needs a meta') { Store.document([{ 'type' => 'title', 'title' => 'x' }]) }
    end
    step('And HttpError 400 for an id holding U+0001') do
      err = assert_raises(HttpError) { Store.document([{ 'type' => 'meta', 'id' => "a\u0001" }]) }
      assert_equal 400, err.status
      assert_match(/\Ameta\.id contains a character that XML cannot represent: U\+0001 at 1\z/, err.message)
    end
    step('And Store.encode_lines raises HttpError 500 for an unknown line type') do
      assert_http(500, 'unknown line type: "nope"') { Store.encode_lines([{ 'type' => 'nope' }]) }
    end
  end
end
