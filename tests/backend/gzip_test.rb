# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3013: the scenarios of docs/specs/LCTYSP-3013_gzip.feature, written by hand. Each test has the title of its
# Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
#
# A Chatty::GzipServer on 127.0.0.1 (a free port), configured as Chatty.run does, mounts a servlet whose response is
# set by the query (/answer?size=…&type=…&status=…&encoding=…) and WEBrick's file handler on a temporary folder
# (/files/). Requests are written by hand on a socket, so nothing between decodes or asks for gzip on its own.

require_relative 'helper'
require 'securerandom'
require 'socket'
require 'uri'
require 'zlib'
require File.expand_path('../../lcty.rb', __dir__)

class GzipTest < Lcty::Scenarios
  # Answers the query: size bytes of text of the type, with the status and the Content-Encoding
  class Answer < WEBrick::HTTPServlet::AbstractServlet
    def do_GET(req, res)
      q = WEBrick::HTTPUtils.parse_query(req.query_string.to_s) # req.query of a POST is its body
      res.status = (q['status'] || 200).to_i
      res['content-type'] = q['type'].to_s
      res['content-encoding'] = q['encoding'] if q['encoding']
      res['vary'] = q['vary'] if q['vary']
      res.body = GzipTest.text(q['size'].to_i)
    end

    alias do_POST do_GET
  end

  FILES = Dir.mktmpdir('lcty-3013-')
  Minitest.after_run { FileUtils.rm_rf(FILES) }

  def self.text(size)
    ('The quick brown fox jumps over the lazy dog. ' * (size / 45 + 1))[0, size]
  end

  def self.port
    @port ||= begin
      server = Chatty::GzipServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Chatty::MIME_TYPES,
                                      Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      server.mount('/answer', Answer)
      server.mount('/files', WEBrick::HTTPServlet::FileHandler, FILES, FancyIndexing: false)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  Response = Struct.new(:status, :headers, :body)

  # One request on its own connection. headers: { name => value }; [status, { lowercase name => value }, body bytes]
  def request(method, path, headers = {})
    sock = TCPSocket.new('127.0.0.1', self.class.port)
    head = ["#{method} #{path} HTTP/1.1", 'Host: 127.0.0.1', 'Connection: close']
    head << 'Content-Length: 0' if method == 'POST'
    headers.each { |k, v| head << "#{k}: #{v}" }
    sock.write(head.join("\r\n") + "\r\n\r\n")
    raw = sock.read.b
    top, body = raw.split("\r\n\r\n", 2)
    lines = top.split("\r\n")
    fields = lines[1..-1].map { |l| l.split(/:\s*/, 2) }.map { |k, v| [k.downcase, v] }.to_h
    Response.new(lines[0].split(' ')[1].to_i, fields, body.to_s)
  ensure
    sock.close if sock
  end

  def answer_path(size, type, extra = {})
    "/answer?#{URI.encode_www_form({ 'size' => size, 'type' => type }.merge(extra))}"
  end

  def with_gzip(headers = {})
    { 'Accept-Encoding' => 'gzip' }.merge(headers)
  end

  def assert_gzipped(res, expected)
    assert_equal 'gzip', res.headers['content-encoding']
    assert_equal res.body.bytesize.to_s, res.headers['content-length']
    assert_equal expected.b, Zlib.gunzip(res.body)
  end

  def assert_plain(res, expected)
    assert_nil res.headers['content-encoding']
    assert_equal expected.b, res.body
  end

  # A text file of size bytes in the file handler's folder; its path under /files/
  def static_file(size)
    name = "f-#{SecureRandom.hex(5)}.txt"
    File.write(File.join(FILES, name), GzipTest.text(size))
    @file = File.join(FILES, name)
    "/files/#{name}"
  end

  def file_bytes
    File.binread(@file)
  end

  scenario 'A large text response is gzipped for a client that accepts gzip' do
    path = res = nil
    step('Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8"') do
      path = answer_path(2000, 'text/plain; charset=utf-8')
    end
    step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
    step('Then the status is 200 with Content-Encoding "gzip" and Vary "Accept-Encoding"') do
      assert_equal 200, res.status
      assert_equal 'gzip', res.headers['content-encoding']
      assert_equal 'Accept-Encoding', res.headers['vary']
    end
    step('And the Content-Length is the length of the gzipped body') do
      assert_equal res.body.bytesize.to_s, res.headers['content-length']
      assert_operator res.body.bytesize, :<, 2000
    end
    step('And the body inflates to the 2,000 bytes') { assert_equal GzipTest.text(2000), Zlib.gunzip(res.body) }
  end

  scenario 'A client that does not say Accept-Encoding gets the plain body, with Vary' do
    path = res = nil
    step('Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8"') do
      path = answer_path(2000, 'text/plain; charset=utf-8')
    end
    step('When it is requested without Accept-Encoding') { res = request('GET', path) }
    step('Then the body is the 2,000 bytes, without Content-Encoding') do
      assert_equal 200, res.status
      assert_plain res, GzipTest.text(2000)
      assert_equal '2000', res.headers['content-length']
    end
    step('And Vary is "Accept-Encoding"') { assert_equal 'Accept-Encoding', res.headers['vary'] }
  end

  [['Cookie', 'Cookie, Accept-Encoding'], ['Cookie, accept-encoding', 'Cookie, accept-encoding'], ['*', '*']].each do |own, vary|
    scenario "A Vary the servlet set is kept (#{own})" do
      path = res = nil
      step(%(Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8" with Vary "#{own}")) do
        path = answer_path(2000, 'text/plain; charset=utf-8', 'vary' => own)
      end
      step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
      step(%(Then the body is gzipped and Vary is "#{vary}")) do
        assert_gzipped res, GzipTest.text(2000)
        assert_equal vary, res.headers['vary']
      end
    end
  end

  [
    ['gzip', true], ['GZIP', true], ['x-gzip', true], ['*', true], ['deflate, gzip;q=0.5', true],
    ['gzip;q=0.001', true], ['gzip ; Q=1', true], ['gzip;q=0', false], ['*;q=0', false], ['gzip;q=0, *', false],
    ['identity', false], ['br, deflate', false], ['', false]
  ].each do |header, gzipped|
    scenario "Accept-Encoding and its q-values decide whether the body is gzipped (\"#{header}\")" do
      path = res = nil
      step('Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8"') do
        path = answer_path(2000, 'text/plain; charset=utf-8')
      end
      step("When it is requested with Accept-Encoding \"#{header}\"") do
        res = request('GET', path, 'Accept-Encoding' => header)
      end
      step("Then the body is #{gzipped ? 'gzipped' : 'plain'}") do
        gzipped ? assert_gzipped(res, GzipTest.text(2000)) : assert_plain(res, GzipTest.text(2000))
      end
      step('And Vary is "Accept-Encoding"') { assert_equal 'Accept-Encoding', res.headers['vary'] }
    end
  end

  [
    ['text/html; charset=utf-8', true], ['text/css; charset=utf-8', true], ['text/javascript; charset=utf-8', true],
    ['application/json; charset=utf-8', true], ['application/javascript', true], ['image/svg+xml', true],
    ['image/png', false], ['application/octet-stream', false], ['application/wasm', false], ['application/xml', false]
  ].each do |type, gzipped|
    scenario "Only text-like types are gzipped (\"#{type}\")" do
      path = res = nil
      step("Given a servlet that answers 2,000 bytes of \"#{type}\"") { path = answer_path(2000, type) }
      step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
      step("Then the body is #{gzipped ? 'gzipped' : 'plain'}") do
        assert_equal type, res.headers['content-type']
        gzipped ? assert_gzipped(res, GzipTest.text(2000)) : assert_plain(res, GzipTest.text(2000))
      end
    end
  end

  scenario 'A response that is not gzipped for its type has no Vary' do
    path = res = nil
    step('Given a servlet that answers 2,000 bytes of "application/octet-stream"') do
      path = answer_path(2000, 'application/octet-stream')
    end
    step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
    step('Then the body is the 2,000 bytes, without Content-Encoding') { assert_plain res, GzipTest.text(2000) }
    step('And there is no Vary') { assert_nil res.headers['vary'] }
  end

  [['0', 0, false], ['1,023', 1023, false], ['1,024', 1024, true]].each do |label, size, gzipped|
    scenario "Bodies under 1,024 bytes are left alone (#{label})" do
      path = res = nil
      step("Given a servlet that answers #{label} bytes of \"text/plain; charset=utf-8\"") do
        path = answer_path(size, 'text/plain; charset=utf-8')
      end
      step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
      step("Then the body is #{gzipped ? 'gzipped' : 'plain'}") do
        assert_equal 200, res.status
        gzipped ? assert_gzipped(res, GzipTest.text(size)) : assert_plain(res, GzipTest.text(size))
      end
      step("And Vary is #{gzipped ? '"Accept-Encoding"' : 'not set'}") do
        gzipped ? assert_equal('Accept-Encoding', res.headers['vary']) : assert_nil(res.headers['vary'])
      end
    end
  end

  [['GET', 404], ['GET', 500], ['GET', 206], ['POST', 200], ['HEAD', 200]].each do |method, status|
    scenario "Only 200 responses to GET are gzipped (#{method}, #{status})" do
      path = res = nil
      step("Given a servlet that answers 2,000 bytes of \"text/plain; charset=utf-8\" with the status #{status}") do
        path = answer_path(2000, 'text/plain; charset=utf-8', 'status' => status)
      end
      step("When it is requested by #{method} with Accept-Encoding \"gzip\"") { res = request(method, path, with_gzip) }
      step("Then the status is #{status} without Content-Encoding") do
        assert_equal status, res.status
        assert_nil res.headers['content-encoding']
        assert_equal(method == 'HEAD' ? '' : GzipTest.text(2000), res.body)
      end
    end
  end

  scenario 'A body the servlet has encoded itself is left alone' do
    path = res = nil
    step('Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8" with Content-Encoding "br"') do
      path = answer_path(2000, 'text/plain; charset=utf-8', 'encoding' => 'br')
    end
    step('When it is requested with Accept-Encoding "gzip, br"') { res = request('GET', path, 'Accept-Encoding' => 'gzip, br') }
    step('Then the body is the 2,000 bytes with Content-Encoding "br"') do
      assert_equal 'br', res.headers['content-encoding']
      assert_equal GzipTest.text(2000), res.body
    end
    step('And there is no Vary') { assert_nil res.headers['vary'] }
  end

  scenario 'A static file is gzipped from the file, keeping its ETag' do
    path = res = nil
    step("Given a static file of 5,000 bytes of text served by WEBrick's file handler") { path = static_file(5000) }
    step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
    step('Then the body inflates to the bytes of the file, with Content-Encoding "gzip" and the Content-Length of the gzipped body') do
      assert_equal 200, res.status
      assert_gzipped res, file_bytes
      assert_equal 'Accept-Encoding', res.headers['vary']
    end
    step('And the ETag is that of the file, as without gzip') do
      refute_nil res.headers['etag']
      assert_equal request('GET', path).headers['etag'], res.headers['etag']
    end
  end

  scenario 'A small static file is left alone' do
    path = res = nil
    step("Given a static file of 100 bytes of text served by WEBrick's file handler") { path = static_file(100) }
    step('When it is requested with Accept-Encoding "gzip"') { res = request('GET', path, with_gzip) }
    step('Then the body is the bytes of the file, without Content-Encoding') do
      assert_equal 200, res.status
      assert_plain res, file_bytes
    end
  end

  scenario 'A part of a static file (206) is left alone' do
    path = res = nil
    step("Given a static file of 5,000 bytes of text served by WEBrick's file handler") { path = static_file(5000) }
    step('When the bytes 0-1999 of it are requested with Accept-Encoding "gzip"') do
      res = request('GET', path, with_gzip('Range' => 'bytes=0-1999'))
    end
    step('Then the status is 206 and the body is those 2,000 bytes, without Content-Encoding') do
      assert_equal 206, res.status
      assert_plain res, file_bytes[0, 2000]
    end
  end

  scenario 'A conditional GET of a static file still answers 304' do
    path = etag = res = nil
    step("Given a static file of 5,000 bytes of text served by WEBrick's file handler") { path = static_file(5000) }
    step('And its ETag from a request with Accept-Encoding "gzip"') do
      etag = request('GET', path, with_gzip).headers['etag']
      refute_nil etag
    end
    step('When it is requested with If-None-Match of that ETag and Accept-Encoding "gzip"') do
      res = request('GET', path, with_gzip('If-None-Match' => etag))
    end
    step('Then the status is 304 without a body or Content-Encoding') do
      assert_equal 304, res.status
      assert_equal '', res.body
      assert_nil res.headers['content-encoding']
    end
  end
end
