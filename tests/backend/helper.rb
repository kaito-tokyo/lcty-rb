# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The backend unit tests (LCTYSP-3xxx): the server's parts on their own, with Minitest, which Ruby 2.6 bundles, so
# nothing has to be installed (macOS's /usr/bin/ruby, or the dev container .devcontainer/ruby-2.6.10).
#
# Like the frontend unit tests, each test is a Scenario of a Gherkin feature in docs/specs: `scenario` names the test
# after the Scenario's title, and `step` wraps each of its lines, so a failure says which line failed.

require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'

$LOAD_PATH.unshift(File.expand_path('../../lib', __dir__))

# lib/config.rb reads LCTY_DATA_DIR once, when it is loaded, so every test of this process shares one data directory:
# a new, empty one in the temporary folder, whatever LCTY_DATA_DIR was (the real data is never touched). It is removed
# afterwards; LCTY_TEST_KEEP_DATA=1 keeps it to look at.
unless defined?(LCTY_TEST_DATA_DIR)
  LCTY_TEST_DATA_DIR = Dir.mktmpdir('lcty-backend-')
  ENV['LCTY_DATA_DIR'] = LCTY_TEST_DATA_DIR
  at_exit do
    if ENV['LCTY_TEST_KEEP_DATA'] == '1'
      $stderr.puts "lcty-backend: kept the data directory #{LCTY_TEST_DATA_DIR}"
    else
      FileUtils.rm_rf(LCTY_TEST_DATA_DIR)
    end
  end
end

module Lcty
  # Open the data directory as the server does (Chatty.open_data: Chatty::TAGS, INDEX and VECTORS), once per process.
  # For the tests of Chatty::Store and the servlets; the tests share it, so each makes conversations of its own.
  def self.open_data
    require 'store'
    Chatty.open_data unless defined?(Chatty::INDEX)
  end

  class Scenarios < Minitest::Test
    # Define the test of the Scenario `title`. Minitest runs the methods whose names start with test_.
    def self.scenario(title, &block)
      name = "test_#{title}"
      raise ArgumentError, "duplicate scenario: #{title}" if method_defined?(name)
      define_method(name, &block)
    end

    # One line of the Scenario. A failed assertion inside it is reported with the line in front.
    def step(line)
      yield
    rescue Minitest::Assertion => e
      raise e.class, "#{line}\n#{e.message}", e.backtrace
    end
  end
end
