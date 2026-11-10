# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Server settings (LCTYSP-0010). LCTY_DATA_DIR, an environment variable, says where the data directory is; the other
# settings are in its server_settings.json (port, host, base_url, allowed_origins), and an environment variable that is
# set and not empty overrides one (PORT, LCTY_HOST, LCTY_BASE_URL, LCTY_ALLOWED_ORIGIN). Everything else is a browser
# setting. lcty.rb uses BASE_URL_SETTING, lib/rpc/servlet.rb ALLOWED_ORIGINS_SETTING.

require 'json'

module Chatty
  class << self
    # Announces a change made outside /v1/rpc (the HTTP API): ->(method) { records }, set by lcty.rb to the hub of
    # lib/rpc/servlet.rb, which runs the block under its lock and sends its records as one method notification with
    # the next version (LCTYSP-0014). Unset (the tests, `lcty.rb convert`), the block only runs.
    attr_accessor :committer

    # Run the change in the block, which returns its records [{store, op, row}, ...], and announce it as method
    def commit(method, &block)
      committer ? committer.call(method, &block) : block.call
    end
  end

  ROOT = File.expand_path('..', __dir__)
  PUBLIC_DIR = File.join(ROOT, 'public')
  # Default: the per-user application data folder, outside the repository (LCTYSP-0010). On macOS (and, for now, Windows)
  # ~/Library/Application Support; elsewhere $XDG_DATA_HOME, or ~/.local/share when it is unset or not absolute (the XDG
  # Base Directory spec). A relative LCTY_DATA_DIR is resolved against the repository root.
  APP_ID = 'tokyo.kaito.lcty-rb'
  XDG_DATA_HOME = ENV['XDG_DATA_HOME'].to_s.start_with?('/') ? ENV['XDG_DATA_HOME'] : File.join(Dir.home, '.local', 'share')
  DEFAULT_DATA_DIR =
    if RUBY_PLATFORM =~ /darwin|mswin|mingw|cygwin/
      File.join(Dir.home, 'Library', 'Application Support', APP_ID, 'Data')
    else
      File.join(XDG_DATA_HOME, APP_ID, 'Data')
    end
  DATA_DIR = File.expand_path(ENV['LCTY_DATA_DIR'].to_s.empty? ? DEFAULT_DATA_DIR : ENV['LCTY_DATA_DIR'], ROOT)
  CONV_DIR = File.join(DATA_DIR, 'c') # Same layout as the URL /c/<id>.html (LCTYSP-0003)
  TAG_DIR = File.join(DATA_DIR, 't') # Source of truth: one HTML file per tag (LCTYSP-0009)
  TAG_LOCK_PATH = File.join(DATA_DIR, 't.lock') # Holds no data: flock is taken on it for t/
  # One SQLite file per resource, cut as the browser's IndexedDB databases are (LCTYSP-0015)
  TAGS_DB_PATH = File.join(DATA_DIR, 'lcty_t.sqlite') # Source of truth (the current tags of conversations)
  FORMER_TAGS_DB_PATH = File.join(DATA_DIR, 'tags.sqlite') # Renamed to TAGS_DB_PATH at startup
  C_DB_PATH = File.join(DATA_DIR, 'lcty_c.sqlite') # Source of truth (what the conversation files of c/ do not hold)
  # Where `lcty.rb convert` keeps every conversation file as it was before converting it to LCTYSP-0013; never deleted
  FORMER_CONV_DIR = File.join(DATA_DIR, 'c-former')
  # Files in data/ starting with _ are derived data that can be rebuilt after deletion (LCTYSP-0010); _index.sqlite is
  # discarded and made anew at every start
  INDEX_PATH = File.join(DATA_DIR, '_index.sqlite')

  # ---- server_settings.json ----

  # Source of truth (no leading _), read once when this file is loaded. A missing file means every default; nothing is
  # created.
  SETTINGS_PATH = File.join(DATA_DIR, 'server_settings.json')
  # Each key of the file and the environment variable that overrides it
  SETTING_ENV = {
    'port' => 'PORT', 'host' => 'LCTY_HOST', 'base_url' => 'LCTY_BASE_URL', 'allowed_origins' => 'LCTY_ALLOWED_ORIGIN'
  }.freeze

  # A server_settings.json that cannot be used: the server does not start (lcty.rb prints the message)
  class SettingsError < StandardError; end

  # The settings of the file at path, checked: {} when there is no file. A file that is not JSON, not an object, has a
  # key that is not a setting or a value of the wrong type raises SettingsError naming the file, so a typo never
  # passes unseen.
  def self.read_settings(path)
    return {} unless File.exist?(path)
    s = begin
      JSON.parse(File.read(path, mode: 'r:UTF-8'))
    rescue JSON::ParserError => e
      raise SettingsError, "#{path}: not JSON: #{e.message.lines.first.to_s.strip}"
    end
    raise SettingsError, "#{path}: must be a JSON object" unless s.is_a?(Hash)
    unknown = s.keys - SETTING_ENV.keys
    unless unknown.empty?
      raise SettingsError, "#{path}: unknown setting #{unknown.map(&:inspect).join(', ')} (known: #{SETTING_ENV.keys.join(', ')})"
    end
    bad = lambda { |key, what| raise SettingsError, "#{path}: #{key} must be #{what}" }
    bad.call('port', 'an integer from 1 to 65535') if s.key?('port') && !(s['port'].is_a?(Integer) && (1..65_535).cover?(s['port']))
    bad.call('host', 'a non-empty string') if s.key?('host') && !(s['host'].is_a?(String) && !s['host'].empty?)
    bad.call('base_url', 'a string') if s.key?('base_url') && !s['base_url'].is_a?(String)
    if s.key?('allowed_origins') &&
       !(s['allowed_origins'].is_a?(Array) && s['allowed_origins'].all? { |o| o.is_a?(String) && !o.empty? })
      bad.call('allowed_origins', 'an array of non-empty strings')
    end
    s
  end

  SETTINGS = read_settings(SETTINGS_PATH).freeze

  # The environment variable of key when it is set and not empty, else the file's value (nil when neither has one)
  def self.setting(key)
    env = ENV[SETTING_ENV.fetch(key)].to_s
    env.empty? ? SETTINGS[key] : env
  end

  PORT = Integer(setting('port') || 45280)
  BIND = setting('host') || '127.0.0.1' # The address to listen on
  BASE_URL_SETTING = setting('base_url') || '/' # The path the site is served under, as written (lcty.rb)
  # The origins whose pages may use /v1/rpc as written, or nil for the server's own (lib/rpc/servlet.rb). In the
  # environment variable they are separated by commas or spaces
  ALLOWED_ORIGINS_SETTING = setting('allowed_origins').yield_self do |o|
    o.is_a?(String) ? o.split(/[\s,]+/).reject(&:empty?) : o
  end
  BIND_URL_HOST = BIND.include?(':') ? "[#{BIND}]" : BIND # As written in a URL (an IPv6 address in brackets)
  ID_RE = /\A[A-Za-z0-9_-]{1,80}\z/
  # A reference from a conversation to a tag: the file-name part of its tag file (`c~23` for C#), derived by the browser
  # (LCTYSP-0009). Checked mechanically only, never rewritten: no whitespace (data-setup-tags is space separated, and
  # the search box splits on JavaScript's \s, which also takes U+3000, U+00A0 and U+FEFF), no control character, no
  # '/', '\' or ':', and at most TAG_REF_MAX_BYTES (255 minus "NNNNN-" and ".html")
  TAG_REF_RE = %r{\A[^[:space:][:cntrl:]\u{FEFF}/\\:]+\z}.freeze
  TAG_REF_MAX_BYTES = 244

  def self.tag_ref?(s)
    s.is_a?(String) && s.valid_encoding? && s.bytesize <= TAG_REF_MAX_BYTES && TAG_REF_RE.match?(s)
  end

  class HttpError < StandardError
    attr_reader :status
    def initialize(status, message)
      super(message)
      @status = status
    end
  end
end
