# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3019: the scenarios of docs/specs/LCTYSP-3019_entry-point.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so the two
# read side by side.
#
# lcty.rb is loaded without running (Lcty.run only runs when it is the program). Lcty.mount_all mounts the site on a
# WEBrick server on 127.0.0.1 (a free port), at / and, for one Scenario, at /base/ on another server. The data
# directory is the tests' own (helper.rb), opened as the server opens it. The files of the site are found from the
# working directory, the repository's root. The settings are read when lcty.rb is loaded, so Lcty.base_url, the
# settings file and the command line are checked in a new Ruby process given only the environment of the Scenario.

require_relative 'helper'
require 'net/http'
require 'open3'
require 'rbconfig'
require File.expand_path('../../lcty.rb', __dir__)

class LctyTest < Lcty::Scenarios
  REPO_ROOT = File.expand_path('../..', __dir__)
  LCTY_RB = File.join(REPO_ROOT, 'lcty.rb')

  def self.server(base)
    @servers ||= {}
    @servers[base] ||= begin
      Lcty.open_data
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Lcty::Servlets::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      Lcty.mount_all(server, base)
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def get(path, base = '/')
    port = self.class.server(base)
    Net::HTTP.start('127.0.0.1', port) { |h| h.request(Net::HTTP::Get.new(path, 'Accept-Encoding' => 'identity')) }
  end

  def public_file(path)
    File.binread(File.join(REPO_ROOT, 'public', path))
  end

  def data_path(*parts)
    File.join(Chatty::DATA_DIR, *parts)
  end

  # Inode and modification time: a file that was not rewritten keeps both
  def identity(path)
    s = File.stat(path)
    [s.ino, s.mtime]
  end

  def teardown
    (@remove || []).each { |path| File.delete(path) if File.exist?(path) }
    # Lcty.listen's scenarios: the server it started, the ports the test took, and Chatty.port as it was
    @listener&.shutdown
    @taken&.each(&:close)
    Chatty.port = @port_before if defined?(@port_before)
  end

  # ---- Lcty.base_url ----

  [
    ['unset', nil, '"/"'],
    ['""', '', '"/"'],
    ['"lcty"', 'lcty', '"/lcty/"'],
    ['"/lcty/"', '/lcty/', '"/lcty/"'],
    ['"/a//b/"', '/a//b/', '"/a/b/"']
  ].each do |label, value, base|
    scenario "The base URL always starts and ends with a slash (#{label})" do
      env = out = nil
      step("Given LCTY_BASE_URL is #{label}") { env = { 'LCTY_BASE_URL' => value, 'LCTY_DATA_DIR' => Chatty::DATA_DIR } }
      step('When lcty.rb is loaded') do
        script = "require #{LCTY_RB.dump}; print Lcty.base_url"
        out, err, status = Open3.capture3(env, RbConfig.ruby, '-e', script, chdir: REPO_ROOT)
        assert status.success?, err
      end
      step("Then Lcty.base_url is #{base}") { assert_equal base.delete('"'), out }
    end
  end

  # lcty.rb run as the program in a new process with LCTY_DATA_DIR dir (and no other setting) and args: [out, err,
  # status]
  def run_lcty(dir, *args)
    env = { 'LCTY_DATA_DIR' => dir, 'LCTY_HOST' => nil, 'LCTY_BASE_URL' => nil, 'LCTY_ALLOWED_ORIGIN' => nil }
    Open3.capture3(env, RbConfig.ruby, LCTY_RB, *args, chdir: REPO_ROOT)
  end

  def usage
    Chatty.option_parser({}).help
  end

  scenario 'A settings file that cannot be used stops lcty.rb with its message' do
    dir = Dir.mktmpdir('lcty-settings-')
    path = File.join(dir, 'server_settings.txt')
    err = status = nil
    step('Given a data directory whose server_settings.txt is the line "--prot=8080"') { File.write(path, "--prot=8080\n") }
    step('When lcty.rb is loaded') do
      _, err, status = Open3.capture3({ 'LCTY_DATA_DIR' => dir }, RbConfig.ruby, '-e', "require #{LCTY_RB.dump}",
                                      chdir: REPO_ROOT)
    end
    step('Then it exits with the status 1 and prints "lcty-rb: " and the message of the settings file, without a backtrace') do
      assert_equal 1, status.exitstatus
      assert_equal "lcty-rb: #{path}: invalid option: --prot=8080\n", err
    end
  ensure
    FileUtils.rm_rf(dir)
  end

  scenario 'An option of the command line that is not one stops lcty.rb with the usage' do
    dir = Dir.mktmpdir('lcty-settings-')
    err = status = nil
    step('Given a data directory without server_settings.txt') {}
    step('When lcty.rb is run with "--prot"') { _, err, status = run_lcty(dir, '--prot') }
    step('Then it exits with the status 1 and prints "lcty-rb: the command line: invalid option: --prot" and the usage') do
      assert_equal 1, status.exitstatus
      assert_equal "lcty-rb: the command line: invalid option: --prot\n#{usage}", err
    end
  ensure
    FileUtils.rm_rf(dir)
  end

  scenario '--help prints every option' do
    dir = Dir.mktmpdir('lcty-settings-')
    out = status = nil
    step('When lcty.rb is run with "--help"') { out, _, status = run_lcty(dir, '--help') }
    step('Then it exits with the status 0 and prints the usage with --host, --base-url and --allowed-origin') do
      assert_equal 0, status.exitstatus
      assert_equal usage, out
      %w[--host=ADDRESS --base-url=PATH --allowed-origin=ORIGIN].each { |o| assert_includes out, o }
    end
  ensure
    FileUtils.rm_rf(dir)
  end

  # ---- Lcty.listen ----

  # n ports that were free a moment ago, each taken by a TCPServer of the test on Chatty.bind; release frees them
  def taken_ports(n)
    servers = Array.new(n) { TCPServer.new(Chatty.bind, 0) }
    @taken = (@taken || []) + servers
    servers.map { |s| s.addr[1] }
  end

  def release(port)
    s = @taken.find { |t| t.addr[1] == port }
    s.close
    @taken.delete(s)
  end

  # Lcty.listen(asked, ports): the server, or the PortError it raised. teardown stops it and puts Chatty.port back
  def listen(asked, ports)
    @port_before = Chatty.port
    @listener = Lcty.listen(asked, ports)
  rescue Lcty::PortError => e
    e
  end

  scenario 'Without a port asked for, the server listens on the first free port tried' do
    first = second = server = nil
    step('Given two free ports, the first of them taken by another server') do
      first, second = taken_ports(2)
      release(second)
    end
    step('When Lcty.listen is given no port to ask for and the two ports to try') { server = listen(nil, [first, second]) }
    step('Then it listens on the second port') { assert_equal second, server.config[:Port] }
    step('And Chatty.port is the second port') { assert_equal second, Chatty.port }
  end

  scenario 'A port asked for that is taken stops the server' do
    port = r = nil
    step('Given a port taken by another server') { port = taken_ports(1).first }
    step('When Lcty.listen is given that port to ask for') { r = listen(port, [port + 1]) }
    step('Then it raises Lcty::PortError "the port <port> (LCTY_PORT or PORT) is in use"') do
      assert_kind_of Lcty::PortError, r
      assert_equal "the port #{port} (LCTY_PORT or PORT) is in use", r.message
    end
  end

  scenario 'When every port tried is taken the server stops' do
    ports = r = nil
    step('Given two ports taken by another server') { ports = taken_ports(2) }
    step('When Lcty.listen is given no port to ask for and the two ports to try') { r = listen(nil, ports) }
    step('Then it raises Lcty::PortError "no free port from <first> to <second> (set one with LCTY_PORT or PORT)"') do
      assert_kind_of Lcty::PortError, r
      assert_equal "no free port from #{ports.first} to #{ports.last} (set one with LCTY_PORT or PORT)", r.message
    end
  end

  # ---- Lcty.mount_all ----

  js = '"text/javascript; charset=utf-8"'
  html = '"text/html; charset=utf-8"'
  [
    ['/lcty.v1/lcty.v1.cjs', '200', js],
    ['/lcty.v1/lcty.v1.lang-ja.cjs', '200', js],
    ['/lcty.v1/lcty.v1.css', '200', '"text/css; charset=utf-8"'],
    ['/lcty.v1/lcty.v1.async.mjs', '200', js],
    ['/lcty.v1/lcty.v1.c.worker.cjs', '200', js],
    ['/lcty.v1/lcty.v1.t.worker.cjs', '200', js],
    ['/c/index.js', '200', js],
    ['/t/index.js', '200', js],
    ['/t/tag-file.js', '200', js],
    ['/c/', '200', html],
    ['/t/', '200', html],
    ['/', '200', html],
    ['/js/site.js', '200', js],
    ['/v1/tags', '200', '"application/json; charset=utf-8"']
  ].each do |path, status, type|
    scenario "Every path of the site is mounted (#{path})" do
      res = nil
      step('Given Lcty.mount_all on a WEBrick server') { self.class.server('/') }
      step("When #{path} is requested") { res = get(path) }
      step("Then the status is #{status} with the type #{type}") do
        assert_equal [status, type.delete('"')], [res.code, res['content-type']]
      end
    end
  end

  [
    %w[lcty.v1.js lcty.v1.cjs],
    %w[lcty.v1.lang-ja.js lcty.v1.lang-ja.cjs],
    %w[lcty.v1.module.js lcty.v1.async.mjs]
  ].each do |name, file|
    scenario "The names of version 1 in /lcty.v1/ are the files they stand for (#{name})" do
      res = nil
      step('Given Lcty.mount_all on a WEBrick server') { self.class.server('/') }
      step("When /lcty.v1/#{name} is requested") { res = get("/lcty.v1/#{name}") }
      step("Then the body is the bytes of public/lcty.v1/#{file}") { assert_equal public_file("lcty.v1/#{file}"), res.body.b }
    end
  end

  %w[/lcty.v1/ /lcty.v1/lcty.v1.d.cts /lcty.v1/lcty.v1.mjs /lcty.v1/sub/lcty.v1.cjs].each do |path|
    scenario "Nothing else is under /lcty.v1/ (#{path})" do
      res = nil
      step('Given Lcty.mount_all on a WEBrick server') { self.class.server('/') }
      step("When #{path} is requested") { res = get(path) }
      step('Then the status is 404') { assert_equal '404', res.code }
    end
  end

  scenario 'The entries are served as they are, not bundled' do
    res = nil
    step('Given Lcty.mount_all on a WEBrick server') { self.class.server('/') }
    step('When /c/index.js is requested') { res = get('/c/index.js') }
    step('Then the body is the bytes of public/c/index.js') { assert_equal public_file('c/index.js'), res.body.b }
  end

  scenario 'Under a base URL every path is below it' do
    inside = outside = nil
    step('Given Lcty.mount_all on a WEBrick server under "/base/"') { self.class.server('/base/') }
    step('When /base/lcty.v1/lcty.v1.css and /lcty.v1/lcty.v1.css are requested') do
      inside = get('/base/lcty.v1/lcty.v1.css', '/base/')
      outside = get('/lcty.v1/lcty.v1.css', '/base/')
    end
    step('Then the first is 200 and the second is 404') { assert_equal %w[200 404], [inside.code, outside.code] }
  end

  # ---- Lcty.publish_offline ----

  scenario 'Lcty.publish_offline copies what a file opened directly reads into the data directories' do
    step('When Lcty.publish_offline runs') do
      File.delete(data_path('c', 'lcty.v1.js')) if File.exist?(data_path('c', 'lcty.v1.js'))
      Lcty.publish_offline
    end
    step('Then lcty.v1.js and lcty.v1.css of the data directory, its c/ and its t/ have the bytes of public/lcty.v1/lcty.v1.cjs and public/lcty.v1/lcty.v1.css') do
      [[], ['c'], ['t']].each do |dir|
        assert_equal public_file('lcty.v1/lcty.v1.cjs'), File.binread(data_path(*dir, 'lcty.v1.js'))
        assert_equal public_file('lcty.v1/lcty.v1.css'), File.binread(data_path(*dir, 'lcty.v1.css'))
      end
    end
  end

  scenario 'Lcty.publish_offline leaves copies that are up to date alone' do
    before = nil
    step('Given Lcty.publish_offline has run') do
      Lcty.publish_offline
      before = %w[lcty.v1.js lcty.v1.css].map { |name| identity(data_path('c', name)) }
    end
    step('When Lcty.publish_offline runs again') { Lcty.publish_offline }
    step('Then the copies in c/ are the same files as before, not rewritten') do
      assert_equal before, %w[lcty.v1.js lcty.v1.css].map { |name| identity(data_path('c', name)) }
    end
  end

  scenario 'Lcty.publish_offline puts back a copy that was changed' do
    step('Given c/lcty.v1.css of the data directory was changed') do
      Lcty.publish_offline
      File.write(data_path('c', 'lcty.v1.css'), '/* edited */')
    end
    step('When Lcty.publish_offline runs') { Lcty.publish_offline }
    step('Then c/lcty.v1.css has the bytes of public/lcty.v1/lcty.v1.css again') do
      assert_equal public_file('lcty.v1/lcty.v1.css'), File.binread(data_path('c', 'lcty.v1.css'))
    end
  end

  scenario 'Lcty.publish_offline leaves the other files of the data directories alone' do
    step('Given a file "lcty.v0.js" in c/ of the data directory') do
      FileUtils.mkdir_p(data_path('c'))
      @remove = [data_path('c', 'lcty.v0.js')]
      File.write(data_path('c', 'lcty.v0.js'), '// v0')
    end
    step('When Lcty.publish_offline runs') { Lcty.publish_offline }
    step('Then c/lcty.v0.js is still there with its content') { assert_equal '// v0', File.read(data_path('c', 'lcty.v0.js')) }
  end
end
