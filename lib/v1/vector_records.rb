# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Vector binary (exchange format lctyvLE0. LCTYSP-008). Everything is little-endian.
#
#   0   8  magic "lctyvLE0"
#   8   4  byte size of the following vector (uint32 LE)
#   12  4  reserved (0)
#   16  16 id (UUIDv7)
#   32  n  vector (Float32 LE)
#
# The whole first 16 bytes (control block) act as the magic. Wrong byte order or size never matches.

require_relative '../uuid'

module Chatty
  module V1
    module VectorRecords
      module_function

      MAGIC = 'lctyvLE0'.b.freeze
      HEAD = 32

      class FormatError < StandardError; end

      def control(size)
        MAGIC + [size, 0].pack('VV')
      end

      def pack(id, vec)
        control(vec.bytesize) + Uuid.to_bytes(id) + vec.b
      end

      # Split bytes into records. Every record's vector must be size bytes. [[id, vector bytes], …]
      def unpack(bytes, size)
        bytes = bytes.b
        rec = HEAD + size
        raise FormatError, "length #{bytes.bytesize} is not a multiple of #{rec}" unless (bytes.bytesize % rec).zero?
        want = control(size)
        (0...bytes.bytesize / rec).map do |i|
          off = i * rec
          raise FormatError, "record #{i}: bad control block (expected lctyvLE0 + #{size})" unless bytes[off, 16] == want
          id = Uuid.from_bytes(bytes[off + 16, 16])
          raise FormatError, "record #{i}: id is not a UUIDv7" unless Uuid.valid?(id)
          [id, bytes[off + HEAD, size]]
        end
      end
    end
  end
end
