# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3008: the scenarios of docs/specs/LCTYSP-3008_server-settings.feature, written by hand. Each test has the title
# of its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
#
# lib/config.rb computes its constants when it is loaded, so the settings are read in a new Ruby process (the Ruby
# running the tests) given only the environment of the scenario; the patterns and HttpError are tested here.

require_relative 'helper'
require 'config'
require 'json'
require 'open3'
require 'rbconfig'

class ConfigTest < Lcty::Scenarios
  CONFIG = File.expand_path('../../lib/config.rb', __dir__)
  REPO_ROOT = File.expand_path('../..', __dir__)
  SETTINGS = %w[LCTY_PORT PORT LCTY_BIND_IP LCTY_DATA_DIR XDG_DATA_HOME LCTY_BASE_URL LCTY_ALLOWED_ORIGIN
                LCTY_BASIC_AUTH LCTY_TEST_ARGS].freeze
  # Hashes of lib/password.rb for the users of Basic authentication (few iterations, made once)
  HASH_A = Chatty::Password.create('correct horse battery', iterations: 1000)
  HASH_B = Chatty::Password.create('staple battery horse', iterations: 1000)
  CONSTANTS = %w[ROOT PUBLIC_DIR XDG_DATA_HOME DEFAULT_DATA_DIR DATA_DIR CONV_DIR TAG_DIR TAG_LOCK_PATH TAGS_DB_PATH
                 FORMER_TAGS_DB_PATH INDEX_PATH PORT SETTINGS_PATH].freeze
  # The lines of a server_settings.txt that sets every setting of the file
  FILE = ['# a comment', '', '--bind-ip=0.0.0.0', '--bind-ip ::1', '--bind-ip=0.0.0.0', '--base-url /lcty/',
          '--allowed-origin=http://a.test:8080', '--allowed-origin=http://b.test:8080'].freeze
  # Prints the constants of lib/config.rb (PORTS_TRIED as its first and last port), the settings after
  # Chatty.configure was given the JSON array LCTY_TEST_ARGS (none by default) and what it returned, and the platform of
  # the process, as JSON
  SCRIPT = "require #{CONFIG.dump}; require 'json'; " \
           "rest = Chatty.configure(JSON.parse(ENV['LCTY_TEST_ARGS'] || '[]')); " \
           "puts JSON.generate(Hash[#{CONSTANTS.inspect}.map { |n| [n, Chatty.const_get(n)] }]" \
           ".merge('PORTS_TRIED' => [Chatty::PORTS_TRIED.first, Chatty::PORTS_TRIED.last], " \
           "'bind_ips' => Chatty.bind_ips, 'base_url' => Chatty.base_url, " \
           "'allowed_origins' => Chatty.allowed_origins, 'basic_users' => Chatty.basic_users, 'rest' => rest, " \
           "'RUBY_PLATFORM' => RUBY_PLATFORM))".freeze

  def setup
    @tmp = Dir.mktmpdir('lcty-config-')
    @home = File.join(@tmp, 'home')
    @cwd = File.join(@tmp, 'cwd')
    FileUtils.mkdir_p([@home, @cwd])
    @env = {}
  end

  def teardown
    FileUtils.rm_rf(@tmp)
  end

  # Loads lib/config.rb in a new process with only @env of the settings (the others unset) and HOME in @tmp. Returns
  # the constants, or the process status and its standard error when loading fails.
  def load_config
    env = Hash[SETTINGS.map { |k| [k, nil] }].merge('HOME' => @home).merge(@env)
    out, err, status = Open3.capture3(env, RbConfig.ruby, '-e', SCRIPT, chdir: @cwd)
    return { status: status, err: err } unless status.success?
    JSON.parse(out)
  end

  # A data directory of its own for the scenario, with server_settings.txt holding the lines (none when nil)
  def given_data_dir(lines, name = 'server_settings.txt')
    @data = File.join(@tmp, 'data')
    FileUtils.mkdir_p(@data)
    File.write(File.join(@data, name), lines.map { |l| "#{l}\n" }.join) if lines
    @env['LCTY_DATA_DIR'] = @data
  end

  def settings_of(c)
    c.values_at('bind_ips', 'base_url', 'allowed_origins')
  end

  # The lines as the steps quote them: "a", "b" and "c"
  def quoted(lines)
    q = lines.map { |l| "\"#{l}\"" }
    "#{q[0..-2].join(', ')} and #{q[-1]}"
  end

  def mac_or_windows?(c)
    c['RUBY_PLATFORM'] =~ /darwin|mswin|mingw|cygwin/
  end

  scenario 'Without settings the port is left to lcty.rb and the address is 127.0.0.1' do
    c = nil
    step('Given LCTY_PORT, PORT and LCTY_BIND_IP are unset') { @env = {} }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is nil and PORTS_TRIED is 45280 to 45379') do
      assert_nil c['PORT']
      assert_equal [45280, 45379], c['PORTS_TRIED']
    end
    step('And Chatty.bind_ips is ["127.0.0.1"]') { assert_equal ['127.0.0.1'], c['bind_ips'] }
  end

  scenario 'Empty settings count as unset' do
    c = nil
    step('Given LCTY_PORT, PORT and LCTY_BIND_IP are empty') do
      @env = { 'LCTY_PORT' => '', 'PORT' => '', 'LCTY_BIND_IP' => '' }
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is nil') { assert_nil c['PORT'] }
    step('And Chatty.bind_ips is ["127.0.0.1"]') { assert_equal ['127.0.0.1'], c['bind_ips'] }
  end

  scenario 'PORT sets the port' do
    c = nil
    step('Given PORT is "8080"') { @env = { 'PORT' => '8080' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is the integer 8080') { assert_same 8080, c['PORT'] }
  end

  scenario 'LCTY_PORT sets the port, before PORT' do
    c = nil
    step('Given LCTY_PORT is "8081" and PORT is "8080"') { @env = { 'LCTY_PORT' => '8081', 'PORT' => '8080' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is the integer 8081') { assert_same 8081, c['PORT'] }
  end

  %w[http 80.5 0 70000].each do |value|
    scenario "A port that is not an integer from 1 to 65535 stops the server (#{value})" do
      c = nil
      step("Given LCTY_PORT is \"#{value}\"") { @env = { 'LCTY_PORT' => value } }
      step('When lib/config.rb is loaded') { c = load_config }
      step("Then loading fails with the SettingsError \"the port must be an integer from 1 to 65535: \"#{value}\"\"") do
        refute c[:status].success?
        assert_includes c[:err], "the port must be an integer from 1 to 65535: \"#{value}\" (Chatty::SettingsError)"
      end
    end
  end

  scenario 'LCTY_BIND_IP sets the one address to listen on' do
    c = nil
    step('Given LCTY_BIND_IP is "::1"') { @env = { 'LCTY_BIND_IP' => '::1' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.bind_ips is ["::1"]') { assert_equal ['::1'], c['bind_ips'] }
  end

  [
    ['LCTY_BIND_IP', '0.0.0.0, ::1', '--bind-ip'],
    ['LCTY_ALLOWED_ORIGIN', 'http://a.test http://b.test', '--allowed-origin']
  ].each do |variable, value, option|
    scenario "An environment variable takes one value only (#{variable})" do
      c = nil
      step("Given #{variable} is \"#{value}\"") { @env = { variable => value } }
      step('When lib/config.rb is loaded') { c = load_config }
      message = "#{variable}: one value only; give more with #{option} in server_settings.txt"
      step("Then loading fails with the SettingsError \"#{message}\"") do
        refute c[:status].success?
        assert_includes c[:err], "#{message} (Chatty::SettingsError)"
      end
    end
  end

  scenario 'LCTY_BIND_IP that is not an IP address stops the server' do
    c = nil
    step('Given LCTY_BIND_IP is "localhost"') { @env = { 'LCTY_BIND_IP' => 'localhost' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then loading fails with the SettingsError "LCTY_BIND_IP: not an IP address to listen on: "localhost""') do
      refute c[:status].success?
      assert_includes c[:err], 'LCTY_BIND_IP: not an IP address to listen on: "localhost" (Chatty::SettingsError)'
    end
  end

  scenario 'An IPv6 address is written in brackets in URLs' do
    r = nil
    step('When Chatty.url_host is given "::1" and "127.0.0.1"') { r = ['::1', '127.0.0.1'].map { |ip| Chatty.url_host(ip) } }
    step('Then it returns "[::1]" and "127.0.0.1"') { assert_equal ['[::1]', '127.0.0.1'], r }
  end

  # ---- server_settings.txt of the data directory, and the command line ----

  scenario 'The settings file of the data directory sets the addresses, the base URL and the allowed origins' do
    c = nil
    step("Given a data directory whose server_settings.txt has the lines #{quoted(FILE)}") { given_data_dir(FILE) }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.bind_ips is ["0.0.0.0", "::1"], Chatty.base_url is "/lcty/" and Chatty.allowed_origins is ["http://a.test:8080", "http://b.test:8080"]') do
      assert_equal [['0.0.0.0', '::1'], '/lcty/', ['http://a.test:8080', 'http://b.test:8080']], settings_of(c)
    end
    step('And SETTINGS_PATH is its "server_settings.txt"') do
      assert_equal File.join(@data, 'server_settings.txt'), c['SETTINGS_PATH']
    end
  end

  scenario 'Without a settings file every setting takes its default, and server_settings.json is not read' do
    c = nil
    step('Given a data directory with a server_settings.json of {"host": "0.0.0.0"} and no server_settings.txt') do
      given_data_dir(['{"host": "0.0.0.0"}'], 'server_settings.json')
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.bind_ips is ["127.0.0.1"], Chatty.base_url is "/" and Chatty.allowed_origins is nil') do
      assert_equal [['127.0.0.1'], '/', nil], settings_of(c)
    end
    step('And no server_settings.txt has been created') do
      refute File.exist?(File.join(@data, 'server_settings.txt'))
    end
  end

  scenario 'An environment variable that is set and not empty overrides the file' do
    c = nil
    lines = ['--bind-ip=0.0.0.0', '--base-url=/lcty/', '--allowed-origin=http://a.test:8080']
    step("Given a data directory whose server_settings.txt has the lines #{quoted(lines)}") { given_data_dir(lines) }
    step('And LCTY_BIND_IP is empty, LCTY_BASE_URL is "/x/" and LCTY_ALLOWED_ORIGIN is "http://b.test"') do
      @env.merge!('LCTY_BIND_IP' => '', 'LCTY_BASE_URL' => '/x/', 'LCTY_ALLOWED_ORIGIN' => 'http://b.test')
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.bind_ips is ["0.0.0.0"], Chatty.base_url is "/x/" and Chatty.allowed_origins is ["http://b.test"]') do
      assert_equal [['0.0.0.0'], '/x/', ['http://b.test']], settings_of(c)
    end
  end

  scenario 'The command line overrides the environment and the file, and the other arguments are returned' do
    c = nil
    lines = ['--bind-ip=0.0.0.0', '--allowed-origin=http://a.test:8080']
    args = ['--bind-ip=10.0.0.1', 'convert', '--allowed-origin=http://c.test']
    step("Given a data directory whose server_settings.txt has the lines #{quoted(lines)}") { given_data_dir(lines) }
    step('And LCTY_BIND_IP is "::1"') { @env['LCTY_BIND_IP'] = '::1' }
    step("When Chatty.configure is given #{quoted(args)}") do
      @env['LCTY_TEST_ARGS'] = JSON.generate(args)
      c = load_config
    end
    step('Then Chatty.bind_ips is ["10.0.0.1"] and Chatty.allowed_origins is ["http://c.test"]') do
      assert_equal [['10.0.0.1'], ['http://c.test']], c.values_at('bind_ips', 'allowed_origins')
    end
    step('And it returns "convert"') { assert_equal ['convert'], c['rest'] }
  end

  [
    ['--prot=1', 'invalid option: --prot=1'],
    ['--host=0.0.0.0', 'invalid option: --host=0.0.0.0'],
    ['--bind-ip', 'missing argument: --bind-ip'],
    ['bind-ip=1', 'not an option: bind-ip=1'],
    ['--port=8080', 'the port is not an option; set LCTY_PORT or PORT'],
    ['--data-dir=/tmp/x', 'the data directory is not an option; set LCTY_DATA_DIR'],
    ['--bind-ip=', 'not an IP address to listen on: ""'],
    ['--bind-ip=localhost', 'not an IP address to listen on: "localhost"'],
    ['--bind-ip=10.0.0.0/8', 'not an IP address to listen on: "10.0.0.0/8"'],
    ['--basic-auth=alice', '--basic-auth: not USER:HASH, as `lcty.rb hash-password USER` prints it'],
    ['--basic-auth=alice:secret', '--basic-auth: the user "alice": not a password hash ' \
                                  '($pbkdf2-sha256$i=<iterations>$<salt>$<hash>)']
  ].each do |line, message|
    scenario "A settings file that cannot be used stops the server (#{line})" do
      c = nil
      step("Given a data directory whose server_settings.txt is the line \"#{line}\"") { given_data_dir([line]) }
      step('When lib/config.rb is loaded') { c = load_config }
      step("Then loading fails with a SettingsError that starts with the path of the file and \"#{message}\"") do
        refute c[:status].success?
        assert_includes c[:err], "#{File.join(@data, 'server_settings.txt')}: #{message} (Chatty::SettingsError)"
      end
    end
  end

  scenario 'The settings file gives the users of Basic authentication' do
    c = nil
    step('Given a data directory whose server_settings.txt has --basic-auth for "alice" and for "bob"') do
      given_data_dir(["--basic-auth=alice:#{HASH_A}", "--basic-auth=bob:#{HASH_B}"])
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.basic_users has "alice" and "bob" with their hashes') do
      assert_equal({ 'alice' => HASH_A, 'bob' => HASH_B }, c['basic_users'])
    end
  end

  scenario 'Without --basic-auth there is no user' do
    c = nil
    step('Given a data directory without server_settings.txt') { given_data_dir(nil) }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.basic_users is empty') { assert_equal({}, c['basic_users']) }
  end

  scenario 'A user given twice stops the server' do
    c = nil
    step('Given a data directory whose server_settings.txt has --basic-auth for "alice" twice') do
      given_data_dir(["--basic-auth=alice:#{HASH_A}", "--basic-auth=alice:#{HASH_B}"])
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then loading fails with a SettingsError that starts with the path of the file and "--basic-auth: the user "alice" is given twice"') do
      refute c[:status].success?
      assert_includes c[:err], "#{File.join(@data, 'server_settings.txt')}: --basic-auth: the user \"alice\" is given " \
                               'twice (Chatty::SettingsError)'
    end
  end

  scenario 'LCTY_BASIC_AUTH gives one user, instead of those of the file' do
    c = nil
    step('Given a data directory whose server_settings.txt has --basic-auth for "alice"') do
      given_data_dir(["--basic-auth=alice:#{HASH_A}"])
    end
    step('And LCTY_BASIC_AUTH is "bob" and a hash') { @env['LCTY_BASIC_AUTH'] = "bob:#{HASH_B}" }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty.basic_users has "bob" only') { assert_equal({ 'bob' => HASH_B }, c['basic_users']) }
  end

  scenario 'An option of the command line that is not one stops the server' do
    c = nil
    step('Given a data directory without server_settings.txt') { given_data_dir(nil) }
    step('When Chatty.configure is given "--prot"') do
      @env['LCTY_TEST_ARGS'] = JSON.generate(['--prot'])
      c = load_config
    end
    step('Then it fails with the SettingsError "the command line: invalid option: --prot"') do
      refute c[:status].success?
      assert_includes c[:err], 'the command line: invalid option: --prot (Chatty::SettingsError)'
    end
  end

  scenario 'An absolute LCTY_DATA_DIR is the data directory' do
    c = dir = nil
    step('Given LCTY_DATA_DIR is an absolute path') do
      dir = File.join(@tmp, 'data')
      @env = { 'LCTY_DATA_DIR' => dir }
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then DATA_DIR is that path') { assert_equal dir, c['DATA_DIR'] }
    step('And CONV_DIR is its "c", TAG_DIR its "t", TAG_LOCK_PATH its "t.lock", TAGS_DB_PATH its "lcty_t.sqlite", FORMER_TAGS_DB_PATH its "tags.sqlite" and INDEX_PATH its "_index.sqlite"') do
      assert_equal File.join(dir, 'c'), c['CONV_DIR']
      assert_equal File.join(dir, 't'), c['TAG_DIR']
      assert_equal File.join(dir, 't.lock'), c['TAG_LOCK_PATH']
      assert_equal File.join(dir, 'lcty_t.sqlite'), c['TAGS_DB_PATH']
      assert_equal File.join(dir, 'tags.sqlite'), c['FORMER_TAGS_DB_PATH']
      assert_equal File.join(dir, '_index.sqlite'), c['INDEX_PATH']
    end
  end

  scenario 'A relative LCTY_DATA_DIR is resolved against the repository root' do
    c = nil
    step('Given LCTY_DATA_DIR is "tmp/lcty-data"') { @env = { 'LCTY_DATA_DIR' => 'tmp/lcty-data' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then DATA_DIR is "tmp/lcty-data" in the repository root, whatever the current directory') do
      assert_equal File.join(REPO_ROOT, 'tmp', 'lcty-data'), c['DATA_DIR']
      refute_equal REPO_ROOT, @cwd
    end
  end

  scenario 'The repository root and the public folder' do
    c = nil
    step('When lib/config.rb is loaded') { c = load_config }
    step("Then ROOT is the folder that holds lib/config.rb's folder") do
      assert_equal File.dirname(File.dirname(CONFIG)), c['ROOT']
      assert_equal REPO_ROOT, c['ROOT']
    end
    step('And PUBLIC_DIR is its "public"') { assert_equal File.join(REPO_ROOT, 'public'), c['PUBLIC_DIR'] }
  end

  scenario 'XDG_DATA_HOME is used when it is absolute' do
    c = xdg = nil
    step('Given XDG_DATA_HOME is an absolute path') do
      xdg = File.join(@tmp, 'xdg')
      @env = { 'XDG_DATA_HOME' => xdg }
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then Chatty::XDG_DATA_HOME is that path') { assert_equal xdg, c['XDG_DATA_HOME'] }
  end

  { 'unset' => nil, 'empty' => '', 'the relative path "xdg"' => 'xdg' }.each do |label, value|
    scenario "Otherwise the data home is ~/.local/share (#{label})" do
      c = nil
      step("Given XDG_DATA_HOME is #{label}") { @env = { 'XDG_DATA_HOME' => value } }
      step('When lib/config.rb is loaded') { c = load_config }
      step('Then Chatty::XDG_DATA_HOME is ".local/share" in HOME') do
        assert_equal File.join(@home, '.local', 'share'), c['XDG_DATA_HOME']
      end
    end
  end

  { 'unset' => nil, 'empty' => '' }.each do |label, value|
    scenario "Without LCTY_DATA_DIR the data directory is the per-user application data folder (#{label})" do
      c = xdg = nil
      step("Given LCTY_DATA_DIR is #{label} and XDG_DATA_HOME is an absolute path") do
        xdg = File.join(@tmp, 'xdg')
        @env = { 'LCTY_DATA_DIR' => value, 'XDG_DATA_HOME' => xdg }
      end
      step('When lib/config.rb is loaded') { c = load_config }
      step('Then on macOS and Windows DATA_DIR is "Library/Application Support/tokyo.kaito.lcty-rb/Data" in HOME') do
        if mac_or_windows?(c)
          assert_equal File.join(@home, 'Library', 'Application Support', 'tokyo.kaito.lcty-rb', 'Data'), c['DATA_DIR']
        end
      end
      step('And elsewhere DATA_DIR is "tokyo.kaito.lcty-rb/Data" in XDG_DATA_HOME') do
        assert_equal File.join(xdg, 'tokyo.kaito.lcty-rb', 'Data'), c['DATA_DIR'] unless mac_or_windows?(c)
      end
      step('And DEFAULT_DATA_DIR is DATA_DIR') { assert_equal c['DATA_DIR'], c['DEFAULT_DATA_DIR'] }
    end
  end

  {
    '"a" (one character)' => 'a',
    '"0190f3a1-7c2e-7abc-8def-0123456789ab" (a UUIDv7)' => '0190f3a1-7c2e-7abc-8def-0123456789ab',
    '"My_Conv-01"' => 'My_Conv-01',
    '80 characters' => 'a' * 80
  }.each do |label, value|
    scenario "ID_RE accepts ids of 1 to 80 letters, digits, \"_\" and \"-\" (#{label})" do
      step("Then ID_RE accepts #{label}") { assert_match Chatty::ID_RE, value }
    end
  end

  {
    '"" (empty)' => '',
    '81 characters' => 'a' * 81,
    '"a.b" (a dot)' => 'a.b',
    '"../etc" (a path)' => '../etc',
    '"a b" (a space)' => 'a b',
    '"abc\n" (a trailing newline)' => "abc\n",
    '"日本語" (not ASCII)' => '日本語'
  }.each do |label, value|
    scenario "ID_RE rejects anything else (#{label})" do
      step("Then ID_RE rejects #{label}") { refute_match Chatty::ID_RE, value }
    end
  end

  {
    '"x" (one character)' => 'x',
    '"work-2026"' => 'work-2026',
    '"日本語" (not ASCII)' => '日本語',
    '"c~23" (an escaped symbol)' => 'c~23',
    '"a#b" (punctuation)' => 'a#b',
    '244 bytes' => 'あ' * 81 + 'a'
  }.each do |label, value|
    scenario "tag_ref? accepts tag references of at most 244 bytes (#{label})" do
      step("Then tag_ref? accepts #{label}") { assert Chatty.tag_ref?(value), value.inspect }
    end
  end

  {
    '"" (empty)' => '',
    '245 bytes' => 'あ' * 81 + 'ab',
    '"tag:work" (a colon)' => 'tag:work',
    '"a/b" (a slash)' => 'a/b',
    'a backslash' => 'a\\b',
    '"two words" (a space)' => 'two words',
    'an ideographic space' => "全角　空白",
    'a tab' => "tab\there",
    'a trailing newline' => "work\n",
    'bytes that are not UTF-8' => "a\xFFb".dup.force_encoding(Encoding::UTF_8),
    'a number' => 1
  }.each do |label, value|
    scenario "tag_ref? rejects whitespace, controls, path separators, colons and more than 244 bytes (#{label})" do
      step("Then tag_ref? rejects #{label}") { refute Chatty.tag_ref?(value), value.inspect }
    end
  end

  scenario 'HttpError carries an HTTP status and a message' do
    e = nil
    step('When an HttpError is made with the status 404 and the message "no such conversation"') do
      e = Chatty::HttpError.new(404, 'no such conversation')
    end
    step('Then its status is 404 and its message is "no such conversation"') do
      assert_equal 404, e.status
      assert_equal 'no such conversation', e.message
    end
    step('And it is a StandardError, so a plain rescue catches it') do
      caught = begin
        raise e
      rescue => err
        err
      end
      assert_same e, caught
      assert_kind_of StandardError, caught
    end
  end
end
