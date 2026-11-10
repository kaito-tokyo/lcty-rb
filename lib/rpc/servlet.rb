# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /v1/rpc: JSON-RPC 2.0 (prototype) over a WebSocket (GET with Upgrade), which carries requests, their responses and
# the notifications of every change. There is no other transport: a page always has a WebSocket. Mounted at /v1/rpc by
# lcty.rb.
#
# Every change gets the next number of the global version, "<boot id>.<seq>": the boot id is new at every start, so a
# client that sees another one knows the server restarted and its history of notifications is gone.
#
# Both ends speak the same protocol. In initialize each end declares the methods it receives (capabilities.receives),
# and a notification goes only to the connections that declared it. The methods are described in
# docs/specs/LCTYSP-0012_rpc-protocol.openrpc.yml, read at startup and returned by rpc.discover.

require 'json'
require 'securerandom'
require 'set'
require 'uri'
require 'webrick'
require 'yaml'
require_relative 'websocket'
require_relative 'conv_store'

module Lcty
  module Rpc
    PARSE_ERROR = -32_700
    INVALID_REQUEST = -32_600
    METHOD_NOT_FOUND = -32_601
    INVALID_PARAMS = -32_602
    INTERNAL_ERROR = -32_603

    # The OpenRPC document of the protocol (the YAML is the source; rpc.discover answers it as JSON)
    DOC_PATH = File.expand_path('../../docs/specs/LCTYSP-0012_rpc-protocol.openrpc.yml', __dir__)
    DOC = YAML.safe_load(File.read(DOC_PATH)).freeze

    # One open WebSocket: the methods its page receives (empty until initialize), the actorId initialize assigned it,
    # and its own queue of messages to send. A thread of its own sends them in order, so a page that stops reading holds
    # up nobody else: when its queue grows past Peer.queue_max, the connection is closed and the page reconnects.
    class Peer
      class << self
        attr_accessor :queue_max # messages waiting to be sent before the connection is dropped
      end
      self.queue_max = 1024

      attr_reader :conn
      attr_accessor :receives, :actor_id, :subscription

      def initialize(conn)
        @conn = conn
        @receives = Set.new
        @actor_id = nil
        @subscription = nil # the one conversation (cid) whose elements this page follows
        @queue = Queue.new
        @sender = Thread.new { send_loop }
        @ask_lock = Mutex.new
        @asked = 0
        @waiting = {}
      end

      # Queue a message to send; never waits. Responses and notifications go through the same queue, so they keep the
      # order in which they were produced.
      def push(text)
        return if @queue.closed?
        if @queue.size >= Peer.queue_max
          abort # too far behind: dropping the connection makes the page reconnect and read again
          return
        end
        @queue << text
      end

      # Stop sending when the session ends: what is queued is still sent, then the sender thread ends
      def finish
        @queue.close
        @sender.join(5)
      end

      # Drop the connection at once (never waits: the sender may be stuck in a write)
      def abort
        @queue.close
        @conn.abort
      end

      # Send the page a request; the block gets the result (or nil for an error) when the response comes. Responses
      # that never come are the caller's to give up on.
      def ask(method, params, &on_result)
        id = nil
        @ask_lock.synchronize do
          @asked += 1
          id = "s#{@asked}" # the server's ids are strings, so they never look like the page's
          @waiting[id] = on_result
        end
        push(JSON.generate('jsonrpc' => '2.0', 'method' => method, 'params' => params, 'id' => id))
      end

      # A response the page sent to one of the server's requests
      def deliver(msg)
        cb = @ask_lock.synchronize { @waiting.delete(msg['id']) }
        cb&.call(msg.key?('error') ? nil : msg['result'])
      end

      private

      def send_loop
        while (text = @queue.pop)
          @conn.send_text(text)
        end
      rescue IOError, SystemCallError
        @queue.close
      end
    end

    # The open connections and the global version. The lock is a write lock: a change runs inside commit, which writes
    # it, numbers it and queues its notification for every connection that receives it before the next change starts,
    # so notifications are queued in version order. Sending happens outside the lock, on each connection's own thread.
    class Hub
      def initialize
        @boot = SecureRandom.hex(4)
        @seq = 0
        @conns = Set.new
        @lock = Mutex.new
      end

      def version
        @lock.synchronize { "#{@boot}.#{@seq}" }
      end

      # Read under the lock, so that what is read and the version returned belong together: [what the block returns,
      # version]
      def read
        @lock.synchronize { [yield, "#{@boot}.#{@seq}"] }
      end

      # The open connections that receive method
      def receivers(method)
        @lock.synchronize { @conns.select { |c| c.receives.include?(method) } }
      end

      def add(conn)
        @lock.synchronize { @conns << conn }
      end

      def remove(conn)
        @lock.synchronize { @conns.delete(conn) }
      end

      # Follow the elements of one conversation (nil: none), replacing what the connection followed. Done under the
      # lock, so the last id and the version returned are those right before the first notification it will get.
      def subscribe(peer, cid)
        @lock.synchronize do
          last = cid && ConvStore.last_id(cid)
          peer.subscription = cid
          [last, "#{@boot}.#{@seq}"]
        end
      end

      # Run the change and announce it as one method notification, c.batch.updated for c/ and t.batch.updated for t/
      # (LCTYSP-0014). The block returns the records of the change, [{store, op, row}, ...], in the order they are
      # applied; they share its version and name the actor that made it (null for a change through the HTTP API, peer
      # nil). Records of the stores in SUBSCRIBED go only to the connections following their conversation; a connection
      # left with no record gets nothing.
      def commit(peer, method = BATCH)
        @lock.synchronize do
          records = yield
          @seq += 1
          version = "#{@boot}.#{@seq}"
          msgs = {}
          @conns.each do |c|
            next unless c.receives.include?(method)
            mine = records.reject { |r| SUBSCRIBED.include?(r['store']) && c.subscription != r['row']['cid'] }
            next if mine.empty?
            c.push(msgs[mine] ||= JSON.generate('jsonrpc' => '2.0', 'method' => method, 'params' => {
                                                       'version' => version, 'actorId' => peer&.actor_id, 'records' => mine
                                                     }))
          end
          version
        end
      end
    end

    # The one notification of every change of c/
    BATCH = 'c.batch.updated'
    # The stores whose records go only to the connections following their conversation (c.subscribe)
    SUBSCRIBED = %w[c_html].freeze

    HUB = Hub.new
    class << self
      attr_accessor :holds_timeout # seconds to wait for the pages' answers to c.cmd.holds
    end
    self.holds_timeout = 2.0

    # The methods the server receives: name => ->(params, peer) { result }, peer the connection of the request.
    METHODS = {
      'initialize' => lambda do |p, peer|
        receives = p.dig('capabilities', 'receives') || []
        unless receives.is_a?(Array) && receives.all? { |m| m.is_a?(String) }
          raise Error.new(INVALID_PARAMS, 'capabilities.receives must be an array of method names')
        end
        peer.receives = Set.new(receives)
        peer.actor_id ||= SecureRandom.uuid # one per connection, kept if initialize is sent again
        { 'protocol' => 'lcty-rpc-prototype', 'version' => HUB.version, 'actorId' => peer.actor_id,
          'capabilities' => { 'receives' => METHODS.keys } }
      end,

      'rpc.discover' => ->(_p, _peer) { DOC },

      'c.create' => lambda do |p, peer|
        cid = p['cid']
        version = HUB.commit(peer) do
          ConvStore.create(cid, created_at: p['createdAt'], title: p['title'], lang: p['lang'],
                                title_max_size: p['titleMaxSize'], lcty_version: p['lctyVersion'])
          [Rpc.meta_record(cid), Rpc.count_record(cid, 0)]
        end
        { 'version' => version }
      end,

      # Append one element, one method per element: {cid, after, attrs, innerHTML} (no innerHTML for the lcty-cmd)
      'c.append.msg' => ->(p, peer) { Rpc.append(p, peer, 'lcty-msg', p['innerHTML']) },
      'c.append.thinking' => ->(p, peer) { Rpc.append(p, peer, 'lcty-thinking', p['innerHTML']) },
      'c.append.cmd' => ->(p, peer) { Rpc.append(p, peer, 'lcty-cmd', '') },

      # Remove the last element: {cid, id}
      'c.unappend' => lambda do |p, peer|
        version = HUB.commit(peer) do
          count = ConvStore.remove(p['cid'], p['id'])
          [{ 'store' => 'c_html', 'op' => 'unappend', 'row' => { 'cid' => p['cid'], 'id' => p['id'] } },
           Rpc.meta_record(p['cid']), Rpc.count_record(p['cid'], count)]
        end
        { 'version' => version }
      end,

      # Follow one conversation: {cid, last}. last is the id of the last element the page holds; the result says
      # whether it is still the last one (stale: the page reads the conversation again).
      'c.subscribe' => lambda do |p, peer|
        cid = p['cid']
        ConvStore.path(cid) if cid # checks the id
        last, version = HUB.subscribe(peer, cid)
        { 'version' => version, 'last' => last, 'current' => cid.nil? || last == p['last'] }
      end,

      # Whether some page holds the lcty-cmd: {cid, id}. The server keeps no record of it: it asks every other connected
      # page that receives c.cmd.holds and waits for their answers (at most Rpc.holds_timeout). A page that does not answer
      # in time counts as not holding it.
      'c.cmd.held' => lambda do |p, peer|
        ConvStore.path(p['cid'])
        askees = HUB.receivers('c.cmd.holds') - [peer]
        lock = Mutex.new
        arrived = ConditionVariable.new
        answers = []
        askees.each do |c|
          c.ask('c.cmd.holds', 'cid' => p['cid'], 'id' => p['id']) do |r|
            lock.synchronize do
              answers << [c, r]
              arrived.signal
            end
          end
        end
        deadline = Time.now + Rpc.holds_timeout
        lock.synchronize do
          loop do
            holder = answers.find { |_c, r| r.is_a?(Hash) && r['holds'] == true }
            return { 'held' => true, 'actorId' => holder[0].actor_id } if holder
            left = deadline - Time.now
            break if answers.size == askees.size || left <= 0
            arrived.wait(lock, left) # Ruby 2.6 has no Queue#pop(timeout:)
          end
        end
        { 'held' => false, 'actorId' => nil }
      end,

      # The meta of every conversation: what a page reads to fill its list, or again after reconnecting
      'c.list' => lambda do |_p, _peer|
        items, version = HUB.read { ConvStore.list_meta }
        { 'version' => version, 'items' => items }
      end,

      # Every cached count of elements, the rows of c_recordcount: what a page reads to fill it, or again after
      # reconnecting. Read under the lock, as c.list, since a change writes its count before its version is given.
      'c.recordcount.list' => lambda do |_p, _peer|
        items, version = HUB.read { ConvStore.list_record_counts }
        { 'version' => version, 'items' => items }
      end,

      # Every row of t_has_many_c, which conversations each tag has, with the version they belong to (LCTYSP-0014):
      # read whenever a page is shown and after reconnecting. Read under the lock, as c.list, since a change of the tags
      # (POST …/lines over HTTP) is written under it.
      't.c.list' => lambda do |_p, _peer|
        items, version = HUB.read { Rpc.tags&.list || [] }
        { 'version' => version, 'items' => items }
      end,

      # Record what was measured of a reply: {cid, id, timings, usage, client}. Not a change of a copy of the pages
      # (they read it with c.stats.list), so it has no version and no notification.
      'c.stats.put' => lambda do |p, _peer|
        ConvStore.put_stats(p)
        {}
      end,

      # What was measured of every reply of a conversation: {cid}
      'c.stats.list' => ->(p, _peer) { { 'items' => ConvStore.list_stats(p['cid']) } },

      # Change the title: {cid, title}. The server fits it into the slot; the result is the title as written.
      'c.update.title' => lambda do |p, peer|
        title = nil
        version = HUB.commit(peer) do
          title = ConvStore.update_title(p['cid'], p['title'])
          [Rpc.meta_record(p['cid'])]
        end
        { 'version' => version, 'title' => title }
      end
    }.freeze

    module_function

    # Append one element of tag after the element named, and announce it with a c_html record of the element as written
    def append(p, peer, tag, inner)
      attrs = nil
      version = HUB.commit(peer) do
        attrs, count = ConvStore.append(p['cid'], p['after'], tag, p['attrs'], inner)
        [{ 'store' => 'c_html', 'op' => 'append',
           'row' => { 'cid' => p['cid'], 'after' => p['after'], 'tag' => tag, 'attrs' => attrs, 'innerHTML' => inner.to_s } },
         meta_record(p['cid']), count_record(p['cid'], count)]
      end
      { 'version' => version, 'attrs' => attrs }
    end

    # The record of a conversation's meta, the row of c_meta
    def meta_record(cid)
      { 'store' => 'c_meta', 'op' => 'put', 'row' => ConvStore.meta(cid) }
    end

    # The record of a conversation's number of elements, the row of c_recordcount
    def count_record(cid, count)
      { 'store' => 'c_recordcount', 'op' => 'put', 'row' => { 'cid' => cid, 'count' => count } }
    end

    # The response to one decoded request (a Hash), or nil for a notification
    def call(req, peer)
      unless req.is_a?(Hash) && req['jsonrpc'] == '2.0' && req['method'].is_a?(String) &&
             (!req.key?('params') || req['params'].is_a?(Hash))
        return error_response(req.is_a?(Hash) ? req['id'] : nil, INVALID_REQUEST, 'invalid request')
      end
      notification = !req.key?('id')
      fn = METHODS[req['method']]
      result =
        begin
          raise Error.new(METHOD_NOT_FOUND, "method not found: #{req['method']}") unless fn
          fn.call(req['params'] || {}, peer)
        rescue Error => e
          return notification ? nil : error_response(req['id'], e.code, e.message, e.data)
        rescue StandardError => e
          warn "rpc #{req['method']}: #{e.class}: #{e.message}"
          return notification ? nil : error_response(req['id'], INTERNAL_ERROR, 'internal error')
        end
      notification ? nil : { 'jsonrpc' => '2.0', 'result' => result, 'id' => req['id'] }
    end

    # Whether a message from a page is a response (to a request of the server) rather than a request
    def response?(text)
      msg = JSON.parse(text) rescue nil
      msg.is_a?(Hash) && !msg.key?('method') && msg.key?('id') && (msg.key?('result') || msg.key?('error'))
    end

    # The response text to a message (a request or a batch), or nil when nothing is to be answered
    def handle(text, peer)
      msg = begin
        JSON.parse(text)
      rescue JSON::ParserError
        return JSON.generate(error_response(nil, PARSE_ERROR, 'parse error'))
      end
      if msg.is_a?(Array)
        return JSON.generate(error_response(nil, INVALID_REQUEST, 'empty batch')) if msg.empty?
        out = msg.map { |r| call(r, peer) }.compact
        return out.empty? ? nil : JSON.generate(out)
      end
      (r = call(msg, peer)) && JSON.generate(r)
    end

    def error_response(id, code, message, data = nil)
      err = { 'code' => code, 'message' => message }
      err['data'] = data if data
      { 'jsonrpc' => '2.0', 'error' => err, 'id' => id }
    end

    # The origins whose pages may use /v1/rpc: LCTY_ALLOWED_ORIGIN (origins separated by commas or spaces), or else the
    # server's own address (and localhost when it listens on 127.0.0.1). Compared with the Origin a browser sends, so a
    # page of another site cannot get in even when its name resolves to this server (DNS rebinding): comparing Origin
    # with Host would let it, since the browser sends the attacker's name in both.
    def self.default_origins
      env = ENV['LCTY_ALLOWED_ORIGIN'].to_s.split(/[\s,]+/).reject(&:empty?)
      return env.map { |o| normalize_origin(o) }.compact unless env.empty?
      own = ["http://#{Chatty::BIND_URL_HOST}:#{Chatty::PORT}"]
      own << "http://localhost:#{Chatty::PORT}" if Chatty::BIND == '127.0.0.1'
      own
    end

    # An origin as browsers send it: scheme://host[:port], lower case, the default port left out
    def self.normalize_origin(o)
      uri = URI.parse(o.to_s.strip) rescue nil
      return nil unless uri&.scheme && uri.host
      port = uri.port == uri.default_port ? '' : ":#{uri.port}"
      "#{uri.scheme.downcase}://#{uri.host.downcase}#{port}"
    end

    class << self
      attr_writer :allowed_origins

      def allowed_origins
        @allowed_origins ||= default_origins
      end
    end

    # An allowed Origin, or no Origin at all (a client that is not a browser cannot be made to send this on a page's
    # behalf)
    def origin_ok?(req)
      origin = req['origin']
      return true if origin.nil?
      Rpc.allowed_origins.include?(Rpc.normalize_origin(origin))
    end

    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def do_GET(req, res)
        raise WEBrick::HTTPStatus::Forbidden, 'cross-origin' unless Rpc.origin_ok?(req)
        unless WebSocket.upgrade?(req)
          res.status = 426
          res['Upgrade'] = 'websocket'
          res.body = 'open a WebSocket'
          return
        end
        conn = WebSocket.accept(req)
        # The request was HTTP/1.1, so WEBrick would wait for another request on the socket (up to RequestTimeout)
        # before closing it, and the client waits for that close: end the connection as soon as the WebSocket ends
        res.keep_alive = false
        peer = Peer.new(conn)
        HUB.add(peer)
        begin
          while (msg = conn.read_message)
            type, data = msg
            next conn.close(1003) unless type == :text
            next peer.deliver(JSON.parse(data)) if Rpc.response?(data) # an answer to one of the server's requests
            out = Rpc.handle(data, peer)
            peer.push(out) if out # after the notifications this request queued
          end
        rescue WebSocket::ProtocolError
          conn.close(1002)
        rescue IOError, SystemCallError
          nil
        ensure
          HUB.remove(peer)
          peer.finish
          conn.close
        end
      end
    end
  end
end
