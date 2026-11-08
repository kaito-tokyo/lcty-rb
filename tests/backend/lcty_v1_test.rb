# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3017: the scenarios of docs/specs/LCTYSP-3017_lcty-v1-servlet.feature, written by hand. Each test has the
# title of its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, the
# Background first, so the two read side by side.
#
# The servlet is mounted at /lcty.v1 of a WEBrick server on 127.0.0.1 (a free port) with the MIME types of lcty.rb, as
# Chatty.run mounts it, and requested over HTTP.

require_relative 'helper'
require 'net/http'
require File.expand_path('../../lcty.rb', __dir__)

class LctyV1Test < Lcty::Scenarios
  LctyV1 = Chatty::LctyV1

  def self.port
    @port ||= begin
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Chatty::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      server.mount('/lcty.v1', LctyV1::Servlet)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def get(path, headers = {})
    req = Net::HTTP::Get.new(path, headers)
    Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(req) }
  end

  def background
    step('Given LctyV1::Servlet mounted at /lcty.v1') { self.class.port }
  end

  [
    ['lcty.v1.cjs', '"text/javascript; charset=utf-8"'],
    ['lcty.v1.lang-ja.cjs', '"text/javascript; charset=utf-8"'],
    ['lcty.v1.css', '"text/css; charset=utf-8"'],
    ['lcty.v1.async.mjs', '"text/javascript; charset=utf-8"'],
    ['lcty.v1.c.worker.cjs', '"text/javascript; charset=utf-8"'],
    ['lcty.v1.t.worker.cjs', '"text/javascript; charset=utf-8"']
  ].each do |name, type|
    scenario "The files of public/lcty.v1/ are served with Cache-Control: no-cache (#{name})" do
      background
      res = nil
      step("When GET /lcty.v1/#{name} is requested") { res = get("/lcty.v1/#{name}") }
      step(%(Then the status is 200 with the type #{type} and Cache-Control "no-cache")) do
        assert_equal '200', res.code
        assert_equal type.delete('"'), res['content-type']
        assert_equal 'no-cache', res['cache-control']
      end
      step("And the body is the bytes of public/lcty.v1/#{name}") do
        assert_equal File.binread(File.join(LctyV1::SRC_DIR, name)), res.body.b
      end
    end
  end

  scenario 'A file of /lcty.v1/ answers 304 when it has not changed' do
    background
    etag = res = nil
    step('Given the ETag of GET /lcty.v1/lcty.v1.cjs') do
      etag = get('/lcty.v1/lcty.v1.cjs')['etag']
      refute_nil etag
    end
    step('When GET /lcty.v1/lcty.v1.cjs is requested with If-None-Match of that ETag') do
      res = get('/lcty.v1/lcty.v1.cjs', 'If-None-Match' => etag)
    end
    step('Then the status is 304') { assert_equal '304', res.code }
  end

  %w[
    /lcty.v1/ /lcty.v1/lcty.v1.d.cts /lcty.v1/lcty.v1.c.worker.d.cts /lcty.v1/lcty.v1.js /lcty.v1/sub/lcty.v1.cjs
    /lcty.v1/..%2Flcty.rb
  ].each do |path|
    scenario "What is not a file of public/lcty.v1/ is 404 (#{path})" do
      background
      res = nil
      step("When GET #{path} is requested") { res = get(path) }
      step('Then the status is 404') { assert_equal '404', res.code }
    end
  end

  [
    ['lcty.v1.js', 'lcty.v1.cjs'],
    ['lcty.v1.lang-ja.js', 'lcty.v1.lang-ja.cjs'],
    ['lcty.v1.css', 'lcty.v1.css'],
    ['lcty.v1.module.js', 'lcty.v1.async.mjs'],
    ['lcty.v1.lang-xx.js', nil],
    ['lcty.v1.cjs', nil],
    ['lcty.v1.mjs', nil],
    ['index.html', nil]
  ].each do |name, file|
    scenario "LctyV1.file_for gives the file a version 1 name stands for (#{name})" do
      background
      result = nil
      step(%(When LctyV1.file_for is given "#{name}")) { result = LctyV1.file_for(name) }
      step("Then it returns #{file ? %("#{file}") : 'nil'}") { file ? assert_equal(file, result) : assert_nil(result) }
    end
  end
end
