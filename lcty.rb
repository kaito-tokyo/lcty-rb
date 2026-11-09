#!/usr/bin/ruby
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# lcty-rb: static file server + JSON document store.
# Runs on macOS /usr/bin/ruby (2.6) with the standard library only. Never talks to the LLM (LCTYSP-0001).
#
#   /usr/bin/ruby lcty.rb                            # => http://127.0.0.1:45280
#   LCTY_HOST=192.168.1.10 /usr/bin/ruby lcty.rb     # => http://192.168.1.10:45280 (that address only)
#   LCTY_BASE_URL=/lcty/ /usr/bin/ruby lcty.rb       # => the site under /lcty/
#
# Start it in the root of the repository: the files of the site are found from the working directory (public/…). This
# file only wires the servlets together; the code lives in lib/ (lib/servlets.rb for the site, lib/v1/ for the API,
# LCTYSP-0005).

# Without LANG the default is US-ASCII, so fix it first (LCTYSP-0001).
Encoding.default_external = Encoding::UTF_8

require 'fileutils'
require 'securerandom'
require 'webrick'
require_relative 'lib/config'
require_relative 'lib/store'
require_relative 'lib/v1/servlet'
require_relative 'lib/servlets'
require_relative 'lib/rpc/servlet'

module Lcty
  # The path the site is served under: LCTY_BASE_URL, starting and ending with "/" ("/" when it is unset or empty)
  BASE_URL = "/#{ENV['LCTY_BASE_URL'].to_s.delete_prefix('/').delete_suffix('/')}/".squeeze('/').freeze

  # The files of /lcty.v1/ (LCTYSP-0005): each under its own name, which the pages and the scripts load, and the names
  # of version 1 that conversation files and tag files load next to themselves (C and T redirect them here)
  LCTY_V1_FILES = {
    'lcty.v1.cjs' => 'public/lcty.v1/lcty.v1.cjs',
    'lcty.v1.lang-ja.cjs' => 'public/lcty.v1/lcty.v1.lang-ja.cjs',
    'lcty.v1.css' => 'public/lcty.v1/lcty.v1.css',
    'lcty.v1.async.mjs' => 'public/lcty.v1/lcty.v1.async.mjs',
    'lcty.v1.c.worker.cjs' => 'public/lcty.v1/lcty.v1.c.worker.cjs',
    'lcty.v1.t.worker.cjs' => 'public/lcty.v1/lcty.v1.t.worker.cjs',
    'lcty.v1.js' => 'public/lcty.v1/lcty.v1.cjs',
    'lcty.v1.lang-ja.js' => 'public/lcty.v1/lcty.v1.lang-ja.cjs',
    'lcty.v1.module.js' => 'public/lcty.v1/lcty.v1.async.mjs'
  }.freeze

  # The module entries of the pages, served as they are: the browser imports the modules of public/js/ they import
  # (../js/…) over HTTP. A file opened directly (file://) runs no module, so nothing is bundled.
  ENTRIES = %w[c/index.js t/index.js t/tag-file.js].freeze

  # What a file opened directly (offline) reads next to itself, copied into every data directory that holds HTML at
  # startup, under the names it loads (LCTYSP-0010): a backup of the data keeps them together with the files
  OFFLINE_FILES = {
    'lcty.v1.js' => 'public/lcty.v1/lcty.v1.cjs',
    'lcty.v1.css' => 'public/lcty.v1/lcty.v1.css'
  }.freeze
  OFFLINE_DIRS = [Chatty::DATA_DIR, Chatty::CONV_DIR, Chatty::TAG_DIR].freeze

  # Copy OFFLINE_FILES into OFFLINE_DIRS, each by an atomic replace and only when its bytes changed. Other files there
  # (copies an older server made, …) are left as they are: they belong to the user.
  def self.publish_offline
    OFFLINE_FILES.each do |name, path_from_pwd|
      body = File.binread(path_from_pwd)
      OFFLINE_DIRS.each do |dir|
        path = File.join(dir, name)
        next if File.exist?(path) && File.binread(path) == body
        FileUtils.mkdir_p(dir)
        tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
        File.binwrite(tmp, body)
        File.rename(tmp, path)
      end
    end
  end

  # Mount every servlet of the site on server, under base (LCTY_BASE_URL)
  def self.mount_all(server, base = BASE_URL)
    server.mount "#{base}v1", Chatty::V1::Servlet
    server.mount "#{base}v1/rpc", Rpc::Servlet # prototype (JSON-RPC 2.0 over WebSocket or POST)
    server.mount "#{base}c", Servlets::C, Chatty::CONV_DIR
    server.mount "#{base}t", Servlets::T, Chatty::TAG_DIR
    LCTY_V1_FILES.each { |name, path| server.mount "#{base}lcty.v1/#{name}", Servlets::StaticFileServlet, path }
    server.mount_proc("#{base}lcty.v1") { raise WEBrick::HTTPStatus::NotFound } # nothing else is under /lcty.v1/
    ENTRIES.each { |entry| server.mount "#{base}#{entry}", Servlets::StaticFileServlet, "public/#{entry}" }
    server.mount base, Servlets::PublicDirectoryServlet, 'public'
    server
  end

  def self.run
    Chatty.open_data
    Rpc.index = Chatty::INDEX # c_recordcount of /v1/rpc lives in _index.sqlite with every other cache
    Rpc::ConvStore.fill_record_counts
    publish_offline
    s = WEBrick::HTTPServer.new(
      BindAddress: Chatty::BIND,
      Port: Chatty::PORT,
      MimeTypes: Servlets::MIME_TYPES,
      Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN),
      AccessLog: [],
      DoNotReverseLookup: true
    )
    mount_all(s)
    %w[INT TERM].each { |sig| trap(sig) { s.shutdown } }
    $stderr.puts "lcty-rb: http://#{Chatty::BIND_URL_HOST}:#{Chatty::PORT}#{BASE_URL}  (data: #{Chatty::DATA_DIR})"
    s.start
  end
end

Lcty.run if $PROGRAM_NAME == __FILE__
