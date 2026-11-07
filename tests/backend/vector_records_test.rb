# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3006: the scenarios of docs/specs/LCTYSP-3006_vector-records.feature, written by hand. Each test has the title
# of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.

require_relative 'helper'
require 'v1/vector_records'

class VectorRecordsTest < Lcty::Scenarios
  VectorRecords = Chatty::V1::VectorRecords
  Uuid = Chatty::Uuid

  def hex_bytes(s)
    s.split.map { |h| h.to_i(16) }
  end

  # A vector of dims Float32 LE values, different for each seed
  def vector(dims, seed = 1)
    Array.new(dims) { |i| Math.sin(seed * 1000 + i) }.pack('e*')
  end

  # The error the block raises (nil when it raises none)
  def error_of
    yield
    nil
  rescue StandardError => e
    e
  end

  def assert_format_error(message, error)
    assert_kind_of VectorRecords::FormatError, error
    assert_equal message, error.message
  end

  scenario 'The control block of a registration record is fixed' do
    block = nil
    step('When VectorRecords.control makes the control block for the size 3072') { block = VectorRecords.control(3072) }
    step('Then it is the 16 bytes 6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00') do
      assert_equal hex_bytes('6c 63 74 79 76 4c 45 30 00 0c 00 00 00 00 00 00'), block.bytes
    end
  end

  scenario 'The control block carries the size in bytes' do
    block = nil
    step('When VectorRecords.control makes the control block for the size 1024') { block = VectorRecords.control(1024) }
    step('Then it is "lctyvLE0" followed by 00 04 00 00 and 00 00 00 00') do
      assert_equal 'lctyvLE0'.b + [0, 4, 0, 0, 0, 0, 0, 0].pack('C*'), block
      assert_equal Encoding::ASCII_8BIT, block.encoding
    end
  end

  scenario 'A record is the control block, the id and the vector' do
    id = vec = record = nil
    step('Given a UUIDv7 id and a vector of 768 Float32 values') do
      id = Uuid.v7
      vec = vector(768)
    end
    step('When VectorRecords.pack makes a record of them') { record = VectorRecords.pack(id, vec) }
    step('Then the record is 3,104 bytes') { assert_equal 3104, record.bytesize }
    step('And it starts with the control block for the size 3072') { assert_equal VectorRecords.control(3072), record[0, 16] }
    step('And the bytes 16 to 31 are the 16 bytes of the id') { assert_equal Uuid.to_bytes(id), record[16, 16] }
    step('And the rest is the vector as it was given') { assert_equal vec, record[32..-1] }
  end

  scenario 'Packed records unpack to their ids and vectors in order' do
    expected = records = nil
    step('Given three records of 768 dimensions, the first and the third with the same id') do
      a = Uuid.v7
      b = Uuid.v7
      expected = [[a, vector(768, 1)], [b, vector(768, 2)], [a, vector(768, 3)]]
    end
    step('When VectorRecords.unpack reads their concatenation with the size 3072') do
      records = VectorRecords.unpack(expected.map { |id, v| VectorRecords.pack(id, v) }.join, 3072)
    end
    step('Then it returns the three ids and vectors in the order they were packed') { assert_equal expected, records }
  end

  scenario 'Records of another size unpack with that size' do
    expected = records = nil
    step('Given two records of 256 dimensions') { expected = [[Uuid.v7, vector(256, 1)], [Uuid.v7, vector(256, 2)]] }
    step('When VectorRecords.unpack reads them with the size 1024') do
      records = VectorRecords.unpack(expected.map { |id, v| VectorRecords.pack(id, v) }.join, 1024)
    end
    step('Then it returns both ids and their vectors of 1,024 bytes') do
      assert_equal expected, records
      assert_equal [1024, 1024], records.map { |(_, v)| v.bytesize }
    end
  end

  scenario 'No bytes unpack to no records' do
    records = nil
    step('When VectorRecords.unpack reads an empty string with the size 3072') { records = VectorRecords.unpack('', 3072) }
    step('Then it returns no records') { assert_equal [], records }
  end

  scenario 'Unpack reads a text string as bytes' do
    id = vec = bytes = records = nil
    step('Given a record whose bytes are labelled as UTF-8 text') do
      id = Uuid.v7
      vec = vector(768)
      bytes = VectorRecords.pack(id, vec).force_encoding(Encoding::UTF_8)
    end
    step('When VectorRecords.unpack reads it with the size 3072') { records = VectorRecords.unpack(bytes, 3072) }
    step('Then it returns the id and the vector as binary bytes') do
      assert_equal [[id, vec]], records
      assert_equal Encoding::ASCII_8BIT, records[0][1].encoding
    end
  end

  {
    'the last byte cut' => [6207, ->(two) { two[0...-1] }],
    'one byte added' => [6209, ->(two) { two + "\0".b }],
    'a 256-dim record' => [4160, ->(two) { two[0, 3104] + VectorRecords.pack(Uuid.v7, ("\0" * 1024).b) }]
  }.each do |change, (length, alter)|
    scenario "Unpack rejects a length that is not a whole number of records (#{change})" do
      bytes = error = nil
      step("Given two records of 768 dimensions with #{change}") do
        bytes = alter.call(VectorRecords.pack(Uuid.v7, vector(768, 1)) + VectorRecords.pack(Uuid.v7, vector(768, 2)))
      end
      step('When VectorRecords.unpack reads them with the size 3072') { error = error_of { VectorRecords.unpack(bytes, 3072) } }
      step("Then it raises a FormatError saying \"length #{length} is not a multiple of 3104\"") do
        assert_format_error("length #{length} is not a multiple of 3104", error)
      end
    end
  end

  {
    'the magic "lctyvLE1"' => ->(r) { r[0, 8] = 'lctyvLE1'.b },
    'the size written big-endian' => ->(r) { r[8, 4] = [3072].pack('N') },
    'the size 3068 and 4 bytes of extra' => ->(r) { r[8, 4] = [3068].pack('V') },
    'a reserved field of 1' => ->(r) { r[12, 4] = [1].pack('V') }
  }.each do |change, alter|
    scenario "Unpack rejects a record whose control block is wrong (#{change})" do
      bytes = error = nil
      step("Given a good record followed by a record with #{change}") do
        bad = VectorRecords.pack(Uuid.v7, vector(768, 2))
        alter.call(bad)
        bytes = VectorRecords.pack(Uuid.v7, vector(768, 1)) + bad
      end
      step('When VectorRecords.unpack reads them with the size 3072') { error = error_of { VectorRecords.unpack(bytes, 3072) } }
      step('Then it raises a FormatError saying "record 1: bad control block (expected lctyvLE0 + 3072)"') do
        assert_format_error('record 1: bad control block (expected lctyvLE0 + 3072)', error)
      end
    end
  end

  {
    '16 zero bytes' => '00000000-0000-0000-0000-000000000000',
    '"0190f3a1-7c2e-4abc-8def-0123456789ab"' => '0190f3a1-7c2e-4abc-8def-0123456789ab'
  }.each do |label, id|
    scenario "Unpack rejects an id that is not a UUIDv7 (#{label})" do
      bytes = error = nil
      step("Given a record whose id is #{label}") { bytes = VectorRecords.pack(id, vector(768)) }
      step('When VectorRecords.unpack reads it with the size 3072') { error = error_of { VectorRecords.unpack(bytes, 3072) } }
      step('Then it raises a FormatError saying "record 0: id is not a UUIDv7"') do
        assert_format_error('record 0: id is not a UUIDv7', error)
      end
    end
  end

  scenario 'Records of another size are rejected even when the length fits' do
    bytes = error = nil
    step('Given three records of 256 dimensions, 3,168 bytes in all') do
      bytes = Array.new(3) { |i| VectorRecords.pack(Uuid.v7, vector(256, i)) }.join
      assert_equal 3168, bytes.bytesize
    end
    step('When VectorRecords.unpack reads them with the size 3136') { error = error_of { VectorRecords.unpack(bytes, 3136) } }
    step('Then it raises a FormatError saying "record 0: bad control block (expected lctyvLE0 + 3136)"') do
      assert_format_error('record 0: bad control block (expected lctyvLE0 + 3136)', error)
    end
  end
end
