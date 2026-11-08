# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3016: the scenarios of docs/specs/LCTYSP-3016_file-types.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
#
# A WEBrick server on 127.0.0.1 (a free port) with Lcty::Servlets::MIME_TYPES, as Lcty.run configures it, mounts
# WEBrick's file handler on a temporary folder.

require_relative 'helper'
require 'net/http'
require File.expand_path('../../lib/servlets.rb', __dir__)

class FileTypesTest < Lcty::Scenarios
  FILES = Dir.mktmpdir('lcty-3016-')
  Minitest.after_run { FileUtils.rm_rf(FILES) }

  def self.port
    @port ||= begin
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Lcty::Servlets::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      server.mount('/', WEBrick::HTTPServlet::FileHandler, FILES, FancyIndexing: false)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def background
    step("Given WEBrick's file handler on a temporary folder, with Lcty::Servlets::MIME_TYPES") { self.class.port }
  end

  %w[js mjs cjs].each do |extension|
    scenario "A JavaScript file is served as text/javascript (#{extension})" do
      background
      name = "a.#{extension}"
      res = nil
      step(%(Given the folder has the file "#{name}")) { File.write(File.join(FILES, name), 'onmessage = null;') }
      step("When GET /#{name} is requested") do
        res = Net::HTTP.get_response(URI("http://127.0.0.1:#{self.class.port}/#{name}"))
      end
      step('Then the status is 200 with the type "text/javascript; charset=utf-8"') do
        assert_equal '200', res.code
        assert_equal 'text/javascript; charset=utf-8', res['content-type']
      end
    end
  end
end
