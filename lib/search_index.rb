# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The search index (LCTYSP-0007). Derived data in data/_index.sqlite (starts with _ = can be rebuilt from the conversation files. LCTYSP-0010).
#
#   chunks      One round (user message + reply). Long ones are split into parts. msg_id is the user message id (UUIDv7)
#               rev marks the version of the whole round's text; it changes when the text changes
#   chunks_fts  Keyword search (FTS5 trigram; rowid equals chunks.rowid)
#   conv_tags   Current tags of each conversation (for tag: filtering)
#   conv_stats  The number of messages of each conversation (all of them, inherited ones included; for lists)
#
# Vectors live in the vector DB (lib/v1/vector_db.rb), which ATTACHes to this connection and joins on chunks.

require 'sqlite3'
require 'digest'

module Chatty
  class SearchIndex
    SCHEMA_VERSION = 3 # 3: moved the vector DB to its own file
    CHUNK_MAX_CHARS = 6000 # Split so each part fits the embedding model's context (8192 tokens)

    # The connection and its mutex are shared with the vector DB (V1::VectorDB), which joins vectors with chunks.
    attr_reader :db, :mutex

    def initialize(path)
      @db = SQLite3::Database.new(path)
      @mutex = Mutex.new
      @listeners = []
      setup
    end

    # Register a block called (inside the mutex) whenever rounds change.
    def on_change(&block)
      @listeners << block
    end

    # ---- Deriving chunks (messages → rounds. Pure function) ----

    def self.rounds_for(conv_id, messages)
      out = []
      messages.each_with_index do |m, i|
        next unless m['role'] == 'user' && m['id'] && !m['inherited'] # Messages copied by a fork belong to the original conversation
        a = messages[i + 1]
        next unless a && a['role'] == 'assistant' # Rounds whose reply is not finished are not indexed yet
        text = [m['content'].to_s, a['content'].to_s].reject(&:empty?).join("\n\n")
        parts = text.length > CHUNK_MAX_CHARS ? text.scan(/.{1,#{CHUNK_MAX_CHARS}}/m) : [text]
        out << { 'msg_id' => m['id'], 'conv_id' => conv_id, 'rev' => Digest::SHA256.hexdigest(text)[0, 16],
                 'parts' => parts, 'at' => a['at'] || m['at'] }
      end
      out
    end

    def self.normalize(s)
      s.to_s.unicode_normalize(:nfkc).downcase
    end

    # ---- Sync ----

    # Bring one conversation's rounds in line with the file (add new, replace changed, delete removed).
    def sync(conv_id, messages, tags = [])
      want = self.class.rounds_for(conv_id, messages)
      @mutex.synchronize do
        have = @db.execute('SELECT msg_id, rev FROM chunks WHERE conv_id = ? AND part = 0', [conv_id]).to_h
        changed = false
        @db.transaction do
          want.each do |r|
            old = have.delete(r['msg_id'])
            next if old == r['rev']
            owner = old ? nil : @db.get_first_value('SELECT conv_id FROM chunks WHERE msg_id = ? AND part = 0', [r['msg_id']])
            if owner && owner != conv_id
              # A message with the same id exists in another conversation (e.g. a copied file). Keep the one registered first
              warn "skip message #{r['msg_id']} of #{conv_id}: already indexed for #{owner}"
              next
            end
            delete_round(r['msg_id'])
            insert_round(r)
            changed = true
          end
          have.each_key { |msg_id| delete_round(msg_id) }
          changed ||= !have.empty?
          @db.execute('DELETE FROM conv_tags WHERE conv_id = ?', [conv_id])
          tags.each { |t| @db.execute('INSERT OR IGNORE INTO conv_tags (conv_id, tag) VALUES (?, ?)', [conv_id, t]) }
          @db.execute('INSERT INTO conv_stats (conv_id, messages) VALUES (?, ?) ' \
                      'ON CONFLICT(conv_id) DO UPDATE SET messages = excluded.messages', [conv_id, messages.size])
        end
        @listeners.each(&:call) if changed
      end
    end

    # At startup: sync every conversation, and drop rounds of conversations that no longer exist.
    def full_sync(conversations)
      conversations.each { |conv_id, (messages, tags)| sync(conv_id, messages, tags || []) }
      @mutex.synchronize do
        known = conversations.keys
        stale = (@db.execute('SELECT DISTINCT conv_id FROM chunks').map(&:first) | @db.execute('SELECT DISTINCT conv_id FROM conv_tags').map(&:first) |
                 @db.execute('SELECT conv_id FROM conv_stats').map(&:first)) - known
        @db.transaction do
          stale.each do |cid|
            @db.execute('SELECT DISTINCT msg_id FROM chunks WHERE conv_id = ?', [cid]).each { |(m)| delete_round(m) }
            @db.execute('DELETE FROM conv_tags WHERE conv_id = ?', [cid])
            @db.execute('DELETE FROM conv_stats WHERE conv_id = ?', [cid])
          end
        end
        @listeners.each(&:call)
      end
    end

    # ---- Keyword search ----

    # The current tags of every conversation as recorded here, in the order they were given: {conv_id => [tag, …]}.
    # A hint for lists (GET /v1/meta-all.json): the index is derived and follows the files when they are written through
    # the server or at startup, so a file edited by hand is not reflected until the next start.
    def tags_hint
      @mutex.synchronize do
        @db.execute('SELECT conv_id, tag FROM conv_tags ORDER BY rowid').each_with_object({}) do |(id, tag), h|
          (h[id] ||= []) << tag
        end
      end
    end

    # The number of messages of every conversation as recorded here: {conv_id => n}. A hint for lists, like tags_hint.
    def messages_hint
      @mutex.synchronize { @db.execute('SELECT conv_id, messages FROM conv_stats').to_h }
    end

    # Ids of conversations that have all the tags (LCTYSP-0009)
    def convs_with_tags(tags)
      tags = tags.uniq
      @mutex.synchronize do
        marks = (['?'] * tags.size).join(',')
        @db.execute("SELECT conv_id FROM conv_tags WHERE tag IN (#{marks}) GROUP BY conv_id HAVING COUNT(DISTINCT tag) = ?",
                    tags + [tags.size]).map(&:first)
      end
    end

    # Matching rounds in rank order. [{id, conv_id, snippet}]. allowed: array of conversation ids to search (nil for all)
    def keyword_search(q, limit: 50, allowed: nil)
      allowed_set = allowed && allowed.each_with_object({}) { |c, h| h[c] = true }
      terms = self.class.normalize(q).split(/\s+/).reject(&:empty?)
      @mutex.synchronize do
        seen = {}
        lexical_search(terms, limit, allowed_set).each_with_object([]) do |(id, conv, text), out|
          next if seen[id]
          seen[id] = true
          out << { 'id' => id, 'conv_id' => conv, 'snippet' => snippet(text, terms) }
        end
      end
    end

    # Snippets of rounds (shown for hits from semantic search only). { id => {conv_id, snippet} }
    def snippets(ids, q)
      terms = self.class.normalize(q).split(/\s+/).reject(&:empty?)
      @mutex.synchronize do
        ids.each_with_object({}) do |id, h|
          row = @db.get_first_row('SELECT conv_id, text FROM chunks WHERE msg_id = ? AND part = 0', [id])
          h[id] = { 'conv_id' => row[0], 'snippet' => snippet(row[1], terms) } if row
        end
      end
    end

    private

    def setup
      if @db.get_first_value('PRAGMA user_version').to_i != SCHEMA_VERSION
        # Derived data, so rebuild when the format changes
        @db.execute_batch('DROP TABLE IF EXISTS vectors; DROP TABLE IF EXISTS chunks_fts; DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS conv_tags; DROP TABLE IF EXISTS conv_stats;')
      end
      @db.execute('PRAGMA journal_mode = WAL')
      @db.execute_batch(<<~SQL)
        CREATE TABLE IF NOT EXISTS chunks (
          msg_id TEXT NOT NULL, part INTEGER NOT NULL, conv_id TEXT NOT NULL, rev TEXT NOT NULL, text TEXT NOT NULL, at TEXT,
          PRIMARY KEY (msg_id, part));
        CREATE INDEX IF NOT EXISTS chunks_conv ON chunks(conv_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='trigram');
        CREATE TABLE IF NOT EXISTS conv_tags (conv_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (conv_id, tag));
        CREATE INDEX IF NOT EXISTS conv_tags_tag ON conv_tags(tag);
        CREATE TABLE IF NOT EXISTS conv_stats (conv_id TEXT PRIMARY KEY, messages INTEGER NOT NULL);
      SQL
      @db.execute("PRAGMA user_version = #{SCHEMA_VERSION}")
    end

    def insert_round(r)
      r['parts'].each_with_index do |t, part|
        @db.execute('INSERT INTO chunks (msg_id, part, conv_id, rev, text, at) VALUES (?, ?, ?, ?, ?, ?)',
                    [r['msg_id'], part, r['conv_id'], r['rev'], t, r['at']])
        @db.execute('INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)', [@db.last_insert_row_id, self.class.normalize(t)])
      end
    end

    # Delete a round (vectors stay; the vector DB's garbage collection removes them at startup)
    def delete_round(msg_id)
      @db.execute('SELECT rowid FROM chunks WHERE msg_id = ?', [msg_id]).each { |(r)| @db.execute('DELETE FROM chunks_fts WHERE rowid = ?', [r]) }
      @db.execute('DELETE FROM chunks WHERE msg_id = ?', [msg_id])
    end

    # Keyword search. Terms of 3+ characters are split into trigrams, matched with OR and ranked by bm25 (partial hits despite wording).
    # Terms under 3 characters (like 京都) cannot use trigrams, so require them in the text. [[msg_id, conv_id, text], …]
    def lexical_search(terms, limit, allowed)
      return [] if terms.empty?
      grams = terms.select { |t| t.length >= 3 }.flat_map { |t| (0..t.length - 3).map { |i| t[i, 3] } }.uniq.first(64)
      short = terms.select { |t| t.length < 3 }
      cap = allowed ? 100_000 : limit * 4
      if grams.empty?
        where = short.map { 'chunks_fts.text LIKE ? ESCAPE \'\\\'' }.join(' AND ')
        binds = short.map { |t| "%#{t.gsub(/[\\%_]/) { |c| "\\#{c}" }}%" }
        rows = @db.execute("SELECT c.msg_id, c.conv_id, c.text FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid " \
                           "WHERE #{where} ORDER BY c.at DESC LIMIT ?", binds + [cap])
      else
        match = grams.map { |g| "\"#{g.gsub('"', '""')}\"" }.join(' OR ')
        rows = @db.execute(<<~SQL, [match, cap])
          SELECT c.msg_id, c.conv_id, c.text, chunks_fts.text FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
          WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?
        SQL
        rows = rows.select { |r| short.all? { |t| r[3].include?(t) } } unless short.empty?
      end
      rows = rows.select { |r| allowed[r[1]] } if allowed
      rows.first(limit).map { |r| r[0, 3] }
    end

    def snippet(text, terms, width = 140)
      t = text.to_s.gsub(/\s+/, ' ')
      norm = self.class.normalize(t)
      pos = terms.map { |w| norm.index(w) }.compact.min
      return t[0, width] if pos.nil? || pos < width / 3
      start = pos - width / 3
      "…#{t[start, width]}"
    end
  end
end
