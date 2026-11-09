# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# A WebSocket (RFC 6455) server connection over a socket taken from WEBrick (prototype). The servlet answers the
# opening handshake itself and keeps the socket, as WEBrick's own proxy does for CONNECT (webrick/httpproxy.rb): the
# socket is Thread.current[:WEBrickSocket], the 101 is written directly, and the request line is cleared so that
# HTTPServer#run sends nothing after it. The servlet also sets res.keep_alive = false, so that run closes the
# connection as soon as the servlet returns instead of waiting for another request.

require 'digest'
require 'base64'
require 'webrick'

module Lcty
  module WebSocket
    GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
    MAX_MESSAGE = 64 * 1024 * 1024 # bytes of one message, after joining its fragments

    OP_CONT = 0x0
    OP_TEXT = 0x1
    OP_BINARY = 0x2
    OP_CLOSE = 0x8
    OP_PING = 0x9
    OP_PONG = 0xA

    class ProtocolError < StandardError; end

    # Reads nothing: given to WEBrick::HTTPRequest#parse to clear the request line (WEBrick::NullReader is only defined
    # when webrick/httpproxy is loaded)
    NULL_READER = Object.new
    class << NULL_READER
      def read(*_args)
        nil
      end
      alias_method :gets, :read
    end

    # Whether req asks to open a WebSocket
    def self.upgrade?(req)
      req.request_method == 'GET' && req['upgrade'].to_s.casecmp?('websocket') &&
        req['connection'].to_s.downcase.split(/\s*,\s*/).include?('upgrade')
    end

    # Answer the opening handshake of req on the socket WEBrick gave this thread, and return the Connection. Raises
    # WEBrick::HTTPStatus::BadRequest when the request is not a valid version 13 handshake.
    def self.accept(req)
      key = req['sec-websocket-key'].to_s
      raise WEBrick::HTTPStatus::BadRequest, 'not a WebSocket handshake' unless upgrade?(req)
      raise WEBrick::HTTPStatus::BadRequest, 'unsupported version' unless req['sec-websocket-version'] == '13'
      raise WEBrick::HTTPStatus::BadRequest, 'bad key' unless (Base64.strict_decode64(key).bytesize rescue 0) == 16

      sock = Thread.current[:WEBrickSocket] or raise WEBrick::HTTPStatus::InternalServerError, 'no socket'
      accept = Base64.strict_encode64(Digest::SHA1.digest(key + GUID))
      sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" \
                 "Sec-WebSocket-Accept: #{accept}\r\n\r\n")
      req.parse(NULL_READER) rescue nil # HTTPServer#run sends no response for a request without a request line
      Connection.new(sock)
    end

    # One server-side connection. Reading is done by one thread (the servlet's); sending may come from any thread.
    class Connection
      def initialize(sock)
        @sock = sock
        @write_lock = Mutex.new
        @closed = false
      end

      attr_reader :closed

      # The next message as [:text | :binary, String], answering pings and joining fragments; nil once closed
      def read_message
        type = nil
        data = String.new(encoding: Encoding::BINARY)
        loop do
          fin, opcode, payload = read_frame
          return nil unless opcode
          case opcode
          when OP_PING then send_frame(OP_PONG, payload)
          when OP_PONG then nil
          when OP_CLOSE
            close(payload.bytesize >= 2 ? payload.byteslice(0, 2).unpack1('n') : 1000)
            return nil
          when OP_TEXT, OP_BINARY
            raise ProtocolError, 'new message inside a fragmented one' if type
            type = opcode == OP_TEXT ? :text : :binary
            data << payload
          when OP_CONT
            raise ProtocolError, 'continuation without a message' unless type
            data << payload
          else raise ProtocolError, "unknown opcode #{opcode}"
          end
          raise ProtocolError, 'message too large' if data.bytesize > MAX_MESSAGE
          next unless type && fin
          return [type, type == :text ? data.force_encoding(Encoding::UTF_8) : data]
        end
      end

      def send_text(str)
        send_frame(OP_TEXT, str.b)
      end

      def ping(data = '')
        send_frame(OP_PING, data.b)
      end

      # Send a close frame (once) and stop reading
      def close(code = 1000)
        @write_lock.synchronize do
          return if @closed
          @closed = true
          write_frame(OP_CLOSE, [code].pack('n')) rescue nil
        end
      end

      private

      # [fin, opcode, payload] of the next frame (unmasked); [nil, nil, nil] at end of stream
      def read_frame
        head = @sock.read(2)
        return [nil, nil, nil] if head.nil? || head.bytesize < 2
        b0, b1 = head.bytes
        raise ProtocolError, 'reserved bits set' if b0 & 0x70 != 0
        raise ProtocolError, 'a client frame must be masked' if b1 & 0x80 == 0
        len = b1 & 0x7F
        len = @sock.read(2).unpack1('n') if len == 126
        len = @sock.read(8).unpack1('Q>') if len == 127
        opcode = b0 & 0x0F
        raise ProtocolError, 'control frame too large' if opcode >= 0x8 && len > 125
        raise ProtocolError, 'frame too large' if len > MAX_MESSAGE
        mask = @sock.read(4).bytes
        payload = len.zero? ? String.new(encoding: Encoding::BINARY) : @sock.read(len)
        return [nil, nil, nil] if payload.nil? || payload.bytesize < len
        bytes = payload.bytes
        bytes.each_index { |i| bytes[i] ^= mask[i & 3] }
        [b0 & 0x80 != 0, opcode, bytes.pack('C*')]
      end

      def send_frame(opcode, payload)
        @write_lock.synchronize do
          raise IOError, 'closed' if @closed
          write_frame(opcode, payload)
        end
      end

      # A server frame is never masked
      def write_frame(opcode, payload)
        len = payload.bytesize
        head = [0x80 | opcode].pack('C')
        head << if len < 126 then [len].pack('C')
                elsif len <= 0xFFFF then [126, len].pack('Cn')
                else [127, len].pack('CQ>')
                end
        @sock.write(head + payload)
      end
    end
  end
end
