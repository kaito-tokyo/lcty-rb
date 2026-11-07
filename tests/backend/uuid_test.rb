# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3001: the scenarios of docs/specs/LCTYSP-3001_uuid-v7.feature, written by hand. Each test has the title of its
# Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.

require_relative 'helper'
require 'uuid'

class UuidTest < Lcty::Scenarios
  Uuid = Chatty::Uuid

  # The milliseconds in the first 48 bits of an id
  def ms_of(id)
    id.delete('-')[0, 12].to_i(16)
  end

  def now_ms
    (Time.now.to_r * 1000).floor
  end

  scenario 'A new id is a canonical UUIDv7' do
    id = nil
    step('When Uuid.v7 makes an id') { id = Uuid.v7 }
    step('Then it is 36 lowercase characters in the groups 8-4-4-4-12') do
      assert_match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/, id)
    end
    step('And its version is 7 and its variant is 10') do
      assert_equal '7', id[14]
      assert_equal 0b10, id[19].to_i(16) >> 2
    end
    step('And Uuid.valid? accepts it') { assert Uuid.valid?(id) }
  end

  scenario 'The first 48 bits are the milliseconds' do
    id = nil
    step('When Uuid.v7 makes an id for the milliseconds 0x0123456789ab') { id = Uuid.v7(0x0123456789ab) }
    step('Then the id starts with "01234567-89ab-7"') { assert id.start_with?('01234567-89ab-7'), id }
  end

  scenario 'Without milliseconds the id is for now' do
    before = after = id = nil
    step('When Uuid.v7 makes an id without milliseconds') do
      before = now_ms
      id = Uuid.v7
      after = now_ms
    end
    step('Then the milliseconds in its first 48 bits are between those before and after the call') do
      assert_operator ms_of(id), :>=, before
      assert_operator ms_of(id), :<=, after
    end
  end

  scenario 'Ids of later milliseconds sort after earlier ones' do
    ids = nil
    step('When Uuid.v7 makes ids for the milliseconds 1000, 1001 and 2000') do
      ids = [1000, 1001, 2000].map { |ms| Uuid.v7(ms) }
    end
    step('Then they sort as strings in the same order') { assert_equal ids, ids.sort }
  end

  scenario 'Ids of the same millisecond differ' do
    ids = nil
    step('When Uuid.v7 makes 100 ids for the millisecond 1000') { ids = Array.new(100) { Uuid.v7(1000) } }
    step('Then all of them are different') { assert_equal 100, ids.uniq.size }
  end

  {
    '"0190f3a1-7c2e-4abc-8def-0123456789ab" (version 4)' => '0190f3a1-7c2e-4abc-8def-0123456789ab',
    '"0190f3a1-7c2e-7abc-cdef-0123456789ab" (variant 11)' => '0190f3a1-7c2e-7abc-cdef-0123456789ab',
    '"0190F3A1-7C2E-7ABC-8DEF-0123456789AB" (uppercase)' => '0190F3A1-7C2E-7ABC-8DEF-0123456789AB',
    '"0190f3a17c2e7abc8def0123456789ab" (no hyphens)' => '0190f3a17c2e7abc8def0123456789ab',
    '"0190f3a1-7c2e-7abc-8def-0123456789ab\n" (a trailing newline)' => "0190f3a1-7c2e-7abc-8def-0123456789ab\n",
    '"" (empty)' => '',
    'nil' => nil,
    'a number' => 0x0190f3a17c2e7abc8def0123456789ab
  }.each do |label, value|
    scenario "Uuid.valid? rejects what is not a canonical UUIDv7 (#{label})" do
      step("Then Uuid.valid? rejects #{label}") { refute Uuid.valid?(value) }
    end
  end

  scenario 'An id and its 16 bytes convert both ways' do
    id = bytes = nil
    step('Given the id "0190f3a1-7c2e-7abc-8def-0123456789ab"') { id = '0190f3a1-7c2e-7abc-8def-0123456789ab' }
    step('When Uuid.to_bytes converts it') { bytes = Uuid.to_bytes(id) }
    step('Then the result is the 16 bytes 01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab') do
      expected = %w[01 90 f3 a1 7c 2e 7a bc 8d ef 01 23 45 67 89 ab].map { |h| h.to_i(16) }
      assert_equal expected, bytes.bytes
    end
    step('And Uuid.from_bytes converts them back to the id') { assert_equal id, Uuid.from_bytes(bytes) }
  end
end
