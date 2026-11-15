# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3029: the scenarios of docs/specs/LCTYSP-3029_request-guard.feature, written by hand. Each test has the title
# of its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so the
# two read side by side.
#
# The site is mounted at / of one WEBrick server on 127.0.0.1 (a free port) whose RequestCallback is a
# Chatty::RequestGuard; the guard's allowed origins are @origins, set by each test, and its log is @log. The requests
# are written on a socket of their own, so their headers are exactly the ones given.

require_relative 'helper'
require 'socket'
require 'stringio'
require File.expand_path('../../lcty.rb', __dir__)

class RequestGuardTest < Lcty::Scenarios
  class << self
    attr_accessor :origins, :log

    # The server of every test, started once
    def port
      @port ||= begin
        Lcty.open_data
        self.log = StringIO.new
        server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Lcty::Servlets::MIME_TYPES,
                                         Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
        guard = Chatty::RequestGuard.new(base: '/', origins: -> { origins }, listen: -> { [['127.0.0.1'], @port] },
                                         logger: WEBrick::Log.new(log, WEBrick::Log::WARN))
        server.config[:RequestCallback] = lambda do |req, res|
          res.keep_alive = false
          guard.check(req, res)
        end
        Lcty.mount_all(server, '/')
        Thread.new { server.start }
        Minitest.after_run { server.shutdown }
        server.config[:Port]
      end
    end
  end

  def setup
    @port = self.class.port
    self.class.origins = ["http://127.0.0.1:#{@port}"]
    self.class.log.truncate(0)
    self.class.log.rewind
  end

  def log
    self.class.log.string
  end

  # "<the port>" in a step's value is the port of the server
  def at_port(s)
    s.gsub('<the port>', @port.to_s)
  end

  # Send a request with exactly these header lines and body; [status, {lower-case name => value}, body]
  def raw(method, path, headers, body = nil)
    s = TCPSocket.new('127.0.0.1', @port)
    s.write("#{method} #{path} HTTP/1.1\r\n#{headers.map { |h| "#{h}\r\n" }.join}Connection: close\r\n\r\n#{body}")
    head, rest = s.read.split("\r\n\r\n", 2)
    lines = head.split("\r\n")
    fields = lines.drop(1).map { |l| l.split(': ', 2) }.to_h { |k, v| [k.downcase, v] }
    [lines[0].split[1].to_i, fields, rest.to_s]
  ensure
    s&.close
  end

  def host
    "Host: 127.0.0.1:#{@port}"
  end

  def search(headers, body = '{"q": "x"}', type: 'application/json')
    type_line = type ? ["Content-Type: #{type}"] : []
    raw('POST', '/v1/search', [host, *type_line, "Content-Length: #{body.bytesize}", *headers], body)
  end

  def assert_refused(r, status, text)
    assert_equal status, r[0], r.inspect
    assert_equal "#{text}\n", r[2]
  end

  # ---- Host ----

  ['"127.0.0.1:<the port>"', '"localhost:<the port>"', '"LOCALHOST:<the port>"'].each do |value|
    scenario "A Host the server is reached by is served (#{value})" do
      r = nil
      step("When GET /v1/defaults.json is sent with Host #{value}") do
        r = raw('GET', '/v1/defaults.json', ["Host: #{at_port(value.delete('"'))}"])
      end
      step('Then the status is 200') { assert_equal 200, r[0], r.inspect }
    end
  end

  ['"attacker.example"', '"127.0.0.1"', '"127.0.0.1:1"', '"192.168.0.10:<the port>"'].each do |value|
    scenario "Any other Host is answered 421 (#{value})" do
      r = nil
      h = nil
      step("When GET /v1/defaults.json is sent with Host #{value}") do
        h = at_port(value.delete('"'))
        r = raw('GET', '/v1/defaults.json', ["Host: #{h}"])
      end
      step('Then the status is 421 with the text "misdirected request"') { assert_refused r, 421, 'misdirected request' }
      step('And the log has a line that refused it, with the Host') do
        assert_includes log, %(refused GET "/v1/defaults.json" (421 misdirected request): Host #{h.inspect})
      end
    end
  end

  scenario 'The host of an allowed origin is served, with and without its default port' do
    rs = r = nil
    step('Given the allowed origins are "https://lcty.example" and "http://lcty.example:8080"') do
      self.class.origins = %w[https://lcty.example http://lcty.example:8080]
    end
    step('When GET /v1/defaults.json is sent with each Host "lcty.example", "lcty.example:443" and "lcty.example:8080"') do
      rs = %w[lcty.example lcty.example:443 lcty.example:8080].map { |h| raw('GET', '/v1/defaults.json', ["Host: #{h}"]) }
    end
    step('Then each status is 200') { assert_equal [200] * 3, rs.map(&:first) }
    step('When it is sent with Host "lcty.example:80"') { r = raw('GET', '/v1/defaults.json', ['Host: lcty.example:80']) }
    step('Then the status is 421 with the text "misdirected request"') { assert_refused r, 421, 'misdirected request' }
  end

  {
    'without Host' => -> { [] },
    'with Host "127.0.0.1:<the port>" twice' => -> { [host, host] }
  }.each do |label, headers|
    scenario "A request without one Host is answered 400 (#{label})" do
      r = nil
      step("When GET /v1/defaults.json is sent #{label}") { r = raw('GET', '/v1/defaults.json', instance_exec(&headers)) }
      step('Then the status is 400 with the text "a request needs one Host"') do
        assert_refused r, 400, 'a request needs one Host'
      end
    end
  end

  scenario 'The WebSocket of /v1/rpc is refused for another Host' do
    r = nil
    step('When the handshake of /v1/rpc is sent with Host "attacker.example"') do
      r = raw('GET', '/v1/rpc', ['Host: attacker.example', 'Upgrade: websocket', 'Connection: Upgrade',
                                 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13'])
    end
    step('Then the status is 421') { assert_equal 421, r[0] }
  end

  # ---- Preflights and writes ----

  scenario 'A preflight is answered 403 with no CORS header' do
    r = nil
    step('When OPTIONS /v1/search is sent with Origin "http://evil.example" and Access-Control-Request-Method "POST"') do
      r = raw('OPTIONS', '/v1/search', [host, 'Origin: http://evil.example', 'Access-Control-Request-Method: POST'])
    end
    step('Then the status is 403 with the text "preflight"') { assert_refused r, 403, 'preflight' }
    step('And the response has no Access-Control-* header') do
      assert_empty r[1].keys.grep(/\Aaccess-control-/)
    end
  end

  [
    ['Sec-Fetch-Site "cross-site"', ['Sec-Fetch-Site: cross-site'], 'its Sec-Fetch-Site', 'Sec-Fetch-Site "cross-site"'],
    ['Sec-Fetch-Site "same-site"', ['Sec-Fetch-Site: same-site'], 'its Sec-Fetch-Site', 'Sec-Fetch-Site "same-site"'],
    ['Sec-Fetch-Site "none"', ['Sec-Fetch-Site: none'], 'its Sec-Fetch-Site', 'Sec-Fetch-Site "none"'],
    ['Origin "http://evil.example"', ['Origin: http://evil.example'], 'its Origin and the allowed',
     'Origin "http://evil.example"; allowed: http://127.0.0.1:'],
    ['Sec-Fetch-Site "same-origin" and Origin "http://evil.example"',
     ['Sec-Fetch-Site: same-origin', 'Origin: http://evil.example'], 'its Origin and the allowed',
     'Origin "http://evil.example"; allowed: http://127.0.0.1:'],
    ['Origin "null"', ['Origin: null'], 'its Origin and the allowed', 'Origin "null"; allowed: http://127.0.0.1:']
  ].each do |label, headers, logged, line|
    scenario "A write from another origin is refused (#{label})" do
      r = nil
      step("When POST /v1/search is sent with a JSON body and #{label}") { r = search(headers) }
      step('Then the status is 403 with the text "cross-origin"') { assert_refused r, 403, 'cross-origin' }
      step("And the log has a line that refused it, with #{logged}") do
        assert_includes log, %(refused POST "/v1/search" (403 cross-origin): #{line})
      end
    end
  end

  [
    ['Sec-Fetch-Site "same-origin" and Origin "http://127.0.0.1:<the port>"',
     ->(port) { ['Sec-Fetch-Site: same-origin', "Origin: http://127.0.0.1:#{port}"] }],
    ['Origin "http://127.0.0.1:<the port>"', ->(port) { ["Origin: http://127.0.0.1:#{port}"] }],
    ['neither Sec-Fetch-Site nor Origin', ->(_) { [] }]
  ].each do |label, headers|
    scenario "A write from the server's own page, or with neither header, is served (#{label})" do
      r = nil
      step("When POST /v1/search is sent with a JSON body and #{label}") { r = search(headers.(@port)) }
      step('Then the status is 200') { assert_equal 200, r[0], r.inspect }
    end
  end

  scenario 'A read from another origin is not refused for its origin' do
    r = nil
    step('When GET /v1/defaults.json is sent with Sec-Fetch-Site "cross-site" and Origin "http://evil.example"') do
      r = raw('GET', '/v1/defaults.json', [host, 'Sec-Fetch-Site: cross-site', 'Origin: http://evil.example'])
    end
    step('Then the status is 200') { assert_equal 200, r[0] }
  end

  # ---- Bodies ----

  {
    'Content-Type "text/plain"' => 'text/plain',
    'Content-Type "application/x-www-form-urlencoded"' => 'application/x-www-form-urlencoded',
    'no Content-Type' => nil
  }.each do |label, type|
    scenario "A body of the JSON API that is not JSON is answered 415 (#{label})" do
      r = nil
      step(%(When POST /v1/search is sent with the body {"q": "x"} and #{label})) { r = search([], type: type) }
      step('Then the status is 415 with the text "the body must be application/json"') do
        assert_refused r, 415, 'the body must be application/json'
      end
    end
  end

  scenario 'A JSON body with a charset is served' do
    r = nil
    step('When POST /v1/search is sent with the body {"q": "x"} and Content-Type "application/json; charset=utf-8"') do
      r = search([], type: 'application/json; charset=utf-8')
    end
    step('Then the status is 200') { assert_equal 200, r[0], r.inspect }
  end

  scenario 'A body over 64 MiB is answered 413 before it is read' do
    r = nil
    step('When POST /v1/search is sent with Content-Length 67108865 and no body') do
      r = raw('POST', '/v1/search', [host, 'Content-Type: application/json', 'Content-Length: 67108865'])
    end
    step('Then the status is 413 with the text "too large"') { assert_refused r, 413, 'too large' }
  end

  # ---- The answer ----

  scenario 'A refusal is a short text that names no allowed host or origin' do
    r = nil
    step('When GET /v1/defaults.json is sent with Host "attacker.example"') do
      r = raw('GET', '/v1/defaults.json', ['Host: attacker.example'])
    end
    step('Then the response is text/plain; charset=utf-8') { assert_equal 'text/plain; charset=utf-8', r[1]['content-type'] }
    step('And its body is "misdirected request" and a line end, with no "127.0.0.1"') do
      assert_equal "misdirected request\n", r[2]
    end
  end

  scenario 'Lcty.listen puts the guard before authentication' do
    port = r = nil
    step('Given a server of Lcty.listen with --basic-auth, on 127.0.0.1') do
      @port_before = Chatty.port
      auth = Lcty.basic_auth({ 'alice' => Chatty::Password.create('a long enough secret') }, htdigest: '/nonexistent', fail_delay: 0)
      free = TCPServer.new('127.0.0.1', 0)
      free_port = free.addr[1]
      free.close
      @listener = Lcty.listen(free_port, [], ['127.0.0.1'], auth: auth)
      Lcty.mount_all(@listener)
      Thread.new { @listener.start }
      sleep 0.05 until @listener.status == :Running
      port = @listener.config[:Port]
    end
    step('When GET / is sent with Host "attacker.example" and no credentials') do
      s = TCPSocket.new('127.0.0.1', port)
      s.write("GET / HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\n\r\n")
      r = s.read.split("\r\n")[0].split[1].to_i
      s.close
    end
    step('Then the status is 421, not 401') { assert_equal 421, r }
  ensure
    @listener&.shutdown
    Chatty.port = @port_before if @port_before
  end
end
