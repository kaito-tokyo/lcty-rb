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
#   c_recordcount  The number of elements of each conversation of /v1/rpc (LCTYSP-0014), written when the file is
#               written and filled at startup from the files (lib/rpc/conv_store.rb)
#
# Everything here the server makes again from the files alone, so the file has no schema version and is never
# migrated: at every start it is discarded (SearchIndex.discard) and made anew, and the full sync fills it
# (LCTYSP-0015). The vectors, which only the browser makes, are lcty_fuzzy_search.sqlite (lib/v1/vector_db.rb),
# attached to this connection.

require 'sqlite3'
require 'digest'

module Chatty
  class SearchIndex
    CHUNK_MAX_CHARS = 6000 # Split so each part fits the embedding model's context (8192 tokens)

    # Delete the file of the index with its WAL, as at every start, before it is opened anew
    def self.discard(path)
      [path, "#{path}-wal", "#{path}-shm"].each { |f| File.delete(f) if File.exist?(f) }
    end

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
        @db.transaction { stale.each { |cid| delete_conversation(cid) } }
        @listeners.each(&:call)
      end
    end

    # A conversation was deleted: drop its rounds, tags and count, leaving no row behind (also for an id that was never
    # indexed). Listeners are told when rounds went away.
    def remove(conv_id)
      @mutex.synchronize do
        had_rounds = !@db.get_first_value('SELECT 1 FROM chunks WHERE conv_id = ? LIMIT 1', [conv_id]).nil?
        @db.transaction { delete_conversation(conv_id) }
        @listeners.each(&:call) if had_rounds
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

    # The cached number of elements of a conversation of /v1/rpc, or nil when the cache has none (LCTYSP-0014)
    def record_count(cid)
      @mutex.synchronize { @db.get_first_value('SELECT count FROM c_recordcount WHERE cid = ?', [cid]) }
    end

    # Every cached count, {cid => count}, ordered by cid
    def record_counts
      @mutex.synchronize { @db.execute('SELECT cid, count FROM c_recordcount ORDER BY cid').to_h }
    end

    # Cache the number of elements of a conversation of /v1/rpc
    def put_record_count(cid, count)
      @mutex.synchronize do
        @db.execute('INSERT INTO c_recordcount (cid, count) VALUES (?, ?) ON CONFLICT(cid) DO UPDATE SET count = excluded.count',
                    [cid, count])
      end
    end

    # Replace the whole cache with counts, {cid => count}: the conversations of /v1/rpc as they are at startup
    def replace_record_counts(counts)
      @mutex.synchronize do
        @db.transaction do
          @db.execute('DELETE FROM c_recordcount')
          counts.each { |cid, n| @db.execute('INSERT INTO c_recordcount (cid, count) VALUES (?, ?)', [cid, n]) }
        end
      end
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
        CREATE TABLE IF NOT EXISTS c_recordcount (cid TEXT PRIMARY KEY, count INTEGER NOT NULL);
      SQL
    end

    def insert_round(r)
      r['parts'].each_with_index do |t, part|
        @db.execute('INSERT INTO chunks (msg_id, part, conv_id, rev, text, at) VALUES (?, ?, ?, ?, ?, ?)',
                    [r['msg_id'], part, r['conv_id'], r['rev'], t, r['at']])
        @db.execute('INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)', [@db.last_insert_row_id, self.class.normalize(t)])
      end
    end

    def delete_conversation(conv_id)
      @db.execute('SELECT DISTINCT msg_id FROM chunks WHERE conv_id = ?', [conv_id]).each { |(m)| delete_round(m) }
      @db.execute('DELETE FROM conv_tags WHERE conv_id = ?', [conv_id])
      @db.execute('DELETE FROM conv_stats WHERE conv_id = ?', [conv_id])
      @db.execute('DELETE FROM c_recordcount WHERE cid = ?', [conv_id])
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
      rows.uniq(&:first).first(limit).map { |r| r[0, 3] } # One row per round: limit counts rounds, not their parts
    end

    def snippet(text, terms, width = 140)
      t = text.to_s.gsub(/\s+/, ' ')
      norm = self.class.normalize(t)
      pos = terms.map { |w| norm.index(w) }.compact.min
      pos = original_index(t, pos) if pos && norm.length != t.length
      return t[0, width] if pos.nil? || pos < width / 3
      start = pos - width / 3
      "…#{t[start, width]}"
    end

    # The index in t of the character at norm_pos of normalize(t). Normalizing can change the length of what comes before
    # (㍿ becomes 株式会社, ﬁ becomes fi, İ lowercases to two characters), so count the normalized length character by
    # character.
    def original_index(t, norm_pos)
      n = 0
      t.each_char.with_index do |c, i|
        n += self.class.normalize(c).length
        return i if n > norm_pos
      end
      t.length
    end
  end
end
