# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The tags of each conversation (LCTYSP-0009). Source-of-truth data (the name does not start with _), in
# data/lcty_t.sqlite, the file of the resource t/ as the browser's lcty_t is its database (LCTYSP-0015); the file of the
# layout before, data/tags.sqlite, is renamed to it at startup (TagStore.rename_former), its version kept.
#
#   t_has_many_c  which conversations each tag has, one row per tag and conversation: (tag, cid, at), tag a reference
#                 (the file-name part of a tag file, which need not exist: an undefined one shows as such), at when the
#                 conversation's tags were set. A conversation's rows are in the order its tags were given. A
#                 conversation with no row has no tags, except a file of LCTYSP-0003 not yet converted, which then has
#                 the tags it was created with (data-setup-tags in its file)
#
# Tag definitions and memory are tag files in data/t/ (lib/tag_files.rb). Format 3 dropped the tables tags and memory
# that held them before, without conversion: tags start empty and are defined again (LCTYSP-0009). Format 4 replaced
# conversation_tags (conv_id, the tags as a JSON array, at) with t_has_many_c, converting its rows; a conversation whose
# tags had been set to none has no row, like one whose tags were never set.
# When the format changes, migrate by PRAGMA user_version instead of rebuilding (deleting would lose data).

require 'sqlite3'
require 'json'
require 'time'
require_relative 'config'

module Chatty
  class TagStore
    SCHEMA_VERSION = 4
    FILE = 'lcty_t.sqlite'
    STORE = 't_has_many_c' # the name of the table, and of the browser's store it is copied to (LCTYSP-0014)
    BATCH = 't.batch.updated' # the one notification of every change of t/ made here

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

    # The current tags of conv_id in the order they were given, or nil when it has none (a file of LCTYSP-0003 then has
    # the tags it was created with)
    def conversation_tags(conv_id)
      @mutex.synchronize do
        tags = @db.execute('SELECT tag FROM t_has_many_c WHERE cid = ? ORDER BY rowid', [conv_id]).map(&:first)
        tags.empty? ? nil : tags
      end
    end

    # Replace the tags of conv_id with tags (unique references), in that order, and announce the change as one
    # t.batch.updated (Chatty.commit, LCTYSP-0014) whose records are a delete for each row that went, then a put for each
    # row that came (none when nothing changed)
    def set_conversation_tags(conv_id, tags, at = nil)
      at ||= Time.now.iso8601
      Chatty.commit(BATCH) { write_conversation_tags(conv_id, tags, at) }
    end

    # Remove every row of conv_id (the conversation was deleted), announced as above
    def delete_conversation_tags(conv_id)
      set_conversation_tags(conv_id, [])
    end

    # Every row, [{tag, cid}], each conversation's in the order given: what t.c.list answers
    def list
      @mutex.synchronize do
        @db.execute('SELECT tag, cid FROM t_has_many_c ORDER BY rowid').map { |t, c| { 'tag' => t, 'cid' => c } }
      end
    end

    private

    # The rows of conv_id replaced; returns the records of the change
    def write_conversation_tags(conv_id, tags, at)
      @mutex.synchronize do
        old = nil
        @db.transaction do # (the block's value is not returned)
          old = @db.execute('SELECT tag FROM t_has_many_c WHERE cid = ?', [conv_id]).map(&:first)
          @db.execute('DELETE FROM t_has_many_c WHERE cid = ?', [conv_id])
          tags.each { |t| @db.execute('INSERT INTO t_has_many_c (tag, cid, at) VALUES (?, ?, ?)', [t, conv_id, at]) }
        end
        (old - tags).map { |t| record('delete', t, conv_id) } + (tags - old).map { |t| record('put', t, conv_id) }
      end
    end

    def record(op, tag, cid)
      { 'store' => STORE, 'op' => op, 'row' => { 'tag' => tag, 'cid' => cid } }
    end

    def migrate
      version = @db.get_first_value('PRAGMA user_version').to_i
      return if version == SCHEMA_VERSION
      raise "#{FILE} has format #{version}, newer than this version (#{SCHEMA_VERSION}); it cannot be opened" if version > SCHEMA_VERSION
      @db.transaction do
        @db.execute_batch(<<~SQL)
          CREATE TABLE IF NOT EXISTS t_has_many_c (
            tag TEXT NOT NULL, cid TEXT NOT NULL, at TEXT NOT NULL, UNIQUE (tag, cid));
          CREATE INDEX IF NOT EXISTS t_has_many_c_cid ON t_has_many_c (cid);
        SQL
        # Formats 1 and 2 also had the tables tags and memory; format 3 dropped them
        if version < 3
          @db.execute_batch(<<~SQL)
            DROP INDEX IF EXISTS memory_tag;
            DROP TABLE IF EXISTS memory;
            DROP TABLE IF EXISTS tags;
          SQL
        end
        # Formats 2 and 3 had conversation_tags, a JSON array per conversation; format 4 has a row per tag
        if version >= 2
          @db.execute('SELECT conv_id, tags, at FROM conversation_tags ORDER BY rowid').each do |cid, json, at|
            JSON.parse(json).uniq.each do |t|
              @db.execute('INSERT OR IGNORE INTO t_has_many_c (tag, cid, at) VALUES (?, ?, ?)', [t, cid, at])
            end
          end
          @db.execute('DROP TABLE conversation_tags')
        end
        @db.execute("PRAGMA user_version = #{SCHEMA_VERSION}")
      end
    end
  end
end
