# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# What the conversations of c/ hold besides their files (LCTYSP-0013): source-of-truth data (the name does not start
# with _) in data/lcty_c.sqlite, the file of the resource c/ as the browser's lcty_c is its database (LCTYSP-0015).
#
#   message_stats  what was measured of a reply, which LCTYSP-0013 moved out of the file: the id of its element
#                  (msg-m-…), the conversation, and data-timings, data-usage and data-client as they were (JSON text,
#                  NULL when absent). Written by tools/convert.rb and by c.stats.put of /v1/rpc; a row goes when its
#                  reply is unappended or its conversation deleted.
#
# The version is PRAGMA user_version (LCTYSP-0015): a newer one is refused, an older one migrated step by step.

require 'sqlite3'
require 'json'

module Chatty
  class CStore
    SCHEMA_VERSION = 1
    FILE = 'lcty_c.sqlite'
    STATS = %w[timings usage client].freeze

    def initialize(path)
      @db = SQLite3::Database.new(path)
      @mutex = Mutex.new
      @db.execute('PRAGMA journal_mode = WAL')
      migrate
    end

    # Record what was measured of the reply whose element is id, in conversation cid: stats has the keys of STATS
    # (absent or nil when not measured). Replaces what was recorded for id.
    def put_message_stats(id, cid, stats)
      values = STATS.map { |k| stats[k].nil? ? nil : JSON.generate(stats[k]) }
      @mutex.synchronize do
        @db.execute('INSERT INTO message_stats (id, cid, timings, usage, client) VALUES (?, ?, ?, ?, ?) ' \
                    'ON CONFLICT(id) DO UPDATE SET cid = excluded.cid, timings = excluded.timings, ' \
                    'usage = excluded.usage, client = excluded.client', [id, cid] + values)
      end
    end

    # {cid, timings, usage, client} of the reply whose element is id (nil for what was not measured), or nil when
    # nothing is recorded
    def message_stats(id)
      row = @mutex.synchronize do
        @db.get_first_row('SELECT cid, timings, usage, client FROM message_stats WHERE id = ?', [id])
      end
      return nil unless row
      { 'cid' => row[0] }.merge(STATS.zip(row[1..]).map { |k, v| [k, v && JSON.parse(v)] }.to_h)
    end

    # What was measured of every reply of conversation cid: [{id, timings, usage, client}], ordered by id
    def stats_of(cid)
      rows = @mutex.synchronize do
        @db.execute('SELECT id, timings, usage, client FROM message_stats WHERE cid = ? ORDER BY id', [cid])
      end
      rows.map { |id, *values| { 'id' => id }.merge(STATS.zip(values).map { |k, v| [k, v && JSON.parse(v)] }.to_h) }
    end

    # Forget what was measured of the reply whose element is id (it was removed from its file)
    def delete_message_stats(id)
      @mutex.synchronize { @db.execute('DELETE FROM message_stats WHERE id = ?', [id]) }
    end

    # Forget what was measured of every reply of conversation cid (it was deleted)
    def delete_stats_of(cid)
      @mutex.synchronize { @db.execute('DELETE FROM message_stats WHERE cid = ?', [cid]) }
    end

    def close
      @mutex.synchronize { @db.close }
    end

    private

    def migrate
      version = @db.get_first_value('PRAGMA user_version').to_i
      return if version == SCHEMA_VERSION
      raise "#{FILE} has format #{version}, newer than this version (#{SCHEMA_VERSION}); it cannot be opened" if version > SCHEMA_VERSION
      @db.transaction do
        @db.execute_batch(<<~SQL)
          CREATE TABLE IF NOT EXISTS message_stats (
            id TEXT PRIMARY KEY, cid TEXT NOT NULL, timings TEXT, usage TEXT, client TEXT);
        SQL
        @db.execute("PRAGMA user_version = #{SCHEMA_VERSION}")
      end
    end
  end
end
