# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /v1/rpc: JSON-RPC 2.0 (prototype). A WebSocket (GET with Upgrade) carries requests, their responses and the
# notifications of every change; POST carries one request (or a batch) and its response, for curl and tests. Mounted at
# /v1/rpc by lcty.rb.
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
    # up nobody else: when its queue grows past QUEUE_MAX, the connection is closed and the page reconnects.
    class Peer
      QUEUE_MAX = 1024 # messages waiting to be sent

      attr_reader :conn
      attr_accessor :receives, :actor_id, :subscription

      def initialize(conn)
        @conn = conn
        @receives = Set.new
        @actor_id = nil
        @subscription = nil # the one conversation (cid) whose elements this page follows
        @queue = Queue.new
        @sender = Thread.new { send_loop }
      end

      # Queue a message to send; never waits. Responses and notifications go through the same queue, so they keep the
      # order in which they were produced.
      def push(text)
        return if @queue.closed?
        if @queue.size >= QUEUE_MAX
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

      def add(conn)
        @lock.synchronize { @conns << conn }
      end

      def remove(conn)
        @lock.synchronize { @conns.delete(conn) }
      end

      # Run the change (the block returns [method, params] of its notification) and notify every connection. The
      # notification names the actor that made the change (the actorId of its connection; nil for POST).
      # Follow the elements of one conversation (nil: none), replacing what the connection followed. Done under the
      # lock, so the last id and the version returned are those right before the first notification it will get.
      def subscribe(peer, cid)
        @lock.synchronize do
          last = cid && ConvStore.last_id(cid)
          peer.subscription = cid
          [last, "#{@boot}.#{@seq}"]
        end
      end

      # The block returns the notifications of the change, [[method, params], ...]; they share its version.
      def commit(peer)
        @lock.synchronize do
          notes = yield
          @seq += 1
          version = "#{@boot}.#{@seq}"
          notes.each do |method, params|
            params = params.merge('version' => version, 'actorId' => peer&.actor_id)
            msg = JSON.generate('jsonrpc' => '2.0', 'method' => method, 'params' => params)
            scoped = SUBSCRIBED.include?(method)
            @conns.each do |c|
              c.push(msg) if c.receives.include?(method) && (!scoped || c.subscription == params['cid'])
            end
          end
          version
        end
      end
    end

    # The notifications that go only to the connections following their conversation (c.subscribe)
    SUBSCRIBED = %w[c.appended c.unappended].freeze

    HUB = Hub.new

    # The methods the server receives: name => ->(params, peer) { result }. peer is nil for POST.
    METHODS = {
      'initialize' => lambda do |p, peer|
        receives = p.dig('capabilities', 'receives') || []
        unless receives.is_a?(Array) && receives.all? { |m| m.is_a?(String) }
          raise Error.new(INVALID_PARAMS, 'capabilities.receives must be an array of method names')
        end
        if peer
          peer.receives = Set.new(receives)
          peer.actor_id ||= SecureRandom.uuid # one per connection, kept if initialize is sent again
        end
        { 'protocol' => 'lcty-rpc-prototype', 'version' => HUB.version, 'actorId' => peer&.actor_id,
          'capabilities' => { 'receives' => METHODS.keys } }
      end,

      'rpc.discover' => ->(_p, _peer) { DOC },

      'c.create' => lambda do |p, peer|
        cid = p['cid']
        version = HUB.commit(peer) do
          ConvStore.create(cid, created_at: p['createdAt'], title: p['title'], lang: p['lang'],
                                title_max_size: p['titleMaxSize'], lcty_version: p['lctyVersion'])
          [['c.created', { 'cid' => cid }], ['c.meta.updated', ConvStore.meta(cid)]]
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
          ConvStore.remove(p['cid'], p['id'])
          [['c.unappended', { 'cid' => p['cid'], 'id' => p['id'] }], ['c.meta.updated', ConvStore.meta(p['cid'])]]
        end
        { 'version' => version }
      end,

      # Follow one conversation: {cid, last}. last is the id of the last element the page holds; the result says
      # whether it is still the last one (stale: the page reads the conversation again).
      'c.subscribe' => lambda do |p, peer|
        raise Error.new(INVALID_PARAMS, 'c.subscribe needs a WebSocket session') unless peer
        cid = p['cid']
        ConvStore.path(cid) if cid # checks the id
        last, version = HUB.subscribe(peer, cid)
        { 'version' => version, 'last' => last, 'current' => cid.nil? || last == p['last'] }
      end,

      'c.list' => lambda do |p, _peer|
        { 'version' => HUB.version, 'elements' => ConvStore.list(p['cid']) }
      end
    }.freeze

    module_function

    # Append one element of tag after the element named, and announce it as c.appended with the element as written
    def append(p, peer, tag, inner)
      attrs = nil
      version = HUB.commit(peer) do
        attrs = ConvStore.append(p['cid'], p['after'], tag, p['attrs'], inner)
        [['c.appended', { 'cid' => p['cid'], 'after' => p['after'],
                          'element' => { 'tag' => tag, 'attrs' => attrs, 'innerHTML' => inner.to_s } }],
         ['c.meta.updated', ConvStore.meta(p['cid'])]]
      end
      { 'version' => version, 'attrs' => attrs }
    end

    # The response to one decoded request (a Hash), or nil for a notification
    def call(req, peer = nil)
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

    # The response text to a message (a request or a batch), or nil when nothing is to be answered
    def handle(text, peer = nil)
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

    # Same origin, or no Origin at all (a client that is not a browser cannot be made to send this on a page's behalf)
    def origin_ok?(req)
      origin = req['origin']
      return true if origin.nil?
      uri = URI.parse(origin) rescue nil
      return false unless uri&.host
      "#{uri.host}:#{uri.port}" == host_port(req)
    end

    def host_port(req)
      host = req['host'].to_s
      host.include?(':') && !host.end_with?(']') ? host : "#{host}:#{req.port}"
    end

    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def do_GET(req, res)
        raise WEBrick::HTTPStatus::Forbidden, 'cross-origin' unless Rpc.origin_ok?(req)
        unless WebSocket.upgrade?(req)
          res.status = 426
          res['Upgrade'] = 'websocket'
          res.body = 'open a WebSocket, or POST a request'
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

      # A request in the body. Only application/json, so that a page of another site cannot send it as a simple request.
      def do_POST(req, res)
        raise WEBrick::HTTPStatus::Forbidden, 'cross-origin' unless Rpc.origin_ok?(req)
        unless req.content_type.to_s.split(';').first.to_s.strip.casecmp?('application/json')
          raise WEBrick::HTTPStatus::UnsupportedMediaType, 'application/json only'
        end
        out = Rpc.handle(req.body.to_s.force_encoding(Encoding::UTF_8))
        res['Cache-Control'] = 'no-store'
        res['Lcty-Version'] = HUB.version
        if out
          res.content_type = 'application/json; charset=utf-8'
          res.body = out
        else
          res.status = 204
        end
      end
    end
  end
end
