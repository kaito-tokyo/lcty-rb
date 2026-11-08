# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3015: the scenarios of docs/specs/LCTYSP-3015_tag-order-servlet.feature, written by hand. Each test has the
# title of its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so
# the two read side by side.
#
# The servlet is mounted at /t of a WEBrick server on 127.0.0.1 (a free port) with the MIME types of lcty.rb, as
# Chatty.run mounts it, and requested over HTTP. data/ is the test data directory's, shared with the other tests.

require_relative 'helper'
require 'net/http'
require File.expand_path('../../lcty.rb', __dir__)

class TServletTest < Lcty::Scenarios
  def self.port
    @port ||= begin
      Lcty.open_data
      Chatty::C.publish_assets
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Chatty::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      server.mount('/t', Chatty::T::Servlet)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def get(path)
    Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(Net::HTTP::Get.new(path)) }
  end

  def setup
    self.class.port
  end

  %w[/t/ /t/index.html].each do |path|
    scenario "/t/ is the tag reorder page, public/t/index.html (#{path})" do
      res = nil
      step("When GET #{path} is requested") { res = get(path) }
      step('Then the status is 200 with the type "text/html; charset=utf-8"') do
        assert_equal '200', res.code
        assert_equal 'text/html; charset=utf-8', res['content-type']
      end
      step('And the body is public/t/index.html') do
        assert_equal File.binread(File.join(Chatty::PUBLIC_DIR, 't', 'index.html')), res.body.b
      end
    end
  end

  [
    ['/t', '"t/"', '/t/'],
    ['/t?x=1', '"t/?x=1"', '/t/?x=1']
  ].each do |path, location_label, location|
    scenario "/t redirects to t/ with its query (#{path})" do
      res = nil
      step("When GET #{path} is requested") { res = get(path) }
      step("Then the status is 302 with the Location #{location_label}, relative to the request") do
        assert_equal '302', res.code
        # WEBrick makes the Location absolute, against the URL of the request
        assert_equal "http://127.0.0.1:#{self.class.port}#{location}", res['location']
      end
    end
  end

  [
    %w[lcty.v1.css lcty.v1.css],
    %w[lcty.v1.js lcty.v1.cjs],
    %w[lcty.v1.lang-ja.js lcty.v1.lang-ja.cjs],
    %w[lcty.v1.module.js lcty.v1.async.mjs]
  ].each do |name, file|
    scenario "The lcty.v1 names redirect to their files in /lcty.v1/ (#{name})" do
      res = nil
      step("When GET /t/#{name} is requested") { res = get("/t/#{name}") }
      step(%(Then the status is 302 with the Location "../lcty.v1/#{file}", relative to the request)) do
        assert_equal '302', res.code
        assert_equal "http://127.0.0.1:#{self.class.port}/lcty.v1/#{file}", res['location']
      end
    end
  end

  [
    ['00010-ruby.html', '/t/00010-ruby.html'],
    ['00020-料理.html', '/t/00020-%E6%96%99%E7%90%86.html'],
    ['00030-c~23.html', '/t/00030-c~23.html']
  ].each do |file, path|
    scenario "A tag file is served as it is (\"#{file}\")" do
      res = nil
      body = %(<!DOCTYPE html>\n<lcty-t data-tag="#{file[6...-5]}">\n</lcty-t>\n)
      step("Given the tag file \"#{file}\" in data/t/") { File.write(File.join(Chatty::TAG_DIR, file), body) }
      step("When GET #{path} is requested") { res = get(path) }
      step('Then the status is 200 with the type "text/html; charset=utf-8"') do
        assert_equal '200', res.code
        assert_equal 'text/html; charset=utf-8', res['content-type']
      end
      step('And the body is the bytes of the file') { assert_equal body.b, res.body.b }
    ensure
      FileUtils.rm_f(File.join(Chatty::TAG_DIR, file))
    end
  end

  %w[/t/00020-ruby.html /t/0010-ruby.html /t/00010-ruby.htm /t/lcty.v1.d.ts /t/index.js.license /t/notes.html
     /t/sub/index.html /t/..%2Fc%2Findex.html].each do |path|
    scenario "What is not the page, an lcty.v1 file or a tag file is 404 (#{path})" do
      res = nil
      step('Given the tag file "00010-ruby.html" in data/t/') do
        File.write(File.join(Chatty::TAG_DIR, '00010-ruby.html'), '<lcty-t data-tag="ruby"></lcty-t>')
      end
      step("When GET #{path} is requested") { res = get(path) }
      step('Then the status is 404') { assert_equal '404', res.code }
    ensure
      FileUtils.rm_f(File.join(Chatty::TAG_DIR, '00010-ruby.html'))
    end
  end
end
