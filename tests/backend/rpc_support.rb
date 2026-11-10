# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# What the tests of /v1/rpc share (LCTYSP-3020 and LCTYSP-3022): one WEBrick server on 127.0.0.1 (a free port) with the
# RPC servlet mounted at /v1/rpc and http://allowed.test as the only allowed origin, a search index of its own as the
# cache of the counts (Lcty::Rpc.index), "a page" (the WebSocket client
# below: a reader thread takes every frame, answers the server's requests when told how, and keeps responses and
# notifications apart), and the helpers that create conversations and append elements. A test class includes it.

require_relative 'helper'
require 'base64'
require 'json'
require 'net/http'
require 'securerandom'
require 'socket'
require 'timeout'
require 'uuid'
require 'search_index'
require 'rpc/servlet'

module RpcSupport
  Rpc = Lcty::Rpc
  ORIGIN = 'http://allowed.test'
  NOTES = %w[c.batch.updated].freeze

  def self.port
    @port ||= begin
      Rpc.allowed_origins = [ORIGIN]
      # A search index of its own, in a folder of its own, for the cache of the counts (c_recordcount)
      index_dir = Dir.mktmpdir('lcty-rpc-index-')
      Rpc.index = Chatty::SearchIndex.new(File.join(index_dir, '_index.sqlite'))
      # and a CStore of its own for c.stats.put and c.stats.list
      Rpc.c_store = Chatty::CStore.new(File.join(index_dir, 'lcty_c.sqlite'))
      Minitest.after_run { FileUtils.rm_rf(index_dir) }
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, Logger: WEBrick::Log.new(File::NULL),
                                       AccessLog: [], DoNotReverseLookup: true)
      server.mount '/v1/rpc', Rpc::Servlet
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  # A WebSocket client of /v1/rpc
  class Page
    attr_reader :log

    # rcvbuf: the size of the receive buffer, set before connecting (after connecting, Linux keeps the window it
    # offered), for a page that stops reading
    def initialize(port, origin: ORIGIN, answer: nil, read: true, rcvbuf: nil)
      @sock = Socket.new(Socket::AF_INET, Socket::SOCK_STREAM)
      @sock.setsockopt(Socket::SOL_SOCKET, Socket::SO_RCVBUF, rcvbuf) if rcvbuf
      @sock.connect(Socket.sockaddr_in(port, '127.0.0.1'))
      @write = Mutex.new
      @inbox = Queue.new
      @log = [] # every message from the server, in order
      @answer = answer # ->(method, params) { result } for the server's requests; nil: never answer
      @next = 0
      @sock.write(Page.handshake(port, origin))
      status = @sock.gets.to_s.split[1]
      while (l = @sock.gets) && l != "\r\n"; end
      raise "handshake answered #{status}" unless status == '101'
      @reader = Thread.new { read_loop } if read
    end

    def self.handshake(port, origin)
      key = Base64.strict_encode64(SecureRandom.random_bytes(16))
      "GET /v1/rpc HTTP/1.1\r\nHost: 127.0.0.1:#{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" \
        "Sec-WebSocket-Key: #{key}\r\nSec-WebSocket-Version: 13\r\n#{origin ? "Origin: #{origin}\r\n" : ''}\r\n"
    end

    # The status line of a handshake from origin
    def self.status_of(port, origin)
      s = TCPSocket.new('127.0.0.1', port)
      s.write(handshake(port, origin))
      s.gets.to_s.split[1]
    ensure
      s&.close
    end

    def send_text(text)
      data = text.b
      mask = SecureRandom.random_bytes(4).bytes
      head = [0x81].pack('C')
      head << if data.bytesize < 126 then [0x80 | data.bytesize].pack('C')
              elsif data.bytesize <= 0xFFFF then [0x80 | 126, data.bytesize].pack('Cn')
              else [0x80 | 127, data.bytesize].pack('CQ>')
              end
      bytes = data.bytes
      bytes.each_index { |i| bytes[i] ^= mask[i & 3] }
      @write.synchronize { @sock.write(head + mask.pack('C*') + bytes.pack('C*')) }
    end

    # Send a request and wait for its response (the notifications that come meanwhile are kept in log)
    def call(method, params = {})
      @next += 1
      id = @next
      send_text(JSON.generate('jsonrpc' => '2.0', 'method' => method, 'params' => params, 'id' => id))
      Timeout.timeout(10) do
        loop do
          msg = @inbox.pop
          raise 'connection closed' if msg == :closed
          return msg if msg['id'] == id && !msg.key?('method')
        end
      end
    end

    def initialize_session(receives = NOTES)
      call('initialize', 'capabilities' => { 'receives' => receives })['result']
    end

    def notes(method = nil)
      @log.select { |m| m.key?('method') && !m.key?('id') && (method.nil? || m['method'] == method) }
    end

    # The records of every c.batch.updated received, in order, each with the version and actorId of its batch:
    # {store, op, row, version, actorId}. store and op narrow them.
    def records(store = nil, op = nil)
      notes('c.batch.updated').flat_map do |m|
        m['params']['records'].map { |r| r.merge(m['params'].slice('version', 'actorId')) }
      end.select { |r| (store.nil? || r['store'] == store) && (op.nil? || r['op'] == op) }
    end

    def close
      @sock.close rescue nil
    end

    private

    def read_loop
      loop do
        b0, b1 = @sock.read(2)&.bytes
        break unless b1
        len = case b1 & 0x7F
              when 126 then @sock.read(2).unpack1('n')
              when 127 then @sock.read(8).unpack1('Q>')
              else b1 & 0x7F
              end
        payload = len.zero? ? '' : @sock.read(len)
        break if (b0 & 0x0F) == 0x8 # close
        msg = JSON.parse(payload.force_encoding(Encoding::UTF_8))
        @log << msg
        if msg.key?('method') && msg.key?('id') # a request of the server
          reply(msg) if @answer
        else
          @inbox << msg
        end
      end
    rescue IOError, SystemCallError
      nil
    ensure
      @inbox << :closed
    end

    def reply(msg)
      result = @answer.call(msg['method'], msg['params'])
      send_text(JSON.generate('jsonrpc' => '2.0', 'result' => result, 'id' => msg['id']))
    end
  end

  def port
    RpcSupport.port
  end

  def setup
    port
    @pages = []
  end

  def teardown
    @pages.each(&:close)
  end

  def page(**opts)
    Page.new(port, **opts).tap { |p| @pages << p }
  end

  # A request from the test itself, over a page of its own that receives no notification (one per test)
  def rpc(method, params = {})
    @rpc_page ||= page.tap { |pg| pg.initialize_session([]) }
    @rpc_page.call(method, params)
  end

  # The actorId of the page rpc sends through
  def rpc_actor
    rpc('initialize', 'capabilities' => { 'receives' => [] })['result']['actorId']
  end

  def new_cid
    @@cid_count = (defined?(@@cid_count) ? @@cid_count : 0) + 1
    "rpc-#{Process.pid}-#{@@cid_count}"
  end

  def create(lang: 'ja', size: 64, title: 'Title')
    cid = new_cid
    r = rpc('c.create', 'cid' => cid, 'createdAt' => '2026-11-09T12:00:00+09:00', 'title' => title, 'lang' => lang,
                        'titleMaxSize' => size, 'lctyVersion' => 'v1')
    raise r.inspect if r['error']
    cid
  end

  def sys_attrs(text = 'x')
    { 'data-role' => 'system', 'id' => "sys-#{Chatty::Uuid.v7}", 'data-content' => text }
  end

  def user_attrs(text = 'q')
    { 'data-role' => 'user', 'id' => "msg-u-#{Chatty::Uuid.v7}", 'data-at' => '2026-11-09T12:00:00+09:00',
      'data-content' => text }
  end

  def model_attrs(text = 'a')
    { 'data-role' => 'model', 'id' => "msg-m-#{Chatty::Uuid.v7}", 'data-at' => '2026-11-09T12:00:00+09:00',
      'data-content' => text }
  end

  # The article of a message: a user message's is its text only, the others' a paragraph
  def article(attrs)
    attrs['data-role'] == 'user' ? "<article>#{attrs['data-content']}</article>" : "<article><p>#{attrs['data-content']}</p></article>"
  end

  def append(cid, after, attrs, inner = article(attrs), via: nil)
    params = { 'cid' => cid, 'after' => after, 'attrs' => attrs, 'innerHTML' => inner }
    via ? via.call('c.append.msg', params) : rpc('c.append.msg', params)
  end

  def cmd_attrs
    { 'id' => "cmd-#{Chatty::Uuid.v7}", 'data-op' => 'send', 'data-at' => '2026-11-09T12:00:00+09:00' }
  end

  def append_cmd(cid, after, attrs, via: nil)
    params = { 'cid' => cid, 'after' => after, 'attrs' => attrs }
    via ? via.call('c.append.cmd', params) : rpc('c.append.cmd', params)
  end

  def unappend(cid, id, via: nil)
    params = { 'cid' => cid, 'id' => id }
    via ? via.call('c.unappend', params) : rpc('c.unappend', params)
  end

  def file_lines(cid)
    File.readlines(Rpc::ConvStore.path(cid))
  end

  # The ids of the elements of a conversation file, in order (after the four head lines)
  def element_ids(cid)
    file_lines(cid).drop(4).map { |l| l[/\sid="([^"]+)"/, 1] }
  end

  # The sequence number of a version, <boot>.<seq>
  def seq(version)
    version.split('.').last.to_i
  end

  def settle
    sleep 0.3 # let notifications arrive
  end

  # Wait until the block is true, failing after timeout seconds
  def wait_until(timeout = 5, message = 'timed out')
    deadline = Time.now + timeout
    until yield
      flunk message if Time.now > deadline
      sleep 0.02
    end
  end

  # Run the block in one thread per item, all released at once, and return the results in the order of items
  def at_once(items)
    gate = Queue.new
    threads = items.map { |item| Thread.new { gate.pop; yield item } }
    items.size.times { gate << true }
    threads.map(&:value)
  end
end
