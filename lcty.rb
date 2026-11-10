#!/usr/bin/ruby
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# lcty-rb: static file server + JSON document store.
# Runs on macOS /usr/bin/ruby (2.6) with the standard library only. Never talks to the LLM (LCTYSP-0001).
#
#   /usr/bin/ruby lcty.rb                            # => http://127.0.0.1:45280, or the next free port up to 45379
#   LCTY_PORT=8080 /usr/bin/ruby lcty.rb             # => http://127.0.0.1:8080 (that port only; PORT if unset)
#   /usr/bin/ruby lcty.rb --host=192.168.1.10        # => http://192.168.1.10:45280 (that address only)
#   /usr/bin/ruby lcty.rb --base-url=/lcty/          # => the site under /lcty/
#   /usr/bin/ruby lcty.rb --help                     # => every option
#
# The port is an environment variable only (LCTY_PORT, else PORT), and LCTY_DATA_DIR says where the data directory is.
# The options can also be written one per line in server_settings.txt of the data directory; LCTY_HOST, LCTY_BASE_URL
# and LCTY_ALLOWED_ORIGIN override the file, and the command line overrides both (LCTYSP-0010).
#
# Start it in the root of the repository: the files of the site are found from the working directory (public/…). This
# file only wires the servlets together; the code lives in lib/ (lib/servlets.rb for the site, lib/v1/ for the API,
# LCTYSP-0005).

# Without LANG the default is US-ASCII, so fix it first (LCTYSP-0001).
Encoding.default_external = Encoding::UTF_8

require 'fileutils'
require 'securerandom'
require 'webrick'
begin
  require_relative 'lib/config'
rescue Chatty::SettingsError => e # a server_settings.txt or an environment variable that cannot be used (LCTYSP-0010)
  abort "lcty-rb: #{e.message}"
end
require_relative 'lib/store'
require_relative 'lib/v1/servlet'
require_relative 'lib/servlets'
require_relative 'lib/rpc/servlet'

module Lcty
  # The path the site is served under (Chatty.base_url: --base-url or LCTY_BASE_URL), starting and ending with "/"
  # ("/" when it is unset or empty)
  def self.base_url
    "/#{Chatty.base_url.to_s.delete_prefix('/').delete_suffix('/')}/".squeeze('/')
  end

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

  # Mount every servlet of the site on server, under base (the base URL)
  def self.mount_all(server, base = base_url)
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

  # No port to listen on: the one asked for is taken, or every one tried is
  class PortError < StandardError; end

  # A WEBrick server listening on Chatty.bind at the port asked for (LCTY_PORT or PORT), or else at the first free one
  # of ports, in order (LCTYSP-0010); Chatty.port is set to it. A port asked for that is taken is not replaced by
  # another: the pages, bookmarks and allowed origins name it. Raises PortError when there is none.
  def self.listen(asked = Chatty::PORT, ports = Chatty::PORTS_TRIED)
    (asked ? [asked] : ports).each do |port|
      server = WEBrick::HTTPServer.new(
        BindAddress: Chatty.bind,
        Port: port,
        MimeTypes: Servlets::MIME_TYPES,
        Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN),
        AccessLog: [],
        DoNotReverseLookup: true
      )
      Chatty.port = port
      return server
    rescue Errno::EADDRINUSE
      raise PortError, "the port #{port} (LCTY_PORT or PORT) is in use" if asked
    end
    raise PortError, "no free port from #{ports.first} to #{ports.last} (set one with LCTY_PORT or PORT)"
  end

  def self.run
    Chatty.open_data
    Rpc.index = Chatty::INDEX # c_recordcount of /v1/rpc lives in _index.sqlite with every other cache
    Rpc.tags = Chatty::TAGS # the tags the index records with the rounds /v1/rpc writes
    Rpc.c_store = Chatty::C_STORE # c.stats.put and c.stats.list
    # Changes through the HTTP API (the tags of a conversation, deleting one) are announced over /v1/rpc too
    Chatty.committer = ->(method, &block) { Rpc::HUB.commit(nil, method, &block) }
    Rpc::ConvStore.fill_record_counts
    publish_offline
    s = begin
      listen
    rescue PortError => e
      abort "lcty-rb: #{e.message}"
    end
    mount_all(s)
    %w[INT TERM].each { |sig| trap(sig) { s.shutdown } }
    $stderr.puts "lcty-rb: http://#{Chatty.bind_url_host}:#{Chatty.port}#{base_url}  (data: #{Chatty::DATA_DIR})"
    # A page opened from another origin cannot use /v1/rpc (LCTYSP-0012): say which ones can
    $stderr.puts "lcty-rb: pages may be opened from #{Rpc.allowed_origins.join(' ')}  (--allowed-origin)"
    settings = File.exist?(Chatty::SETTINGS_PATH) ? Chatty::SETTINGS_PATH : "none (#{Chatty::SETTINGS_PATH} does not exist)"
    $stderr.puts "lcty-rb: settings: #{settings}"
    s.start
  end
end

module Lcty
  # `lcty.rb convert`, with the server stopped: convert the conversation files of c/ to LCTYSP-0013 once
  # (lib/convert_c.rb). Returns whether every file could be converted.
  def self.convert(out = $stderr)
    require_relative 'lib/c_store'
    require_relative 'lib/convert_c'
    Chatty::TagStore.rename_former(Chatty::FORMER_TAGS_DB_PATH, Chatty::TAGS_DB_PATH)
    tags = Chatty::TagStore.new(Chatty::TAGS_DB_PATH)
    c_store = Chatty::CStore.new(Chatty::C_DB_PATH)
    begin
      r = Chatty::ConvertC.run(tags: tags, c_store: c_store, out: out)
    ensure
      c_store.close
    end
    out.puts "lcty-rb convert: #{r[:converted].size} converted, #{r[:current].size} already lcty-msg, " \
             "#{r[:failed].size} failed (the files as they were are in #{Chatty::FORMER_CONV_DIR})"
    r[:failed].empty?
  end

  # The command line: its options (those of server_settings.txt, LCTYSP-0010) override the file and the environment;
  # no other argument starts the server, and `convert` converts the conversation files
  def self.main(argv)
    args = begin
      Chatty.configure(argv.dup)
    rescue Chatty::SettingsError => e
      abort "lcty-rb: #{e.message}\n#{Chatty.option_parser({}).help}"
    end
    case args
    when [] then run
    when ['convert'] then exit(convert ? 0 : 1)
    else abort Chatty.option_parser({}).help
    end
  end
end

Lcty.main(ARGV) if $PROGRAM_NAME == __FILE__
