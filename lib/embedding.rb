# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Embedding on the server (LCTYSP-0019): the vector pair, the embedding server and the indexer, put together. lcty.rb
# starts it once the data is open; /v1 serves the pair, /v1/rpc embeds queries, and both tell it when a message comes or
# goes. Until it is started (the tests that do not start it), every call here does nothing.

require 'digest'
require 'set'
require_relative 'config'
require_relative 'uuid'
require_relative 'embedding/vector_pair'
require_relative 'embedding/llama_server'
require_relative 'embedding/indexer'

module Chatty
  module Embedding
    QUERY_PREFIX = 'task: search result | query: '
    UUID = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    # A whole line of a user or model lcty-msg (data-role comes first, then the id: the one order of LCTYSP-0013)
    MESSAGE_LINE_RE = %r{^<lcty-msg data-role="(?:user|model)" id="msg-[um]-(#{UUID})"[^\n]*</lcty-msg>$}.freeze
    ID_ATTR_RE = /\sid="msg-[um]-(#{UUID})"/.freeze

    class << self
      attr_reader :pair, :server, :indexer
      # Announces a change of the pair: ->(method, summary), set by lcty.rb to the hub of /v1/rpc
      attr_accessor :notifier

      # The name of the pair for the model repo: <slug>_<floats of a row>, the slug eg2 for the default model, else the
      # first 8 hex digits of the SHA-256 of repo
      def pair_name(repo = Chatty.embedding_hf_repo)
        slug = repo == LlamaServer::DEFAULT_REPO ? 'eg2' : Digest::SHA256.hexdigest(repo)[0, 8]
        "#{slug}_#{VectorPair::DAT_RECORD / 4}"
      end

      # The UUIDs of the user and model messages of every lcty-msg file of conv_dir: [[cid, uuid], …]
      def current_messages(conv_dir)
        Dir.glob(File.join(conv_dir, '*.html')).flat_map do |path|
          cid = File.basename(path, '.html').dup.force_encoding(Encoding::UTF_8)
          next [] unless ID_RE.match?(cid)
          text = File.read(path, mode: 'r:UTF-8')
          text.valid_encoding? ? text.scan(MESSAGE_LINE_RE).map { |(uuid)| [cid, uuid] } : []
        end
      end

      # The UUIDs of the user and model messages of the file at path ([] when there is none), read before it is deleted
      def message_ids_of(path)
        File.exist?(path) ? File.read(path, mode: 'r:UTF-8').scan(ID_ATTR_RE).flatten.uniq : []
      end

      # Open the pair (a new generation) and, when enabled, start the embedding server and queue every message
      # without a valid row
      def start(data_dir: DATA_DIR, conv_dir: CONV_DIR, enabled: Chatty.embedding?, command: Chatty.llama_server,
                repo: Chatty.embedding_hf_repo, log: $stderr)
        messages = current_messages(conv_dir)
        current = Set.new(messages.map { |_cid, uuid| Uuid.to_bytes(uuid) })
        @name = pair_name(repo)
        @pair = VectorPair.new(*VectorPair.paths(data_dir, @name), current: ->(id) { current.include?(id) })
        return log.puts('lcty-rb: embedding: off (--no-embedding); keyword search only') unless enabled

        @server = LlamaServer.new(command: command, repo: repo, pid_path: File.join(data_dir, 'lcty_embedding.pid'),
                                  log: log, child_log: File.join(data_dir, '_llama-server.log'))
        return @server = nil unless @server.start

        @indexer = Indexer.new(pair: @pair, server: @server, conv_dir: conv_dir, on_change: -> { changed }, log: log)
        messages.each { |cid, uuid| @indexer.enqueue(cid, uuid) unless @pair.valid?(Uuid.to_bytes(uuid)) }
        @indexer.start
      end

      # Stop the indexer, then the embedding server
      def stop
        @indexer&.stop
        @server&.stop
      end

      # Forget everything started (the tests)
      def reset
        stop
        @pair = @server = @indexer = @name = nil
      end

      # The name of the pair open now (nil before start)
      attr_reader :name

      # A user or model message was appended to the conversation cid
      def message_added(cid, uuid)
        @indexer&.enqueue(cid, uuid)
      end

      # Messages went away (uuids): their rows are filled with NaN
      def messages_removed(uuids)
        return unless @pair && !uuids.empty?
        changed if @pair.invalidate(uuids.map { |u| Uuid.to_bytes(u) })
      end

      # The query vector of text: 256 floats, L2-normalized. Raises Unavailable while there is no embedding server.
      def embed_query(text)
        raise Unavailable, 'semantic search is off' unless @server
        @server.embed([QUERY_PREFIX + text]).first
      end

      def changed
        notifier&.call("vectors.#{@name}.changed", @pair.summary)
      end
    end
  end
end
