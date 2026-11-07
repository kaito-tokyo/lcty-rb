# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The vector DB (persistent format, LCTYSP-0008): a separate file per embedding model, data/_vectors.<model>.sqlite, ATTACHed
# to the search index's connection so vectors can be joined with its rounds (chunks). Derived data (LCTYSP-0010).
#
#   vectors     vec = 768 dims (source of truth), vec256 = its first 256 dims renormalized (uniquely derived from vec).
#               Both are Float32 BLOBs, L2-normalized. Stale when rev differs from chunks.rev
#               Stale vectors are not deleted on the spot but by garbage collection at startup (gc_all)
#
# The browser embeds rounds and PUTs registration vector binaries (768 dims); the server builds the distribution vector
# binary (256 dims). Both use the exchange format lctyvLE0 (VectorRecords).

require 'sqlite3'
require 'fileutils'
require 'securerandom'
require_relative 'vector_records'

module Chatty
  module V1
    class VectorDB
      SCHEMA_VERSION = 1
      MODEL_RE = /\A[A-Za-z0-9._-]{1,80}\z/.freeze # Used in file names, so only these characters are allowed
      DIM = 768     # Dimensions of incoming vectors
      OUT_DIM = 256 # Dimensions of distributed vectors (take the head and renormalize)

      # index: the SearchIndex, which owns the connection, its mutex and the chunks table.
      def initialize(index, dir)
        @db = index.db
        @mutex = index.mutex
        @dir = dir
        @attached = {} # model => ATTACH name (v0, v1, …)
        @exported = nil # the model whose vectors data/_vectors.eg2_264.{dat,idx} hold, while they match the current vectors
        index.on_change { @exported = nil } # Rounds changed: the distribution files may be stale
      end

      # At startup: garbage-collect every vector DB in the data directory.
      def gc_all
        Dir.glob(File.join(@dir, '_vectors.*.sqlite')).each { |f| gc(File.basename(f)[/\A_vectors\.(.+)\.sqlite\z/, 1]) }
      end

      # Garbage collection: delete vectors that match no current round (msg_id, part, rev). Returns the number deleted.
      # Vectors are not deleted when a round disappears or changes (the distribution files are joined on rev, so they never
      # mix in; after an undo returns to the same content, the remaining vectors are reused as is).
      def gc(model)
        return 0 unless MODEL_RE.match?(model.to_s)
        @mutex.synchronize do
          v = vdb(model)
          @db.execute(<<~SQL)
            DELETE FROM #{v}.vectors WHERE NOT EXISTS (
              SELECT 1 FROM chunks c WHERE c.msg_id = #{v}.vectors.msg_id AND c.part = #{v}.vectors.part AND c.rev = #{v}.vectors.rev)
          SQL
          n = @db.changes
          warn "gc: removed #{n} stale vectors from _vectors.#{model}.sqlite" if n > 0
          n
        end
      end

      # Rounds without vectors yet (or whose content changed). Newest first. [{id, rev, parts: [text, …]}]
      def pending(model, limit)
        @mutex.synchronize do
          v = vdb(model)
          rows = @db.execute(<<~SQL, [limit])
            SELECT c.msg_id, c.rev FROM chunks c
            WHERE c.part = 0 AND NOT EXISTS (SELECT 1 FROM #{v}.vectors v WHERE v.msg_id = c.msg_id AND v.rev = c.rev)
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
        records = VectorRecords.unpack(bytes, DIM * 4)
        groups = records.group_by(&:first)
        missing = groups.keys - revs.keys
        raise HttpError.new(400, "rev is missing for #{missing.first}") unless missing.empty?
        vecs = groups.map { |id, recs| [id, recs.map { |(_, v)| normalized(v) }] }
        accepted = []
        stale = []
        @mutex.synchronize do
          vt = "#{vdb(model)}.vectors"
          @db.transaction do
            vecs.each do |id, list|
              rev = @db.get_first_value('SELECT rev FROM chunks WHERE msg_id = ? AND part = 0', [id])
              parts = @db.get_first_value('SELECT COUNT(*) FROM chunks WHERE msg_id = ?', [id]).to_i
              unless rev && rev == revs[id] && parts == list.size
                stale << id
                next
              end
              @db.execute("DELETE FROM #{vt} WHERE msg_id = ?", [id])
              list.each_with_index do |v, part|
                @db.execute("INSERT INTO #{vt} (msg_id, part, rev, vec, vec256) VALUES (?, ?, ?, ?, ?)",
                            [id, part, rev, SQLite3::Blob.new(v), SQLite3::Blob.new(truncated(v))])
              end
              accepted << id
            end
          end
          @exported = nil if @exported == model && !accepted.empty?
        end
        { 'accepted' => accepted.size, 'stale' => stale }
      rescue VectorRecords::FormatError => e
        raise HttpError.new(400, e.message)
      end

      ROW_PAD = 32 # zero bytes after each distributed vector: a row of the bdot264 kernel is 256 × f32 + 32 B
      ROW = OUT_DIM * 4 + ROW_PAD # 1,056 bytes
      ID = 16

      # The distribution files of model's valid vectors (LCTYSP-0008), [dat path, idx path], served as
      # /v1/vectors.eg2_264.dat and /v1/vectors.eg2_264.idx. Derived data in data/, rewritten together on request when
      # stale (temporary files → rename, the idx first):
      #   _vectors.eg2_264.dat  n rows of 256 × Float32 LE + 32 zero bytes: the kernel's memory layout, copied as it is
      #                         into the browser's wasm memory
      #   _vectors.eg2_264.idx  n × 16 bytes, the UUIDv7 message id of each row, in the same order
      def export(model)
        dir = @dir
        dat_path = File.join(dir, '_vectors.eg2_264.dat')
        idx_path = File.join(dir, '_vectors.eg2_264.idx')
        @mutex.synchronize do
          return [dat_path, idx_path] if @exported == model && File.exist?(dat_path) && File.exist?(idx_path)
          rows = ''.b
          ids = ''.b
          pad = ("\0" * ROW_PAD).b
          v = vdb(model)
          @db.execute(<<~SQL) do |id, vec|
            SELECT v.msg_id, v.vec256 FROM #{v}.vectors v
            JOIN chunks c ON c.msg_id = v.msg_id AND c.part = v.part AND c.rev = v.rev
            ORDER BY c.at, v.msg_id, v.part
          SQL
            rows << vec.b << pad
            ids << Uuid.to_bytes(id)
          end
          FileUtils.mkdir_p(dir)
          tag = "#{Process.pid}-#{SecureRandom.hex(4)}"
          File.binwrite("#{dat_path}.tmp-#{tag}", rows)
          File.binwrite("#{idx_path}.tmp-#{tag}", ids)
          File.rename("#{idx_path}.tmp-#{tag}", idx_path)
          File.rename("#{dat_path}.tmp-#{tag}", dat_path)
          # the former distribution files (one pair per model, and before that a single lctyvLE0 file)
          Dir.glob(File.join(@dir, "_vectors.*.#{OUT_DIM}.{rows,ids,bin}")).each { |f| File.delete(f) }
          @exported = model
        end
        [dat_path, idx_path]
      end

      private

      # ATTACH the model's vector DB (data/_vectors.<model>.sqlite) and return its name. Call outside transactions.
      def vdb(model)
        raise HttpError.new(400, "invalid model name: #{model.inspect}") unless MODEL_RE.match?(model)
        @attached[model] ||= begin
          name = "v#{@attached.size}"
          @db.execute("ATTACH DATABASE ? AS #{name}", [File.join(@dir, "_vectors.#{model}.sqlite")])
          if @db.get_first_value("PRAGMA #{name}.user_version").to_i != SCHEMA_VERSION
            @db.execute("DROP TABLE IF EXISTS #{name}.vectors") # Derived data, so rebuild when the format changes
          end
          @db.execute("PRAGMA #{name}.journal_mode = WAL")
          @db.execute(<<~SQL)
            CREATE TABLE IF NOT EXISTS #{name}.vectors (
              msg_id TEXT NOT NULL, part INTEGER NOT NULL, rev TEXT NOT NULL, vec BLOB NOT NULL, vec256 BLOB NOT NULL,
              PRIMARY KEY (msg_id, part))
          SQL
          @db.execute("PRAGMA #{name}.user_version = #{SCHEMA_VERSION}")
          name
        end
      end

      def normalized(bytes)
        v = bytes.unpack('e*')
        n = Math.sqrt(v.inject(0.0) { |s, x| s + x * x })
        raise HttpError.new(400, 'vector must be finite and non-zero') unless n.finite? && n > 0
        (n - 1.0).abs < 1e-4 ? bytes.b : v.map { |x| x / n }.pack('e*')
      end

      # Take the first OUT_DIM of the 768 dims and L2-renormalize (Matryoshka representation)
      def truncated(vec)
        v = vec.unpack("e#{OUT_DIM}")
        n = Math.sqrt(v.inject(0.0) { |s, x| s + x * x })
        n = 1.0 unless n > 0
        v.map { |x| x / n }.pack('e*')
      end
    end
  end
end
