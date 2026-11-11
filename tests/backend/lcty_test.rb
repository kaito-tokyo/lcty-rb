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
require 'digest'
require 'net/http'
require 'open3'
require 'rbconfig'
require 'stringio'
require File.expand_path('../../lcty.rb', __dir__)
require_relative 'rpc_support' # its Page, a WebSocket client of /v1/rpc

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
  def run_lcty(dir, *args, stdin_data: '')
    env = { 'LCTY_DATA_DIR' => dir, 'LCTY_BIND_IP' => nil, 'LCTY_BASE_URL' => nil, 'LCTY_ALLOWED_ORIGIN' => nil }
    Open3.capture3(env, RbConfig.ruby, LCTY_RB, *args, chdir: REPO_ROOT, stdin_data: stdin_data)
  end

  # A terminal that is typed lines, as $stdin of lcty.rb hash-password; echoed is whether a line was read with echo
  class Terminal
    attr_reader :echoed

    def initialize(*lines)
      @lines = lines.map { |l| "#{l}\n" }
      @echoed = false
      @quiet = false
    end

    def tty?
      true
    end

    def gets
      @echoed ||= !@quiet
      @lines.shift
    end

    def noecho
      @quiet = true
      yield self
    ensure
      @quiet = false
    end
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

  scenario 'lcty.rb hash-password prints the option of the user for the password piped in' do
    dir = Dir.mktmpdir('lcty-settings-')
    out = status = nil
    step('When lcty.rb is run with "hash-password alice" and the input "correct horse battery"') do
      out, _, status = run_lcty(dir, 'hash-password', 'alice', stdin_data: "correct horse battery\n")
    end
    step('Then it exits with the status 0 and prints one line "--basic-auth=alice:" and a hash') do
      assert_equal 0, status.exitstatus
      assert_match(/\A--basic-auth=alice:\$pbkdf2-sha256\$i=600000\$\S+\n\z/, out)
    end
    step('And the hash accepts "correct horse battery"') do
      require 'password'
      assert Chatty::Password.verify('correct horse battery', out.chomp.delete_prefix('--basic-auth=alice:'))
    end
  ensure
    FileUtils.rm_rf(dir)
  end

  scenario 'lcty.rb hash-password refuses a password that cannot be used' do
    dir = Dir.mktmpdir('lcty-settings-')
    out = err = status = nil
    step('When lcty.rb is run with "hash-password alice" and the input "too short"') do
      out, err, status = run_lcty(dir, 'hash-password', 'alice', stdin_data: "too short\n")
    end
    step('Then it exits with the status 1, prints nothing and says "the password is shorter than 15 characters"') do
      assert_equal 1, status.exitstatus
      assert_empty out
      assert_equal "lcty-rb hash-password: the password is shorter than 15 characters\n", err
    end
  ensure
    FileUtils.rm_rf(dir)
  end

  scenario 'On a terminal hash-password asks for the password twice, without echo' do
    term = out = err = r = nil
    step('Given a terminal typed "correct horse battery" twice') do
      term = Terminal.new('correct horse battery', 'correct horse battery')
    end
    step('When Lcty.hash_password runs for "alice" on it') do
      out = StringIO.new
      err = StringIO.new
      r = Lcty.hash_password('alice', input: term, out: out, err: err)
    end
    step('Then it asks "Password: " and "Again: ", reading neither with echo') do
      assert_equal "Password: \nAgain: \n", err.string
      refute term.echoed
    end
    step('And it returns true and prints the option of "alice"') do
      assert r
      assert out.string.start_with?('--basic-auth=alice:$pbkdf2-sha256$'), out.string
    end
  end

  scenario 'On a terminal two passwords that differ print nothing' do
    term = out = err = r = nil
    step('Given a terminal typed "correct horse battery" and "correct horse batterY"') do
      term = Terminal.new('correct horse battery', 'correct horse batterY')
    end
    step('When Lcty.hash_password runs for "alice" on it') do
      out = StringIO.new
      err = StringIO.new
      r = Lcty.hash_password('alice', input: term, out: out, err: err)
    end
    step('Then it returns false, prints nothing and says "the two passwords differ"') do
      refute r
      assert_empty out.string
      assert err.string.end_with?("lcty-rb hash-password: the two passwords differ\n"), err.string
    end
  end

  scenario '--help prints every option' do
    dir = Dir.mktmpdir('lcty-settings-')
    out = status = nil
    step('When lcty.rb is run with "--help"') { out, _, status = run_lcty(dir, '--help') }
    step('Then it exits with the status 0 and prints the usage with --bind-ip, --base-url and --allowed-origin') do
      assert_equal 0, status.exitstatus
      assert_equal usage, out
      %w[--bind-ip=ADDRESS --base-url=PATH --allowed-origin=ORIGIN].each { |o| assert_includes out, o }
    end
  ensure
    FileUtils.rm_rf(dir)
  end

  # ---- Digest authentication ----

  # A data directory of its own, with a .htdigest of lines (none when nil)
  def htdigest_dir(lines)
    @auth_dir = Dir.mktmpdir('lcty-auth-')
    File.write(File.join(@auth_dir, '.htdigest'), lines.map { |l| "#{l}\n" }.join) if lines
    File.join(@auth_dir, '.htdigest')
  end

  def htdigest_line(user, realm, password)
    "#{user}:#{realm}:#{Digest::MD5.hexdigest("#{user}:#{realm}:#{password}")}"
  end

  # A server on a free port with the site mounted and every request checked by auth; stopped by teardown
  def auth_server(auth)
    @port_before = Chatty.port
    Lcty.open_data
    @listener = Lcty.listen(free_port, [], ['127.0.0.1'], auth: auth)
    Lcty.mount_all(@listener)
    Thread.new { @listener.start }
    sleep 0.05 until @listener.status == :Running
    @listener.config[:Port]
  end

  # The Authorization of a Digest response to challenge (a WWW-Authenticate) for method and uri, as a browser computes
  # it with the algorithm MD5-sess and the qop auth
  def digest_authorization(challenge, user, password, method, uri)
    p = challenge.scan(/(\w+)="?([^",]*)"?/).to_h
    cnonce = SecureRandom.hex(8)
    nc = '00000001'
    md5 = ->(s) { Digest::MD5.hexdigest(s) }
    ha1 = md5.call("#{md5.call("#{user}:#{p['realm']}:#{password}")}:#{p['nonce']}:#{cnonce}")
    response = md5.call("#{ha1}:#{p['nonce']}:#{nc}:#{cnonce}:auth:#{md5.call("#{method}:#{uri}")}")
    %(Digest username="#{user}", realm="#{p['realm']}", nonce="#{p['nonce']}", uri="#{uri}", algorithm=MD5-sess, ) +
      %(qop=auth, nc=#{nc}, cnonce="#{cnonce}", response="#{response}", opaque="#{p['opaque']}")
  end

  # GET path with the header authorization (nil: none): [status, WWW-Authenticate]
  def get_with(port, path, authorization = nil)
    res = Net::HTTP.start('127.0.0.1', port) do |h|
      h.request(Net::HTTP::Get.new(path, authorization ? { 'Authorization' => authorization } : {}))
    end
    [res.code, res['www-authenticate']]
  end

  # The status of a WebSocket handshake for /v1/rpc with the header authorization (nil: none). It sends no Origin, which
  # /v1/rpc accepts: the allowed origins are the RPC tests' own when they ran first in this process
  def handshake_status(port, authorization)
    s = TCPSocket.new('127.0.0.1', port)
    head = RpcSupport::Page.handshake(port, nil)
    head = head.sub("\r\n\r\n", "\r\nAuthorization: #{authorization}\r\n\r\n") if authorization
    s.write(head)
    s.gets.to_s.split[1]
  ensure
    s&.close
  end

  ALICE = 'Given a data directory whose .htdigest has the user "alice" with the password "secret-pass" in the realm "lcty-rb"'

  scenario 'Without a .htdigest file no request needs credentials' do
    path = r = nil
    step('Given a data directory without .htdigest') { path = htdigest_dir(nil) }
    step('When Lcty.digest_auth is called') { r = Lcty.digest_auth(path) }
    step('Then it returns nil') { assert_nil r }
  end

  scenario 'With a .htdigest file every request needs one of its users' do
    port = status = challenge = nil
    path = nil
    step(ALICE) { path = htdigest_dir([htdigest_line('alice', 'lcty-rb', 'secret-pass')]) }
    step('And a server listening with Lcty.digest_auth, the site mounted') { port = auth_server(Lcty.digest_auth(path)) }
    step('When /c/ is requested without credentials') { status, challenge = get_with(port, '/c/') }
    step('Then it is answered 401 with a Digest challenge of the realm "lcty-rb"') do
      assert_equal '401', status
      assert_match(/\ADigest realm="lcty-rb", nonce="/, challenge)
    end
    step('When /c/ is requested with the Digest response of "alice" and "secret-pass"') do
      status, = get_with(port, '/c/', digest_authorization(challenge, 'alice', 'secret-pass', 'GET', '/c/'))
    end
    step('Then it is answered 200') { assert_equal '200', status }
    step('When /c/ is requested with the Digest response of "alice" and "wrong"') do
      _, fresh = get_with(port, '/c/')
      status, = get_with(port, '/c/', digest_authorization(fresh, 'alice', 'wrong', 'GET', '/c/'))
    end
    step('Then it is answered 401') { assert_equal '401', status }
    step('When /c/ is requested with Basic credentials of "alice" and "secret-pass"') do
      status, = get_with(port, '/c/', "Basic #{['alice:secret-pass'].pack('m0')}")
    end
    step('Then it is answered 401') { assert_equal '401', status }
  ensure
    FileUtils.rm_rf(@auth_dir) if @auth_dir
  end

  scenario 'The WebSocket of /v1/rpc needs the credentials too' do
    port = status = path = nil
    step(ALICE) { path = htdigest_dir([htdigest_line('alice', 'lcty-rb', 'secret-pass')]) }
    step('And a server listening with Lcty.digest_auth, the site mounted') { port = auth_server(Lcty.digest_auth(path)) }
    step('When the WebSocket of /v1/rpc is opened without credentials') { status = handshake_status(port, nil) }
    step('Then the handshake is answered 401') { assert_equal '401', status }
    step('When it is opened with the Digest response of "alice" and "secret-pass"') do
      _, challenge = get_with(port, '/v1/rpc')
      status = handshake_status(port, digest_authorization(challenge, 'alice', 'secret-pass', 'GET', '/v1/rpc'))
    end
    step('Then the handshake is answered 101') { assert_equal '101', status }
  ensure
    FileUtils.rm_rf(@auth_dir) if @auth_dir
  end

  [
    ['the line "alice:secret"', ['alice:secret'], 'not a line of htdigest (user:realm:md5): "alice:secret"'],
    ['empty', [], 'no user (add one with htdigest)'],
    ['the users "alice" of the realm "a" and "bob" of the realm "b"',
     ['alice:a:0123456789abcdef0123456789abcdef', 'bob:b:0123456789abcdef0123456789abcdef'], 'one realm only, not "a", "b"']
  ].each do |content, lines, message|
    scenario "A .htdigest file that cannot be used stops the server (#{content})" do
      path = r = nil
      step("Given a data directory whose .htdigest is #{content}") { path = htdigest_dir(lines) }
      step('When Lcty.digest_auth is called') do
        r = Lcty.digest_auth(path)
      rescue Chatty::SettingsError => e
        r = e
      end
      step("Then it raises a SettingsError that starts with the path of the file and \"#{message}\"") do
        assert_kind_of Chatty::SettingsError, r
        assert_equal "#{path}: #{message}", r.message
      end
    ensure
      FileUtils.rm_rf(@auth_dir) if @auth_dir
    end
  end

  # ---- Stopping ----

  # A port free a moment ago on 127.0.0.1
  def free_port
    s = TCPServer.new('127.0.0.1', 0)
    s.addr[1]
  ensure
    s&.close
  end

  %w[INT TERM].each do |signal|
    scenario "The server stops on a signal while a page keeps /v1/rpc open (#{signal})" do
      dir = Dir.mktmpdir('lcty-stop-')
      port = free_port
      pid = pg = status = nil
      begin
        step('Given lcty.rb is running, with a page connected to /v1/rpc that never closes its end') do
          env = { 'LCTY_DATA_DIR' => dir, 'LCTY_PORT' => port.to_s, 'PORT' => nil, 'LCTY_BIND_IP' => nil,
                  'LCTY_BASE_URL' => nil, 'LCTY_ALLOWED_ORIGIN' => nil }
          pid = Process.spawn(env, RbConfig.ruby, LCTY_RB, chdir: REPO_ROOT, out: File::NULL, err: File::NULL)
          deadline = Time.now + 30
          begin
            TCPSocket.new('127.0.0.1', port).close
          rescue SystemCallError
            flunk 'lcty.rb did not start' if Time.now > deadline
            sleep 0.1
            retry
          end
          pg = RpcSupport::Page.new(port, origin: "http://127.0.0.1:#{port}")
        end
        step("When the server is sent #{signal}") { Process.kill(signal, pid) }
        step('Then it exits with the status 0 within 5 seconds') do
          deadline = Time.now + 5
          sleep 0.05 until (status = Process.wait2(pid, Process::WNOHANG)&.last) || Time.now > deadline
          refute_nil status, 'lcty.rb is still running'
          assert_equal 0, status.exitstatus
        end
        step('And the page got a close frame with the code 1001') { assert_equal 1001, pg.close_code }
      ensure
        pg&.close
        if pid && status.nil?
          Process.kill('KILL', pid) rescue nil
          Process.wait(pid) rescue nil
        end
        FileUtils.rm_rf(dir)
      end
    end
  end

  # ---- Lcty.listen ----

  # n ports that were free a moment ago, each taken by a TCPServer of the test on ip; release frees them
  def taken_ports(n, ip = '127.0.0.1')
    servers = Array.new(n) { TCPServer.new(ip, 0) }
    @taken = (@taken || []) + servers
    servers.map { |s| s.addr[1] }
  end

  def release(port)
    s = @taken.find { |t| t.addr[1] == port }
    s.close
    @taken.delete(s)
  end

  # Lcty.listen(asked, ports, ips): the server, or the PortError it raised. teardown stops it and puts Chatty.port back
  def listen(asked, ports, ips = ['127.0.0.1'])
    @port_before = Chatty.port
    @listener = Lcty.listen(asked, ports, ips)
  rescue Lcty::PortError => e
    e
  end

  # Whether this machine can listen on ::1 (a container may have no IPv6)
  def ipv6_loopback?
    TCPServer.new('::1', 0).close
    true
  rescue SystemCallError
    false
  end

  # Whether something answers at ip:port
  def answers?(ip, port)
    TCPSocket.new(ip, port).close
    true
  rescue SystemCallError
    false
  end

  scenario 'The server listens on every address given, at one port' do
    skip 'this machine has no IPv6 loopback' unless ipv6_loopback?
    port = nil
    step('Given a free port') { port = taken_ports(1).first.tap { |p| release(p) } }
    step('When Lcty.listen is given that port to ask for and the addresses "127.0.0.1" and "::1"') do
      assert_kind_of WEBrick::HTTPServer, listen(port, [], ['127.0.0.1', '::1'])
    end
    step('Then both addresses answer at that port') do
      assert answers?('127.0.0.1', port)
      assert answers?('::1', port)
    end
  end

  scenario 'A port taken on one of the addresses is skipped on all of them' do
    skip 'this machine has no IPv6 loopback' unless ipv6_loopback?
    first = second = server = nil
    step('Given two free ports, the first of them taken on "::1" by another server') do
      first, second = taken_ports(2, '::1')
      release(second)
    end
    step('When Lcty.listen is given no port to ask for, the two ports to try and the addresses "127.0.0.1" and "::1"') do
      server = listen(nil, [first, second], ['127.0.0.1', '::1'])
    end
    step('Then it listens on the second port') { assert_equal second, server.config[:Port] }
    step('And the first port is free again on "127.0.0.1"') do
      TCPServer.new('127.0.0.1', first).close # raises Errno::EADDRINUSE while a listener of the first try is open
    end
  end

  scenario 'An address that is not one of this machine stops the server' do
    r = nil
    step('When Lcty.listen is given the address "192.0.2.1"') { r = listen(nil, [taken_ports(1).first + 1], ['192.0.2.1']) }
    step('Then it raises Lcty::PortError "cannot listen on 192.0.2.1: it is not an address of this machine (--bind-ip)"') do
      assert_kind_of Lcty::PortError, r
      assert_equal 'cannot listen on 192.0.2.1: it is not an address of this machine (--bind-ip)', r.message
    end
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
