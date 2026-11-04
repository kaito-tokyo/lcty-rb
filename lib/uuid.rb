# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# UUIDv7 (RFC 9562), used for message ids (LCTYSP-003). The first 48 bits are milliseconds, so ids sort roughly by creation time.

require 'securerandom'

module Chatty
  module Uuid
    module_function

    RE = /\A[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/.freeze

    def v7(ms = (Time.now.to_r * 1000).floor)
      b = [ms >> 16, ms & 0xffff].pack('Nn') + SecureRandom.random_bytes(10)
      b.setbyte(6, (b.getbyte(6) & 0x0f) | 0x70) # version 7
      b.setbyte(8, (b.getbyte(8) & 0x3f) | 0x80) # variant 10
      from_bytes(b)
    end

    def valid?(s)
      s.is_a?(String) && RE.match?(s)
    end

    # canonical string form ⇔ 16 bytes
    def to_bytes(s)
      [s.delete('-')].pack('H*')
    end

    def from_bytes(b)
      h = b.unpack1('H*')
      "#{h[0, 8]}-#{h[8, 4]}-#{h[12, 4]}-#{h[16, 4]}-#{h[20, 12]}"
    end
  end
end
