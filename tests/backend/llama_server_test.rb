# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3027: the scenarios of docs/specs/LCTYSP-3027_embedding-server.feature, written by hand. Each test has the
# title of its Scenario and one step per line of it, so the two read side by side. tests/backend/fake/llama-server
# stands in for llama-server.

require_relative 'helper'
require 'stringio'
require 'zlib'
require 'embedding'

class LlamaServerTest < Lcty::Scenarios
  Server = Chatty::Embedding::LlamaServer
  FAKE = File.expand_path('fake/llama-server', __dir__)

  def setup
    @dir = Dir.mktmpdir('lcty-llama-')
    @pid_path = File.join(@dir, 'lcty_embedding.pid')
    @child_log = File.join(@dir, '_llama-server.log')
    @log = StringIO.new
    @servers = []
    @env = {}
  end

  def teardown
    @servers.each(&:stop)
    @env.each { |k, v| ENV[k] = v }
    FileUtils.rm_rf(@dir)
  end

  # Set an environment variable for this test only
  def set_env(name, value)
    @env[name] = ENV[name] unless @env.key?(name)
    ENV[name] = value
  end

  def server(command: FAKE)
    s = Server.new(command: command, repo: Server::DEFAULT_REPO, pid_path: @pid_path, log: @log, child_log: @child_log,
                   health_interval: 0.05)
    @servers << s
    s
  end

  def ready_server
    s = server
    assert s.start
    assert s.wait_ready(10), "not ready: #{@log.string}"
    s
  end

  # The vector the fake answers for text: 768 numbers, of which the first 256 are kept and normalized
  def expected(text)
    seed = Zlib.crc32(text)
    head = Array.new(256) { |i| Math.sin(seed + i) }
    n = Math.sqrt(head.sum { |x| x * x })
    head.map { |x| x / n }
  end

  def child_pid
    Integer(File.read(@pid_path).split("\n")[0])
  end

  def running?(pid)
    Process.kill(0, pid)
    true
  rescue Errno::ESRCH
    false
  end

  def wait_until(timeout = 5)
    deadline = Time.now + timeout
    sleep 0.02 until yield || Time.now > deadline
    yield
  end

  scenario 'The child gets its whole command line and no LLAMA_* variable' do
    s = nil
    step('Given LLAMA_API_KEY is set in the environment') { set_env('LLAMA_API_KEY', 'secret') }
    step('When the embedding server is started and becomes ready') { s = ready_server }
    step("Then the child's command line is the model, --embedding, -c, -b and -ub 8192, -ngl all, --no-webui and --host") do
      line = File.read(@child_log)[/^argv (.*)$/, 1]
      assert_equal "--hf-repo ggml-org/embeddinggemma-2-GGUF:Q8_0 --embedding -c 8192 -b 8192 -ub 8192 -ngl all " \
                   "--no-webui --host #{s.socket_path}", line
    end
    step("And the socket is embedding.sock in a 0700 directory named lcty-") do
      assert_equal 'embedding.sock', File.basename(s.socket_path)
      assert File.basename(File.dirname(s.socket_path)).start_with?('lcty-')
      assert_equal 0o700, File.stat(File.dirname(s.socket_path)).mode & 0o777
    end
    step('And the child sees no LLAMA_* variable') { assert_equal 'env ', File.read(@child_log)[/^env .*$/] }
    step("And the pid file holds its pid and the socket's path") do
      pid, sock = File.read(@pid_path).split("\n")
      assert running?(Integer(pid))
      assert_equal s.socket_path, sock
    end
  end

  scenario 'Texts are embedded as 256 dimensions of length 1' do
    s = vectors = nil
    step('Given a ready embedding server') { s = ready_server }
    step('When two texts are embedded') { vectors = s.embed(%w[alpha beta]) }
    step("Then each vector is the first 256 of the child's 768 numbers, divided by their length") do
      assert_equal 2, vectors.size
      [%w[alpha beta], vectors].transpose.each do |text, v|
        assert_equal 256, v.size
        expected(text).zip(v).each { |a, b| assert_in_delta a, b, 1e-12 }
      end
    end
  end

  scenario 'Embedding before the server is ready is unavailable' do
    s = error = nil
    step('Given an embedding server whose child listens only after 1 second') do
      set_env('FAKE_LLAMA_DELAY', '1')
      s = server
      s.start
    end
    step('When a text is embedded at once') { error = (s.embed(['x']) rescue $!) }
    step('Then it raises Unavailable') { assert_kind_of Chatty::Embedding::Unavailable, error }
  end

  scenario 'A vector that is not 768 numbers is an error' do
    s = error = nil
    step('Given a ready embedding server whose child answers 100 numbers') do
      set_env('FAKE_LLAMA_DIMS', '100')
      s = ready_server
    end
    step('When a text is embedded') { error = (s.embed(['x']) rescue $!) }
    step('Then it raises Unavailable saying a vector is not 768 numbers') do
      assert_kind_of Chatty::Embedding::Unavailable, error
      assert_equal 'a vector is not 768 numbers', error.message
    end
  end

  scenario 'A child that exits is started again' do
    s = first = nil
    step('Given an embedding server whose child exits 0.5 seconds after it starts') do
      set_env('FAKE_LLAMA_EXIT', '0.5')
      s = server
    end
    step('When it has become ready, and then ready again') do
      s.start
      assert s.wait_ready(5)
      first = child_pid
      assert wait_until(10) { File.exist?(@pid_path) && child_pid != first && s.ready? }, @log.string
    end
    step('Then the log says the child exited and when it is started again') do
      assert_match(/llama-server exited \(exit 3\); starting it again in 1 s/, @log.string)
    end
    step('And the second child has another pid') { refute_equal first, child_pid }
  end

  scenario 'Stopping ends the child and removes its files' do
    s = pid = nil
    step('Given a ready embedding server') do
      s = ready_server
      pid = child_pid
    end
    step('When it is stopped') { s.stop }
    step('Then the child is gone') { refute running?(pid) }
    step("And the pid file and the socket's directory are removed") do
      refute File.exist?(@pid_path)
      refute File.exist?(File.dirname(s.socket_path))
    end
  end

  scenario 'A child left behind is stopped at the next start' do
    pid = dir = nil
    step('Given a child left running and its pid file, as after a server killed with KILL') do
      dir = Dir.mktmpdir('lcty-')
      sock = File.join(dir, 'embedding.sock')
      pid = Process.spawn(FAKE, '--host', sock, out: File::NULL)
      Process.detach(pid)
      File.write(@pid_path, "#{pid}\n#{sock}\n")
      assert wait_until { File.exist?(sock) }
    end
    step('When another embedding server is started with that pid file') { ready_server }
    step('Then the child left behind is gone and its directory removed') do
      assert wait_until { !running?(pid) }
      refute File.exist?(dir)
      assert_match(/stopping llama-server \(pid #{pid}\) left behind/, @log.string)
    end
  end

  scenario 'A pid file whose pid is not llama-server is left alone' do
    pid = nil
    step('Given a pid file naming the pid of a process that is not llama-server') do
      pid = Process.spawn('sleep', '30')
      File.write(@pid_path, "#{pid}\n/tmp/lcty-x/embedding.sock\n")
    end
    step('When an embedding server is started with that pid file') { ready_server }
    step('Then that process is still running') do
      assert running?(pid)
      Process.kill('KILL', pid)
      Process.wait(pid)
    end
  end

  scenario 'A socket path too long for sun_path starts nothing' do
    s = started = nil
    step('Given TMPDIR is a directory whose path is 120 bytes long') do
      deep = File.join(@dir, 'd' * (120 - @dir.bytesize - 1))
      FileUtils.mkdir_p(deep)
      assert_equal 120, deep.bytesize
      set_env('TMPDIR', deep)
    end
    step('When the embedding server is started') do
      s = server
      started = s.start
    end
    step('Then it returns false and the log says the socket path is too long') do
      refute started
      assert_match(/the socket path .* is longer than \d+ bytes/, @log.string)
    end
  end

  scenario 'A llama-server that cannot be found turns semantic search off' do
    s = nil
    step('Given the command is a path that does not exist') { s = server(command: File.join(@dir, 'no-such-llama-server')) }
    step('When the embedding server is started') { s.start }
    step('Then the log says it cannot be started') do
      assert wait_until { @log.string.include?('cannot start') }
      assert_match(/semantic search is off/, @log.string)
    end
    step('And it never becomes ready') { refute s.wait_ready(0.3) }
  end
end
