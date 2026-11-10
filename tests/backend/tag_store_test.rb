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
    File.join(@dir, 'lcty_t.sqlite')
  end

  def former
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

  scenario 'The current tags of a conversation are set, replaced and removed' do
    store = nil
    step('Given a new tag store') { store = new_store }
    step('When the tags of "c1" are set to "z", "a" and "undefined-tag"') do
      store.set_conversation_tags('c1', %w[z a undefined-tag])
    end
    step('Then the current tags of "c1" are "z", "a" and "undefined-tag" in that order') do
      assert_equal %w[z a undefined-tag], store.conversation_tags('c1')
    end
    step('When the tags of "c1" are set to "a" and "b"') { store.set_conversation_tags('c1', %w[a b]) }
    step('Then the current tags of "c1" are "a" and "b"') { assert_equal %w[a b], store.conversation_tags('c1') }
    step('When the tags of "c1" are set to no tags') { store.set_conversation_tags('c1', [], '2026-01-01T00:00:00Z') }
    step('Then the current tags of "c1" are nil') { assert_nil store.conversation_tags('c1') }
    step('When the tags of "c1" are set to "a" and then deleted') do
      store.set_conversation_tags('c1', %w[a])
      store.delete_conversation_tags('c1')
    end
    step('Then the current tags of "c1" are nil') { assert_nil store.conversation_tags('c1') }
  end

  scenario 'Each change is announced as one t.batch.updated with the rows that went and came' do
    store = before = nil
    changes = []
    step('Given a new tag store whose changes are recorded through Chatty.commit') do
      store = new_store
      before = Chatty.committer # the RPC tests' own, when they ran first
      Chatty.committer = ->(method, &block) { changes << [method, block.call] }
    end
    step('When the tags of "c1" are set to "a" and "b", then to "b" and "c", then to the same, then deleted') do
      store.set_conversation_tags('c1', %w[a b])
      store.set_conversation_tags('c1', %w[b c])
      store.set_conversation_tags('c1', %w[b c])
      store.delete_conversation_tags('c1')
    ensure
      Chatty.committer = before
    end
    step('Then the changes are announced as t.batch.updated') do
      assert_equal ['t.batch.updated'] * 4, changes.map(&:first)
    end
    step('And their records are put a and b; delete a and put c; none; delete b and delete c') do
      assert(changes.flat_map(&:last).all? { |r| r['store'] == 't_has_many_c' && r['row']['cid'] == 'c1' })
      assert_equal [[%w[put a], %w[put b]], [%w[delete a], %w[put c]], [], [%w[delete b], %w[delete c]]],
                   changes.map { |_, rs| rs.map { |r| [r['op'], r['row']['tag']] } }
    end
  end

  scenario 'The rows of every conversation are listed in the order their tags were given' do
    store = rows = nil
    step('Given a tag store with "c1" tagged "z" and "a", and "c2" tagged "a"') do
      store = new_store
      store.set_conversation_tags('c1', %w[z a])
      store.set_conversation_tags('c2', %w[a])
    end
    step('When its rows are listed') { rows = store.list }
    step('Then they are z of c1, a of c1 and a of c2, each only tag and cid') do
      assert_equal [{ 'tag' => 'z', 'cid' => 'c1' }, { 'tag' => 'a', 'cid' => 'c1' }, { 'tag' => 'a', 'cid' => 'c2' }], rows
    end
  end

  scenario 'A store is kept when it is opened again' do
    store = nil
    step('Given a tag store with the conversation "c1" tagged "ruby"') do
      new_store.set_conversation_tags('c1', ['ruby'])
    end
    step('When the file is opened again') { store = new_store }
    step('Then the current tags of "c1" are "ruby"') { assert_equal ['ruby'], store.conversation_tags('c1') }
  end

  scenario 'A new store has format 4 and only the table t_has_many_c' do
    step('Given a new tag store') { new_store }
    step('Then it has format 4') { assert_format 4 }
    step('And it has the table t_has_many_c and no other') { assert_equal %w[t_has_many_c], tables }
  end

  scenario 'A store of format 3 has its conversation_tags converted into rows' do
    store = nil
    step('Given a tags file of format 3 with "c1" tagged "z" and "a", "c2" tagged with no tags, and "c3" tagged "a" twice') do
      with_db do |db|
        db.execute_batch(<<~SQL)
          CREATE TABLE conversation_tags (conv_id TEXT PRIMARY KEY, tags TEXT NOT NULL, at TEXT NOT NULL);
          INSERT INTO conversation_tags VALUES ('c1', '["z","a"]', '2026-01-01T00:00:00Z');
          INSERT INTO conversation_tags VALUES ('c2', '[]', '2026-01-01T00:00:00Z');
          INSERT INTO conversation_tags VALUES ('c3', '["a","a"]', '2026-01-01T00:00:00Z');
          PRAGMA user_version = 3;
        SQL
      end
    end
    step('When it is opened') { store = new_store }
    step('Then it has format 4') { assert_format 4 }
    step('And it has the table t_has_many_c and no other') { assert_equal %w[t_has_many_c], tables }
    step('And the current tags of "c1" are "z" and "a" in that order') do
      assert_equal %w[z a], store.conversation_tags('c1')
    end
    step('And "c2" has no current tags') { assert_nil store.conversation_tags('c2') }
    step('And the current tags of "c3" are "a"') { assert_equal %w[a], store.conversation_tags('c3') }
  end

  scenario 'A store of format 2 loses its tag definitions and memory and keeps the tags of conversations' do
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
    step('Then it has format 4') { assert_format 4 }
    step('And it has the table t_has_many_c and no other') { assert_equal %w[t_has_many_c], tables }
    step('And the current tags of "c1" are "ruby"') { assert_equal ['ruby'], store.conversation_tags('c1') }
  end

  scenario 'A store of format 1 loses its tag definitions and memory and gains t_has_many_c' do
    store = nil
    step('Given a tags file of format 1 with the tag "ruby" and its memory item "m1"') do
      with_db do |db|
        db.execute_batch(FORMAT1)
        db.execute('PRAGMA user_version = 1')
      end
    end
    step('When it is opened') { store = new_store }
    step('Then it has format 4') { assert_format 4 }
    step('And it has the table t_has_many_c and no other') { assert_equal %w[t_has_many_c], tables }
    step('And the tags of a conversation can be set') do
      store.set_conversation_tags('c1', ['ruby'])
      assert_equal ['ruby'], store.conversation_tags('c1')
    end
  end

  scenario 'A store of a newer format is refused' do
    step('Given a tags file of format 5') { with_db { |db| db.execute('PRAGMA user_version = 5') } }
    step('Then opening it fails with "lcty_t.sqlite has format 5, newer than this version (4); it cannot be opened"') do
      e = assert_raises(RuntimeError) { new_store }
      assert_equal 'lcty_t.sqlite has format 5, newer than this version (4); it cannot be opened', e.message
    end
  end

  # ---- The file of the layout before ----

  scenario 'tags.sqlite is renamed to lcty_t.sqlite at startup, keeping its tags and its format' do
    renamed = nil
    step('Given a tags.sqlite with the conversation "c1" tagged "ruby", still in its WAL, and no lcty_t.sqlite') do
      old = TagStore.new(former)
      old.set_conversation_tags('c1', ['ruby'])
      assert File.exist?("#{former}-wal")
    end
    step('When TagStore.rename_former renames it') { renamed = TagStore.rename_former(former, path) }
    step('Then it returns true, and tags.sqlite, its -wal and its -shm are gone') do
      assert renamed
      assert_equal [false] * 3, [former, "#{former}-wal", "#{former}-shm"].map { |f| File.exist?(f) }
    end
    step('And lcty_t.sqlite has format 4 and the current tags of "c1" are "ruby"') do
      assert_format 4
      assert_equal ['ruby'], new_store.conversation_tags('c1')
    end
  end

  scenario 'tags.sqlite is left as it is when lcty_t.sqlite exists' do
    renamed = nil
    step('Given a tags.sqlite with "c1" tagged "old" and a lcty_t.sqlite with "c1" tagged "new"') do
      TagStore.new(former).set_conversation_tags('c1', ['old'])
      new_store.set_conversation_tags('c1', ['new'])
    end
    step('When TagStore.rename_former is called') { renamed = TagStore.rename_former(former, path) }
    step('Then it returns false, tags.sqlite is still there and the current tags of "c1" are "new"') do
      refute renamed
      assert File.exist?(former)
      assert_equal ['new'], new_store.conversation_tags('c1')
    end
  end
end
