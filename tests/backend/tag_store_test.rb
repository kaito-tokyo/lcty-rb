# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3005: the scenarios of docs/specs/LCTYSP-3005_tag-store.feature, written by hand. Each test has the title of its
# Scenario and one step per line of it, so the two read side by side. Every test opens its own store in a temporary
# directory.

require_relative 'helper'
require 'time'
require 'tag_store'

class TagStoreTest < Lcty::Scenarios
  TagStore = Chatty::TagStore

  def setup
    @dir = Dir.mktmpdir('lcty-tag-store-')
  end

  def teardown
    FileUtils.rm_rf(@dir)
  end

  def path
    File.join(@dir, 'tags.sqlite')
  end

  def new_store
    TagStore.new(path)
  end

  def tag(name, memory = [], prompt = nil)
    { 'name' => name, 'prompt' => prompt, 'memory' => memory }
  end

  def find_tag(store, name)
    store.all['tags'].find { |t| t['name'] == name }
  end

  def assert_http_error(status, message)
    e = assert_raises(Chatty::HttpError) { yield }
    assert_equal status, e.status
    assert_equal message, e.message
  end

  # A time of now: between the seconds before and after the call
  def assert_now(at, before, after)
    t = Time.iso8601(at)
    assert_operator t.to_i, :>=, before.to_i
    assert_operator t.to_i, :<=, after.to_i
  end

  scenario 'A new store is empty' do
    store = nil
    step('Given a new tag store') { store = new_store }
    step('Then it is empty') { assert store.empty? }
    step('And all lists no tags') { assert_equal({ 'tags' => [] }, store.all) }
  end

  scenario 'Saved tags are listed in the order given' do
    store = nil
    ruby = tag('ruby', [], 'Use Ruby 2.6')
    notes = tag('notes')
    step('Given a new tag store') { store = new_store }
    step('When the tags "ruby" with the prompt "Use Ruby 2.6" and "notes" without a prompt are saved') do
      store.replace_all('tags' => [ruby, notes])
    end
    step('Then the store is not empty') { refute store.empty? }
    step('And all lists "ruby" and then "notes", with their prompts and no memory') do
      assert_equal({ 'tags' => [{ 'name' => 'ruby', 'prompt' => 'Use Ruby 2.6', 'memory' => [] },
                                { 'name' => 'notes', 'prompt' => nil, 'memory' => [] }] }, store.all)
    end
    step('When they are saved again as "notes" and then "ruby"') { store.replace_all('tags' => [notes, ruby]) }
    step('Then all lists "notes" and then "ruby"') { assert_equal %w[notes ruby], store.all['tags'].map { |t| t['name'] } }
  end

  scenario 'Saving memory keeps its time and source, and gives a time to an item without one' do
    store = before = after = memory = nil
    step('Given a new tag store') { store = new_store }
    step('When the tag "ruby" is saved with an item that has a time and a source, and an item without a time') do
      before = Time.now
      store.replace_all('tags' => [tag('ruby', [
        { 'id' => 'mem-old', 'text' => 'old', 'at' => '2020-01-01T00:00:00Z',
          'source' => { 'conv_id' => 'c1', 'msg_id' => 'm1' } },
        { 'id' => 'mem-new', 'text' => 'new' }
      ])])
      after = Time.now
    end
    step('Then all lists both items of "ruby" in the order of their times') do
      memory = find_tag(store, 'ruby')['memory']
      assert_equal %w[mem-old mem-new], memory.map { |m| m['id'] }
    end
    step('And the first keeps its time and its source') do
      assert_equal({ 'id' => 'mem-old', 'text' => 'old', 'at' => '2020-01-01T00:00:00Z',
                     'source' => { 'conv_id' => 'c1', 'msg_id' => 'm1' } }, memory[0])
    end
    step('And the second has a time of now and no source') do
      assert_now(memory[1]['at'], before, after)
      refute memory[1].key?('source')
    end
  end

  scenario 'Renaming a tag in the editor moves its memory' do
    store = nil
    item = { 'id' => 'm1', 'text' => 'remember this', 'at' => '2026-01-01T00:00:00Z' }
    step('Given a tag store with the tag "ruby" and its memory item "m1"') do
      store = new_store
      store.replace_all('tags' => [tag('ruby', [item])])
    end
    step('When the tags are saved with "ruby" renamed to "rb" and the same item') do
      store.replace_all('tags' => [tag('rb', [item])])
    end
    step('Then all lists only "rb", with the item "m1" and its text') do
      assert_equal({ 'tags' => [{ 'name' => 'rb', 'prompt' => nil, 'memory' => [item] }] }, store.all)
    end
  end

  scenario 'Tags and items left out of the editor are deleted' do
    store = nil
    a1 = { 'id' => 'a1', 'text' => 'one', 'at' => '2026-01-01T00:00:00Z' }
    step('Given a tag store with the tag "a" with the items "a1" and "a2", and the tag "b" with the item "b1"') do
      store = new_store
      store.replace_all('tags' => [tag('a', [a1, { 'id' => 'a2', 'text' => 'two' }]), tag('b', [{ 'id' => 'b1', 'text' => 'b' }])])
    end
    step('When the tags are saved with only "a" and its item "a1"') { store.replace_all('tags' => [tag('a', [a1])]) }
    step('Then all lists only "a" with only "a1"') do
      assert_equal({ 'tags' => [{ 'name' => 'a', 'prompt' => nil, 'memory' => [a1] }] }, store.all)
    end
    step('And the item "b1" can no longer be edited under "b"') do
      assert_http_error(404, 'no such tag') { store.edit_memory('b', 'b1', 'x') }
    end
  end

  scenario 'Saving no tags empties the store' do
    store = nil
    step('Given a tag store with the tag "ruby"') do
      store = new_store
      store.replace_all('tags' => [tag('ruby')])
    end
    step('When no tags are saved') { store.replace_all('tags' => []) }
    step('Then it is empty') do
      assert store.empty?
      assert_equal({ 'tags' => [] }, store.all)
    end
  end

  scenario 'Memory added to a tag is listed with an id, a time and its source' do
    store = item = before = after = nil
    step('Given a tag store with the tag "ruby"') do
      store = new_store
      store.replace_all('tags' => [tag('ruby')])
    end
    step('When the memory "WEBrick paths are ASCII-8BIT" is added to "ruby" from the conversation "c1" and the message "m1"') do
      before = Time.now
      item = store.add_memory('ruby', 'WEBrick paths are ASCII-8BIT', 'conv_id' => 'c1', 'msg_id' => 'm1')
      after = Time.now
    end
    step('Then the new item has an id of "mem-" and 12 hex digits, the text and a time of now') do
      assert_match(/\Amem-[0-9a-f]{12}\z/, item['id'])
      assert_equal 'WEBrick paths are ASCII-8BIT', item['text']
      assert_now(item['at'], before, after)
    end
    step('And its source is the conversation "c1" and the message "m1"') do
      assert_equal({ 'conv_id' => 'c1', 'msg_id' => 'm1' }, item['source'])
    end
    step('And all lists it under "ruby"') { assert_equal [item], find_tag(store, 'ruby')['memory'] }
  end

  scenario 'Memory added without a source has no source' do
    store = item = nil
    step('Given a tag store with the tag "ruby"') do
      store = new_store
      store.replace_all('tags' => [tag('ruby')])
    end
    step('When the memory "no source" is added to "ruby" without a source') { item = store.add_memory('ruby', 'no source') }
    step('Then the new item has no source') { refute item.key?('source') }
    step('And all lists it without a source') { assert_equal [item], find_tag(store, 'ruby')['memory'] }
  end

  scenario 'Memory cannot be added to an undefined tag' do
    store = nil
    step('Given a new tag store') { store = new_store }
    step('Then adding memory to "missing" fails with 404 "no such tag"') do
      assert_http_error(404, 'no such tag') { store.add_memory('missing', 'x') }
    end
    step('And the store stays empty') do
      assert store.empty?
      assert_equal({ 'tags' => [] }, store.all)
    end
  end

  scenario 'A memory item is edited in place' do
    store = item = result = nil
    step('Given a tag store with the tag "ruby" and a memory item added to it') do
      store = new_store
      store.replace_all('tags' => [tag('ruby')])
      item = store.add_memory('ruby', 'original')
    end
    step('When its text is edited to "edited"') { result = store.edit_memory('ruby', item['id'], 'edited') }
    step('Then the result has its id, the text "edited" and its time') do
      assert_equal({ 'id' => item['id'], 'text' => 'edited', 'at' => item['at'] }, result)
    end
    step('And all lists it with the text "edited"') { assert_equal [result], find_tag(store, 'ruby')['memory'] }
  end

  scenario 'Editing memory fails for an undefined tag or an item of another tag' do
    store = item = nil
    step('Given a tag store with the tags "a" and "b" and a memory item added to "a"') do
      store = new_store
      store.replace_all('tags' => [tag('a'), tag('b')])
      item = store.add_memory('a', 'keep me')
    end
    step('Then editing the item under "missing" fails with 404 "no such tag"') do
      assert_http_error(404, 'no such tag') { store.edit_memory('missing', item['id'], 'x') }
    end
    step('And editing the item under "b" fails with 404 "no such memory item"') do
      assert_http_error(404, 'no such memory item') { store.edit_memory('b', item['id'], 'x') }
    end
    step('And editing an unknown id under "a" fails with 404 "no such memory item"') do
      assert_http_error(404, 'no such memory item') { store.edit_memory('a', 'mem-unknown', 'x') }
    end
    step('And the item keeps its text') { assert_equal ['keep me'], find_tag(store, 'a')['memory'].map { |m| m['text'] } }
  end

  scenario 'A memory item is deleted' do
    store = first = second = nil
    step('Given a tag store with the tag "ruby" and two memory items added to it') do
      store = new_store
      store.replace_all('tags' => [tag('ruby')])
      first = store.add_memory('ruby', 'first')
      second = store.add_memory('ruby', 'second')
    end
    step('When the first is deleted') { store.delete_memory('ruby', first['id']) }
    step('Then all lists only the second under "ruby"') { assert_equal [second], find_tag(store, 'ruby')['memory'] }
  end

  scenario 'Deleting memory fails for an undefined tag, an unknown item, and an item of another tag' do
    store = item = nil
    step('Given a tag store with the tags "a" and "b" and a memory item added to "a"') do
      store = new_store
      store.replace_all('tags' => [tag('a'), tag('b')])
      item = store.add_memory('a', 'keep me')
    end
    step('Then deleting the item under "missing" fails with 404 "no such tag"') do
      assert_http_error(404, 'no such tag') { store.delete_memory('missing', item['id']) }
    end
    step('And deleting an unknown id under "a" fails with 404 "no such memory item"') do
      assert_http_error(404, 'no such memory item') { store.delete_memory('a', 'no-such-id') }
    end
    step('And deleting the item under "b" fails with 404 "no such memory item" and leaves it under "a"') do
      assert_http_error(404, 'no such memory item') { store.delete_memory('b', item['id']) }
      assert_equal [item], find_tag(store, 'a')['memory']
    end
  end

  scenario 'A conversation has no current tags until they are set' do
    store = nil
    step('Given a new tag store') { store = new_store }
    step('Then the current tags of "c1" are nil') { assert_nil store.conversation_tags('c1') }
  end

  scenario 'The current tags of a conversation are set, replaced and deleted' do
    store = nil
    step('Given a new tag store') { store = new_store }
    step('When the tags of "c1" are set to "z", "a" and "undefined-tag"') do
      store.set_conversation_tags('c1', %w[z a undefined-tag])
    end
    step('Then the current tags of "c1" are "z", "a" and "undefined-tag" in that order') do
      assert_equal %w[z a undefined-tag], store.conversation_tags('c1')
    end
    step('When the tags of "c1" are set to no tags') { store.set_conversation_tags('c1', [], '2026-01-01T00:00:00Z') }
    step('Then the current tags of "c1" are an empty list') { assert_equal [], store.conversation_tags('c1') }
    step('When the tags of "c1" are deleted') { store.delete_conversation_tags('c1') }
    step('Then the current tags of "c1" are nil') { assert_nil store.conversation_tags('c1') }
  end

  scenario 'Deleting a tag definition keeps it on conversations' do
    store = nil
    step('Given a tag store with the tag "ruby" and the conversation "c1" tagged "ruby"') do
      store = new_store
      store.replace_all('tags' => [tag('ruby')])
      store.set_conversation_tags('c1', ['ruby'])
    end
    step('When no tags are saved') { store.replace_all('tags' => []) }
    step('Then the current tags of "c1" are still "ruby"') { assert_equal ['ruby'], store.conversation_tags('c1') }
  end

  scenario 'A store is kept when it is opened again' do
    store = item = nil
    step('Given a tag store with the tag "ruby", a memory item and the conversation "c1" tagged "ruby"') do
      first = new_store
      first.replace_all('tags' => [tag('ruby', [], 'prompt')])
      item = first.add_memory('ruby', 'remember')
      first.set_conversation_tags('c1', ['ruby'])
    end
    step('When the file is opened again') { store = new_store }
    step('Then all lists "ruby" with its memory item') do
      assert_equal({ 'tags' => [{ 'name' => 'ruby', 'prompt' => 'prompt', 'memory' => [item] }] }, store.all)
    end
    step('And the current tags of "c1" are "ruby"') { assert_equal ['ruby'], store.conversation_tags('c1') }
  end

  scenario 'A store of format 1 is migrated without losing data' do
    store = nil
    step('Given a tags file of format 1 with the tag "ruby" and its memory item "m1"') do
      db = SQLite3::Database.new(path)
      db.execute_batch(<<~SQL)
        CREATE TABLE tags (name TEXT PRIMARY KEY, prompt TEXT, position INTEGER NOT NULL);
        CREATE TABLE memory (
          id TEXT PRIMARY KEY,
          tag TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE ON DELETE CASCADE,
          text TEXT NOT NULL, at TEXT NOT NULL, source_conv TEXT, source_msg TEXT);
        INSERT INTO tags VALUES ('ruby', 'p', 0);
        INSERT INTO memory VALUES ('m1', 'ruby', 'kept', '2026-01-01T00:00:00Z', NULL, NULL);
        PRAGMA user_version = 1;
      SQL
      db.close
    end
    step('When it is opened') { store = new_store }
    step('Then it has format 2') do
      db = SQLite3::Database.new(path)
      begin
        assert_equal 2, db.get_first_value('PRAGMA user_version')
      ensure
        db.close
      end
    end
    step('And all lists "ruby" with the item "m1"') do
      assert_equal({ 'tags' => [{ 'name' => 'ruby', 'prompt' => 'p',
                                  'memory' => [{ 'id' => 'm1', 'text' => 'kept', 'at' => '2026-01-01T00:00:00Z' }] }] },
                   store.all)
    end
    step('And the tags of a conversation can be set') do
      store.set_conversation_tags('c1', ['ruby'])
      assert_equal ['ruby'], store.conversation_tags('c1')
    end
  end

  scenario 'A store of a newer format is refused' do
    step('Given a tags file of format 3') do
      db = SQLite3::Database.new(path)
      db.execute('PRAGMA user_version = 3')
      db.close
    end
    step('Then opening it fails with "tags.sqlite has format 3, newer than this version (2); it cannot be opened"') do
      e = assert_raises(RuntimeError) { new_store }
      assert_equal 'tags.sqlite has format 3, newer than this version (2); it cannot be opened', e.message
    end
  end
end
