# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Server settings (LCTYSP-0010). Two are environment variables only: LCTY_DATA_DIR, where the data directory is, and
# the port (LCTY_PORT, else PORT; without either lcty.rb takes the first free port from 45280). The others are options
# of lcty.rb (--bind-ip, --base-url, --allowed-origin), written one per line in server_settings.txt of the data
# directory or given on the command line; an environment variable that is set and not empty overrides the file with
# one value (LCTY_BIND_IP, LCTY_BASE_URL, LCTY_ALLOWED_ORIGIN: the environment is for starting quickly), and the
# command line overrides both. Everything else is a browser setting.

require 'ipaddr'
require 'optparse'
require_relative 'password' # the hashes of --basic-auth

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

  # A setting that cannot be used: the server does not start (lcty.rb prints the message)
  class SettingsError < StandardError; end

  # ---- The port: environment variables only ----

  # The port asked for: LCTY_PORT, else PORT (set and not empty), or nil when neither is (then lcty.rb takes the first
  # free one of PORTS_TRIED). A port that is not an integer from 1 to 65535 stops the server.
  PORT = [ENV['LCTY_PORT'], ENV['PORT']].map(&:to_s).find { |v| !v.empty? }&.yield_self do |v|
    port = Integer(v, 10) rescue nil
    raise SettingsError, "the port must be an integer from 1 to 65535: #{v.inspect}" unless port && (1..65_535).cover?(port)
    port
  end
  PORTS_TRIED = (45_280..45_379).freeze # tried in order when no port is asked for

  class << self
    # The port the server listens on, which lcty.rb sets once it is listening; before that PORT, or the first of
    # PORTS_TRIED
    attr_writer :port

    def port
      @port || PORT || PORTS_TRIED.first
    end
  end

  # ---- The other settings: server_settings.txt, the environment and the command line ----

  # Source of truth (no leading _): the options of lcty.rb, one per line (`--bind-ip=0.0.0.0`, or the option and its
  # value separated by spaces), as they would be written on the command line; blank lines and lines starting with # are
  # left out. A missing file means every default; nothing is created.
  SETTINGS_PATH = File.join(DATA_DIR, 'server_settings.txt')
  # The file of the users of Digest authentication of an older version. It is not read any more; the server does not
  # start while it is there, so that it never runs without the protection it was given (LCTYSP-0010)
  HTDIGEST_PATH = File.join(DATA_DIR, '.htdigest')
  # Each setting and the environment variable that overrides the file
  SETTING_ENV = {
    bind_ips: 'LCTY_BIND_IP', base_url: 'LCTY_BASE_URL', allowed_origins: 'LCTY_ALLOWED_ORIGIN',
    basic_users: 'LCTY_BASIC_AUTH'
  }.freeze
  # The settings that take several values (once per option); their environment variable takes one only, since the
  # environment is for starting the server quickly, and more are given as options (LCTYSP-0010)
  SETTING_LISTS = %i[bind_ips allowed_origins basic_users].freeze
  SETTING_DEFAULTS = { bind_ips: ['127.0.0.1'].freeze, base_url: '/', allowed_origins: nil, basic_users: [].freeze }.freeze
  OPTION_OF = { bind_ips: '--bind-ip', allowed_origins: '--allowed-origin', basic_users: '--basic-auth' }.freeze

  # The options of lcty.rb, the same for the file and the command line; what they set goes into into
  def self.option_parser(into)
    OptionParser.new do |o|
      o.banner = 'usage: lcty.rb [options] [convert | hash-password USER]'
      o.on('--bind-ip=ADDRESS', 'an IP address to listen on, once per address (default 127.0.0.1)') do |v|
        raise SettingsError, "not an IP address to listen on: #{v.inspect}" unless ip_address?(v)
        (into[:bind_ips] ||= []) << v
      end
      o.on('--base-url=PATH', 'the path the site is served under (default /)') { |v| into[:base_url] = v }
      o.on('--allowed-origin=ORIGIN', 'an origin whose pages may use /v1/rpc, once per origin (default: the ' \
                                      "server's own)") { |v| (into[:allowed_origins] ||= []) << v }
      o.on('--basic-auth=USER:HASH', 'a user of Basic authentication, once per user, as `lcty.rb hash-password ' \
                                     'USER` prints it; with one, every request needs one (default: none)') do |v|
        users = (into[:basic_users] ||= [])
        user = basic_user(v)
        raise SettingsError, "--basic-auth: the user #{user[0].inspect} is given twice" if users.assoc(user[0])
        users << user
      end
      # Each server of a machine needs a port of its own, so it is not kept with the data (LCTYSP-0010)
      o.on('--port=PORT', 'not an option: set LCTY_PORT or PORT') do
        raise SettingsError, 'the port is not an option; set LCTY_PORT or PORT'
      end
      # The data directory holds server_settings.txt, so it is said before any option is read (LCTYSP-0010)
      o.on('--data-dir=DIR', 'not an option: set LCTY_DATA_DIR') do
        raise SettingsError, 'the data directory is not an option; set LCTY_DATA_DIR'
      end
    end
  end

  # Whether s is one IPv4 or IPv6 address, written as an address (no prefix length, no brackets, no host name)
  def self.ip_address?(s)
    !s.include?('/') && IPAddr.new(s) && true
  rescue IPAddr::Error
    false
  end

  # [user, hash] of the value of --basic-auth, USER:HASH with HASH a PHC string of lib/password.rb; raises SettingsError
  # when it is not one. The hash is not shown in the message, only what is wrong with it
  def self.basic_user(v)
    user, hash = v.split(':', 2)
    unless hash && Password::USER_RE.match?(user)
      raise SettingsError, '--basic-auth: not USER:HASH, as `lcty.rb hash-password USER` prints it'
    end
    begin
      Password.parse(hash)
    rescue Password::Error => e
      raise SettingsError, "--basic-auth: the user #{user.inspect}: #{e.message}"
    end
    [user, hash].freeze
  end

  # What the options args set, {setting => value}; args loses the options it had and keeps the other arguments. An
  # option that is not one, or lacks its value, raises SettingsError naming source.
  def self.parse_options(args, source)
    set = {}
    option_parser(set).parse!(args)
    set
  rescue OptionParser::ParseError, SettingsError => e
    raise SettingsError, "#{source}: #{e.message}"
  end

  # The arguments the lines of the file at path stand for ([] when there is none). A line that is not an option is an
  # error: the file holds options only.
  def self.file_args(path)
    return [] unless File.exist?(path)
    File.read(path, mode: 'r:UTF-8').each_line.map(&:strip).reject { |l| l.empty? || l.start_with?('#') }.flat_map do |l|
      raise SettingsError, "#{path}: not an option: #{l}" unless l.start_with?('--')
      l.split(/\s+/, 2)
    end
  end

  # What the environment variables set when they are set and not empty, one value each: LCTY_BIND_IP one address,
  # LCTY_ALLOWED_ORIGIN one origin. A value with a comma or whitespace in it is refused, so a list is never taken apart
  # one way here and another way elsewhere.
  def self.env_settings
    SETTING_ENV.each_with_object({}) do |(key, var), set|
      v = ENV[var].to_s
      next if v.empty?
      next set[key] = v unless SETTING_LISTS.include?(key)
      if v.match?(/[\s,]/)
        raise SettingsError, "#{var}: one value only; give more with #{OPTION_OF[key]} in server_settings.txt"
      end
      raise SettingsError, "#{var}: not an IP address to listen on: #{v.inspect}" if key == :bind_ips && !ip_address?(v)
      next set[key] = [basic_user(v)] if key == :basic_users

      set[key] = [v]
    end
  end

  # Compute the settings: the defaults, then server_settings.txt, then the environment, then the options of argv (the
  # command line), each replacing the ones before. argv loses its options; the other arguments are returned. A setting
  # that cannot be used raises SettingsError. lib/config.rb runs it with no arguments when it is loaded, and lcty.rb
  # again with its command line.
  def self.configure(argv = [])
    file = parse_options(file_args(SETTINGS_PATH), SETTINGS_PATH)
    command_line = parse_options(argv, 'the command line')
    s = SETTING_DEFAULTS.merge(file).merge(env_settings).merge(command_line)
    @settings = s.merge(bind_ips: s[:bind_ips].uniq.freeze).freeze # an address given twice is listened on once
    argv
  end

  class << self
    # The IP addresses to listen on, at one port, in the order given
    def bind_ips
      @settings[:bind_ips]
    end

    # An address as written in a URL (an IPv6 address in brackets)
    def url_host(ip)
      ip.include?(':') ? "[#{ip}]" : ip
    end

    # The path the site is served under, as written (lcty.rb makes it start and end with /)
    def base_url
      @settings[:base_url]
    end

    # The origins whose pages may use /v1/rpc as written, or nil for the server's own (lib/rpc/servlet.rb)
    def allowed_origins
      @settings[:allowed_origins]
    end

    # The users of Basic authentication, {user => PHC string}; empty when no request needs credentials
    def basic_users
      @settings[:basic_users].to_h.freeze
    end
  end

  configure
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
