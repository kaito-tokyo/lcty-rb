# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3011: the scenarios of docs/specs/LCTYSP-3011_conversation-servlet.feature, written by hand. Each test has the
# title of its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so
# the two read side by side.
#
# The servlet is mounted at /c of a WEBrick server on 127.0.0.1 (a free port) with the MIME types of lcty.rb, as
# Chatty.run mounts it, and requested over HTTP. data/c/ is the test data directory's, shared with the other tests.

require_relative 'helper'
require 'net/http'
require 'securerandom'
require File.expand_path('../../lcty.rb', __dir__)

class CServletTest < Lcty::Scenarios
  C = Chatty::C

  def self.port
    @port ||= begin
      Lcty.open_data
      C.publish_assets
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Chatty::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      server.mount('/c', C::Servlet)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def get(path, headers = {})
    req = Net::HTTP::Get.new(path, headers)
    Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(req) }
  end

  def new_conversation
    id = "c3011-#{SecureRandom.hex(5)}"
    Chatty::Store.create('meta' => { 'id' => id, 'created_at' => '2026-11-07T00:00:00Z' },
                         'lines' => [{ 'type' => 'message', 'role' => 'user', 'content' => 'こんにちは' }])
    id
  end

  # The bytes of the file of public/lcty.v1/ that the version 1 name stands for (lcty.v1.js: lcty.v1.cjs)
  def public_lcty_v1(name)
    File.binread(File.join(Chatty::LctyV1::SRC_DIR, Chatty::LctyV1.file_for(name)))
  end

  def data_c(name)
    File.join(Chatty::CONV_DIR, name)
  end

  # Inode and modification time: a file that was not rewritten keeps both
  def identity(path)
    s = File.stat(path)
    [s.ino, s.mtime]
  end

  def leftovers(dir)
    Dir.children(dir).grep(/\.tmp-/)
  end

  # Every test needs the data directory open, the published list made and the server up
  def setup
    self.class.port
  end

  def teardown
    FileUtils.rm_rf(@tmp) if @tmp
    (@remove || []).each { |path| File.delete(path) if File.exist?(path) }
  end

  scenario 'A conversation file is served as it is' do
    id = res = nil
    step('Given a conversation file made by the store') do
      self.class.port
      id = new_conversation
    end
    step('When GET /c/<id>.html is requested') { res = get("/c/#{id}.html") }
    step('Then the status is 200 with the type "text/html; charset=utf-8"') do
      assert_equal '200', res.code
      assert_equal 'text/html; charset=utf-8', res['content-type']
    end
    step('And the body is the bytes of the file') { assert_equal File.binread(Chatty::Store.conv_path(id)), res.body.b }
  end

  [
    ['/c/<unknown id>.html', ->(_) { "/c/c3011-unknown-#{SecureRandom.hex(5)}.html" }],
    ['/c/<id>', ->(id) { "/c/#{id}" }],
    ['/c/<id>.htm', ->(id) { "/c/#{id}.htm" }],
    ['/c/sub/<id>.html', ->(id) { "/c/sub/#{id}.html" }],
    ['/c/<id>%20copy.html', ->(id) { "/c/#{id}%20copy.html" }],
    ['/c/notes.txt', ->(_) { '/c/notes.txt' }],
    ['/c/lcty.v1.d.ts', ->(_) { '/c/lcty.v1.d.ts' }],
    ['/c/lcty.v1.cjs', ->(_) { '/c/lcty.v1.cjs' }],
    ['/c/lcty.v1.mjs', ->(_) { '/c/lcty.v1.mjs' }],
    ['/c/..%2Fsecret.html', ->(_) { '/c/..%2Fsecret.html' }]
  ].each do |label, path|
    scenario "What is not a conversation file or a published file is 404 (#{label})" do
      id = res = nil
      step('Given a conversation file made by the store, and the files "notes.txt" and "<id> copy.html" in data/c/') do
        self.class.port
        id = new_conversation
        @remove = [data_c('notes.txt'), data_c("#{id} copy.html")]
        File.write(data_c('notes.txt'), 'notes')
        FileUtils.cp(Chatty::Store.conv_path(id), data_c("#{id} copy.html"))
      end
      step("When GET #{label} is requested") { res = get(instance_exec(id, &path)) }
      step('Then the status is 404') { assert_equal '404', res.code }
    end
  end

  ['/c/', '/c/?fork=abc&at=3'].each do |path|
    scenario "/c/ is the new conversation page, public/c/index.html (#{path})" do
      res = nil
      step("When GET #{path} is requested") { res = get(path) }
      step('Then the status is 200 with the type "text/html; charset=utf-8"') do
        assert_equal '200', res.code
        assert_equal 'text/html; charset=utf-8', res['content-type']
      end
      step('And the body is public/c/index.html') do
        assert_equal File.binread(File.join(Chatty::PUBLIC_DIR, 'c', 'index.html')), res.body.b
      end
    end
  end

  [
    ['/c', '"c/"', '/c/'],
    ['/c?fork=abc&at=3', '"c/?fork=abc&at=3"', '/c/?fork=abc&at=3']
  ].each do |path, location_label, location|
    scenario "/c redirects to c/ with its query (#{path})" do
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
      step("When GET /c/#{name} is requested") { res = get("/c/#{name}") }
      step(%(Then the status is 302 with the Location "../lcty.v1/#{file}", relative to the request)) do
        assert_equal '302', res.code
        assert_equal "http://127.0.0.1:#{self.class.port}/lcty.v1/#{file}", res['location']
      end
    end
  end

  scenario 'A published file answers 304 when it has not changed' do
    etag = res = nil
    step('Given the ETag of GET /c/index.html') do
      etag = get('/c/index.html')['etag']
      refute_nil etag
    end
    step('When GET /c/index.html is requested with If-None-Match of that ETag') do
      res = get('/c/index.html', 'If-None-Match' => etag)
    end
    step('Then the status is 304') { assert_equal '304', res.code }
  end

  scenario 'The copy in data/c/ is never what /c/ serves' do
    res = nil
    begin
      step('Given the copy of lcty.v1.css in data/c/ differs from public/lcty.v1/lcty.v1.css') do
        self.class.port
        File.write(data_c('lcty.v1.css'), '/* an older copy */')
      end
      step('When GET /c/lcty.v1.css is requested') { res = get('/c/lcty.v1.css') }
      step('Then it is redirected to /lcty.v1/lcty.v1.css, not answered with the copy') do
        assert_equal '302', res.code
        assert_equal "http://127.0.0.1:#{self.class.port}/lcty.v1/lcty.v1.css", res['location']
      end
    ensure
      C.publish_assets
    end
  end

  scenario 'C.publish_assets lists the files of public/c/ but documentation and licences' do
    step('When C.publish_assets runs') { C.publish_assets }
    step('Then C.published is every file under public/c/, sorted, except the names ending in .d.ts or .license') do
      files = Dir.glob('**/*', base: C::SRC_DIR).reject { |f| File.directory?(File.join(C::SRC_DIR, f)) }
      assert_equal files.reject { |f| f.end_with?('.d.ts', '.license') }.sort, C.published
    end
    step('And it has index.html') { assert_includes C.published, 'index.html' }
    step('And it is frozen') { assert C.published.frozen? }
  end

  scenario 'C.publish_assets copies what a conversation file opened directly needs into data/c/' do
    step('When C.publish_assets runs') do
      File.delete(data_c('lcty.v1.js')) if File.exist?(data_c('lcty.v1.js'))
      C.publish_assets
    end
    step('Then data/c/lcty.v1.js and data/c/lcty.v1.css have the bytes of public/lcty.v1/lcty.v1.cjs and lcty.v1.css') do
      %w[lcty.v1.js lcty.v1.css].each { |name| assert_equal public_lcty_v1(name), File.binread(data_c(name)) }
    end
    step('And no other file of public/lcty.v1/ is copied, such as lcty.v1.module.js (lcty.v1.async.mjs)') do
      refute File.exist?(data_c('lcty.v1.module.js'))
      refute File.exist?(data_c('lcty.v1.async.mjs'))
      assert_equal %w[lcty.v1.css lcty.v1.js], C::OFFLINE.sort
    end
  end

  scenario 'C.publish_assets copies the same files into the root of data/ and into data/t/, for the tag files' do
    step('When C.publish_assets runs') { C.publish_assets }
    step('Then data/lcty.v1.js, data/lcty.v1.css, data/t/lcty.v1.js and data/t/lcty.v1.css have the same bytes as those of data/c/') do
      [Chatty::DATA_DIR, Chatty::TAG_DIR].product(%w[lcty.v1.js lcty.v1.css]).each do |dir, name|
        assert_equal public_lcty_v1(name), File.binread(File.join(dir, name))
      end
    end
  end

  scenario 'C.publish_assets leaves copies that are up to date alone' do
    before = nil
    step('Given C.publish_assets has run') do
      C.publish_assets
      before = %w[lcty.v1.js lcty.v1.css].map { |name| identity(data_c(name)) }
    end
    step('When C.publish_assets runs again') { C.publish_assets }
    step('Then data/c/lcty.v1.js and data/c/lcty.v1.css are the same files as before, not rewritten') do
      assert_equal before, %w[lcty.v1.js lcty.v1.css].map { |name| identity(data_c(name)) }
    end
  end

  scenario 'C.publish_assets puts back a copy that was changed' do
    step('Given data/c/lcty.v1.css was changed') { File.write(data_c('lcty.v1.css'), '/* edited */') }
    step('When C.publish_assets runs') { C.publish_assets }
    step('Then data/c/lcty.v1.css has the bytes of public/lcty.v1/lcty.v1.css again') do
      assert_equal public_lcty_v1('lcty.v1.css'), File.binread(data_c('lcty.v1.css'))
    end
  end

  scenario 'C.publish_assets leaves the other files of data/c/ alone' do
    step('Given a file "lcty.v0.js" in data/c/ that an older server made') do
      @remove = [data_c('lcty.v0.js')]
      File.write(data_c('lcty.v0.js'), '// v0')
    end
    step('When C.publish_assets runs') { C.publish_assets }
    step('Then data/c/lcty.v0.js is still there with its content') { assert_equal '// v0', File.read(data_c('lcty.v0.js')) }
  end

  scenario 'C.write_if_changed writes a new file and the folders it needs' do
    @tmp = Dir.mktmpdir('lcty-3011-')
    path = File.join(@tmp, 'a', 'b', 'file.txt')
    step('When C.write_if_changed writes "hello" to a/b/file.txt in an empty folder') { C.write_if_changed(path, 'hello') }
    step('Then a/b/file.txt has the bytes "hello"') { assert_equal 'hello', File.binread(path) }
    step('And no temporary file is left next to it') { assert_equal [], leftovers(File.dirname(path)) }
  end

  scenario 'C.write_if_changed leaves a file with the same bytes alone' do
    @tmp = Dir.mktmpdir('lcty-3011-')
    path = File.join(@tmp, 'file.txt')
    before = nil
    step('Given a file with "hello"') do
      File.binwrite(path, 'hello')
      File.utime(Time.utc(2001), Time.utc(2001), path)
      before = identity(path)
    end
    step('When C.write_if_changed writes "hello" to it') { C.write_if_changed(path, 'hello') }
    step('Then it is the same file as before, not rewritten') { assert_equal before, identity(path) }
  end

  scenario 'C.write_if_changed replaces a file whose bytes differ' do
    @tmp = Dir.mktmpdir('lcty-3011-')
    path = File.join(@tmp, 'file.txt')
    before = nil
    step('Given a file with "hello"') do
      File.binwrite(path, 'hello')
      before = File.stat(path).ino
    end
    step('When C.write_if_changed writes "world" to it') { C.write_if_changed(path, 'world') }
    step('Then the file is replaced by a new one with the bytes "world"') do
      assert_equal 'world', File.binread(path)
      refute_equal before, File.stat(path).ino
    end
    step('And no temporary file is left next to it') { assert_equal ['file.txt'], Dir.children(@tmp) }
  end

  scenario 'C.write_if_changed compares bytes, whatever the encoding of the string' do
    @tmp = Dir.mktmpdir('lcty-3011-')
    path = File.join(@tmp, 'file.txt')
    before = nil
    step('Given a file with the UTF-8 bytes of "日本語"') do
      File.binwrite(path, '日本語'.b)
      File.utime(Time.utc(2001), Time.utc(2001), path)
      before = identity(path)
    end
    step('When C.write_if_changed writes "日本語" as a UTF-8 string to it') do
      C.write_if_changed(path, '日本語'.encode(Encoding::UTF_8))
    end
    step('Then it is the same file as before, not rewritten') { assert_equal before, identity(path) }
  end
end
