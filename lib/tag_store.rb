# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Tag definitions, memory and the tags of each conversation (LCTYSP-009). Source-of-truth data (the name does not start
# with _).
#
#   tags               name, prompt, position (the order in which drafts are joined)
#   memory             memory items per tag. Renaming a tag moves them via ON UPDATE CASCADE
#   conversation_tags  the current tags of a conversation whose tags were changed after it was created (a JSON array,
#                      in the order given); a conversation without a row has the tags it was created with
#                      (data-setup-tags in its file). Names need not be defined tags (an undefined one shows as such)
#
# When the format changes, migrate by PRAGMA user_version instead of rebuilding (deleting would lose data).

require 'sqlite3'
require 'json'
require 'securerandom'
require 'time'

module Chatty
  class TagStore
    SCHEMA_VERSION = 2

    def initialize(path)
      @db = SQLite3::Database.new(path)
      @mutex = Mutex.new
      @db.execute('PRAGMA journal_mode = WAL')
      @db.execute('PRAGMA foreign_keys = ON')
      migrate
    end

    def empty?
      @mutex.synchronize { @db.get_first_value('SELECT COUNT(*) FROM tags').to_i.zero? }
    end

    # { "tags" => [{ name, prompt, memory: [{ id, text, at, source }] }] } (in position order)
    def all
      @mutex.synchronize do
        memory = Hash.new { |h, k| h[k] = [] }
        @db.execute('SELECT id, tag, text, at, source_conv, source_msg FROM memory ORDER BY at, rowid') do |id, tag, text, at, sc, sm|
          item = { 'id' => id, 'text' => text, 'at' => at }
          item['source'] = { 'conv_id' => sc, 'msg_id' => sm }.reject { |_, v| v.nil? } if sc || sm
          memory[tag] << item
        end
        tags = @db.execute('SELECT name, prompt FROM tags ORDER BY position').map do |name, prompt|
          { 'name' => name, 'prompt' => prompt, 'memory' => memory[name] }
        end
        { 'tags' => tags }
      end
    end

    # Replace all definitions (saving the tag editor). The caller has already validated.
    # Handles renames: create tags under new names first, move memory to them, then delete the old tags.
    def replace_all(obj)
      @mutex.synchronize do
        @db.transaction do
          names = obj['tags'].map { |t| t['name'] }
          obj['tags'].each_with_index do |t, i|
            @db.execute('INSERT INTO tags (name, prompt, position) VALUES (?, ?, ?) ' \
                        'ON CONFLICT(name) DO UPDATE SET prompt = excluded.prompt, position = excluded.position',
                        [t['name'], t['prompt'], i])
          end
          keep = []
          obj['tags'].each do |t|
            (t['memory'] || []).each do |m|
              src = m['source'].is_a?(Hash) ? m['source'] : {}
              @db.execute('INSERT INTO memory (id, tag, text, at, source_conv, source_msg) VALUES (?, ?, ?, ?, ?, ?) ' \
                          'ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, text = excluded.text',
                          [m['id'], t['name'], m['text'], m['at'] || Time.now.iso8601, src['conv_id'], src['msg_id']])
              keep << m['id']
            end
          end
          # Memory deleted in the editor
          existing = @db.execute('SELECT id FROM memory').map(&:first)
          (existing - keep).each { |id| @db.execute('DELETE FROM memory WHERE id = ?', [id]) }
          # Tags removed from the list (including old names of renamed tags)
          (@db.execute('SELECT name FROM tags').map(&:first) - names).each { |n| @db.execute('DELETE FROM tags WHERE name = ?', [n]) }
        end
      end
    end

    def add_memory(name, text, source = nil)
      item = { 'id' => "mem-#{SecureRandom.hex(6)}", 'text' => text, 'at' => Time.now.iso8601 }
      src = source.is_a?(Hash) ? source : {}
      @mutex.synchronize do
        raise HttpError.new(404, 'no such tag') unless tag_exists?(name)
        @db.execute('INSERT INTO memory (id, tag, text, at, source_conv, source_msg) VALUES (?, ?, ?, ?, ?, ?)',
                    [item['id'], name, text, item['at'], src['conv_id'], src['msg_id']])
      end
      item['source'] = src unless src.empty?
      item
    end

    def edit_memory(name, id, text)
      @mutex.synchronize do
        raise HttpError.new(404, 'no such tag') unless tag_exists?(name)
        @db.execute('UPDATE memory SET text = ? WHERE id = ? AND tag = ?', [text, id, name])
        raise HttpError.new(404, 'no such memory item') if @db.changes.zero?
        row = @db.get_first_row('SELECT id, text, at FROM memory WHERE id = ?', [id])
        { 'id' => row[0], 'text' => row[1], 'at' => row[2] }
      end
    end

    def delete_memory(name, id)
      @mutex.synchronize do
        raise HttpError.new(404, 'no such tag') unless tag_exists?(name)
        @db.execute('DELETE FROM memory WHERE id = ? AND tag = ?', [id, name])
      end
    end

    # ---- Tags of conversations ----

    # The current tags of conv_id, or nil when they were never changed (then they are the tags at creation)
    def conversation_tags(conv_id)
      @mutex.synchronize do
        json = @db.get_first_value('SELECT tags FROM conversation_tags WHERE conv_id = ?', [conv_id])
        json && JSON.parse(json)
      end
    end

    def set_conversation_tags(conv_id, tags, at = nil)
      @mutex.synchronize do
        @db.execute('INSERT INTO conversation_tags (conv_id, tags, at) VALUES (?, ?, ?) ' \
                    'ON CONFLICT(conv_id) DO UPDATE SET tags = excluded.tags, at = excluded.at',
                    [conv_id, JSON.generate(tags), at || Time.now.iso8601])
      end
    end

    def delete_conversation_tags(conv_id)
      @mutex.synchronize { @db.execute('DELETE FROM conversation_tags WHERE conv_id = ?', [conv_id]) }
    end

    private

    def tag_exists?(name)
      !@db.get_first_value('SELECT 1 FROM tags WHERE name = ?', [name]).nil?
    end

    def migrate
      version = @db.get_first_value('PRAGMA user_version').to_i
      return if version == SCHEMA_VERSION
      raise "tags.sqlite has format #{version}, newer than this version (#{SCHEMA_VERSION}); it cannot be opened" if version > SCHEMA_VERSION
      @db.transaction do
        if version < 1
          @db.execute_batch(<<~SQL)
            CREATE TABLE IF NOT EXISTS tags (
              name TEXT PRIMARY KEY, prompt TEXT, position INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS memory (
              id TEXT PRIMARY KEY,
              tag TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE ON DELETE CASCADE,
              text TEXT NOT NULL, at TEXT NOT NULL, source_conv TEXT, source_msg TEXT);
            CREATE INDEX IF NOT EXISTS memory_tag ON memory(tag, at);
          SQL
        end
        if version < 2
          @db.execute_batch(<<~SQL)
            CREATE TABLE IF NOT EXISTS conversation_tags (
              conv_id TEXT PRIMARY KEY, tags TEXT NOT NULL, at TEXT NOT NULL);
          SQL
        end
        @db.execute("PRAGMA user_version = #{SCHEMA_VERSION}")
      end
    end
  end
end
