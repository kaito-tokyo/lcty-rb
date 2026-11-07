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
  SETTINGS = %w[PORT LCTY_HOST LCTY_DATA_DIR XDG_DATA_HOME].freeze
  CONSTANTS = %w[ROOT PUBLIC_DIR XDG_DATA_HOME DEFAULT_DATA_DIR DATA_DIR CONV_DIR TAGS_DB_PATH INDEX_PATH PORT BIND
                 BIND_URL_HOST].freeze
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

  scenario 'An absolute LCTY_DATA_DIR is the data directory' do
    c = dir = nil
    step('Given LCTY_DATA_DIR is an absolute path') do
      dir = File.join(@tmp, 'data')
      @env = { 'LCTY_DATA_DIR' => dir }
    end
    step('When lib/config.rb is loaded') { c = load_config }
    step('Then DATA_DIR is that path') { assert_equal dir, c['DATA_DIR'] }
    step('And CONV_DIR is its "c", TAGS_DB_PATH its "tags.sqlite" and INDEX_PATH its "_index.sqlite"') do
      assert_equal File.join(dir, 'c'), c['CONV_DIR']
      assert_equal File.join(dir, 'tags.sqlite'), c['TAGS_DB_PATH']
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
    '"a/b#c" (punctuation)' => 'a/b#c',
    '40 characters' => 'あ' * 40
  }.each do |label, value|
    scenario "TAG_NAME_RE accepts names of 1 to 40 characters without whitespace or \":\" (#{label})" do
      step("Then TAG_NAME_RE accepts #{label}") { assert_match Chatty::TAG_NAME_RE, value }
    end
  end

  {
    '"" (empty)' => '',
    '41 characters' => 'a' * 41,
    '"tag:work" (a colon)' => 'tag:work',
    '"two words" (a space)' => 'two words',
    '"tab\there" (a tab)' => "tab\there",
    '"work\n" (a trailing newline)' => "work\n"
  }.each do |label, value|
    scenario "TAG_NAME_RE rejects anything else (#{label})" do
      step("Then TAG_NAME_RE rejects #{label}") { refute_match Chatty::TAG_NAME_RE, value }
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
