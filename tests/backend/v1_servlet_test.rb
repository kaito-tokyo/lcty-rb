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
  Records = Chatty::V1::VectorRecords
  DIM = Chatty::V1::VectorDB::DIM

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

  def assert_ok(res, status = 200)
    assert_equal status, res.status, res.raw
    assert_equal({ 'ok' => true }, res.json)
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

  def create(lines = [], tags = [], id = new_id)
    res = http('POST', '/v1/conversations',
               'meta' => { 'id' => id, 'created_at' => '2026-11-07T00:00:00Z', 'tags' => tags }, 'lines' => lines)
    assert_equal 201, res.status, res.raw
    id
  end

  def conv(id)
    res = http('GET', "/v1/conversations/#{id}")
    assert_equal 200, res.status, res.raw
    res.json
  end

  def conv_file(id)
    File.binread(Chatty::Store.conv_path(id))
  end

  def four_messages
    create([user('one'), assistant('two'), user('three'), assistant('four')])
  end

  def search(body)
    res = http('POST', '/v1/search', body)
    assert_equal 200, res.status, res.raw
    res.json['results']
  end

  def tag_defs
    res = http('GET', '/v1/tags')
    assert_equal 200, res.status, res.raw
    res.json['tags']
  end

  # Add a tag definition (keeping every other one, which other tests may own)
  def add_tag(name, memory = [])
    assert_ok http('PUT', '/v1/tags', 'tags' => tag_defs + [{ 'name' => name, 'prompt' => nil, 'memory' => memory }])
  end

  def pending(model, limit = nil)
    res = http('GET', "/v1/vectors/pending?model=#{model}#{limit ? "&limit=#{limit}" : ''}")
    assert_equal 200, res.status, res.raw
    res.json
  end

  # A conversation with one round, waiting for embeddings with a model: [round id, model, rev]
  def pending_round
    u = user("#{unique_word} question")
    create([u, assistant('answer')])
    model = new_model
    entry = pending(model).find { |p| p['id'] == u['id'] }
    assert entry, 'the round is pending'
    [u['id'], model, entry['rev']]
  end

  # A 768-dimension vector of length 1 with 1.0 at k
  def unit_vector(k = 0)
    Array.new(DIM) { |i| i == k ? 1.0 : 0.0 }.pack('e*')
  end

  def vector_query(model, revs, count, overrides = {})
    q = { 'model' => model, 'magic' => 'lctyvLE0', 'size' => (DIM * 4).to_s, 'entry_count' => count.to_s,
          'rev' => revs.map { |id, rev| "#{id}:#{rev}" }.join(',') }.merge(overrides)
    q.reject { |_, v| v.nil? }.map { |k, v| "#{k}=#{v}" }.join('&')
  end

  def put_vectors(query, body)
    http('PUT', "/v1/vectors?#{query}", body, 'content-type' => 'application/octet-stream')
  end

  scenario 'The defaults of the browser settings' do
    res = nil
    step('When GET /v1/defaults.json is requested') { res = http('GET', '/v1/defaults.json') }
    step('Then the status is 200 and the body is JSON') do
      assert_equal 200, res.status
      assert_equal 'application/json; charset=utf-8', res.header['content-type']
      assert_kind_of Hash, res.json
    end
    step('And it has the base_url "http://127.0.0.1:9931", the model "gemma-4-26b-a4b-it" and the embedding_model "embeddinggemma-2"') do
      assert_equal 'http://127.0.0.1:9931', res.json['base_url']
      assert_equal 'gemma-4-26b-a4b-it', res.json['model']
      assert_equal 'embeddinggemma-2', res.json['embedding_model']
    end
    step('And its api_key is the host name and the user joined by "-"') do
      assert_equal "#{Socket.gethostname}-#{ENV['USER']}", res.json['api_key']
    end
  end

  scenario 'A new conversation is created and listed' do
    id = new_id
    tag = "t-#{hex}"
    own = user('hi')
    res = nil
    step('When POST /v1/conversations creates a conversation with the title "Hello", the tag "t", an inherited user message, a user message and an assistant message') do
      lines = [{ 'type' => 'title', 'title' => 'Hello' }, user('old', 'inherited' => true), own, assistant('hello')]
      res = http('POST', '/v1/conversations',
                 'meta' => { 'id' => id, 'created_at' => '2026-11-07T00:00:00Z', 'tags' => [tag] }, 'lines' => lines)
    end
    step('Then the status is 201 and the body is {"ok": true}') { assert_ok res, 201 }
    entry = nil
    step('And GET /v1/conversations lists it with the title "Hello", 3 messages and the tags ["t"]') do
      list = http('GET', '/v1/conversations').json
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

  [
    ['an array', '"body must be an object"', -> { [] }, 'body must be an object'],
    ['no meta', '"meta must be an object"', -> { { 'lines' => [] } }, 'meta must be an object'],
    ['a meta without an id', '"invalid id"', -> { { 'meta' => {} } }, 'invalid id'],
    ['an id with a space', '"invalid id"', -> { { 'meta' => { 'id' => 'a b' } } }, 'invalid id'],
    ['tags that are not unique', '"tags must be an array of unique tag names"',
     -> { { 'meta' => { 'id' => new_id, 'tags' => %w[x x] } } }, 'tags must be an array of unique tag names'],
    ['a tags line', '"line type not allowed: \"tags\""',
     -> { { 'meta' => { 'id' => new_id }, 'lines' => [{ 'type' => 'tags', 'tags' => [] }] } }, 'line type not allowed: "tags"'],
    ['a message id that is not a UUIDv7', '"message id must be a UUIDv7: \"abc\""',
     -> { { 'meta' => { 'id' => new_id }, 'lines' => [user('x', 'id' => 'abc')] } }, 'message id must be a UUIDv7: "abc"'],
    ['a command that is not a command name', '"invalid command: \"Send!\""',
     -> { { 'meta' => { 'id' => new_id }, 'lines' => [{ 'type' => 'cmd', 'op' => 'Send!' }] } }, 'invalid command: "Send!"']
  ].each do |label, error_label, body, message|
    scenario "A conversation that cannot be created is rejected with 400 (#{label})" do
      res = nil
      sent = instance_exec(&body)
      step("When POST /v1/conversations sends #{label}") { res = http('POST', '/v1/conversations', sent) }
      step("Then the status is 400 with the error #{error_label}") do
        assert_error res, 400, message
        id = sent.is_a?(Hash) && sent['meta'].is_a?(Hash) && sent['meta']['id']
        refute File.exist?(File.join(Chatty::CONV_DIR, "#{id}.html")), 'nothing is written' if id
      end
    end
  end

  scenario 'Creating a conversation whose id exists is a conflict' do
    id = before = res = nil
    step('Given a conversation') do
      id = create([user('first')])
      before = conv_file(id)
    end
    step('When POST /v1/conversations creates another one with the same id') do
      res = http('POST', '/v1/conversations', 'meta' => { 'id' => id }, 'lines' => [user('second')])
    end
    step('Then the status is 409 with the error "already exists"') { assert_error res, 409, 'already exists' }
    step('And the conversation file is unchanged') { assert_equal before, conv_file(id) }
  end

  scenario 'A body that is not JSON is rejected' do
    res = nil
    step('When POST /v1/conversations sends "{not json"') { res = http('POST', '/v1/conversations', '{not json') }
    step('Then the status is 400 with an error that starts with "invalid JSON: "') do
      assert_equal 400, res.status
      assert res.json['error'].start_with?('invalid JSON: '), res.json['error']
    end
  end

  scenario 'A body that is not UTF-8 is rejected' do
    res = nil
    step('When POST /v1/conversations sends the bytes of a JSON string with the byte 0xff in it') do
      res = http('POST', '/v1/conversations', "{\"meta\": \"\xFF\"}".b)
    end
    step('Then the status is 400 with the error "invalid UTF-8"') { assert_error res, 400, 'invalid UTF-8' }
  end

  scenario 'A body over 64 MiB is rejected before it is read' do
    status = body = nil
    step('When a POST to /v1/conversations says its Content-Length is 64 MiB and one byte, and sends no body') do
      status, body = raw_request("POST /v1/conversations HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n" \
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
    ['GET /v1/conversations/a.b', 400, '"invalid id"', 'invalid id', ->(_) { http('GET', '/v1/conversations/a.b') }],
    ['POST /v1/conversations/<unknown id>/lines', 404, '"not found"', 'not found',
     ->(unknown) { http('POST', "/v1/conversations/#{unknown}/lines", [user('x')]) }],
    ['POST /v1/conversations/<unknown id>/pop', 404, '"not found"', 'not found',
     ->(unknown) { http('POST', "/v1/conversations/#{unknown}/pop", 'from' => 0) }],
    ['DELETE /v1/conversations/a.b', 400, '"invalid id"', 'invalid id', ->(_) { http('DELETE', '/v1/conversations/a.b') }]
  ].each do |request, status, error_label, message, send|
    scenario "An unknown or invalid conversation id (#{request})" do
      res = nil
      step("When #{request} is requested") { res = instance_exec(new_id, &send) }
      step("Then the status is #{status} with the error #{error_label}") { assert_error res, status, message }
    end
  end

  scenario 'Appending lines adds messages and sets the title and the tags' do
    id = res = nil
    a = "a-#{hex}"
    b = "b-#{hex}"
    step('Given a conversation with a user and an assistant message and the tag "a"') do
      id = create([user('hi'), assistant('hello')], [a])
    end
    step('When POST /v1/conversations/<id>/lines appends a user message, a title line "Renamed" and a tags line ["b"]') do
      res = http('POST', "/v1/conversations/#{id}/lines",
                 [user('more'), { 'type' => 'title', 'title' => 'Renamed' }, { 'type' => 'tags', 'tags' => [b] }])
    end
    step('Then the status is 200 and the body is {"ok": true}') { assert_ok res }
    step('And the conversation has 3 messages, the title "Renamed" and the tags ["b"]') do
      c = conv(id)
      assert_equal %w[hi hello more], c['messages'].map { |m| m['content'] }
      assert_equal 'Renamed', c['title']
      assert_equal [b], c['tags']
    end
    step('And the conversation file has the title "Renamed" but not the tag "b"') do
      file = conv_file(id)
      assert_includes file, 'Renamed'
      refute_includes file, b
      assert_includes file, a
    end
  end

  [
    ['an object', '"lines must be an array of objects"', -> { user('x') }, 'lines must be an array of objects'],
    ['a meta line', '"line type not allowed: \"meta\""', -> { [{ 'type' => 'meta' }] }, 'line type not allowed: "meta"'],
    ['a valid message and a message whose id is not a UUIDv7', '"message id must be a UUIDv7: \"nope\""',
     -> { [user('fine'), user('bad', 'id' => 'nope')] }, 'message id must be a UUIDv7: "nope"'],
    ['an assistant message whose content_html is a number', '"content_html must be a string"',
     -> { [assistant('x', 'content_html' => 1)] }, 'content_html must be a string'],
    ['a tags line with a tag name with a space', '"tags must be an array of unique tag names"',
     -> { [{ 'type' => 'tags', 'tags' => ['a b'] }] }, 'tags must be an array of unique tag names']
  ].each do |label, error_label, lines, message|
    scenario "Lines that cannot be appended are rejected with 400 (#{label})" do
      id = before = res = nil
      step('Given a conversation with a user and an assistant message and the tag "a"') do
        id = create([user('hi'), assistant('hello')], ["a-#{hex}"])
        before = conv_file(id)
      end
      step("When POST /v1/conversations/<id>/lines sends #{label}") do
        res = http('POST', "/v1/conversations/#{id}/lines", instance_exec(&lines))
      end
      step("Then the status is 400 with the error #{error_label}") { assert_error res, 400, message }
      step('And the conversation file is unchanged') { assert_equal before, conv_file(id) }
    end
  end

  scenario 'Popping the last turn deletes the messages from there' do
    id = res = nil
    step('Given a conversation with the messages user, assistant, user, assistant') { id = four_messages }
    step('When POST /v1/conversations/<id>/pop sends {"from": 2}') do
      res = http('POST', "/v1/conversations/#{id}/pop", 'from' => 2)
    end
    step('Then the status is 200 and the body is {"ok": true}') { assert_ok res }
    step('And the conversation has its first 2 messages left') do
      assert_equal %w[one two], conv(id)['messages'].map { |m| m['content'] }
    end
  end

  scenario 'Popping before the last user message is a conflict' do
    id = res = nil
    step('Given a conversation with the messages user, assistant, user, assistant') { id = four_messages }
    step('When POST /v1/conversations/<id>/pop sends {"from": 1}') do
      res = http('POST', "/v1/conversations/#{id}/pop", 'from' => 1)
    end
    step('Then the status is 409 with the error "can only pop the last turn (from must be >= index of the last user message)"') do
      assert_error res, 409, 'can only pop the last turn (from must be >= index of the last user message)'
    end
    step('And the conversation still has 4 messages') { assert_equal 4, conv(id)['messages'].size }
  end

  scenario 'Popping from past the last message changes nothing' do
    id = res = nil
    step('Given a conversation with the messages user, assistant, user, assistant') { id = four_messages }
    step('When POST /v1/conversations/<id>/pop sends {"from": 10}') do
      res = http('POST', "/v1/conversations/#{id}/pop", 'from' => 10)
    end
    step('Then the status is 200 and the body is {"ok": true}') { assert_ok res }
    step('And the conversation still has 4 messages') { assert_equal 4, conv(id)['messages'].size }
  end

  [
    ['an array', '"body must be an object"', [], 'body must be an object'],
    ['{"from": "2"}', '"from must be an integer"', { 'from' => '2' }, 'from must be an integer'],
    ['{"from": -1}', '"from must be an integer"', { 'from' => -1 }, 'from must be an integer']
  ].each do |label, error_label, body, message|
    scenario "A pop that is not understood is rejected with 400 (#{label})" do
      id = res = nil
      step('Given a conversation with the messages user, assistant, user, assistant') { id = four_messages }
      step("When POST /v1/conversations/<id>/pop sends #{label}") do
        res = http('POST', "/v1/conversations/#{id}/pop", body)
      end
      step("Then the status is 400 with the error #{error_label}") { assert_error res, 400, message }
    end
  end

  scenario 'Deleting a conversation removes it with its tags and its index entries' do
    id = res = nil
    word = unique_word
    round = user("about #{word}")
    step('Given a conversation with a round with a unique word whose tags were changed to ["gone"]') do
      id = create([round, assistant('noted')])
      assert_ok http('POST', "/v1/conversations/#{id}/lines", [{ 'type' => 'tags', 'tags' => ["gone-#{hex}"] }])
      assert_includes search('q' => word).map { |r| r['id'] }, round['id']
    end
    step('When DELETE /v1/conversations/<id> is requested') { res = http('DELETE', "/v1/conversations/#{id}") }
    step('Then the status is 200 and the body is {"ok": true}') { assert_ok res }
    step('And GET /v1/conversations/<id> answers 404') do
      assert_error http('GET', "/v1/conversations/#{id}"), 404, 'not found'
    end
    step('And it is in neither /v1/conversations nor /v1/meta-all.json') do
      refute_includes http('GET', '/v1/conversations').json.map { |c| c['id'] }, id
      refute_includes http('GET', '/v1/meta-all.json').json.map { |c| c['id'] }, id
    end
    step('And a search for its word no longer finds its round') do
      refute_includes search('q' => word).map { |r| r['id'] }, round['id']
    end
    step('And its current tags are forgotten') { assert_nil Chatty::TAGS.conversation_tags(id) }
    step('And the search index keeps no count for it') { refute Chatty::INDEX.messages_hint.key?(id) }
    step('And deleting it again still answers 200, leaving no count either') do
      assert_ok http('DELETE', "/v1/conversations/#{id}")
      refute Chatty::INDEX.messages_hint.key?(id)
    end
  end

  scenario 'The meta of every conversation is listed newest first' do
    newer = older = list = nil
    setup_tag = "setup-#{hex}"
    now_tag = "now-#{hex}"
    step('Given a conversation created with the tag "setup" whose tags were changed to ["now"], last modified in 2002') do
      newer = create([{ 'type' => 'title', 'title' => 'Newer' }, user('hi'), assistant('hello')], [setup_tag])
      assert_ok http('POST', "/v1/conversations/#{newer}/lines", [{ 'type' => 'tags', 'tags' => [now_tag] }])
      File.utime(Time.utc(2002), Time.utc(2002), Chatty::Store.conv_path(newer))
    end
    step('And a conversation last modified in 2001') do
      older = create([user('hi')])
      File.utime(Time.utc(2001), Time.utc(2001), Chatty::Store.conv_path(older))
    end
    step('When GET /v1/meta-all.json is requested') do
      res = http('GET', '/v1/meta-all.json')
      assert_equal 200, res.status
      list = res.json
    end
    step('Then the one of 2002 is listed before the one of 2001') do
      ids = list.map { |c| c['id'] }
      assert_operator ids.index(newer), :<, ids.index(older)
    end
    step('And the one of 2002 has its id, title, created_at, updated_at_hint, the setup_tags ["setup"], the tags_hint ["now"] and the messages_hint 2') do
      entry = list.find { |c| c['id'] == newer }
      assert_equal %w[created_at id messages_hint setup_tags tags_hint title updated_at_hint], entry.keys.sort
      assert_equal 'Newer', entry['title']
      assert_equal '2026-11-07T00:00:00Z', entry['created_at']
      assert_equal Time.utc(2002), Time.iso8601(entry['updated_at_hint'])
      assert_equal [setup_tag], entry['setup_tags']
      assert_equal [now_tag], entry['tags_hint']
      assert_equal 2, entry['messages_hint']
    end
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

  scenario 'The tag definitions are replaced as a whole' do
    before = res = nil
    name = "new-#{hex}"
    memory = { 'id' => "m-#{hex}", 'text' => 'a note', 'at' => '2026-11-07T00:00:00+09:00' }
    step('Given the tag definitions from GET /v1/tags') { before = tag_defs }
    step('When PUT /v1/tags sends them with a new tag that has a prompt and a memory item') do
      res = http('PUT', '/v1/tags', 'tags' => before + [{ 'name' => name, 'prompt' => 'Be brief.', 'memory' => [memory] }])
    end
    step('Then the status is 200 and the body is {"ok": true}') { assert_ok res }
    after = nil
    step('And GET /v1/tags has the new tag last, with its prompt and its memory item') do
      after = tag_defs
      assert_equal({ 'name' => name, 'prompt' => 'Be brief.', 'memory' => [memory] }, after.last)
    end
    step('And the tags that were there before are kept') { assert_equal before, after[0...-1] }
  end

  scenario 'A renamed tag keeps its memory' do
    old_name = "old-#{hex}"
    new_name = "renamed-#{hex}"
    memory = { 'id' => "m-#{hex}", 'text' => 'kept', 'at' => '2026-11-07T00:00:00+09:00' }
    step('Given a tag with a memory item') { add_tag(old_name, [memory]) }
    step('When PUT /v1/tags sends the same definitions with the tag under a new name and the same memory item') do
      defs = tag_defs.map { |t| t['name'] == old_name ? t.merge('name' => new_name) : t }
      assert_ok http('PUT', '/v1/tags', 'tags' => defs)
    end
    defs = nil
    step('Then GET /v1/tags has the new name with the memory item') do
      defs = tag_defs
      tag = defs.find { |t| t['name'] == new_name }
      assert tag, 'the new name'
      assert_equal [memory], tag['memory']
    end
    step('And the old name is gone') { refute_includes defs.map { |t| t['name'] }, old_name }
  end

  [
    ['an array', '"body must be {\"tags\": [...]}"', -> { [] }, 'body must be {"tags": [...]}'],
    ['a tag that is not an object', '"each tag must be an object"', -> { { 'tags' => ['x'] } }, 'each tag must be an object'],
    ['a tag name with a space', '"invalid tag name: \"a b\""', -> { { 'tags' => [{ 'name' => 'a b' }] } },
     'invalid tag name: "a b"'],
    ['a prompt that is a number', '"prompt must be a string"', -> { { 'tags' => [{ 'name' => "p-#{hex}", 'prompt' => 1 }] } },
     'prompt must be a string'],
    ['a memory item with a blank text', '"memory must be an array of {id, text}"',
     -> { { 'tags' => [{ 'name' => "m-#{hex}", 'memory' => [{ 'id' => 'm1', 'text' => '  ' }] }] } },
     'memory must be an array of {id, text}'],
    ['two tags with the same name', '"tag names must be unique"',
     -> { n = "d-#{hex}"; { 'tags' => [{ 'name' => n }, { 'name' => n }] } }, 'tag names must be unique'],
    ['two memory items with the same id', '"memory ids must be unique"',
     lambda do
       m = "m-#{hex}"
       { 'tags' => [{ 'name' => "x-#{hex}", 'memory' => [{ 'id' => m, 'text' => 'a' }] },
                    { 'name' => "y-#{hex}", 'memory' => [{ 'id' => m, 'text' => 'b' }] }] }
     end, 'memory ids must be unique']
  ].each do |label, error_label, body, message|
    scenario "Tag definitions that are not valid are rejected with 400 (#{label})" do
      before = tag_defs
      res = nil
      step("When PUT /v1/tags sends #{label}") { res = http('PUT', '/v1/tags', instance_exec(&body)) }
      step("Then the status is 400 with the error #{error_label}") { assert_error res, 400, message }
      step('And the tag definitions are unchanged') { assert_equal before, tag_defs }
    end
  end

  scenario 'Memory items are added, edited and deleted' do
    name = "メモ-#{hex}"
    path = "/v1/tags/#{path_escape(name)}/memory"
    res = item = nil
    step('Given a tag with a name in Japanese') { add_tag(name) }
    step('When POST /v1/tags/<name>/memory sends {"text": "  remember this  ", "source": {"conv_id": "c1"}}') do
      res = http('POST', path, 'text' => '  remember this  ', 'source' => { 'conv_id' => 'c1' })
    end
    step('Then the status is 201 and the item has an id starting with "mem-", the text "remember this", the time it was added and the source') do
      assert_equal 201, res.status, res.raw
      item = res.json
      assert_match(/\Amem-/, item['id'])
      assert_equal 'remember this', item['text']
      assert_in_delta Time.now.to_f, Time.iso8601(item['at']).to_f, 60
      assert_equal({ 'conv_id' => 'c1' }, item['source'])
    end
    step('When PATCH /v1/tags/<name>/memory/<item id> sends {"text": "edited"}') do
      res = http('PATCH', "#{path}/#{item['id']}", 'text' => 'edited')
    end
    step('Then the status is 200 and the item has the text "edited"') do
      assert_equal 200, res.status, res.raw
      assert_equal({ 'id' => item['id'], 'text' => 'edited', 'at' => item['at'] }, res.json)
    end
    step('When DELETE /v1/tags/<name>/memory/<item id> is requested') { res = http('DELETE', "#{path}/#{item['id']}") }
    step('Then the status is 200 and the body is {"ok": true}') { assert_ok res }
    step('And GET /v1/tags has the tag without memory') do
      assert_equal [], tag_defs.find { |t| t['name'] == name }['memory']
    end
  end

  [
    ['POST /v1/tags/<unknown tag>/memory with a text', 404, '"no such tag"', 'no such tag',
     ->(_, _) { http('POST', "/v1/tags/nope-#{hex}/memory", 'text' => 'x') }],
    ['POST /v1/tags/<name>/memory with a blank text', 400, '"text is required"', 'text is required',
     ->(name, _) { http('POST', "/v1/tags/#{name}/memory", 'text' => '   ') }],
    ['POST /v1/tags/<name>/memory with an array', 400, '"text is required"', 'text is required',
     ->(name, _) { http('POST', "/v1/tags/#{name}/memory", []) }],
    ['PATCH /v1/tags/<unknown tag>/memory/<item id> with a text', 404, '"no such tag"', 'no such tag',
     ->(_, item) { http('PATCH', "/v1/tags/nope-#{hex}/memory/#{item}", 'text' => 'x') }],
    ['PATCH /v1/tags/<name>/memory/<unknown id> with a text', 404, '"no such memory item"', 'no such memory item',
     ->(name, _) { http('PATCH', "/v1/tags/#{name}/memory/mem-#{hex}", 'text' => 'x') }],
    ['DELETE /v1/tags/<unknown tag>/memory/<item id>', 404, '"no such tag"', 'no such tag',
     ->(_, item) { http('DELETE', "/v1/tags/nope-#{hex}/memory/#{item}") }],
    ['DELETE /v1/tags/<name>/memory/<unknown id>', 404, '"no such memory item"', 'no such memory item',
     ->(name, _) { http('DELETE', "/v1/tags/#{name}/memory/mem-#{hex}") }]
  ].each do |request, status, error_label, message, send|
    scenario "Memory requests that cannot be done (#{request})" do
      name = "mem-tag-#{hex}"
      memory = { 'id' => "m-#{hex}", 'text' => 'kept', 'at' => '2026-11-07T00:00:00+09:00' }
      res = nil
      step('Given a tag with a memory item') { add_tag(name, [memory]) }
      step("When #{request} is requested") { res = instance_exec(name, memory['id'], &send) }
      step("Then the status is #{status} with the error #{error_label}") do
        assert_error res, status, message
        assert_equal [memory], tag_defs.find { |t| t['name'] == name }['memory']
      end
    end
  end

  scenario 'The rounds waiting for embeddings' do
    round = user('question')
    list = nil
    step('Given a conversation with a round of the user text "question" and the assistant text "answer"') do
      create([round, assistant('answer')])
    end
    step('When GET /v1/vectors/pending is requested with a model') { list = pending(new_model) }
    step('Then the round is listed with its id, its revision and the parts ["question\n\nanswer"]') do
      entry = list.find { |p| p['id'] == round['id'] }
      assert entry, 'pending'
      assert_equal %w[id parts rev], entry.keys.sort
      assert_match(/\A[0-9a-f]{16}\z/, entry['rev'])
      assert_equal ["question\n\nanswer"], entry['parts']
    end
  end

  scenario 'The pending list is newest first and its limit is kept between 1 and 16' do
    users = Array.new(17) { |i| user("round #{i}") }
    model = nil
    step('Given a conversation with 17 rounds, each newer than any other round') do
      create(users.flat_map { |u| [u, assistant('ok')] })
    end
    step('When GET /v1/vectors/pending is requested with a model') { model = new_model }
    step('Then with the limit 2 it lists the 2 newest rounds, newest first') do
      assert_equal [users[16]['id'], users[15]['id']], pending(model, 2).map { |p| p['id'] }
    end
    step('And with the limit 0 it lists 1 round') { assert_equal 1, pending(model, 0).size }
    step('And with the limit 100 it lists 16 rounds') { assert_equal 16, pending(model, 100).size }
  end

  [
    ['no model', '"model is required"', '/v1/vectors/pending', 'model is required'],
    ['the model a/b', '"invalid model name: \"a/b\""', '/v1/vectors/pending?model=a%2Fb', 'invalid model name: "a/b"']
  ].each do |label, error_label, path, message|
    scenario "The pending list needs a valid model (#{label})" do
      res = nil
      step("When GET /v1/vectors/pending is requested with #{label}") { res = http('GET', path) }
      step("Then the status is 400 with the error #{error_label}") { assert_error res, 400, message }
    end
  end

  scenario 'Registered vectors take their round off the pending list' do
    id = model = rev = res = nil
    step('Given a round waiting for embeddings with a model') { id, model, rev = pending_round }
    step('When PUT /v1/vectors sends a vector for it with its revision') do
      res = put_vectors(vector_query(model, { id => rev }, 1), Records.pack(id, unit_vector))
    end
    step('Then the status is 200 and the body is {"accepted": 1, "stale": []}') do
      assert_equal 200, res.status, res.raw
      assert_equal({ 'accepted' => 1, 'stale' => [] }, res.json)
    end
    step('And the round is no longer pending for that model') do
      refute_includes pending(model).map { |p| p['id'] }, id
    end
  end

  scenario 'A vector for an old revision is stale' do
    id = model = res = nil
    step('Given a round waiting for embeddings with a model') { id, model, = pending_round }
    step('When PUT /v1/vectors sends a vector for it with another revision') do
      res = put_vectors(vector_query(model, { id => '0123456789abcdef' }, 1), Records.pack(id, unit_vector))
    end
    step('Then the body is {"accepted": 0, "stale": [<its id>]}') do
      assert_equal 200, res.status, res.raw
      assert_equal({ 'accepted' => 0, 'stale' => [id] }, res.json)
    end
    step('And the round is still pending for that model') { assert_includes pending(model).map { |p| p['id'] }, id }
  end

  [
    ['no model', '"model is required"', 'model is required',
     ->(id, _, rev) { [vector_query(nil, { id => rev }, 1), Records.pack(id, unit_vector)] }],
    ['17 revisions', '"at most 16 ids per request"', 'at most 16 ids per request',
     lambda do |id, model, rev|
       revs = { id => rev }
       16.times { revs[Uuid.v7] = rev }
       [vector_query(model, revs, 1), Records.pack(id, unit_vector)]
     end],
    ['the magic lctyvBE0', '"magic must be lctyvLE0"', 'magic must be lctyvLE0',
     ->(id, model, rev) { [vector_query(model, { id => rev }, 1, 'magic' => 'lctyvBE0'), Records.pack(id, unit_vector)] }],
    ['the size 1024', '"size must be 3072"', 'size must be 3072',
     ->(id, model, rev) { [vector_query(model, { id => rev }, 1, 'size' => '1024'), Records.pack(id, unit_vector)] }],
    ['the entry_count 0', '"entry_count must be a positive integer"', 'entry_count must be a positive integer',
     ->(id, model, rev) { [vector_query(model, { id => rev }, 0), Records.pack(id, unit_vector)] }],
    ['the entry_count 2 with one record', '"body must be 2 records of 3104 bytes"', 'body must be 2 records of 3104 bytes',
     ->(id, model, rev) { [vector_query(model, { id => rev }, 2), Records.pack(id, unit_vector)] }],
    ['a record with a wrong control block', '"record 0: bad control block (expected lctyvLE0 + 3072)"',
     'record 0: bad control block (expected lctyvLE0 + 3072)',
     ->(id, model, rev) { [vector_query(model, { id => rev }, 1), 'lctyvBE0'.b + Records.pack(id, unit_vector)[8..-1]] }],
    ['a record without a revision', '"rev is missing for <its id>"', :rev_missing,
     ->(id, model, _) { [vector_query(model, {}, 1), Records.pack(id, unit_vector)] }],
    ['a zero vector', '"vector must be finite and non-zero"', 'vector must be finite and non-zero',
     ->(id, model, rev) { [vector_query(model, { id => rev }, 1), Records.pack(id, ("\0" * DIM * 4).b)] }]
  ].each do |label, error_label, message, request|
    scenario "A vector registration that is not valid is rejected with 400 (#{label})" do
      id = model = rev = res = nil
      step('Given a round waiting for embeddings with a model') { id, model, rev = pending_round }
      step("When PUT /v1/vectors sends #{label}") { res = put_vectors(*instance_exec(id, model, rev, &request)) }
      step("Then the status is 400 with the error #{error_label}") do
        assert_error res, 400, message == :rev_missing ? "rev is missing for #{id}" : message
        assert_includes pending(model).map { |p| p['id'] }, id
      end
    end
  end

  scenario 'The distribution files carry one ETag and answer 304 when unchanged' do
    dat = idx = nil
    step('When GET /v1/vectors.eg2_264.dat and GET /v1/vectors.eg2_264.idx are requested') do
      dat = http('GET', '/v1/vectors.eg2_264.dat')
      idx = http('GET', '/v1/vectors.eg2_264.idx')
    end
    step('Then both are 200 application/octet-stream with the same ETag') do
      [dat, idx].each do |r|
        assert_equal 200, r.status
        assert_equal 'application/octet-stream', r.header['content-type']
      end
      refute_nil dat.header['etag']
      assert_equal dat.header['etag'], idx.header['etag']
    end
    step('And the .dat has 1,056 bytes per row and the .idx 16 bytes per row, for the same number of rows') do
      assert_equal 0, dat.raw.to_s.bytesize % 1056
      assert_equal 0, idx.raw.to_s.bytesize % 16
      assert_equal dat.raw.to_s.bytesize / 1056, idx.raw.to_s.bytesize / 16
    end
    step('And GET /v1/vectors.eg2_264.dat with If-None-Match of that ETag answers 304 without a body') do
      res = http('GET', '/v1/vectors.eg2_264.dat', nil, 'If-None-Match' => dat.header['etag'])
      assert_equal 304, res.status
      assert_equal dat.header['etag'], res.header['etag']
      assert_equal '', res.raw.to_s
    end
  end

  scenario 'The distribution files follow a registered vector' do
    etag = idx = id = nil
    vector = unit_vector(5)
    step('Given the ETag of the distribution files') { etag = http('GET', '/v1/vectors.eg2_264.idx').header['etag'] }
    step('When PUT /v1/vectors registers a vector of the model "embeddinggemma-2" for a new round') do
      u = user("#{unique_word} distributed")
      create([u, assistant('ok')])
      id = u['id']
      rev = pending('embeddinggemma-2').find { |p| p['id'] == id }['rev']
      res = put_vectors(vector_query('embeddinggemma-2', { id => rev }, 1), Records.pack(id, vector))
      assert_equal({ 'accepted' => 1, 'stale' => [] }, res.json)
    end
    step('Then GET /v1/vectors.eg2_264.idx has another ETag') do
      idx = http('GET', '/v1/vectors.eg2_264.idx')
      refute_equal etag, idx.header['etag']
    end
    row = nil
    step('And its rows include the id of the round') do
      row = idx.raw.b.scan(/.{16}/m).index(Uuid.to_bytes(id))
      refute_nil row
    end
    step('And the row of the round in the .dat is the first 256 dimensions of its vector, of length 1, followed by 32 zero bytes') do
      dat = http('GET', '/v1/vectors.eg2_264.dat')
      assert_equal idx.header['etag'], dat.header['etag']
      assert_equal vector[0, 1024] + ("\0" * 32).b, dat.raw.b[row * 1056, 1056]
    end
  end

  [
    ['GET /v1/nope', ->() { http('GET', '/v1/nope') }],
    ['DELETE /v1/defaults.json', ->() { http('DELETE', '/v1/defaults.json') }],
    ['PATCH /v1/conversations', ->() { http('PATCH', '/v1/conversations', {}) }],
    ['GET /v1/tags/a/memory', ->() { http('GET', '/v1/tags/a/memory') }],
    ['GET /v1/conversations/a/lines', ->() { http('GET', '/v1/conversations/a/lines') }]
  ].each do |request, send|
    scenario "An unknown endpoint is 404 (#{request})" do
      res = nil
      step("When #{request} is requested") { res = instance_exec(&send) }
      step('Then the status is 404 with the error "no such endpoint"') { assert_error res, 404, 'no such endpoint' }
    end
  end

  scenario 'A path that is not UTF-8 is rejected' do
    res = nil
    step('When GET /v1/conversations/%FF is requested') { res = http('GET', '/v1/conversations/%FF') }
    step('Then the status is 400 with the error "invalid path encoding"') { assert_error res, 400, 'invalid path encoding' }
  end
end
