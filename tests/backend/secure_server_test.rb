# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3030: the scenarios of docs/specs/LCTYSP-3030_secure-server.feature, written by hand. Each test has the title
# of its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so the
# two read side by side.
#
# One server of Lcty.listen on 127.0.0.1 (a free port) serves the site for every test, with a conversation file and the
# tag file ruby.html of its own in the tests' data directory (helper.rb) and /probe mounted as a proc that answers text/plain
# without a charset. Requests go through Net::HTTP, whose Host is 127.0.0.1:<port>.

require_relative 'helper'
require 'json'
require 'net/http'
require 'socket'
require File.expand_path('../../lcty.rb', __dir__)

class SecureServerTest < Lcty::Scenarios
  CONV = "hdr-#{Process.pid}"
  TAG_FILE = 'ruby.html'

  def self.port
    @port ||= begin
      Lcty.open_data
      FileUtils.mkdir_p(Chatty::CONV_DIR)
      File.write(File.join(Chatty::CONV_DIR, "#{CONV}.html"), "<!DOCTYPE html>\n")
      FileUtils.mkdir_p(Chatty::TAG_DIR)
      File.write(File.join(Chatty::TAG_DIR, TAG_FILE), "<!DOCTYPE html>\n")
      free = TCPServer.new('127.0.0.1', 0)
      port = free.addr[1]
      free.close
      server = Lcty.listen(port, [], ['127.0.0.1'])
      Lcty.mount_all(server)
      server.mount_proc('/probe') do |_req, res|
        res['Content-Type'] = 'text/plain'
        res.body = 'x'
      end
      Thread.new { server.start }
      sleep 0.05 until server.status == :Running
      Minitest.after_run { server.shutdown }
      port
    end
  end

  def request(method, path, headers = {})
    port = self.class.port
    Net::HTTP.start('127.0.0.1', port) do |h|
      req = Net::HTTPGenericRequest.new(method, method == 'POST', method != 'HEAD', path, headers)
      req.body = '' if method == 'POST'
      h.request(req)
    end
  end

  # "GET /path" or "POST /path" of a step
  def send_line(line)
    method, path = line.split(' ', 2)
    request(method, path)
  end

  def path_of(value)
    value.sub('<the conversation>', CONV).sub('<the tag file>', TAG_FILE)
  end

  OTHER = "default-src 'none'; frame-ancestors 'none'"

  scenario 'A page gets the page policy and every common header' do
    res = nil
    step('When GET /c/ is requested') { res = request('GET', '/c/') }
    step(%(Then Content-Security-Policy is "#{Chatty::PAGE_CSP}")) do
      assert_equal "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self'; " \
                   "connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; form-action 'self'; " \
                   "frame-ancestors 'none'", res['content-security-policy']
    end
    step('And X-Content-Type-Options is "nosniff", X-Frame-Options "DENY" and Referrer-Policy "no-referrer"') do
      assert_equal %w[nosniff DENY no-referrer], res.to_hash.values_at('x-content-type-options', 'x-frame-options',
                                                                       'referrer-policy').map(&:first)
    end
    step('And Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy are "same-origin", Cross-Origin-Embedder-Policy "require-corp"') do
      assert_equal %w[same-origin same-origin require-corp],
                   %w[cross-origin-opener-policy cross-origin-resource-policy cross-origin-embedder-policy].map { |h| res[h] }
    end
    step('And Permissions-Policy turns every feature off but "sync-xhr=(self)"') do
      features = res['permissions-policy'].split(', ')
      assert_equal ['sync-xhr=(self)'], features.reject { |f| f.end_with?('=()') }
      assert_includes features, 'camera=()'
    end
    step('And X-Permitted-Cross-Domain-Policies is "none", X-DNS-Prefetch-Control "off" and X-Robots-Tag "noindex, nofollow"') do
      assert_equal ['none', 'off', 'noindex, nofollow'],
                   %w[x-permitted-cross-domain-policies x-dns-prefetch-control x-robots-tag].map { |h| res[h] }
    end
  end

  ['GET /fuzzy_search.worker.js', 'GET /lcty.v1/lcty.v1.cjs'].each do |line|
    scenario "A script gets the policy a worker runs under (#{line})" do
      res = nil
      step("When #{line} is requested") { res = send_line(line) }
      step(%(Then Content-Security-Policy is "#{Chatty::SCRIPT_CSP}")) do
        assert_equal "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'",
                     res['content-security-policy']
      end
    end
  end

  [
    ['GET /c/', 'text/html; charset=utf-8', Chatty::PAGE_CSP],
    ['GET /lcty.v1/lcty.v1.cjs', 'text/javascript; charset=utf-8', Chatty::SCRIPT_CSP]
  ].each do |line, type, csp|
    scenario "A 304 of a page or a script keeps the policy of its type (#{line})" do
      method, path = line.split(' ', 2)
      etag = res = nil
      step("Given the ETag of #{line}") { etag = request(method, path)['etag'] }
      step("When #{line} is requested with If-None-Match of that ETag") do
        res = request(method, path, 'If-None-Match' => etag)
      end
      step(%(Then the status is 304 with the type "#{type}")) { assert_equal ['304', type], [res.code, res['content-type']] }
      step(%(And Content-Security-Policy is the policy of "#{type}")) { assert_equal csp, res['content-security-policy'] }
    end
  end

  ['GET /v1/defaults.json', 'GET /lcty.v1/lcty.v1.css', 'GET /nope'].each do |line|
    scenario "A response that is neither a page nor a script gets the short policy (#{line})" do
      res = nil
      step("When #{line} is requested") { res = send_line(line) }
      step(%(Then Content-Security-Policy is "#{OTHER}")) { assert_equal OTHER, res['content-security-policy'] }
      step('And X-Content-Type-Options is "nosniff"') { assert_equal 'nosniff', res['x-content-type-options'] }
    end
  end

  [
    ['/v1/defaults.json', 'private, no-cache'],
    ['/c/<the conversation>.html', 'private, no-cache'],
    ['/t/ruby.html', 'private, no-cache'],
    ['/c/', 'no-cache'],
    ['/t/index.html', 'no-cache'],
    ['/lcty.v1/lcty.v1.cjs', 'no-cache'],
    ['/js/site.js', 'no-cache']
  ].each do |path, cache|
    scenario "The user's data is kept out of shared caches, and the code is not (#{path})" do
      res = nil
      step("When GET #{path} is requested") { res = request('GET', path_of(path)) }
      step(%(Then Cache-Control is "#{cache}")) do
        assert_equal '200', res.code, res.body
        assert_equal cache, res['cache-control']
      end
    end
  end

  ['GET /c/', 'GET /nope', 'POST /v1/rpc'].each do |line|
    scenario "No response says what server it is (#{line})" do
      res = nil
      step("When #{line} is requested") { res = send_line(line) }
      step('Then the response has no Server header') { assert_nil res['server'] }
    end
  end

  scenario 'An error WEBrick makes is a short text in UTF-8' do
    res = nil
    step('When GET /nope is requested') { res = request('GET', '/nope') }
    step('Then the status is 404, the type "text/plain; charset=utf-8" and the body "404 Not Found" and a line end') do
      assert_equal ['404', 'text/plain; charset=utf-8', "404 Not Found\n"], [res.code, res['content-type'], res.body]
    end
  end

  scenario 'An error WEBrick makes under /v1/ is JSON' do
    res = nil
    step('When POST /v1/rpc is requested') { res = request('POST', '/v1/rpc') }
    step('Then the status is 405, the type "application/json; charset=utf-8" and the body {"error": "method not allowed"}') do
      assert_equal ['405', 'application/json; charset=utf-8'], [res.code, res['content-type']]
      assert_equal({ 'error' => 'method not allowed' }, JSON.parse(res.body))
    end
  end

  scenario 'A text type without a charset gets charset=utf-8' do
    res = nil
    step('When GET /probe is requested') { res = request('GET', '/probe') }
    step('Then Content-Type is "text/plain; charset=utf-8"') { assert_equal 'text/plain; charset=utf-8', res['content-type'] }
  end

  scenario 'A refusal of the request guard gets the headers too' do
    res = nil
    step('When GET /c/ is requested with Host "attacker.example"') { res = request('GET', '/c/', 'Host' => 'attacker.example') }
    step('Then the status is 421') { assert_equal '421', res.code }
    step(%(And Content-Security-Policy is "#{OTHER}" and X-Content-Type-Options "nosniff")) do
      assert_equal [OTHER, 'nosniff'], [res['content-security-policy'], res['x-content-type-options']]
    end
  end
end
