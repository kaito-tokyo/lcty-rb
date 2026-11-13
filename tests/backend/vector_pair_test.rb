# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3026: the scenarios of docs/specs/LCTYSP-3026_vector-pair.feature, written by hand. Each test has the title of
# its Scenario and one step per line of it, so the two read side by side.

require_relative 'helper'
require 'embedding/vector_pair'
require 'uuid'

class VectorPairTest < Lcty::Scenarios
  Pair = Chatty::Embedding::VectorPair
  Uuid = Chatty::Uuid
  T0 = 1_763_000_000_000

  def setup
    @dir = Dir.mktmpdir('lcty-pair-')
    @dat, @idx = Pair.paths(@dir, 'eg2_264')
  end

  def teardown
    FileUtils.rm_rf(@dir)
  end

  def open(now: T0, current: ->(_id) { true })
    Pair.new(@dat, @idx, current: current, now: now)
  end

  def vec(seed)
    v = Array.new(256) { |i| Math.sin(seed * 1000 + i) }
    n = Math.sqrt(v.sum { |x| x * x })
    v.map { |x| x / n }
  end

  def id
    Uuid.to_bytes(Uuid.v7)
  end

  def dat_record(r)
    File.binread(@dat, Pair::DAT_RECORD, r * Pair::DAT_RECORD)
  end

  def idx_record(r)
    File.binread(@idx, Pair::IDX_RECORD, r * Pair::IDX_RECORD)
  end

  scenario 'A new pair has a header and no rows' do
    pair = nil
    step('Given a data directory without a pair') { refute File.exist?(@dat) }
    step('When a VectorPair is opened there at the time 1763000000000') { pair = open }
    step('Then both files are one record long') do
      assert_equal [1056, 16], [File.size(@dat), File.size(@idx)]
    end
    step('And its rev and its count are 1763000000000 and 1') { assert_equal [T0, 1], [pair.rev, pair.count] }
    step('And .idx record 0 is a UUIDv8 whose octets 0 to 5 are the rev') do
      h = idx_record(0)
      assert_equal [T0 >> 16, T0 & 0xFFFF].pack('Nn'), h[0, 6]
      assert_equal 0x80, h.getbyte(6)
      assert_equal 0x80, h.getbyte(8)
      assert_equal [0] * 8, h.bytes[7, 1] + h.bytes[9, 7] # every other bit is zero
      assert_equal T0, Pair.rev_of_idx(h)
    end
    step('And .dat record 0 is 256 quiet NaNs whose first three payloads are the rev, 16 bits each, and 32 zero bytes') do
      h = dat_record(0)
      floats = h.unpack('L<256')
      assert_equal [0x7FC00000 | ((T0 >> 32) & 0xFFFF), 0x7FC00000 | ((T0 >> 16) & 0xFFFF), 0x7FC00000 | (T0 & 0xFFFF)],
                   floats[0, 3]
      assert_equal [0x7FC00000], floats[3..-1].uniq
      assert_equal "\0" * 32, h[1024, 32]
      assert_equal T0, Pair.rev_of_dat(h)
    end
  end

  scenario 'The rev grows even when the clock goes back' do
    pair = nil
    step('Given a pair opened at the time 1763000000000') { open }
    step('When it is opened again at the time 1700000000000') { pair = open(now: 1_700_000_000_000) }
    step('Then its rev is 1763000000001') do
      assert_equal T0 + 1, pair.rev
      assert_equal T0 + 1, Pair.rev_of_dat(dat_record(0))
    end
  end

  scenario 'Appended rows are read back after the header' do
    pair = m = nil
    step('Given a new pair') { pair = open }
    step('When two rows are appended for one message') do
      m = id
      assert pair.append(m, [vec(1), vec(2)])
    end
    step('Then the count is 3 and the message has a valid row') do
      assert_equal 3, pair.count
      assert pair.valid?(m)
    end
    step('And .dat records 1 and 2 are the rows, each with 32 zero bytes after its floats') do
      assert_equal vec(1).pack('e*') + "\0" * 32, dat_record(1)
      assert_equal vec(2).pack('e*') + "\0" * 32, dat_record(2)
    end
    step("And .idx records 1 and 2 are the 16 bytes of the message's id") do
      assert_equal [m, m], [idx_record(1), idx_record(2)]
    end
  end

  scenario 'Rows are not appended when the message is gone' do
    pair = appended = nil
    step('Given a new pair') { pair = open }
    step('When a row is appended with a block that answers false') { appended = pair.append(id, [vec(1)]) { false } }
    step('Then nothing is appended and the count stays 1') do
      refute appended
      assert_equal 1, pair.count
      assert_equal 1056, File.size(@dat)
    end
  end

  scenario 'Invalidated rows are filled with NaN and listed as ranges' do
    pair = ids = nil
    step('Given a new pair with one row each for the messages a, b and c, and two for d') do
      pair = open
      ids = Array.new(4) { id }
      ids.first(3).each_with_index { |m, i| pair.append(m, [vec(i)]) }
      pair.append(ids[3], [vec(8), vec(9)])
    end
    step('When the rows of b and d are invalidated') { assert pair.invalidate([ids[1], ids[3]]) }
    step('Then the summary lists the invalid records as [[2, 2], [4, 5]]') do
      assert_equal({ 'rev' => T0, 'count' => 6, 'invalid' => [[2, 2], [4, 5]] }, pair.summary)
    end
    step('And those rows are quiet NaNs with zero padding, and their ids are left as they were') do
      [2, 4, 5].each { |r| assert_equal Pair::NAN_ROW, dat_record(r) }
      assert_equal [ids[1], ids[3], ids[3]], [idx_record(2), idx_record(4), idx_record(5)]
      assert_equal vec(0).pack('e*'), dat_record(1)[0, 1024]
    end
    step('And invalidating b again changes nothing') { refute pair.invalidate([ids[1]]) }
  end

  scenario 'A start cuts back a write that did not finish' do
    pair = nil
    step('Given a pair with one row, then half a record more of .idx and a whole row more of .dat') do
      open.append(id, [vec(1)])
      File.open(@idx, 'ab') { |f| f.write("\1" * 8) }
      File.open(@dat, 'ab') { |f| f.write(Pair.row(vec(2))) }
    end
    step('When it is opened again') { pair = open(now: T0 + 5) }
    step('Then .idx and .dat are cut back to two records') { assert_equal [2 * 16, 2 * 1056], [File.size(@idx), File.size(@dat)] }
    step('And the count is 2') { assert_equal 2, pair.count }
  end

  scenario 'A start fills with NaN the rows of messages that are not current' do
    pair = a = b = nil
    step('Given a pair with one row for the message a and one for b') do
      a = id
      b = id
      first = open
      first.append(a, [vec(1)])
      first.append(b, [vec(2)])
    end
    step('When it is opened again with a the only current message') { pair = open(now: T0 + 5, current: ->(i) { i == a }) }
    step('Then the row of b is NaN and listed as invalid') do
      assert_equal Pair::NAN_ROW, dat_record(2)
      assert_equal [[2, 2]], pair.summary['invalid']
    end
    step('And a still has its valid row and b has none') do
      assert pair.valid?(a)
      refute pair.valid?(b)
    end
  end

  scenario 'A read is clamped to the records' do
    pair = bytes = size = nil
    step('Given a new pair with one row') do
      pair = open
      pair.append(id, [vec(1)])
    end
    step('When bytes 1000 to 99999 of .dat are read') { bytes, size = pair.read(:dat, 1000, 99_999) }
    step('Then it returns the bytes 1000 to 2111 and the size 2112') do
      assert_equal File.binread(@dat)[1000..2111], bytes
      assert_equal 2112, size
    end
    step('And a read from byte 2112 returns nothing') { assert_nil pair.read(:dat, 2112, 3000)[0] }
  end
end
