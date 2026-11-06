#!/usr/bin/ruby

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
#
# lcty-rb: static file server + JSON document store.
# Runs on macOS /usr/bin/ruby (2.6) with the standard library only. Never talks to the LLM (LCTYSP-001).
#
#   /usr/bin/ruby lcty.rb        # => http://127.0.0.1:8765
#
# This file only wires the servlets together (plus transparent gzip); the code lives in lib/ (LCTYSP-005).

# Without LANG the default is US-ASCII, so fix it first (LCTYSP-001).
Encoding.default_external = Encoding::UTF_8

require 'webrick'
require 'zlib'
require_relative 'lib/config'
require_relative 'lib/store'
require_relative 'lib/guard'
require_relative 'lib/page_servlet'
require_relative 'lib/module_servlet'
require_relative 'lib/c/servlet'
require_relative 'lib/v1/servlet'

module Chatty
  MIME_TYPES = WEBrick::HTTPUtils::DefaultMimeTypes.merge(
    'html' => 'text/html; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'svg' => 'image/svg+xml'
  ).freeze

  # Transparent gzip for every servlet (WEBrick has none). Applied to 200 responses of text-like types once the servlet
  # has finished; 304 / 206, HEAD and small bodies are left alone. The ETag is kept as is (with Vary), so the servlets'
  # own conditional GETs (If-None-Match) keep working.
  class GzipServer < WEBrick::HTTPServer
    GZIP_TYPES = %r{\A(?:text/|application/(?:json|javascript)|image/svg\+xml)}
    MIN_SIZE = 1024

    def service(req, res)
      super
      return unless res.status == 200 && req.request_method == 'GET' && res['content-encoding'].nil?
      return unless GZIP_TYPES.match?(res['content-type'].to_s)
      size = res.body.respond_to?(:read) ? res['content-length'].to_i : res.body.to_s.bytesize
      return if size < MIN_SIZE
      res['vary'] = 'Accept-Encoding' # Set for every client, so a cache never hands a plain copy as the gzip one or back
      return unless accepts_gzip?(req['accept-encoding'])
      body = res.body.respond_to?(:read) ? read_and_close(res.body) : res.body.to_s
      res.body = Zlib.gzip(body)
      res['content-encoding'] = 'gzip'
      res['content-length'] = res.body.bytesize.to_s
    end

    private

    # Accept-Encoding allows gzip: "gzip" (or "*" when gzip is not named) with a q-value above 0.
    # WEBrick::HTTPUtils.parse_qvalues keeps entries with q=0, so it cannot be used here.
    def accepts_gzip?(header)
      q = header.to_s.split(',').map { |part| part.strip.split(/\s*;\s*q=/i, 2) }.map { |name, v| [name.downcase, v ? v.to_f : 1.0] }.to_h
      (q['gzip'] || q['x-gzip'] || q['*'] || 0) > 0
    end

    def read_and_close(io)
      io.read
    ensure
      io.close
    end
  end

  def self.run
    open_data
    C.publish_assets
    server = GzipServer.new(
      BindAddress: BIND,
      Port: PORT,
      MimeTypes: MIME_TYPES,
      RequestCallback: GUARD,
      Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN),
      AccessLog: [],
      DoNotReverseLookup: true
    )
    server.mount('/v1', V1::Servlet)
    server.mount('/c', C::Servlet)
    server.mount('/tags', PageServlet, 'tags.html')
    server.mount('/settings', PageServlet, 'settings.html')
    ModuleServlet.mount_all(server)
    server.mount('/', WEBrick::HTTPServlet::FileHandler, PUBLIC_DIR, FancyIndexing: false)
    %w[INT TERM].each { |sig| trap(sig) { server.shutdown } }
    $stderr.puts "lcty-rb: http://#{BIND}:#{PORT}/  (data: #{DATA_DIR})"
    server.start
  end
end

Chatty.run if $PROGRAM_NAME == __FILE__
