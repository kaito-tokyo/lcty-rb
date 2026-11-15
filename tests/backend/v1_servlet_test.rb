# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3012: the scenarios of docs/specs/LCTYSP-3012_http-api.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so the two
# read side by side.
#
# The servlet is mounted at /v1 of a WEBrick server on 127.0.0.1 (a free port), as Chatty.run mounts it, and requested
# over HTTP. The data directory is shared by every test of the process, so the conversations, tag names, words and
# models of each test get a random suffix (the tag "pick" is "pick-<hex>", …).

require_relative 'helper'
require 'net/http'
require 'json'
require 'socket'
require 'securerandom'
require 'time'
require 'v1/servlet'

class V1ServletTest < Lcty::Scenarios
  Uuid = Chatty::Uuid

  # The port of the server, started at the first request and shut down when the tests have run.
  def self.port
    @port ||= begin
      Lcty.open_data
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, Logger: WEBrick::Log.new(File::NULL),
                                       AccessLog: [], DoNotReverseLookup: true)
      server.mount('/v1', Chatty::V1::Servlet)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  # An `at` after that of every other round (rounds are ordered by `at` as a string), later at every call.
  def self.next_at
    @at_n = (@at_n || 0) + 1
    format('9999-12-31T23:59:59.%012dZ', @at_n)
  end

  Response = Struct.new(:status, :header, :raw) do
    def json
      JSON.parse(raw.to_s.dup.force_encoding(Encoding::UTF_8))
    end
  end

  # body: a String is sent as it is, anything else as JSON
  def http(method, path, body = nil, headers = {})
    req = Net::HTTP.const_get(method.capitalize).new(path, headers)
    unless body.nil?
      req.body = body.is_a?(String) ? body : JSON.generate(body)
      req['content-type'] ||= 'application/json'
    end
    res = Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(req) }
    Response.new(res.code.to_i, res, res.body)
  end

  # A request written by hand; [status, body]
  def raw_request(text)
    sock = TCPSocket.new('127.0.0.1', self.class.port)
    sock.write(text)
    head, body = sock.read.split("\r\n\r\n", 2)
    [head.lines.first.split(' ')[1].to_i, body]
  ensure
    sock.close if sock
  end

  def assert_error(res, status, message)
    assert_equal status, res.status, res.raw
    assert_equal 'application/json; charset=utf-8', res.header['content-type']
    assert_equal({ 'error' => message }, res.json)
  end

  def hex
    SecureRandom.hex(5)
  end

  def new_id
    "v1t-#{hex}"
  end

  # Letters only, so its trigrams are unlikely in any other round
  def unique_word
    "qz#{SecureRandom.hex(5).tr('0-9', 'ghijkmnprs')}"
  end

  # One model for every test: the vector DB ATTACHes a database per model and never detaches it, and SQLite allows only
  # 10 of them per connection
  MODEL = "test-3012-#{SecureRandom.hex(4)}".freeze

  def new_model
    MODEL
  end

  def path_escape(s)
    s.bytes.map { |b| format('%%%02X', b) }.join
  end

  def user(content, extra = {})
    { 'type' => 'message', 'id' => Uuid.v7, 'role' => 'user', 'content' => content }.merge(extra)
  end

  def assistant(content, extra = {})
    { 'type' => 'message', 'id' => Uuid.v7, 'role' => 'assistant', 'content' => content, 'at' => self.class.next_at }.merge(extra)
  end

  # A conversation file of LCTYSP-0003 in c/, added to the search index as at startup; returns its id
  def create(lines = [], tags = [], id = new_id)
    self.class.port
    meta = { 'type' => 'meta', 'id' => id, 'created_at' => '2026-11-07T00:00:00Z', 'tags' => tags }
    path = Chatty::Store.conv_path(id)
    Chatty::Store.write_atomic(path, Chatty::ConvHtml.document([meta] + lines))
    Chatty::INDEX.sync(id, *Chatty::Store.index_state(path))
    id
  end

  def conv_file(id)
    File.binread(Chatty::Store.conv_path(id))
  end

  def search(body)
    res = http('POST', '/v1/search', body)
    assert_equal 200, res.status, res.raw
    res.json['results']
  end

  scenario 'The defaults of the browser settings' do
    res = nil
    step('When GET /v1/defaults.json is requested') { res = http('GET', '/v1/defaults.json') }
    step('Then the status is 200 and the body is JSON') do
      assert_equal 200, res.status
      assert_equal 'application/json; charset=utf-8', res.header['content-type']
      assert_kind_of Hash, res.json
    end
    step('And it has the base_url "http://127.0.0.1:9931" and the model "gemma-4-26b-a4b-it", and no embedding_model') do
      assert_equal 'http://127.0.0.1:9931', res.json['base_url']
      assert_equal 'gemma-4-26b-a4b-it', res.json['model']
      refute res.json.key?('embedding_model')
    end
    step('And its api_key is the host name and the user joined by "-"') do
      assert_equal "#{Socket.gethostname}-#{ENV['USER']}", res.json['api_key']
    end
  end

  scenario 'A conversation is listed with its title, messages and tags' do
    id = list = nil
    tag = "t-#{hex}"
    own = user('hi')
    step('Given a conversation with the title "Hello", the tag "t", an inherited user message, a user message and an assistant message') do
      id = create([{ 'type' => 'title', 'title' => 'Hello' }, user('old', 'inherited' => true), own, assistant('hello')], [tag])
    end
    step('When GET /v1/conversations is requested') { list = http('GET', '/v1/conversations').json }
    entry = nil
    step('Then it lists the conversation with the title "Hello", 3 messages and the tags ["t"]') do
      entry = list.find { |c| c['id'] == id }
      assert entry, 'listed'
      assert_equal 'Hello', entry['title']
      assert_equal '2026-11-07T00:00:00Z', entry['created_at']
      assert_equal 3, entry['messages']
      assert_equal [tag], entry['tags']
    end
    step('And its message_ids are only the id of its own user message') { assert_equal [own['id']], entry['message_ids'] }
  end

  scenario 'A conversation is read as its meta, title, tags and messages' do
    id = res = nil
    tag = "t-#{hex}"
    step('Given a conversation with the title "Greeting" whose assistant message has content_html') do
      id = create([{ 'type' => 'title', 'title' => 'Greeting' }, user('hi'),
                   assistant('**hello**', 'content_html' => '<p><strong>hello</strong></p>')], [tag])
    end
    step('When GET /v1/conversations/<id> is requested') { res = http('GET', "/v1/conversations/#{id}") }
    step('Then the body has its meta, the title "Greeting", its tags and its 2 messages') do
      assert_equal 200, res.status
      body = res.json
      assert_equal %w[messages meta tags title], body.keys.sort
      assert_equal id, body['meta']['id']
      assert_equal '2026-11-07T00:00:00Z', body['meta']['created_at']
      assert_equal 'Greeting', body['title']
      assert_equal [tag], body['tags']
      assert_equal %w[user assistant], body['messages'].map { |m| m['role'] }
      assert_equal %w[hi **hello**], body['messages'].map { |m| m['content'] }
    end
    step('And the messages have neither type nor content_html') do
      res.json['messages'].each do |m|
        refute m.key?('type'), m.inspect
        refute m.key?('content_html'), m.inspect
      end
      refute res.json['meta'].key?('type')
    end
  end

  scenario 'A body that is not JSON is rejected' do
    res = nil
    step('When POST /v1/search sends "{not json"') { res = http('POST', '/v1/search', '{not json') }
    step('Then the status is 400 with an error that starts with "invalid JSON: "') do
      assert_equal 400, res.status
      assert res.json['error'].start_with?('invalid JSON: '), res.json['error']
    end
  end

  scenario 'A body that is not UTF-8 is rejected' do
    res = nil
    step('When POST /v1/search sends the bytes of a JSON string with the byte 0xff in it') do
      res = http('POST', '/v1/search', "{\"q\": \"\xFF\"}".b)
    end
    step('Then the status is 400 with the error "invalid UTF-8"') { assert_error res, 400, 'invalid UTF-8' }
  end

  scenario 'A body over 64 MiB is rejected before it is read' do
    status = body = nil
    step('When a POST to /v1/search says its Content-Length is 64 MiB and one byte, and sends no body') do
      status, body = raw_request("POST /v1/search HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n" \
                                 "Content-Length: #{64 * 1024 * 1024 + 1}\r\nConnection: close\r\n\r\n")
    end
    step('Then the status is 413 with the error "too large"') do
      assert_equal 413, status
      assert_equal({ 'error' => 'too large' }, JSON.parse(body))
    end
  end

  [
    ['GET /v1/conversations/<unknown id>', 404, '"not found"', 'not found',
     ->(unknown) { http('GET', "/v1/conversations/#{unknown}") }],
    ['GET /v1/conversations/a.b', 400, '"invalid id"', 'invalid id', ->(_) { http('GET', '/v1/conversations/a.b') }]
  ].each do |request, status, error_label, message, send|
    scenario "An unknown or invalid conversation id (#{request})" do
      res = nil
      step("When #{request} is requested") { res = instance_exec(new_id, &send) }
      step("Then the status is #{status} with the error #{error_label}") { assert_error res, status, message }
    end
  end

  [
    ['POST /v1/conversations', 404, ->(id) { http('POST', '/v1/conversations', 'meta' => { 'id' => id }, 'lines' => []) }],
    ['POST /v1/conversations/<id>/lines', 404, ->(id) { http('POST', "/v1/conversations/#{id}/lines", [user('x')]) }],
    ['POST /v1/conversations/<id>/pop', 404, ->(id) { http('POST', "/v1/conversations/#{id}/pop", 'from' => 0) }],
    ['DELETE /v1/conversations/<id>', 405, ->(id) { http('DELETE', "/v1/conversations/#{id}") }]
  ].each do |request, status, send|
    scenario "The writes of conversations are gone (#{request})" do
      id = before = res = nil
      step('Given a conversation with a user and an assistant message') do
        id = create([user('hi'), assistant('hello')])
        before = conv_file(id)
      end
      step("When #{request} is requested") { res = instance_exec(id, &send) }
      step("Then the status is #{status}") { assert_equal status, res.status, res.raw }
      step('And the conversation file is unchanged') { assert_equal before, conv_file(id) }
    end
  end

  scenario 'GET /v1/meta-all.json is no longer served' do
    res = nil
    step('Given a conversation') { create([user('hi')]) }
    step('When GET /v1/meta-all.json is requested') { res = http('GET', '/v1/meta-all.json') }
    step('Then the status is 404 with the error "no such endpoint"') { assert_error res, 404, 'no such endpoint' }
  end

  scenario 'Keyword search finds rounds and can be limited to tags' do
    word = unique_word
    pick = "pick-#{hex}"
    a = user("first #{word} round")
    b = user("second #{word} round")
    ids = {}
    results = nil
    step('Given two conversations with a round with the same unique word, only one of them with the tag "pick"') do
      ids[a['id']] = create([a, assistant('ok')], [pick])
      ids[b['id']] = create([b, assistant('ok')])
    end
    step('When POST /v1/search searches for the word') { results = search('q' => word) }
    step('Then the results include both rounds with their conversation ids and snippets with the word') do
      [a, b].each do |m|
        r = results.find { |x| x['id'] == m['id'] }
        assert r, "#{m['content']} is found"
        assert_equal ids[m['id']], r['conv_id']
        assert_includes r['snippet'], word
      end
    end
    step('When POST /v1/search searches for the word with the tags ["pick"]') { results = search('q' => word, 'tags' => [pick]) }
    step('Then the result is only the round of the conversation with the tag "pick"') do
      assert_equal [a['id']], results.map { |r| r['id'] }
    end
  end

  scenario 'The search limit is kept between 1 and 200' do
    word = unique_word
    lim = "lim-#{hex}"
    step('Given three conversations with the tag "lim", each with a round with the same unique word') do
      3.times { |i| create([user("#{word} #{i}"), assistant('ok')], [lim]) }
    end
    step('Then POST /v1/search for the word with the tags ["lim"] and the limit 2 returns 2 results') do
      assert_equal 2, search('q' => word, 'tags' => [lim], 'limit' => 2).size
    end
    step('And with the limit 0 it returns 1 result') do
      assert_equal 1, search('q' => word, 'tags' => [lim], 'limit' => 0).size
    end
    step('And with the limit 1000 it returns all 3') do
      assert_equal 3, search('q' => word, 'tags' => [lim], 'limit' => 1000).size
    end
  end

  scenario 'A search body that is not an object is rejected' do
    res = nil
    step('When POST /v1/search sends an array') { res = http('POST', '/v1/search', []) }
    step('Then the status is 400 with the error "body must be an object"') { assert_error res, 400, 'body must be an object' }
  end

  { '"10"' => '10', '[]' => [], 'true' => true }.each do |label, limit|
    scenario "A search limit that is not a number is rejected (#{label})" do
      res = nil
      step("When POST /v1/search sends a word with the limit #{label}") do
        res = http('POST', '/v1/search', 'q' => unique_word, 'limit' => limit)
      end
      step('Then the status is 400 with the error "limit must be a number"') do
        assert_error res, 400, 'limit must be a number'
      end
    end
  end

  scenario 'Snippets of rounds by id' do
    word = unique_word
    round = user("a long question about #{word}")
    id = body = nil
    unknown = Uuid.v7
    step('Given a round with a unique word') { id = create([round, assistant('ok')]) }
    step('When POST /v1/snippets sends its id and an unknown id with the word as q') do
      res = http('POST', '/v1/snippets', 'ids' => [round['id'], unknown], 'q' => word)
      assert_equal 200, res.status
      body = res.json
    end
    step('Then the body maps its id to its conversation id and a snippet with the word') do
      assert_equal id, body[round['id']]['conv_id']
      assert_includes body[round['id']]['snippet'], word
    end
    step('And the unknown id is left out') { assert_equal [round['id']], body.keys }
  end

  scenario 'Snippets need a list of ids' do
    res = nil
    step('When POST /v1/snippets sends {"q": "x"}') { res = http('POST', '/v1/snippets', 'q' => 'x') }
    step('Then the status is 400 with the error "body must be {\"ids\": [...]}"') do
      assert_error res, 400, 'body must be {"ids": [...]}'
    end
  end

  [
    ['GET /v1/nope', ->() { http('GET', '/v1/nope') }],
    ['GET /v1/vectors/pending', ->() { http('GET', '/v1/vectors/pending?model=embeddinggemma-2') }],
    ['GET /v1/tags', ->() { http('GET', '/v1/tags') }],
    ['POST /v1/tags/00010-a.html/memory', ->() { http('POST', '/v1/tags/00010-a.html/memory', 'text' => 'x') }],
    ['GET /v1/tags/a/memory', ->() { http('GET', '/v1/tags/a/memory') }],
    ['GET /v1/conversations/a/lines', ->() { http('GET', '/v1/conversations/a/lines') }]
  ].each do |request, send|
    scenario "An unknown endpoint is 404 (#{request})" do
      res = nil
      step("When #{request} is requested") { res = instance_exec(&send) }
      step('Then the status is 404 with the error "no such endpoint"') { assert_error res, 404, 'no such endpoint' }
    end
  end

  [
    ['PUT /v1/vectors', ->() { http('PUT', '/v1/vectors?model=embeddinggemma-2', 'x', 'content-type' => 'application/octet-stream') }],
    ['DELETE /v1/defaults.json', ->() { http('DELETE', '/v1/defaults.json') }],
    ['PATCH /v1/conversations', ->() { http('PATCH', '/v1/conversations', {}) }],
    ['PUT /v1/tags', ->() { http('PUT', '/v1/tags', { 'tags' => [] }, 'if-match' => '*') }],
    ['PATCH /v1/tags/a/memory/b', ->() { http('PATCH', '/v1/tags/a/memory/b', 'text' => 'x') }],
    ['DELETE /v1/tags/a/memory/b', ->() { http('DELETE', '/v1/tags/a/memory/b') }]
  ].each do |request, send|
    scenario "A method other than GET and POST is not allowed (#{request})" do
      res = nil
      step("When #{request} is requested") { res = instance_exec(&send) }
      step('Then the status is 405') { assert_equal 405, res.status, res.raw }
    end
  end

  scenario 'A path that is not UTF-8 is rejected' do
    res = nil
    step('When GET /v1/conversations/%FF is requested') { res = http('GET', '/v1/conversations/%FF') }
    step('Then the status is 400 with the error "invalid path encoding"') { assert_error res, 400, 'invalid path encoding' }
  end
end
