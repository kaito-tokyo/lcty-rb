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
  SETTINGS = %w[PORT LCTY_HOST LCTY_DATA_DIR XDG_DATA_HOME LCTY_BASE_URL LCTY_ALLOWED_ORIGIN].freeze
  CONSTANTS = %w[ROOT PUBLIC_DIR XDG_DATA_HOME DEFAULT_DATA_DIR DATA_DIR CONV_DIR TAG_DIR TAG_LOCK_PATH TAGS_DB_PATH
                 FORMER_TAGS_DB_PATH INDEX_PATH PORT BIND BIND_URL_HOST SETTINGS_PATH BASE_URL_SETTING
                 ALLOWED_ORIGINS_SETTING].freeze
  FILE = '{"port": 8080, "host": "0.0.0.0", "base_url": "/lcty/", "allowed_origins": ["http://a.test:8080"]}'
  # Prints the constants of lib/config.rb and the platform of the process as JSON
  SCRIPT = "require #{CONFIG.dump}; require 'json'; " \
           "puts JSON.generate(Hash[#{CONSTANTS.inspect}.map { |n| [n, Chatty.const_get(n)] }]" \
           ".merge('RUBY_PLATFORM' => RUBY_PLATFORM))".freeze

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

  # A data directory of its own for the scenario, with server_settings.json holding content (none when nil)
  def given_data_dir(content)
    @data = File.join(@tmp, 'data')
    FileUtils.mkdir_p(@data)
    File.write(File.join(@data, 'server_settings.json'), content) if content
    @env['LCTY_DATA_DIR'] = @data
  end

  def settings_of(c)
    c.values_at('PORT', 'BIND', 'BASE_URL_SETTING', 'ALLOWED_ORIGINS_SETTING')
  end

  def mac_or_windows?(c)
    c['RUBY_PLATFORM'] =~ /darwin|mswin|mingw|cygwin/
  end

  scenario 'Without settings the server listens on 127.0.0.1:45280' do
    c = nil
    step('Given PORT and LCTY_HOST are unset') { @env = {} }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is 45280') { assert_equal 45280, c['PORT'] }
    step('And BIND and BIND_URL_HOST are "127.0.0.1"') do
      assert_equal '127.0.0.1', c['BIND']
      assert_equal '127.0.0.1', c['BIND_URL_HOST']
    end
  end

  scenario 'Empty settings count as unset' do
    c = nil
    step('Given PORT and LCTY_HOST are empty') { @env = { 'PORT' => '', 'LCTY_HOST' => '' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is 45280') { assert_equal 45280, c['PORT'] }
    step('And BIND is "127.0.0.1"') { assert_equal '127.0.0.1', c['BIND'] }
  end

  scenario 'PORT sets the port' do
    c = nil
    step('Given PORT is "8080"') { @env = { 'PORT' => '8080' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is the integer 8080') { assert_same 8080, c['PORT'] }
  end

  scenario 'A PORT that is not a number stops the server' do
    c = nil
    step('Given PORT is "http"') { @env = { 'PORT' => 'http' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then loading fails with an ArgumentError about the invalid value "http"') do
      refute c[:status].success?
      assert_match(/invalid value for Integer\(\): "http" \(ArgumentError\)/, c[:err])
    end
  end

  scenario 'LCTY_HOST sets the address to listen on' do
    c = nil
    step('Given LCTY_HOST is "0.0.0.0"') { @env = { 'LCTY_HOST' => '0.0.0.0' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then BIND and BIND_URL_HOST are "0.0.0.0"') do
      assert_equal '0.0.0.0', c['BIND']
      assert_equal '0.0.0.0', c['BIND_URL_HOST']
    end
  end

  scenario 'An IPv6 address is written in brackets in URLs' do
    c = nil
    step('Given LCTY_HOST is "::1"') { @env = { 'LCTY_HOST' => '::1' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then BIND is "::1"') { assert_equal '::1', c['BIND'] }
    step('And BIND_URL_HOST is "[::1]"') { assert_equal '[::1]', c['BIND_URL_HOST'] }
  end

  scenario 'A host name is written in URLs as it is' do
    c = nil
    step('Given LCTY_HOST is "localhost"') { @env = { 'LCTY_HOST' => 'localhost' } }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then BIND_URL_HOST is "localhost"') { assert_equal 'localhost', c['BIND_URL_HOST'] }
  end

  # ---- server_settings.json of the data directory ----

  scenario 'The settings file of the data directory sets the port, the address, the base URL and the allowed origins' do
    c = nil
    step("Given a data directory whose server_settings.json is #{FILE}") { given_data_dir(FILE) }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is 8080, BIND is "0.0.0.0", BASE_URL_SETTING is "/lcty/" and ALLOWED_ORIGINS_SETTING is ["http://a.test:8080"]') do
      assert_equal [8080, '0.0.0.0', '/lcty/', ['http://a.test:8080']], settings_of(c)
    end
    step('And SETTINGS_PATH is its "server_settings.json"') do
      assert_equal File.join(@data, 'server_settings.json'), c['SETTINGS_PATH']
    end
  end

  scenario 'Without a settings file every setting takes its default' do
    c = nil
    step('Given a data directory without server_settings.json') { given_data_dir(nil) }
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is 45280, BIND is "127.0.0.1", BASE_URL_SETTING is "/" and ALLOWED_ORIGINS_SETTING is nil') do
      assert_equal [45280, '127.0.0.1', '/', nil], settings_of(c)
    end
    step('And no server_settings.json has been created') do
      refute File.exist?(File.join(@data, 'server_settings.json'))
    end
  end

  scenario 'An environment variable that is set and not empty overrides the file' do
    c = nil
    step("Given a data directory whose server_settings.json is #{FILE}") { given_data_dir(FILE) }
    step('And PORT is "9090", LCTY_HOST is empty, LCTY_BASE_URL is "/x/" and LCTY_ALLOWED_ORIGIN is "http://b.test, http://c.test"') do
      @env.merge!('PORT' => '9090', 'LCTY_HOST' => '', 'LCTY_BASE_URL' => '/x/',
                  'LCTY_ALLOWED_ORIGIN' => 'http://b.test, http://c.test')
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then PORT is 9090, BIND is "0.0.0.0", BASE_URL_SETTING is "/x/" and ALLOWED_ORIGINS_SETTING is ["http://b.test", "http://c.test"]') do
      assert_equal [9090, '0.0.0.0', '/x/', ['http://b.test', 'http://c.test']], settings_of(c)
    end
  end

  [
    ['{port: 1}', 'not JSON:'],
    ['[1, 2]', 'must be a JSON object'],
    ['{"prot": 8080}', 'unknown setting "prot" (known: port, host, base_url, allowed_origins)'],
    ['{"port": "8080"}', 'port must be an integer from 1 to 65535'],
    ['{"port": 70000}', 'port must be an integer from 1 to 65535'],
    ['{"host": ""}', 'host must be a non-empty string'],
    ['{"base_url": 1}', 'base_url must be a string'],
    ['{"allowed_origins": "http://a"}', 'allowed_origins must be an array of non-empty strings']
  ].each do |content, message|
    scenario "A settings file that cannot be used stops the server (#{content})" do
      c = nil
      step("Given a data directory whose server_settings.json is #{content}") { given_data_dir(content) }
      step('When lib/config.rb is loaded') { c = load_config }
      step("Then loading fails with a SettingsError that starts with the path of the file and \"#{message}\"") do
        refute c[:status].success?
        assert_includes c[:err], "#{File.join(@data, 'server_settings.json')}: #{message}"
        assert_includes c[:err], 'Chatty::SettingsError'
      end
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
