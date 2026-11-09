# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The vector DB (persistent format, LCTYSP-0008): the table vectors of the search index, data/_index.sqlite, which holds
# every cache that may be lost (LCTYSP-0010), so vectors join its rounds (chunks) on the same connection.
#
#   vectors     One row per model and round part. vec = 768 dims (as registered), vec256 = its first 256 dims
#               renormalized (uniquely derived from vec). Both are Float32 BLOBs, L2-normalized. Stale when rev differs
#               from chunks.rev. Stale vectors are not deleted on the spot but by garbage collection at startup (gc_all)
#
# The browser embeds rounds and PUTs registration vector binaries (768 dims); the server builds the distribution vector
# binary (256 dims) in memory on every request. Both use the exchange format lctyvLE0 (VectorRecords).

require 'sqlite3'
require_relative '../config'
require_relative 'vector_records'

module Chatty
  module V1
    class VectorDB
      MODEL_RE = /\A[A-Za-z0-9._-]{1,80}\z/.freeze
      DIM = 768     # Dimensions of incoming vectors
      OUT_DIM = 256 # Dimensions of distributed vectors (take the head and renormalize)
      # The files of the former layout, each a cache of its own beside _index.sqlite: one vector DB per model (and its
      # WAL), the distribution files, and before them one pair per model and a single lctyvLE0 file
      FORMER_FILES = %w[_vectors.*.sqlite _vectors.*.sqlite-wal _vectors.*.sqlite-shm _vectors.eg2_264.dat
                        _vectors.eg2_264.idx _vectors.*.256.rows _vectors.*.256.ids _vectors.*.256.bin].freeze

      # index: the SearchIndex, which owns the connection, its mutex and the tables chunks and vectors.
      def initialize(index, dir)
        @db = index.db
        @mutex = index.mutex
        @dir = dir
      end

      # At startup: garbage-collect the vectors of every model, and delete the files of the former layout.
      def gc_all
        models = @mutex.synchronize { @db.execute('SELECT DISTINCT model FROM vectors').map(&:first) }
        models.each { |m| gc(m) }
        FORMER_FILES.flat_map { |g| Dir.glob(File.join(@dir, g)) }.uniq.each { |f| File.delete(f) }
      end

      # Garbage collection: delete the model's vectors that match no current round (msg_id, part, rev). Returns the number
      # deleted. Vectors are not deleted when a round disappears or changes (the distribution is joined on rev, so they
      # never mix in; after an undo returns to the same content, the remaining vectors are reused as is).
      def gc(model)
        return 0 unless model.is_a?(String) && MODEL_RE.match?(model)
        @mutex.synchronize do
          @db.execute(<<~SQL, [model])
            DELETE FROM vectors WHERE model = ? AND NOT EXISTS (
              SELECT 1 FROM chunks c WHERE c.msg_id = vectors.msg_id AND c.part = vectors.part AND c.rev = vectors.rev)
          SQL
          n = @db.changes
          warn "gc: removed #{n} stale vectors of the model #{model}" if n > 0
          n
        end
      end

      # Rounds without vectors yet (or whose content changed). Newest first. [{id, rev, parts: [text, …]}]
      def pending(model, limit)
        check_model(model)
        @mutex.synchronize do
          rows = @db.execute(<<~SQL, [model, limit])
            SELECT c.msg_id, c.rev FROM chunks c
            WHERE c.part = 0 AND NOT EXISTS (SELECT 1 FROM vectors v WHERE v.model = ? AND v.msg_id = c.msg_id AND v.rev = c.rev)
            ORDER BY c.at DESC LIMIT ?
          SQL
          rows.map do |id, rev|
            { 'id' => id, 'rev' => rev, 'parts' => @db.execute('SELECT text FROM chunks WHERE msg_id = ? ORDER BY part', [id]).map(&:first) }
          end
        end
      end

      # Put a registration vector binary (PUT body, 768 dims) into the vector DB. revs: { id => rev } (from the pending list).
      # The vectors of each id in the body are replaced entirely by those in the body (parts in body order).
      # Ids whose revision differs or whose part count does not match are dropped (the content changed while embedding).
      def put(model, revs, bytes)
        check_model(model)
        records = VectorRecords.unpack(bytes, DIM * 4)
        groups = records.group_by(&:first)
        missing = groups.keys - revs.keys
        raise HttpError.new(400, "rev is missing for #{missing.first}") unless missing.empty?
        # [id, [[vec, vec256], …]], checked before anything is written
        vecs = groups.map { |id, recs| [id, recs.map { |(_, v)| n = normalized(v); [n, truncated(n)] }] }
        accepted = []
        stale = []
        @mutex.synchronize do
          @db.transaction do
            vecs.each do |id, list|
              rev = @db.get_first_value('SELECT rev FROM chunks WHERE msg_id = ? AND part = 0', [id])
              parts = @db.get_first_value('SELECT COUNT(*) FROM chunks WHERE msg_id = ?', [id]).to_i
              unless rev && rev == revs[id] && parts == list.size
                stale << id
                next
              end
              @db.execute('DELETE FROM vectors WHERE model = ? AND msg_id = ?', [model, id])
              list.each_with_index do |(v, v256), part|
                @db.execute('INSERT INTO vectors (model, msg_id, part, rev, vec, vec256) VALUES (?, ?, ?, ?, ?, ?)',
                            [model, id, part, rev, SQLite3::Blob.new(v), SQLite3::Blob.new(v256)])
              end
              accepted << id
            end
          end
        end
        { 'accepted' => accepted.size, 'stale' => stale }
      rescue VectorRecords::FormatError => e
        raise HttpError.new(400, e.message)
      end

      ROW_PAD = 32 # zero bytes after each distributed vector: a row of the bdot264 kernel is 256 × f32 + 32 B
      ROW = OUT_DIM * 4 + ROW_PAD # 1,056 bytes
      ID = 16

      # The distribution of model's valid vectors (LCTYSP-0008), [dat, idx], served as /v1/vectors.eg2_264.dat and
      # /v1/vectors.eg2_264.idx. Built in memory on every call and never written to disk:
      #   dat  n rows of 256 × Float32 LE + 32 zero bytes: the kernel's memory layout, copied as it is into the browser's
      #        wasm memory
      #   idx  n × 16 bytes, the UUIDv7 message id of each row, in the same order
      def export(model)
        check_model(model)
        rows = ''.b
        ids = ''.b
        pad = ("\0" * ROW_PAD).b
        @mutex.synchronize do
          @db.execute(<<~SQL, [model]) do |id, vec|
            SELECT v.msg_id, v.vec256 FROM vectors v
            JOIN chunks c ON c.msg_id = v.msg_id AND c.part = v.part AND c.rev = v.rev
            WHERE v.model = ?
            ORDER BY c.at, v.msg_id, v.part
          SQL
            rows << vec.b << pad
            ids << Uuid.to_bytes(id)
          end
        end
        [rows, ids]
      end

      private

      def check_model(model)
        raise HttpError.new(400, "invalid model name: #{model.inspect}") unless model.is_a?(String) && MODEL_RE.match?(model)
      end

      def normalized(bytes)
        v = bytes.unpack('e*')
        n = Math.sqrt(v.inject(0.0) { |s, x| s + x * x })
        raise HttpError.new(400, 'vector must be finite and non-zero') unless n.finite? && n > 0
        (n - 1.0).abs < 1e-4 ? bytes.b : v.map { |x| x / n }.pack('e*')
      end

      # Take the first OUT_DIM of the 768 dims and L2-renormalize (Matryoshka representation). A vector whose first
      # OUT_DIM dims are all zero has no direction there, so it would score 0 against everything: reject it
      def truncated(vec)
        v = vec.unpack("e#{OUT_DIM}")
        n = Math.sqrt(v.inject(0.0) { |s, x| s + x * x })
        raise HttpError.new(400, "the first #{OUT_DIM} dimensions of a vector must not all be zero") unless n > 0
        v.map { |x| x / n }.pack('e*')
      end
    end
  end
end
