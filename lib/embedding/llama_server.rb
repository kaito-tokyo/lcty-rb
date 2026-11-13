# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The embedding server (LCTYSP-0019): a llama-server of lcty.rb's own for the embedding model alone, a child process
# listening on a UNIX domain socket in a 0700 directory of its own, and the client that talks HTTP/1.1 to it. Ruby 2.6's
# Net::HTTP cannot open a UNIX socket, so the client writes the request itself, one connection per request.
#
# LlamaServer#start runs a thread that starts the child, polls GET /health until it answers 200, waits for the child
# and starts it again with a growing delay when it exits. The pid and socket of the child are kept in a pid file, so a
# child left behind by a server killed with KILL is stopped at the next start.

require 'fileutils'
require 'json'
require 'socket'
require 'tmpdir'

module Chatty
  module Embedding
    # The embedding server cannot be used now (not started yet, down, or answering an error)
    class Unavailable < StandardError; end

    # HTTP/1.1 over a UNIX socket, one connection per request (Connection: close)
    module SocketHttp
      module_function

      # [status, body] of a request to the socket at path
      def request(path, method, target, body = nil, timeout: 60)
        UNIXSocket.open(path) do |s|
          head = +"#{method} #{target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
          head << "Content-Type: application/json\r\nContent-Length: #{body.bytesize}\r\n" if body
          s.write("#{head}\r\n#{body}")
          parse(read_all(s, timeout))
        end
      rescue SystemCallError, IOError => e
        raise Unavailable, "#{path}: #{e.class}: #{e.message}"
      end

      # Everything the server sends until it closes the connection
      def read_all(s, timeout)
        out = String.new(encoding: Encoding::BINARY)
        deadline = Time.now + timeout
        loop do
          left = deadline - Time.now
          raise Unavailable, 'the embedding server did not answer in time' if left <= 0 || !IO.select([s], nil, nil, left)
          chunk = s.read_nonblock(65_536, exception: false)
          break if chunk.nil?
          out << chunk unless chunk == :wait_readable
        end
        out
      end

      # [status, body] of a whole response; a chunked body is joined
      def parse(raw)
        head, body = raw.split("\r\n\r\n", 2)
        status = head.to_s[%r{\AHTTP/1\.[01] (\d{3})}, 1] or raise Unavailable, 'not an HTTP response'
        body = dechunk(body.to_s) if head =~ /^transfer-encoding:\s*chunked/i
        [status.to_i, body.to_s.force_encoding(Encoding::UTF_8)]
      end

      def dechunk(body)
        out = String.new(encoding: Encoding::BINARY)
        until body.empty?
          size_line, body = body.split("\r\n", 2)
          size = size_line.to_s.to_i(16)
          break if size.zero?
          out << body.byteslice(0, size)
          body = body.byteslice(size + 2..-1).to_s
        end
        out
      end
    end

    class LlamaServer
      DEFAULT_REPO = 'ggml-org/embeddinggemma-2-GGUF:Q8_0'
      FULL_DIMS = 768 # what the model returns; the first 256 are kept (Matryoshka)
      # sun_path, the terminating NUL included
      SUN_PATH = RUBY_PLATFORM.include?('darwin') ? 104 : 108
      STOP_WAIT = 5 # seconds between TERM and KILL
      MAX_DELAY = 60 # the longest wait before starting a child that exited again

      attr_reader :socket_path

      # command: the llama-server to run; repo: the model, as --hf-repo; pid_path: the pid file in the data directory;
      # log: an IO for the lines about the child; child_log: the file its own output goes to
      def initialize(command:, repo:, pid_path:, log: $stderr, child_log: File::NULL, health_interval: 0.2)
        @command = command
        @repo = repo
        @pid_path = pid_path
        @log = log
        @child_log = child_log
        @health_interval = health_interval
        @lock = Mutex.new
        @ready = ConditionVariable.new
        @state = :stopped # :starting, :ready, :stopped
        @stopping = false
        @pid = nil
      end

      # The command line of the child (no LLAMA_* variable of the environment applies: everything is here)
      def argv
        [@command, '--hf-repo', @repo, '--embedding', '-c', '8192', '-b', '8192', '-ub', '8192', '-ngl', 'all',
         '--no-webui', '--host', @socket_path]
      end

      # The environment of the child: every LLAMA_* variable unset
      def self.env
        ENV.keys.select { |k| k.start_with?('LLAMA_') }.map { |k| [k, nil] }.to_h
      end

      def ready?
        @lock.synchronize { @state == :ready }
      end

      # Wait until the server is ready, at most timeout seconds (nil: as long as it takes); whether it is
      def wait_ready(timeout = nil)
        deadline = timeout && Time.now + timeout
        @lock.synchronize do
          until @state == :ready || @stopping
            left = deadline && deadline - Time.now
            return false if left && left <= 0
            @ready.wait(@lock, left)
          end
          @state == :ready
        end
      end

      # Stop a child left behind, make the socket's directory and start supervising. Returns false (and logs why) when
      # the socket's path would not fit sun_path; nothing is started then.
      def start
        stop_left_behind
        @dir = Dir.mktmpdir('lcty-')
        @socket_path = File.join(@dir, 'embedding.sock')
        if @socket_path.bytesize >= SUN_PATH
          say "the socket path #{@socket_path} is longer than #{SUN_PATH - 1} bytes (TMPDIR); semantic search is off"
          FileUtils.rm_rf(@dir)
          return false
        end
        @thread = Thread.new { supervise }
        true
      end

      # Stop the child (TERM, then KILL after STOP_WAIT seconds), remove the pid file and then the directory
      def stop
        pid = @lock.synchronize do
          @stopping = true
          @ready.broadcast
          @pid
        end
        signal('TERM', pid)
        unless @thread.nil? || @thread.join(STOP_WAIT)
          signal('KILL', @lock.synchronize { @pid })
          @thread.join(1)
        end
        FileUtils.rm_f(@pid_path)
        FileUtils.rm_rf(@dir) if @dir
      end

      # The vectors of texts, the first 256 dimensions of each, L2-normalized. Raises Unavailable when the server is
      # not ready or does not answer with 768 dimensions for each.
      def embed(texts)
        raise Unavailable, 'the embedding server is not ready' unless ready?
        status, body = SocketHttp.request(@socket_path, 'POST', '/v1/embeddings', JSON.generate('input' => texts))
        raise Unavailable, "POST /v1/embeddings answered #{status}: #{body[0, 200]}" unless status == 200
        data = JSON.parse(body)['data']
        raise Unavailable, 'not one vector for each input' unless data.is_a?(Array) && data.size == texts.size
        data.sort_by { |d| d['index'].to_i }.map { |d| LlamaServer.truncate(d['embedding']) }
      rescue JSON::ParserError => e
        raise Unavailable, "POST /v1/embeddings: #{e.message}"
      end

      # The first 256 of 768 dimensions, L2-normalized
      def self.truncate(v)
        raise Unavailable, 'a vector is not 768 numbers' unless v.is_a?(Array) && v.size == FULL_DIMS && v.all? { |x| x.is_a?(Numeric) }
        head = v.first(VectorPair::DIMS)
        norm = Math.sqrt(head.sum { |x| x * x })
        raise Unavailable, 'a vector is zero' if norm.zero? || !norm.finite?
        head.map { |x| x / norm }
      end

      private

      def say(line)
        @log.puts "lcty-rb: embedding: #{line}"
      end

      def supervise
        delay = 0.5
        until @lock.synchronize { @stopping }
          started = Time.now
          pid = spawn_child or return
          status = await_child(pid)
          break if @lock.synchronize { @stopping }
          delay = Time.now - started > MAX_DELAY ? 1 : [delay * 2, MAX_DELAY].min
          how = status.nil? ? 'unknown' : status.signaled? ? "signal #{status.termsig}" : "exit #{status.exitstatus}"
          say "llama-server exited (#{how}); starting it again in #{format('%g', delay)} s"
          @lock.synchronize { @ready.wait(@lock, delay) unless @stopping } # stop wakes it
        end
      end

      # Start the child and write the pid file; nil (logged) when it cannot be started at all
      def spawn_child
        FileUtils.rm_f(@socket_path)
        pid = Process.spawn(LlamaServer.env, *argv, in: File::NULL, %i[out err] => [@child_log, 'a'])
        @lock.synchronize do
          @pid = pid
          @state = :starting
        end
        tmp = "#{@pid_path}.tmp-#{Process.pid}"
        File.write(tmp, "#{pid}\n#{@socket_path}\n")
        File.rename(tmp, @pid_path) # never read half written
        say "started llama-server (pid #{pid}) on #{@socket_path}"
        pid
      rescue SystemCallError => e
        say "cannot start #{@command}: #{e.message}; semantic search is off"
        nil
      end

      # Poll /health until the child answers 200, then wait for it to exit. Returns its status.
      def await_child(pid)
        until @lock.synchronize { @stopping }
          _, status = Process.waitpid2(pid, Process::WNOHANG)
          return finished(status) if status
          if health_ok?
            @lock.synchronize do
              @state = :ready
              @ready.broadcast
            end
            say 'llama-server is ready'
            break
          end
          sleep @health_interval
        end
        _, status = Process.waitpid2(pid)
        finished(status)
      rescue Errno::ECHILD
        finished(nil)
      end

      def finished(status)
        @lock.synchronize do
          @state = :stopped
          @pid = nil
        end
        status
      end

      def health_ok?
        SocketHttp.request(@socket_path, 'GET', '/health', timeout: 2)[0] == 200
      rescue Unavailable
        false
      end

      def signal(sig, pid)
        Process.kill(sig, pid) if pid
      rescue Errno::ESRCH
        nil
      end

      # A child of a server that did not stop cleanly: TERM it when its pid still runs llama-server with its socket
      def stop_left_behind
        return unless File.exist?(@pid_path)
        pid, sock = File.read(@pid_path).split("\n")
        FileUtils.rm_f(@pid_path)
        pid = Integer(pid.to_s, 10, exception: false)
        return unless pid
        cmd = `ps -o command= -p #{pid}`.to_s
        return unless sock && cmd.include?('llama-server') && cmd.include?(sock)
        say "stopping llama-server (pid #{pid}) left behind by a server that did not stop cleanly"
        Process.kill('TERM', pid) rescue nil
        dir = File.dirname(sock)
        FileUtils.rm_rf(dir) if File.basename(dir).start_with?('lcty-')
      end
    end
  end
end
