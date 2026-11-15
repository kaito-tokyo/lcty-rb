# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The checks every request passes before it is served (LCTYSP-0016, step 1), called by WEBrick's RequestCallback before
# authentication and before any servlet, the WebSocket of /v1/rpc included:
#
#   Host      only a host the server is reached by: an address it listens on, localhost when it listens on a loopback
#             address, and the host of every allowed origin; any other is 421, none or more than one 400
#   OPTIONS   a preflight is 403, with no CORS header: no other origin is ever given access
#   a write   (any method but GET and HEAD) only from the server's own pages: a Sec-Fetch-Site other than same-origin,
#             or an Origin that is not allowed, is 403. A request with neither (curl, the tests) is served
#   the body  at most MAX_BODY bytes by its Content-Length (413), and a body of the JSON API under v1/ must be
#             application/json (415)
#
# A refused request is answered with a short text of its own and logged with what was checked. The text never holds
# the allowed hosts or origins: a page of another site reads the answer to a request it sent with a rebound name.

require 'uri'
require 'webrick'
require_relative 'config'

module Chatty
  class RequestGuard
    MAX_BODY = 64 * 1024 * 1024
    SAFE = %w[GET HEAD].freeze
    JSON_METHODS = %w[POST PUT PATCH].freeze # the methods of the JSON API that carry a body

    # Ends the request with the response the guard has set: WEBrick sends a response whose status was raised as an
    # HTTPStatus::Status that is not an Error as it is, without its own error page
    class Refused < WEBrick::HTTPStatus::Status
      attr_reader :code

      def initialize(code)
        super()
        @code = code
      end
    end

    # 421 is not among WEBrick's reason phrases
    WEBrick::HTTPStatus::StatusMessage[421] ||= 'Misdirected Request'

    # base: the path the site is served under (Chatty.base_url); origins: the allowed origins, normalized
    # (Lcty::Rpc.allowed_origins); listen: [[address, ...], port] the server listens on, asked for each request since
    # the port is known only once it listens; logger gets a line for every refusal
    def initialize(base:, origins:, listen:, logger:)
      @api = "#{base}v1/"
      @rpc = "#{base}v1/rpc"
      @origins = origins
      @listen = listen
      @logger = logger
    end

    # Returns when req may be served; otherwise sets res to the refusal and raises Refused
    def check(req, res)
      check_host(req, res)
      refuse(res, 403, 'preflight', req) if req.request_method == 'OPTIONS'
      check_origin(req, res) unless SAFE.include?(req.request_method)
      check_body(req, res)
    end

    # The hosts the server answers for, as a Host header names them: lower case, each with and without the default port
    # of its scheme
    def hosts
      ips, port = @listen.call
      own = ips.map { |ip| "#{Chatty.url_host(ip)}:#{port}" }
      own << "localhost:#{port}" if ips.any? { |ip| %w[127.0.0.1 ::1].include?(ip) }
      from_origins = @origins.call.flat_map do |o|
        u = URI.parse(o) rescue nil
        next [] unless u&.host
        host = u.host.downcase
        host = "[#{host}]" if host.include?(':') && !host.start_with?('[')
        [host + (u.port == u.default_port ? '' : ":#{u.port}"), "#{host}:#{u.port}"]
      end
      (own + from_origins).map(&:downcase).uniq
    end

    private

    def check_host(req, res)
      values = Array(req.header['host'])
      refuse(res, 400, 'a request needs one Host', req) unless values.size == 1
      host = values[0].to_s.strip.downcase
      refuse(res, 421, 'misdirected request', req, "Host #{host[0, 200].inspect}") unless hosts.include?(host)
    end

    def check_origin(req, res)
      site = req['sec-fetch-site']
      if site && site != 'same-origin'
        refuse(res, 403, 'cross-origin', req, "Sec-Fetch-Site #{site[0, 40].inspect}, Origin #{req['origin'].to_s[0, 200].inspect}")
      end
      origin = req['origin']
      return if origin.nil? || @origins.call.include?(normalize(origin))

      refuse(res, 403, 'cross-origin', req, "Origin #{origin[0, 200].inspect}; allowed: #{@origins.call.join(' ')}")
    end

    def check_body(req, res)
      refuse(res, 413, 'too large', req) if req['content-length'].to_i > MAX_BODY
      return unless JSON_METHODS.include?(req.request_method) && req.path.start_with?(@api) && req.path != @rpc

      type = req['content-type'].to_s.split(';').first.to_s.strip.downcase
      refuse(res, 415, 'the body must be application/json', req) unless type == 'application/json'
    end

    # An origin as browsers send it: scheme://host[:port], lower case, the default port left out (as Lcty::Rpc)
    def normalize(origin)
      u = URI.parse(origin.to_s.strip) rescue nil
      return nil unless u&.scheme && u.host
      port = u.port == u.default_port ? '' : ":#{u.port}"
      "#{u.scheme.downcase}://#{u.host.downcase}#{port}"
    end

    # Answer status with text (no detail of the settings), log why, and end the request
    def refuse(res, status, text, req, why = nil)
      @logger.error("lcty-rb: refused #{req.request_method} #{req.path.to_s[0, 200].inspect} (#{status} #{text})" \
                    "#{why ? ": #{why}" : ''}")
      res.status = status
      res['Content-Type'] = 'text/plain; charset=utf-8'
      res.body = "#{text}\n"
      res.keep_alive = false
      raise Refused, status
    end
  end
end
