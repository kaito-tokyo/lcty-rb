# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The vector DB of semantic search (LCTYSP-0019): two files of fixed-size records, the rows (.dat) and the ids (.idx),
# record i of one belonging with record i of the other. Record 0 is the header of both and names the generation by its
# rev. While the server runs, .idx is only appended to, and .dat is appended to or has a row filled with NaN; opening the
# pair (a start) cuts back a write that did not finish, fills with NaN the rows of messages that went away, and writes a
# new header.
#
# A row is that of the kernel bdot264: 256 Float32 LE, then 32 zero bytes. An id is the 16 bytes of a message's UUIDv7.
# Every method is safe to call from any thread.

require 'json'
require 'digest'
require 'set'

module Chatty
  module Embedding
    class VectorPair
      DIMS = 256
      DAT_RECORD = 1056 # 256 Float32 and 32 zero bytes
      IDX_RECORD = 16
      PADDING = ("\0" * (DAT_RECORD - DIMS * 4)).b.freeze
      QNAN = 0x7FC0_0000
      # An invalid row: every float the quiet NaN without payload, the padding zero (NaN × 0 is NaN in the kernel)
      NAN_ROW = ([QNAN].pack('L<') * DIMS + PADDING).b.freeze

      attr_reader :dat_path, :idx_path

      # The pair named name ("eg2_264") in dir
      def self.paths(dir, name)
        base = File.join(dir, "lcty_fuzzy_search.#{name}")
        ["#{base}.dat", "#{base}.idx"]
      end

      # .idx record 0: a UUIDv8 carrying rev (48 bits) as UUIDv7 carries its timestamp
      def self.idx_header(rev)
        b = [rev >> 16, rev & 0xFFFF].pack('Nn') + ("\0" * 10)
        b.setbyte(6, 0x80) # version 8
        b.setbyte(8, 0x80) # variant 10
        b.b
      end

      # .dat record 0: 256 NaNs, the first three carrying 16 bits of rev each (most significant first)
      def self.dat_header(rev)
        payloads = [(rev >> 32) & 0xFFFF, (rev >> 16) & 0xFFFF, rev & 0xFFFF]
        (payloads.map { |p| QNAN | p } + [QNAN] * (DIMS - 3)).pack('L<*') + PADDING
      end

      # rev of an .idx header, or nil when it is not one
      def self.rev_of_idx(header)
        return nil unless header && header.bytesize == IDX_RECORD
        hi, lo = header.unpack('Nn')
        (hi << 16) | lo
      end

      # rev of a .dat header (read as integers, never as floats, which may lose a NaN's payload)
      def self.rev_of_dat(header)
        return nil unless header && header.bytesize >= 12
        a, b, c = header.unpack('L<3')
        ((a & 0xFFFF) << 32) | ((b & 0xFFFF) << 16) | (c & 0xFFFF)
      end

      # One row of a vector of 256 floats (already normalized)
      def self.row(vector)
        raise ArgumentError, "a row has #{DIMS} floats, not #{vector.size}" unless vector.size == DIMS
        vector.pack('e*') + PADDING
      end

      # Open the pair at dat_path and idx_path (made when it does not exist) and begin a new generation. current says
      # whether a 16-byte id is that of a current user or model message; a row of any other id is filled with NaN.
      # now is the time in milliseconds, which the new rev is unless the rev before is not smaller.
      def initialize(dat_path, idx_path, current:, now: (Time.now.to_r * 1000).floor)
        @dat_path = dat_path
        @idx_path = idx_path
        @lock = Mutex.new
        @rows_of = {} # id => [record numbers of its valid rows]
        @invalid = SortedSet.new # record numbers of NaN rows (record 0, the header, is not one)
        start(current, now)
      end

      attr_reader :rev

      # The number of records, the header included
      def count
        @lock.synchronize { @count }
      end

      # Whether the message of id (16 bytes) has a valid row
      def valid?(id)
        @lock.synchronize { @rows_of.key?(id) }
      end

      # Append the rows of one message (one or more vectors of 256 floats), when the block, run under the lock, returns
      # true (the message still exists). Rows go to .dat first, then the ids to .idx. Returns whether they were appended.
      def append(id, vectors)
        raise ArgumentError, 'an id is 16 bytes' unless id.bytesize == IDX_RECORD
        rows = vectors.map { |v| VectorPair.row(v) }.join
        @lock.synchronize do
          next false if block_given? && !yield
          first = @count
          write_at(@dat_path, first * DAT_RECORD, rows)
          write_at(@idx_path, first * IDX_RECORD, id.b * vectors.size)
          @count += vectors.size
          (@rows_of[id] ||= []).concat((first...@count).to_a)
          true
        end
      end

      # Fill every valid row of the ids (16 bytes each) with NaN. Returns whether any row changed.
      def invalidate(ids)
        @lock.synchronize do
          recs = ids.flat_map { |id| @rows_of.delete(id.b) || [] }
          File.open(@dat_path, 'r+b') { |f| recs.each { |r| f.seek(r * DAT_RECORD); f.write(NAN_ROW) } } unless recs.empty?
          @invalid.merge(recs)
          !recs.empty?
        end
      end

      # The JSON document of the pair: {rev, count, invalid: [[first, last], …]}
      def summary
        @lock.synchronize { { 'rev' => @rev, 'count' => @count, 'invalid' => ranges } }
      end

      # The bytes first..last (inclusive, clamped to the records) of .dat (kind :dat) or .idx (:idx), and the size of
      # the whole. nil when first is past the end.
      def read(kind, first, last)
        path, size = @lock.synchronize { kind == :dat ? [@dat_path, @count * DAT_RECORD] : [@idx_path, @count * IDX_RECORD] }
        return [nil, size] if first >= size
        last = [last, size - 1].min
        [File.open(path, 'rb') { |f| f.seek(first); f.read(last - first + 1) }, size]
      end

      private

      # Cut back, fill with NaN the rows of ids not current, write a new header (.dat first, then .idx)
      def start(current, now)
        [@dat_path, @idx_path].each { |p| File.open(p, File::RDWR | File::CREAT, 0o644, &:size) }
        n = [File.size(@idx_path) / IDX_RECORD, File.size(@dat_path) / DAT_RECORD].min
        File.truncate(@idx_path, n * IDX_RECORD)
        File.truncate(@dat_path, n * DAT_RECORD)
        before = n.positive? ? VectorPair.rev_of_idx(File.open(@idx_path, 'rb') { |f| f.read(IDX_RECORD) }) : nil
        @rev = before && before >= now ? before + 1 : now
        scan(n, current)
        write_at(@dat_path, 0, VectorPair.dat_header(@rev))
        write_at(@idx_path, 0, VectorPair.idx_header(@rev))
        @count = [n, 1].max
      end

      def scan(n, current)
        return if n < 2
        File.open(@dat_path, 'r+b') do |dat|
          ids = File.binread(@idx_path, (n - 1) * IDX_RECORD, IDX_RECORD)
          dat.seek(DAT_RECORD)
          (1...n).each do |r|
            row = dat.read(DAT_RECORD)
            id = ids.byteslice((r - 1) * IDX_RECORD, IDX_RECORD)
            if row == NAN_ROW
              @invalid << r
            elsif current.call(id)
              (@rows_of[id] ||= []) << r
            else
              dat.seek(r * DAT_RECORD)
              dat.write(NAN_ROW)
              @invalid << r
            end
          end
        end
      end

      def write_at(path, offset, bytes)
        File.open(path, 'r+b') do |f|
          f.seek(offset)
          f.write(bytes)
          f.flush
        end
      end

      def ranges
        @invalid.each_with_object([]) do |r, out|
          if out.last && out.last[1] == r - 1
            out.last[1] = r
          else
            out << [r, r]
          end
        end
      end
    end
  end
end
