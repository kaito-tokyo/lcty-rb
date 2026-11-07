# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3005: the scenarios of docs/specs/LCTYSP-3005_tag-store.feature, written by hand. Each test has the title of its
# Scenario and one step per line of it, so the two read side by side. Every test opens its own store in a temporary
# directory.

require_relative 'helper'
require 'tag_store'

class TagStoreTest < Lcty::Scenarios
  TagStore = Chatty::TagStore

  # Formats 1 and 2 as they were written before format 3 (lib/tag_store.rb before tag files)
  FORMAT1 = <<~SQL
    CREATE TABLE tags (name TEXT PRIMARY KEY, prompt TEXT, position INTEGER NOT NULL);
    CREATE TABLE memory (
      id TEXT PRIMARY KEY,
      tag TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE ON DELETE CASCADE,
      text TEXT NOT NULL, at TEXT NOT NULL, source_conv TEXT, source_msg TEXT);
    CREATE INDEX memory_tag ON memory(tag, at);
    INSERT INTO tags VALUES ('ruby', 'p', 0);
    INSERT INTO memory VALUES ('m1', 'ruby', 'kept', '2026-01-01T00:00:00Z', NULL, NULL);
  SQL

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

  def with_db
    db = SQLite3::Database.new(path)
    yield db
  ensure
    db&.close
  end

  def tables
    with_db { |db| db.execute("SELECT name FROM sqlite_master WHERE type = 'table'").map(&:first).sort }
  end

  def assert_format(version)
    with_db { |db| assert_equal version, db.get_first_value('PRAGMA user_version') }
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

  scenario 'A store is kept when it is opened again' do
    store = nil
    step('Given a tag store with the conversation "c1" tagged "ruby"') do
      new_store.set_conversation_tags('c1', ['ruby'])
    end
    step('When the file is opened again') { store = new_store }
    step('Then the current tags of "c1" are "ruby"') { assert_equal ['ruby'], store.conversation_tags('c1') }
  end

  scenario 'A new store has format 3 and no tables of tag definitions' do
    step('Given a new tag store') { new_store }
    step('Then it has format 3') { assert_format 3 }
    step('And it has the table conversation_tags and no tables tags or memory') do
      assert_equal %w[conversation_tags], tables
    end
  end

  scenario 'A store of format 2 loses its tag definitions and memory and keeps conversation_tags' do
    store = nil
    step('Given a tags file of format 2 with the tag "ruby", its memory item "m1" and the conversation "c1" tagged "ruby"') do
      with_db do |db|
        db.execute_batch(FORMAT1)
        db.execute_batch(<<~SQL)
          CREATE TABLE conversation_tags (conv_id TEXT PRIMARY KEY, tags TEXT NOT NULL, at TEXT NOT NULL);
          INSERT INTO conversation_tags VALUES ('c1', '["ruby"]', '2026-01-01T00:00:00Z');
          PRAGMA user_version = 2;
        SQL
      end
    end
    step('When it is opened') { store = new_store }
    step('Then it has format 3') { assert_format 3 }
    step('And it has the table conversation_tags and no tables tags or memory') do
      assert_equal %w[conversation_tags], tables
    end
    step('And the current tags of "c1" are "ruby"') { assert_equal ['ruby'], store.conversation_tags('c1') }
  end

  scenario 'A store of format 1 loses its tag definitions and memory and gains conversation_tags' do
    store = nil
    step('Given a tags file of format 1 with the tag "ruby" and its memory item "m1"') do
      with_db do |db|
        db.execute_batch(FORMAT1)
        db.execute('PRAGMA user_version = 1')
      end
    end
    step('When it is opened') { store = new_store }
    step('Then it has format 3') { assert_format 3 }
    step('And it has the table conversation_tags and no tables tags or memory') do
      assert_equal %w[conversation_tags], tables
    end
    step('And the tags of a conversation can be set') do
      store.set_conversation_tags('c1', ['ruby'])
      assert_equal ['ruby'], store.conversation_tags('c1')
    end
  end

  scenario 'A store of a newer format is refused' do
    step('Given a tags file of format 4') { with_db { |db| db.execute('PRAGMA user_version = 4') } }
    step('Then opening it fails with "tags.sqlite has format 4, newer than this version (3); it cannot be opened"') do
      e = assert_raises(RuntimeError) { new_store }
      assert_equal 'tags.sqlite has format 4, newer than this version (3); it cannot be opened', e.message
    end
  end
end
