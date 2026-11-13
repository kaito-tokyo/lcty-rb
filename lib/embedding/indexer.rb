# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The indexer (LCTYSP-0019): a thread that embeds the user and model messages queued for it, one conversation at a
# time, and appends their rows to the vector pair. A message longer than PART_CHARS is embedded in parts, a row each.
# Before appending, it checks under the pair's lock that the message is still in its file, so a message removed while it
# was being embedded is dropped. While the embedding server is down, the queue waits for it.

require 'set'
require_relative '../conv_html'
require_relative '../uuid'
require_relative 'llama_server'

module Chatty
  module Embedding
    class Indexer
      PREFIX = 'title: none | text: '
      PART_CHARS = 6000 # so each part fits the model's 8,192-token context

      # The texts embedded for one message: the prefix and each part of its content
      def self.inputs(content)
        parts = content.empty? ? [''] : content.scan(/.{1,#{PART_CHARS}}/m)
        parts.map { |p| PREFIX + p }
      end

      # The line of a user or model lcty-msg whose UUID is uuid, as written in a conversation file
      def self.marker(uuid)
        [%( id="msg-u-#{uuid}"), %( id="msg-m-#{uuid}")]
      end

      # pair: the VectorPair; server: what embeds (LlamaServer#embed and #wait_ready); conv_dir: where the conversation
      # files are; on_change: called after rows were appended
      def initialize(pair:, server:, conv_dir:, on_change: -> {}, log: $stderr)
        @pair = pair
        @server = server
        @conv_dir = conv_dir
        @on_change = on_change
        @log = log
        @lock = Mutex.new
        @wake = ConditionVariable.new
        @pending = {} # cid => Set of UUIDs, in the order the conversations were queued
        @stopping = false
        @busy = false
      end

      # Queue the message uuid of the conversation cid
      def enqueue(cid, uuid)
        @lock.synchronize do
          (@pending[cid] ||= Set.new) << uuid
          @wake.signal
        end
      end

      def start
        @thread = Thread.new { run }
        self
      end

      def stop
        @lock.synchronize do
          @stopping = true
          @wake.broadcast
        end
        @thread&.join(5)
      end

      # Wait until the queue is empty and nothing is being embedded (the tests), at most timeout seconds
      def drain(timeout = 10)
        deadline = Time.now + timeout
        sleep 0.01 while Time.now < deadline && @lock.synchronize { !@pending.empty? || @busy }
        @lock.synchronize { @pending.empty? && !@busy }
      end

      # Embed every message of ids (UUIDs) still in the conversation cid and without a valid row. Returns the UUIDs
      # left to do when the embedding server became unavailable, else [].
      def process(cid, ids)
        path = File.join(@conv_dir, "#{cid}.html")
        contents = messages(path)
        ids.each_with_index do |uuid, i|
          next unless (content = contents[uuid])
          id = Uuid.to_bytes(uuid)
          next if @pair.valid?(id)
          begin
            vectors = @server.embed(Indexer.inputs(content))
          rescue Unavailable => e
            return ids[i..-1] unless @server.ready?
            @log.puts "lcty-rb: embedding: #{cid} #{uuid} is not embedded: #{e.message}"
            next
          end
          @on_change.call if @pair.append(id, vectors) { exists?(path, uuid) }
        end
        []
      end

      private

      def run
        loop do
          cid, ids = @lock.synchronize do
            @wake.wait(@lock) while @pending.empty? && !@stopping
            return if @stopping
            @busy = true
            @pending.shift
          end
          left = process(cid, ids.to_a)
          @lock.synchronize { @busy = false }
          next if left.empty?
          left.each { |uuid| enqueue(cid, uuid) }
          sleep 0 until @server.wait_ready(1) || @lock.synchronize { @stopping } # stop is not held up by a server down
        end
      rescue StandardError => e
        @log.puts "lcty-rb: embedding: the indexer stopped: #{e.class}: #{e.message}"
      end

      # {UUID => content} of the user and model messages of an lcty-msg file ({} when it is gone or of another format)
      def messages(path)
        text = File.open(path, 'r:UTF-8') do |f|
          f.flock(File::LOCK_SH)
          f.read
        end
        return {} unless ConvHtml.lcty_msg?(text)
        ConvHtml.decode(text, File.basename(path)).map(&:first)
                .select { |o| o['type'] == 'message' }.map { |o| [o['id'], o['content'].to_s] }.to_h
      rescue Errno::ENOENT
        {}
      end

      def exists?(path, uuid)
        text = File.open(path, 'r:UTF-8') do |f|
          f.flock(File::LOCK_SH)
          f.read
        end
        Indexer.marker(uuid).any? { |m| text.include?(m) }
      rescue Errno::ENOENT
        false
      end
    end
  end
end
