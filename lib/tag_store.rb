# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The tags of each conversation (LCTYSP-0009). Source-of-truth data (the name does not start with _), in
# data/lcty_t.sqlite, the file of the resource t/ as the browser's lcty_t is its database (LCTYSP-0015); the file of the
# layout before, data/tags.sqlite, is renamed to it at startup (TagStore.rename_former), its version kept.
#
#   conversation_tags  the current tags of a conversation whose tags were changed after it was created (a JSON array of
#                      references, the file-name parts of tags, in the order given); a conversation without a row has
#                      the tags it was created with (data-setup-tags in its file). References need not have a tag file
#                      (an undefined one shows as such)
#
# Tag definitions and memory are tag files in data/t/ (lib/tag_files.rb). Format 3 dropped the tables tags and memory
# that held them before, without conversion: tags start empty and are defined again (LCTYSP-0009).
# When the format changes, migrate by PRAGMA user_version instead of rebuilding (deleting would lose data).

require 'sqlite3'
require 'json'
require 'time'
require_relative 'config'

module Chatty
  class TagStore
    SCHEMA_VERSION = 3
    FILE = 'lcty_t.sqlite'

    # At startup: when former (tags.sqlite) exists and path (lcty_t.sqlite) does not, rename it, after a checkpoint so
    # its WAL holds nothing, and remove its WAL files. Returns whether it was renamed.
    def self.rename_former(former, path)
      return false if File.exist?(path) || !File.exist?(former)
      db = SQLite3::Database.new(former)
      db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
      db.close
      File.rename(former, path)
      ["#{former}-wal", "#{former}-shm"].each { |f| File.delete(f) if File.exist?(f) }
      true
    end

    def initialize(path)
      @db = SQLite3::Database.new(path)
      @mutex = Mutex.new
      @db.execute('PRAGMA journal_mode = WAL')
      migrate
    end

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

    def migrate
      version = @db.get_first_value('PRAGMA user_version').to_i
      return if version == SCHEMA_VERSION
      raise "#{FILE} has format #{version}, newer than this version (#{SCHEMA_VERSION}); it cannot be opened" if version > SCHEMA_VERSION
      @db.transaction do
        # Formats 1 and 2 also had the tables tags and memory; format 3 drops them (below)
        @db.execute_batch(<<~SQL)
          CREATE TABLE IF NOT EXISTS conversation_tags (
            conv_id TEXT PRIMARY KEY, tags TEXT NOT NULL, at TEXT NOT NULL);
        SQL
        if version < 3
          @db.execute_batch(<<~SQL)
            DROP INDEX IF EXISTS memory_tag;
            DROP TABLE IF EXISTS memory;
            DROP TABLE IF EXISTS tags;
          SQL
        end
        @db.execute("PRAGMA user_version = #{SCHEMA_VERSION}")
      end
    end
  end
end
