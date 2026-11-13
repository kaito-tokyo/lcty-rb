# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3028: the scenarios of docs/specs/LCTYSP-3028_server-embedding.feature, written by hand. Each test has the
# title of its Scenario and one step per line of the Background and of it, so the two read side by side.
#
# The conversations are in the data directory the tests share (lcty-msg files, written by Lcty::Rpc::ConvStore), so
# the pair also holds the messages of other tests: every check looks at the records of this test's own messages. The
# pair itself is in a directory of each test's own, and tests/backend/fake/llama-server stands in for llama-server.

require_relative 'helper'
require_relative 'rpc_support'
require 'base64'
require 'digest'
require 'net/http'
require 'stringio'
require 'zlib'
require 'embedding'
require 'v1/servlet'

class ServerEmbeddingTest < Lcty::Scenarios
  Embedding = Chatty::Embedding
  Pair = Embedding::VectorPair
  ConvStore = Lcty::Rpc::ConvStore
  FAKE = File.expand_path('fake/llama-server', __dir__)
  Peer = Struct.new(:actor_id, :receives)

  # A WEBrick server with /v1 mounted, as lcty.rb mounts it, started once
  def self.port
    @port ||= begin
      Lcty.open_data
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, Logger: WEBrick::Log.new(File::NULL),
                                       AccessLog: [], DoNotReverseLookup: true)
      server.mount '/v1', Chatty::V1::Servlet
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def setup
    RpcSupport.port # the stores /v1/rpc writes through (Rpc.index, Rpc.tags, Rpc.c_store)
    self.class.port
    @dir = Dir.mktmpdir('lcty-embedding-')
    @log = StringIO.new
    @notes = []
    Embedding.notifier = ->(method, params) { @notes << [method, params] }
    @peer = Peer.new('test-actor', Set.new)
  end

  def teardown
    Embedding.reset
    Embedding.notifier = nil
    FileUtils.rm_rf(@dir)
  end

  def uuid
    Chatty::Uuid.v7
  end

  def at
    Time.now.utc.strftime('%Y-%m-%dT%H:%M:%S.%LZ')
  end

  # Append one lcty-msg of role with text after the element after; returns its id
  def append_msg(cid, after, role, text)
    prefix = { 'system' => 'sys-', 'user' => 'msg-u-', 'model' => 'msg-m-' }[role]
    id = "#{prefix}#{uuid}"
    attrs = { 'data-role' => role, 'id' => id }
    attrs['data-at'] = at unless role == 'system'
    attrs['data-content'] = text
    res = rpc('c.append.msg', 'cid' => cid, 'after' => after, 'attrs' => attrs, 'innerHTML' => "<article>#{text}</article>")
    raise res.inspect unless res['result']
    id
  end

  def rpc(method, params)
    Lcty::Rpc.call({ 'jsonrpc' => '2.0', 'method' => method, 'params' => params, 'id' => 1 }, @peer)
  end

  # Background: the conversation "c1" (an id of this test's own) with a system message, a user message and a reply
  def background
    @cid = "c1-#{SecureRandom.hex(6)}"
    ConvStore.create(@cid, created_at: at, title: 'c1', lang: 'en', title_max_size: 64, lcty_version: 'v1')
    @system = append_msg(@cid, nil, 'system', 'You are terse.')
    @user = append_msg(@cid, @system, 'user', 'How do closures work in Ruby?')
    @model = append_msg(@cid, @user, 'model', 'A block keeps the variables around it.')
  end

  def bare(id)
    id.sub(/\A(?:msg-[um]-|sys-)/, '')
  end

  def start(enabled: true)
    Embedding.start(data_dir: @dir, conv_dir: ConvStore::DIR, enabled: enabled, command: FAKE,
                    repo: Embedding::LlamaServer::DEFAULT_REPO, log: @log)
  end

  # The embedding is started and has embedded every message queued at startup
  def started_and_embedded
    start
    assert Embedding.server.wait_ready(10), @log.string
    assert Embedding.indexer.drain, @log.string
  end

  # The record numbers of the message id in the pair's .idx
  def records_of(id)
    idx = File.binread(Pair.paths(@dir, 'eg2_264')[1])
    bytes = Chatty::Uuid.to_bytes(bare(id))
    (0...idx.bytesize / 16).select { |r| idx.byteslice(r * 16, 16) == bytes }
  end

  def row(r)
    File.binread(Pair.paths(@dir, 'eg2_264')[0], 1056, r * 1056)
  end

  # The row the fake's vector of text makes
  def expected_row(text)
    seed = Zlib.crc32(text)
    head = Array.new(256) { |i| Math.sin(seed + i) }
    n = Math.sqrt(head.sum { |x| x * x })
    Pair.row(head.map { |x| x / n })
  end

  def http(method, path, headers = {})
    req = Net::HTTP.const_get(method.capitalize).new(path)
    headers.each { |k, v| req[k] = v }
    Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(req) }
  end

  def valid?(id)
    Embedding.pair.valid?(Chatty::Uuid.to_bytes(bare(id)))
  end

  def wait_until(timeout = 5)
    deadline = Time.now + timeout
    sleep 0.02 until yield || Time.now > deadline
    yield
  end

  scenario 'The pair is named after the model' do
    names = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('When the name of the pair is asked for the default model and for "someone/other-GGUF:Q4_0"') do
      names = [Embedding.pair_name(Embedding::LlamaServer::DEFAULT_REPO), Embedding.pair_name('someone/other-GGUF:Q4_0')]
    end
    step('Then it is "eg2_264" for the default and the first 8 hex digits of the SHA-256 of the repository, then "_264"') do
      assert_equal ['eg2_264', "#{Digest::SHA256.hexdigest('someone/other-GGUF:Q4_0')[0, 8]}_264"], names
    end
  end

  scenario 'A long message is embedded in parts' do
    inputs = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('When the inputs of a message of 13,000 characters are made') { inputs = Embedding::Indexer.inputs('あ' * 13_000) }
    step('Then there are three, of 6,000, 6,000 and 1,000 characters after the prefix "title: none | text: "') do
      assert_equal 3, inputs.size
      assert inputs.all? { |t| t.start_with?('title: none | text: ') }
      assert_equal [6000, 6000, 1000], inputs.map { |t| t.size - 'title: none | text: '.size }
    end
  end

  scenario 'Every user and model message is embedded at startup' do
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('When the embedding is started') { started_and_embedded }
    step('Then the user message and the model reply each have one valid row, and the system message none') do
      assert_equal [1, 1, 0], [@user, @model, @system].map { |id| records_of(id).size }
      assert valid?(@user)
      assert valid?(@model)
    end
    step('And each row is the vector of its content with the prefix "title: none | text: "') do
      assert_equal expected_row('title: none | text: How do closures work in Ruby?'), row(records_of(@user)[0])
      assert_equal expected_row('title: none | text: A block keeps the variables around it.'), row(records_of(@model)[0])
    end
    step('And a change was announced as vectors.eg2_264.changed with the summary of the pair') do
      refute_empty @notes
      assert_equal ['vectors.eg2_264.changed'], @notes.map(&:first).uniq
      assert_equal Embedding.pair.summary, @notes.last[1]
    end
  end

  scenario 'A message appended through /v1/rpc is embedded' do
    id = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step('When a user message is appended to "c1" with c.append.msg') { id = append_msg(@cid, @model, 'user', 'And procs?') }
    step('Then that message gets a valid row') do
      assert wait_until { valid?(id) }
      assert_equal expected_row('title: none | text: And procs?'), row(records_of(id)[0])
    end
  end

  scenario 'A message removed with c.unappend has its rows filled with NaN' do
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step('When the model reply is removed with c.unappend') do
      assert rpc('c.unappend', 'cid' => @cid, 'id' => @model)['result']
    end
    step('Then its row is listed as invalid in the summary') do
      r = records_of(@model)[0]
      assert(Embedding.pair.summary['invalid'].any? { |a, b| (a..b).cover?(r) })
      assert_equal Pair::NAN_ROW, row(r)
      refute valid?(@model)
    end
    step('And the user message keeps its valid row') { assert valid?(@user) }
  end

  scenario 'Deleting a conversation fills its rows with NaN' do
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step('When "c1" is deleted with DELETE /v1/conversations/c1') do
      assert_equal '200', http('DELETE', "/v1/conversations/#{@cid}").code
    end
    step('Then the rows of the user message and the model reply are listed as invalid') do
      invalid = Embedding.pair.summary['invalid']
      [@user, @model].each do |id|
        r = records_of(id)[0]
        assert(invalid.any? { |a, b| (a..b).cover?(r) })
        refute valid?(id)
      end
    end
  end

  scenario 'A message removed while it is being embedded is dropped' do
    id = indexer = appended = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step('And a user message appended to "c1" that is removed while the indexer embeds it') do
      Embedding.indexer.stop # this test's indexer processes it
      id = append_msg(@cid, @model, 'user', 'Gone soon')
      cid = @cid
      real = Embedding.server
      server = Object.new
      server.define_singleton_method(:ready?) { true }
      server.define_singleton_method(:embed) do |texts|
        ConvStore.remove(cid, id)
        real.embed(texts)
      end
      count = Embedding.pair.count
      indexer = Embedding::Indexer.new(pair: Embedding.pair, server: server, conv_dir: ConvStore::DIR,
                                       on_change: -> { appended = true }, log: @log)
      @count = count
    end
    step('When the indexer processes it') { assert_equal [], indexer.process(@cid, [bare(id)]) }
    step('Then no row is appended for it') do
      refute appended
      assert_equal @count, Embedding.pair.count
      refute valid?(id)
    end
  end

  scenario 'The JSON of the pair is revalidated by its ETag' do
    first = second = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step('When GET /v1/vectors.eg2_264.json is requested, and again with If-None-Match of its ETag') do
      first = http('GET', '/v1/vectors.eg2_264.json')
      second = http('GET', '/v1/vectors.eg2_264.json', 'If-None-Match' => first['ETag'])
    end
    step('Then the first answer is 200 with the summary of the pair: its rev, its count and its invalid ranges') do
      assert_equal '200', first.code
      assert_equal Embedding.pair.summary, JSON.parse(first.body)
      assert_equal %w[count invalid rev], JSON.parse(first.body).keys.sort
    end
    step('And the second is 304') { assert_equal '304', second.code }
  end

  scenario 'The rows are served by Range in the generation of If-Match' do
    res = r = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step("When the 16 bytes of the user message's record of /v1/vectors.eg2_264.idx are requested with If-Match of the rev") do
      r = records_of(@user)[0]
      res = http('GET', '/v1/vectors.eg2_264.idx', 'Range' => "bytes=#{r * 16}-#{r * 16 + 15}",
                                                    'If-Match' => %("#{Embedding.pair.rev}"))
    end
    step("Then the answer is 206 with the message's id and a Content-Range of those bytes and the size of .idx") do
      assert_equal '206', res.code
      assert_equal Chatty::Uuid.to_bytes(bare(@user)), res.body.b
      assert_equal "bytes #{r * 16}-#{r * 16 + 15}/#{Embedding.pair.count * 16}", res['Content-Range']
      assert_equal %("#{Embedding.pair.rev}"), res['ETag']
    end
    step('And the same request with If-Match of another rev is answered 412') do
      other = http('GET', '/v1/vectors.eg2_264.idx', 'Range' => "bytes=#{r * 16}-#{r * 16 + 15}",
                                                      'If-Match' => %("#{Embedding.pair.rev - 1}"))
      assert_equal '412', other.code
    end
    step('And a range from the end of .idx is answered 416') do
      size = Embedding.pair.count * 16
      assert_equal '416', http('GET', '/v1/vectors.eg2_264.idx', 'Range' => "bytes=#{size}-#{size + 15}").code
    end
    step('And a request for .dat with Range is answered with the row of the user message') do
      dat = http('GET', '/v1/vectors.eg2_264.dat', 'Range' => "bytes=#{r * 1056}-#{r * 1056 + 1055}")
      assert_equal '206', dat.code
      assert_equal expected_row('title: none | text: How do closures work in Ruby?'), dat.body.b
    end
  end

  scenario 'A query is embedded over /v1/rpc' do
    res = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started and has embedded "c1"') { started_and_embedded }
    step('When vectors.eg2_264.embed is called with the text "closures"') { res = rpc('vectors.eg2_264.embed', 'text' => 'closures') }
    step('Then the result\'s vector is the base64 of 256 Float32 LE, the vector of "task: search result | query: closures"') do
      bytes = Base64.strict_decode64(res['result']['vector'])
      assert_equal 1024, bytes.bytesize
      assert_equal expected_row('task: search result | query: closures')[0, 1024], bytes
    end
    step('And initialize lists vectors.eg2_264.embed among the methods the server receives') do
      receives = rpc('initialize', 'capabilities' => { 'receives' => [] })['result']['capabilities']['receives']
      assert_includes receives, 'vectors.eg2_264.embed'
    end
  end

  scenario 'Without an embedding server a query is unavailable' do
    res = nil
    step('Given a data directory with the conversation "c1" holding a system message, a user message and a model reply') { background }
    step('Given the embedding is started with --no-embedding') { start(enabled: false) }
    step('When vectors.eg2_264.embed is called with the text "closures"') { res = rpc('vectors.eg2_264.embed', 'text' => 'closures') }
    step('Then it is answered with the error 7') { assert_equal 7, res.dig('error', 'code') }
    step('And the pair is still open and served') do
      assert_equal '200', http('GET', '/v1/vectors.eg2_264.json').code
      assert_nil Embedding.server
    end
  end
end
