# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3018: the scenarios of docs/specs/LCTYSP-3018_site-servlets.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, the
# Background first, so the two read side by side.
#
# One WEBrick server on 127.0.0.1 (a free port) with Lcty::Servlets::MIME_TYPES mounts the servlets over temporary
# folders: StaticFileServlets at /f/<name> (files of FILES), C at /base/c (conversations of CONV) and T at /base/t
# (tags of TAGS), and a PublicDirectoryServlet at /pub (files of PUB). The pages of C and T are public/c/index.html and
# public/t/index.html of the repository, found from the working directory, which is the repository's root.

require_relative 'helper'
require 'net/http'
require File.expand_path('../../lib/servlets.rb', __dir__)

class ServletsTest < Lcty::Scenarios
  S = Lcty::Servlets
  ROOT = Dir.mktmpdir('lcty-3018-')
  FILES = File.join(ROOT, 'files')
  CONV = File.join(ROOT, 'c')
  TAGS = File.join(ROOT, 't')
  PUB = File.join(ROOT, 'pub')
  STATIC = %w[a.js a.cjs a.css a.html a.json b.js].freeze
  Minitest.after_run { FileUtils.rm_rf(ROOT) }

  def self.port
    @port ||= begin
      [FILES, CONV, TAGS, PUB].each { |d| FileUtils.mkdir_p(d) }
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: S::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      STATIC.each { |name| server.mount("/f/#{name}", S::StaticFileServlet, File.join(FILES, name)) }
      server.mount('/f/cached.js', S::StaticFileServlet, File.join(FILES, 'a.js'), 'public, max-age=60')
      server.mount('/f/missing.js', S::StaticFileServlet, File.join(FILES, 'missing.js'))
      server.mount('/base/c', S::C, CONV)
      server.mount('/base/t', S::T, TAGS)
      server.mount('/pub', S::PublicDirectoryServlet, PUB)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def request(klass, path, headers = {})
    req = klass.new(path, headers)
    Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(req) }
  end

  def get(path, headers = {})
    request(Net::HTTP::Get, path, { 'Accept-Encoding' => 'identity' }.merge(headers))
  end

  def write(dir, name, body)
    path = File.join(dir, name)
    FileUtils.mkdir_p(File.dirname(path))
    File.binwrite(path, body)
    path
  end

  def location(res)
    res['location'].to_s.sub("http://127.0.0.1:#{self.class.port}", '')
  end

  def background
    step('Given the servlets mounted on a WEBrick server over temporary folders') { self.class.port }
  end

  # A stand-in for a request that WEBrick would never pass on: only what the servlets read of one
  FakeRequest = Struct.new(:path_info, :request_method) do
    def [](_name)
      nil
    end
  end

  # ---- StaticFileServlet ----

  [
    ['a.js', '"text/javascript; charset=utf-8"'],
    ['a.cjs', '"text/javascript; charset=utf-8"'],
    ['a.css', '"text/css; charset=utf-8"'],
    ['a.html', '"text/html; charset=utf-8"'],
    ['a.json', '"application/json; charset=utf-8"']
  ].each do |name, type|
    scenario "A file is served with its type, no-cache, Last-Modified and an ETag (#{name})" do
      background
      body = res = nil
      step(%(Given the file "#{name}" served by a StaticFileServlet)) { body = File.binread(write(FILES, name, "#{name} ✓")) }
      step('When it is requested') { res = get("/f/#{name}") }
      step("Then the status is 200 with the type #{type}") do
        assert_equal ['200', type.delete('"')], [res.code, res['content-type']]
      end
      step('And Cache-Control is "no-cache", with Last-Modified and an ETag') do
        assert_equal 'no-cache', res['cache-control']
        refute_nil res['last-modified']
        assert_match(/\A"[0-9a-f]+-[0-9a-f]+"\z/, res['etag'])
      end
      step('And the body is the bytes of the file') { assert_equal body, res.body.b }
    end
  end

  scenario 'A Cache-Control the servlet is given is sent instead of no-cache' do
    background
    res = nil
    step('Given the file "a.js" served by a StaticFileServlet given "public, max-age=60"') { write(FILES, 'a.js', 'a') }
    step('When it is requested') { res = get('/f/cached.js') }
    step('Then Cache-Control is "public, max-age=60"') { assert_equal 'public, max-age=60', res['cache-control'] }
  end

  scenario 'The ETag of the file answers 304, with the same ETag and Cache-Control' do
    background
    etag = res = nil
    step('Given the ETag of a file served by a StaticFileServlet') do
      write(FILES, 'b.js', 'b')
      etag = get('/f/b.js')['etag']
    end
    step('When it is requested with If-None-Match of that ETag') { res = get('/f/b.js', 'If-None-Match' => etag) }
    step('Then the status is 304 with no body') do
      assert_equal '304', res.code
      assert_equal '', res.body.to_s
    end
    step('And the answer has the same ETag and Cache-Control "no-cache"') do
      assert_equal [etag, 'no-cache'], [res['etag'], res['cache-control']]
    end
  end

  scenario 'Another ETag is answered with the file' do
    background
    res = nil
    step('Given a file served by a StaticFileServlet') { write(FILES, 'b.js', 'bb') }
    step('When it is requested with If-None-Match "\"other\""') { res = get('/f/b.js', 'If-None-Match' => '"other"') }
    step('Then the status is 200 with the bytes of the file') { assert_equal %w[200 bb], [res.code, res.body] }
  end

  scenario 'A changed file gets another ETag' do
    background
    before = nil
    step('Given the ETag of a file served by a StaticFileServlet') do
      write(FILES, 'b.js', 'one')
      before = get('/f/b.js')['etag']
    end
    step('When the file is rewritten with other bytes') { write(FILES, 'b.js', 'three') }
    step('Then the ETag is another one') { refute_equal before, get('/f/b.js')['etag'] }
  end

  scenario 'HEAD answers the headers of GET without a body' do
    background
    res = nil
    step('Given a file served by a StaticFileServlet') { write(FILES, 'b.js', 'head') }
    step('When it is requested with HEAD') { res = request(Net::HTTP::Head, '/f/b.js') }
    step('Then the status is 200 with the Content-Length of the file and no body') do
      assert_equal %w[200 4], [res.code, res['content-length']]
      assert_nil res.body
    end
  end

  scenario 'A file that is not there is 404' do
    background
    res = nil
    step('Given a StaticFileServlet for a file that does not exist') { refute File.exist?(File.join(FILES, 'missing.js')) }
    step('When it is requested') { res = get('/f/missing.js') }
    step('Then the status is 404') { assert_equal '404', res.code }
  end

  scenario 'POST is not allowed' do
    background
    res = nil
    step('Given a file served by a StaticFileServlet') { write(FILES, 'b.js', 'b') }
    step('When it is requested with POST') { res = request(Net::HTTP::Post, '/f/b.js') }
    step('Then the status is 405') { assert_equal '405', res.code }
  end

  scenario 'A Cache-Control that is not a string is refused' do
    background
    error = nil
    step('When a StaticFileServlet is made with the Cache-Control :public') do
      error = assert_raises(ArgumentError) { S::StaticFileServlet.new(nil, File.join(FILES, 'a.js'), :public) }
    end
    step('Then it raises ArgumentError') { assert_kind_of ArgumentError, error }
  end

  # ---- C and T ----

  [
    ['/base/c', '"/base/c/"'],
    ['/base/c?fork=a&at=1', '"/base/c/?fork=a&at=1"'],
    ['/base/t', '"/base/t/"']
  ].each do |path, loc|
    scenario "A directory without its slash redirects to it, with its query (#{path})" do
      background
      res = nil
      step("When #{path} is requested") { res = get(path) }
      step("Then the status is 302 with the Location #{loc}, relative to the request") do
        assert_equal ['302', loc.delete('"')], [res.code, location(res)]
      end
    end
  end

  [
    ['/base/c/', 'public/c/index.html'],
    ['/base/c/index.html', 'public/c/index.html'],
    ['/base/t/', 'public/t/index.html']
  ].each do |path, page|
    scenario "The directory and its index.html are its page (#{path})" do
      background
      res = nil
      step("When #{path} is requested") { res = get(path) }
      step('Then the status is 200 with the type "text/html; charset=utf-8"') do
        assert_equal ['200', 'text/html; charset=utf-8'], [res.code, res['content-type']]
      end
      step("And the body is the bytes of #{page}") { assert_equal File.binread(page), res.body.b }
    end
  end

  scenario 'A conversation file is served as it is' do
    background
    body = res = nil
    step('Given the conversation file "abc-1.html" in the conversations\' folder') do
      body = File.binread(write(CONV, 'abc-1.html', "<!DOCTYPE html>\n<p>会話</p>\n"))
    end
    step('When /base/c/abc-1.html is requested') { res = get('/base/c/abc-1.html') }
    step('Then the status is 200 with the type "text/html; charset=utf-8"') do
      assert_equal ['200', 'text/html; charset=utf-8'], [res.code, res['content-type']]
    end
    step('And the body is the bytes of the file') { assert_equal body, res.body.b }
  end

  %w[00010-ruby.html 00020-c~23.html 00030-料理.html].each do |file|
    scenario "A tag file is served as it is (#{file})" do
      background
      body = res = nil
      step(%(Given the tag file "#{file}" in the tags' folder)) do
        body = File.binread(write(TAGS, file, "<lcty-t data-tag=\"#{file}\"></lcty-t>\n"))
      end
      # escape_path takes a path that starts with /
      step('When it is requested under /base/t/') { res = get("/base/t#{WEBrick::HTTPUtils.escape_path("/#{file}")}") }
      step('Then the status is 200 with the type "text/html; charset=utf-8"') do
        assert_equal ['200', 'text/html; charset=utf-8'], [res.code, res['content-type']]
      end
      step('And the body is the bytes of the file') { assert_equal body, res.body.b }
    end
  end

  [
    ['/base/c/lcty.v1.js', '"/base/lcty.v1/lcty.v1.js"'],
    ['/base/c/lcty.v1.module.js', '"/base/lcty.v1/lcty.v1.module.js"'],
    ['/base/t/lcty.v1.css', '"/base/lcty.v1/lcty.v1.css"'],
    ['/base/c/lcty.v1%20x.js', '"/base/lcty.v1/lcty.v1%20x.js"'],
    ['/base/c/lcty.v1%3Fq.js', '"/base/lcty.v1/lcty.v1%3Fq.js"']
  ].each do |path, loc|
    scenario "A name that starts with lcty.v1 redirects to the same name in ../lcty.v1/ for a day (#{path})" do
      background
      res = nil
      step("When #{path} is requested") { res = get(path) }
      step("Then the status is 302 with the Location #{loc}, relative to the request") do
        assert_equal ['302', loc.delete('"')], [res.code, location(res)]
      end
      step('And Cache-Control is "max-age=86400"') { assert_equal 'max-age=86400', res['cache-control'] }
    end
  end

  %w[
    /base/c/no-such-id.html /base/c/notes.txt /base/c/sub/abc-1.html /base/c/..%2Fabc-1.html /base/c/%FF.html
    /base/c/lcty.v1/sub.js /base/t/0010-short.html /base/t/00010-none.html
  ].each do |path|
    scenario "What is not a page, a data file or an lcty.v1 name is 404 (#{path})" do
      background
      res = nil
      step('Given the conversation file "abc-1.html" and the file "notes.txt" in the conversations\' folder') do
        write(CONV, 'abc-1.html', '<p>')
        write(CONV, 'notes.txt', 'notes')
      end
      step("When #{path} is requested") { res = get(path) }
      step('Then the status is 404') { assert_equal '404', res.code }
    end
  end

  # ---- PublicDirectoryServlet ----

  [
    ['/pub/', '"text/html; charset=utf-8"'],
    ['/pub/index.html', '"text/html; charset=utf-8"'],
    ['/pub/js/x.js', '"text/javascript; charset=utf-8"']
  ].each do |path, type|
    scenario "The files below the directory are served (#{path})" do
      background
      res = nil
      step('Given the files "index.html" and "js/x.js" in the public folder') do
        write(PUB, 'index.html', '<p>')
        write(PUB, 'js/x.js', 'x')
      end
      step("When #{path} is requested") { res = get(path) }
      step("Then the status is 200 with the type #{type}") do
        assert_equal ['200', type.delete('"')], [res.code, res['content-type']]
      end
    end
  end

  %w[/pub/.hidden /pub/%2Ehidden /pub/sub /pub/no-such.js].each do |path|
    scenario "A hidden file, a folder or a missing file is 404 (#{path})" do
      background
      res = nil
      step('Given the files "js/x.js" and ".hidden" and the folder "sub" in the public folder') do
        write(PUB, 'js/x.js', 'x')
        write(PUB, '.hidden', 'h')
        FileUtils.mkdir_p(File.join(PUB, 'sub'))
      end
      step("When #{path} is requested") { res = get(path) }
      step('Then the status is 404') { assert_equal '404', res.code }
    end
  end

  scenario 'A licence file of REUSE is 404' do
    background
    res = nil
    step('Given the files "x.wasm" and "x.wasm.license" in the public folder') do
      write(PUB, 'x.wasm', 'w')
      write(PUB, 'x.wasm.license', 'licence')
    end
    step('When /pub/x.wasm.license is requested') { res = get('/pub/x.wasm.license') }
    step('Then the status is 404') { assert_equal '404', res.code }
  end

  [
    ['"/js/../js/x.js"', '/js/../js/x.js'],
    ['"/js//x.js"', '/js//x.js'],
    ['"/./js/x.js"', '/./js/x.js'],
    ['"/.hidden"', '/.hidden'],
    ['"/js/x.js\u0000"', "/js/x.js\u0000"]
  ].each do |label, path|
    scenario "The servlet itself refuses a path with an empty part, a part that starts with \".\" or a NUL (#{label})" do
      background
      error = nil
      step('Given the files "js/x.js" and ".hidden" in the public folder') do
        write(PUB, 'js/x.js', 'x')
        write(PUB, '.hidden', 'h')
      end
      step("When the PublicDirectoryServlet is given the path #{label} directly") do
        servlet = S::PublicDirectoryServlet.new({ Logger: WEBrick::Log.new(File::NULL) }, PUB)
        error = assert_raises(WEBrick::HTTPStatus::NotFound) do
          servlet.do_GET(FakeRequest.new(path, 'GET'), WEBrick::HTTPResponse.new(WEBrick::Config::HTTP))
        end
      end
      step('Then it raises NotFound') { assert_kind_of WEBrick::HTTPStatus::NotFound, error }
    end
  end
end
