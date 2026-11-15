# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Storage (LCTYSP-0003, LCTYSP-0004, LCTYSP-0009): conversation files in data/c/, tag files in data/t/ (TagFiles) and
# the current tags of conversations in data/lcty_t.sqlite (TagStore).
# open_data opens every store and brings the derived data (search index, vector DB) in line with the files.

require 'json'
require 'fileutils'
require 'securerandom'
require 'time'
require_relative 'config'
require_relative 'conv_html'
require_relative 'uuid'
require_relative 'tag_store'
require_relative 'tag_files'
require_relative 'search_index'
require_relative 'c_store'

module Chatty
  module Store
    module_function

    # Write to a temporary file, then rename (atomic replace). Used whenever a conversation file is written whole.
    # Files whose head is not the current one (the format before 2026-11-07, a head edited by hand, or a header, lines 1
    # and 2, that has changed since) are rewritten with the current one at startup (LCTYSP-0003). What they hold is kept as read; so is their modification time, which
    # is updated_at_hint (the order of the list). A file whose meta cannot be read at all is left as it is.
    def migrate_heads
      conversation_paths.each do |path|
        with_lock(path) do |f|
          text = f.read
          next if text.start_with?(ConvHtml::HEADER) && ConvHtml.head_lines(text)
          next if ConvHtml.lcty_msg?(text) # LCTYSP-0013: written only through /v1/rpc, never rewritten whole
          entries = parse_lines(text, File.basename(path)).map(&:first)
          next if ConvHtml.current_meta(entries).empty?
          mtime = f.mtime
          write_atomic(path, document(entries))
          File.utime(File.atime(path), mtime, path)
          warn "rewrote #{File.basename(path)} with the current head"
        end
      rescue StandardError => e
        warn "could not rewrite #{File.basename(path)}: #{e.class}: #{e.message}"
      end
    end

    def write_atomic(path, data)
      FileUtils.mkdir_p(File.dirname(path))
      tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
      File.open(tmp, 'w:UTF-8') do |f|
        f.write(data)
        f.flush
        f.fsync
      end
      File.rename(tmp, path)
    ensure
      File.unlink(tmp) if tmp && File.exist?(tmp)
    end

    def conv_path(id)
      raise HttpError.new(400, 'invalid id') unless id.is_a?(String) && ID_RE.match?(id)
      File.join(CONV_DIR, "#{id}.html")
    end

    def existing_conv_path(id)
      path = conv_path(id)
      raise HttpError.new(404, 'not found') unless File.exist?(path)
      path
    end

    # The whole conversation file (the header on lines 1 and 2, the title slot on line 3, <lcty-c> on line 4, then the
    # elements. LCTYSP-0003)
    def document(lines)
      ConvHtml.document(lines)
    rescue ConvHtml::InvalidCharError => e
      raise HttpError.new(400, e.message)
    rescue ConvHtml::FormatError => e
      raise HttpError.new(500, e.message)
    end

    # [[line object, element], …]. A broken last element is dropped.
    def parse_lines(data, label = '')
      ConvHtml.decode(data, label)
    end

    def with_lock(path)
      File.open(path, 'r+:UTF-8') do |f|
        f.flock(File::LOCK_EX)
        yield f
      end
    end

    # Current tags: lcty_t.sqlite when they were changed after creation, else the tags at creation (data-setup-tags.
    # LCTYSP-0009). Tag changes are not written to the conversation file.
    def current_tags(entries)
      meta = ConvHtml.current_meta(entries)
      (meta['id'] && TAGS.conversation_tags(meta['id'])) || Array(meta['tags'])
    end

    # For index sync: [messages, current tags]
    def index_state(path)
      entries = parse_lines(File.read(path, mode: 'r:UTF-8')).map(&:first)
      [entries.select { |o| o['type'] == 'message' }, current_tags(entries)]
    end

    def summarize(path)
      entries = parse_lines(File.read(path, mode: 'r:UTF-8')).map(&:first)
      meta = ConvHtml.current_meta(entries)
      title = ConvHtml.current_title(entries)
      {
        'id' => meta['id'] || File.basename(path, '.html'),
        'title' => title && title['title'],
        'created_at' => meta['created_at'],
        'updated_at_hint' => File.mtime(path).iso8601, # a hint: the file's mtime, which copying, syncing or editing changes too
        'messages' => entries.count { |o| o['type'] == 'message' },
        'tags' => current_tags(entries),
        # Ids of the rounds this conversation owns (user message ids; maps semantic search hits to conversations. LCTYSP-0008)
        'message_ids' => entries.select { |o| o['type'] == 'message' && o['role'] == 'user' && !o['inherited'] }.map { |o| o['id'] },
        # Each own user and model message with its round, [[message id, round id], …]: maps a hit of semantic search,
        # which is a message (LCTYSP-0019), to its round and its conversation
        'message_rounds' => message_rounds(entries)
      }
    end

    # [[message id, round id], …] of the own user and assistant messages; a reply's round is the user message before it
    def message_rounds(entries)
      round = nil
      entries.each_with_object([]) do |o, out|
        next unless o['type'] == 'message'
        round = o['inherited'] ? nil : o['id'] if o['role'] == 'user' # a reply to an inherited one has no own round
        next if o['inherited'] || o['id'].nil?
        out << [o['id'], round] if round && %w[user assistant].include?(o['role'])
      end
    end

    # Conversation files. Skip names that are not valid conversation ids (copies like "… copy.html")
    def conversation_paths
      Dir.glob(File.join(CONV_DIR, '*.html')).select do |path|
        ok = ID_RE.match?(File.basename(path, '.html'))
        unless ok || (@skipped ||= {})[path]
          @skipped[path] = true
          warn "skip #{File.basename(path)}: the file name is not a valid conversation id"
        end
        ok
      end
    end

    def list_conversations
      conversation_paths.map do |path|
        begin
          summarize(path)
        rescue SystemCallError => e
          warn "skip #{path}: #{e.class}: #{e.message}"
          nil
        end
      end.compact.sort_by { |c| [c['updated_at_hint'].to_s, c['id'].to_s] }.reverse # newest first, then by id
    end

    # For the API: the conversation as an object ({meta, title, tags, messages})
    def conversation(id)
      entries = parse_lines(File.read(existing_conv_path(id), mode: 'r:UTF-8'), id).map(&:first)
      meta = ConvHtml.current_meta(entries)
      title = ConvHtml.current_title(entries)
      {
        'meta' => meta.reject { |k, _| k == 'type' },
        'title' => title ? title['title'] : '',
        'tags' => current_tags(entries),
        'messages' => entries.select { |o| o['type'] == 'message' }.map { |o| o.reject { |k, _| %w[type content_html].include?(k) } }
      }
    end

  end

  # At startup: bring the files of the layout before to this one (tags.sqlite renamed to lcty_t.sqlite), discard
  # _index.sqlite, open the stores (TAG_FILES, TAGS, C_STORE, INDEX) and fill the index from the files (LCTYSP-0015). The
  # vectors of semantic search are the vector pair of lib/embedding.rb, which lcty.rb opens next (LCTYSP-0019).
  def self.open_data
    FileUtils.mkdir_p(CONV_DIR)
    TagStore.rename_former(FORMER_TAGS_DB_PATH, TAGS_DB_PATH)
    SearchIndex.discard(INDEX_PATH)
    const_set(:TAG_FILES, TagFiles.new(TAG_DIR, TAG_LOCK_PATH))
    const_set(:TAGS, TagStore.new(TAGS_DB_PATH))
    const_set(:C_STORE, CStore.new(C_DB_PATH))
    const_set(:INDEX, SearchIndex.new(INDEX_PATH))
    Store.migrate_heads
    convs = Store.conversation_paths.map { |p| [File.basename(p, '.html'), Store.index_state(p)] }.to_h
    INDEX.full_sync(convs)
  end
end
