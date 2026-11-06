# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Storage (LCTYSP-003, LCTYSP-004, LCTYSP-009): conversation files in data/c/ and tag definitions in data/tags.sqlite.
# open_data opens every store and brings the derived data (search index, vector DB) in line with the files.

require 'json'
require 'fileutils'
require 'securerandom'
require 'time'
require_relative 'config'
require_relative 'conv_html'
require_relative 'uuid'
require_relative 'tag_store'
require_relative 'search_index'
require_relative 'v1/vector_db'

module Chatty
  module Store
    module_function

    APPENDABLE = %w[message title tags].freeze # tags lines go to tags.sqlite, not to the file (LCTYSP-009)
    # A new conversation may also end with a command tag (send: generate a reply at once. LCTYSP-004)
    CREATABLE = %w[message title cmd].freeze # the tags at creation are meta.tags

    # Write to a temporary file, then rename (atomic replace). Used whenever a conversation file is written whole.
    # Files whose head is not in the current format (the one before 2026-11-07, or a head edited by hand) are rewritten
    # in the current one at startup (LCTYSP-003). What they hold is kept as read; so is their modification time, which
    # is updated_at_hint (the order of the list). A file whose meta cannot be read at all is left as it is.
    def migrate_heads
      conversation_paths.each do |path|
        with_lock(path) do |f|
          text = f.read
          next if ConvHtml.head_lines(text)
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
    # elements. LCTYSP-003)
    def document(lines)
      ConvHtml.document(lines)
    rescue ConvHtml::InvalidCharError => e
      raise HttpError.new(400, e.message)
    rescue ConvHtml::FormatError => e
      raise HttpError.new(500, e.message)
    end

    # Conversations are HTML fragments of Custom Elements (LCTYSP-003). Line objects are written as elements.
    def encode_lines(lines)
      ConvHtml.encode(lines)
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

    # Give message lines without an id a UUIDv7 id (so the index stays sane even if a client forgets. LCTYSP-003).
    def ensure_ids!(lines)
      lines.each { |l| l['id'] ||= Uuid.v7 if l['type'] == 'message' }
    end

    def messages_of(path)
      parse_lines(File.read(path, mode: 'r:UTF-8')).map(&:first).select { |o| o['type'] == 'message' }
    end

    def validate_lines!(lines, allowed)
      raise HttpError.new(400, 'lines must be an array of objects') unless lines.is_a?(Array) && lines.all? { |l| l.is_a?(Hash) }
      bad = lines.find { |l| !allowed.include?(l['type']) }
      raise HttpError.new(400, "line type not allowed: #{bad['type'].inspect}") if bad
      lines.each { |l| validate_tag_list!(l['tags']) if l['type'] == 'tags' }
      bad = lines.find { |l| l.key?('content_html') && !l['content_html'].is_a?(String) }
      raise HttpError.new(400, 'content_html must be a string') if bad
      # Reject characters that cannot be written before writing any line (so nothing fails halfway)
      lines.each_with_index { |l, i| ConvHtml.check_chars!(l, "lines[#{i}]") }
      bad = lines.find { |l| l['type'] == 'message' && l.key?('id') && !Uuid.valid?(l['id']) }
      raise HttpError.new(400, "message id must be a UUIDv7: #{bad['id'].inspect}") if bad
      bad = lines.find { |l| l['type'] == 'cmd' && !ConvHtml::CMD_OP_RE.match?(l['op'].to_s) }
      raise HttpError.new(400, "invalid command: #{bad['op'].inspect}") if bad
    rescue ConvHtml::InvalidCharError => e
      raise HttpError.new(400, e.message)
    end

    def validate_tag_list!(tags)
      ok = tags.is_a?(Array) && tags.all? { |t| t.is_a?(String) && TAG_NAME_RE.match?(t) } && tags.uniq.size == tags.size
      raise HttpError.new(400, 'tags must be an array of unique tag names') unless ok
    end

    # Current tags: tags.sqlite when they were changed after creation, else the tags at creation (data-setup-tags.
    # LCTYSP-009). Tag changes are not written to the conversation file.
    def current_tags(entries)
      meta = ConvHtml.current_meta(entries)
      (meta['id'] && TAGS.conversation_tags(meta['id'])) || Array(meta['tags'])
    end

    # For index sync: [messages, current tags]
    def index_state(path)
      entries = parse_lines(File.read(path, mode: 'r:UTF-8')).map(&:first)
      [entries.select { |o| o['type'] == 'message' }, current_tags(entries)]
    end

    def create(body)
      raise HttpError.new(400, 'body must be an object') unless body.is_a?(Hash)
      meta = body['meta']
      raise HttpError.new(400, 'meta must be an object') unless meta.is_a?(Hash)
      validate_tag_list!(meta['tags'] ||= [])
      lines = body['lines'] || []
      validate_lines!(lines, CREATABLE)
      path = conv_path(meta['id'])
      raise HttpError.new(409, 'already exists') if File.exist?(path)
      ensure_ids!(lines)
      meta = meta.slice('id', 'created_at', 'tags', 'instructions') # the tags at creation are data-setup-tags
      write_atomic(path, document([meta.merge('type' => 'meta')] + lines))
      meta['id']
    end

    def append(id, lines)
      validate_lines!(lines, APPENDABLE)
      return if lines.empty?
      ensure_ids!(lines)
      titles, lines = lines.partition { |l| l['type'] == 'title' }
      tags, lines = lines.partition { |l| l['type'] == 'tags' }
      set_title(id, titles.last) unless titles.empty?
      unless tags.empty?
        existing_conv_path(id) # 404 for an unknown conversation
        TAGS.set_conversation_tags(id, tags.last['tags'], tags.last['at'])
      end
      return if lines.empty?
      with_lock(existing_conv_path(id)) do |f|
        size = f.size
        if size > 0
          f.seek(size - 1)
          last = f.read(1)
        end
        f.seek(0, IO::SEEK_END)
        f.write((last && last != "\n" ? "\n" : '') + encode_lines(lines))
        f.flush
        f.fsync
      end
    end

    # The title is the <title> on line 3, in the slot whose length its id carries (LCTYSP-003). The slot is overwritten
    # in place; when the file has no valid slot (an older head, or a broken one) the whole file is rewritten instead.
    def set_title(id, title_line)
      path = existing_conv_path(id)
      with_lock(path) do |f|
        f.binmode
        head = Array.new(ConvHtml::HEAD_LINES - 1) { f.gets }
        range = head.all? && ConvHtml.slot_range(head[2])
        slot = range && ConvHtml.title_slot(title_line['title'], range[1])
        if slot && !ConvHtml.legacy?(head[0])
          f.seek(head[0].bytesize + head[1].bytesize + range[0])
          f.write(slot.b)
          f.flush
          f.fsync
          next
        end
        f.rewind
        entries = parse_lines(f.read.force_encoding(Encoding::UTF_8), id).map(&:first)
        write_atomic(path, document(entries.reject { |o| o['type'] == 'title' } + [title_line]))
      end
    end

    # Delete from the n-th message (0-based, counting message lines only).
    # One call may go back at most one turn: reject n before the last user message (LCTYSP-004).
    def pop(id, from)
      raise HttpError.new(400, 'from must be an integer') unless from.is_a?(Integer) && from >= 0
      path = existing_conv_path(id)
      with_lock(path) do |f|
        entries = parse_lines(f.read, id).map(&:first)
        messages = entries.each_index.select { |i| entries[i]['type'] == 'message' }
        return if from >= messages.size
        last_user = messages.rindex { |i| entries[i]['role'] == 'user' }
        if last_user.nil? || from < last_user
          raise HttpError.new(409, 'can only pop the last turn (from must be >= index of the last user message)')
        end
        cut = messages[from]
        # Keep the title after the cut
        keep = entries[0...cut] + entries[cut..-1].select { |o| o['type'] == 'title' }
        write_atomic(path, document(keep))
      end
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
        # Ids of the rounds this conversation owns (user message ids; maps semantic search hits to conversations. LCTYSP-008)
        'message_ids' => entries.select { |o| o['type'] == 'message' && o['role'] == 'user' && !o['inherited'] }.map { |o| o['id'] }
      }
    end

    # The meta of every conversation, newest first, from its head lines only (lines 1 to 4: the header, the title slot and
    # <lcty-c>. LCTYSP-003): they hold what a list needs, so the rest of each file is not read (GET /v1/meta-all.json).
    # setup_tags are the tags at creation; later changes are in tags.sqlite, which tags_hint reflects.
    # updated_at_hint is only a hint (the file's mtime, which copying, syncing or editing by hand changes too), and so is
    # tags_hint and messages_hint, the current tags and the number of messages as recorded in the search index (derived;
    # LCTYSP-007).
    def meta_all
      tags = INDEX.tags_hint
      counts = INDEX.messages_hint
      conversation_paths.map do |path|
        begin
          text = File.open(path, 'r:UTF-8') { |f| Array.new(ConvHtml::HEAD_LINES) { f.gets }.compact.join }
          head = ConvHtml.head_lines(text)
          unless head
            warn "skip #{File.basename(path)}: no head lines"
            next nil
          end
          meta = ConvHtml.frame_meta(head[3])
          {
            'id' => meta['id'], 'title' => ConvHtml.slot_title(head[2]).to_s, 'created_at' => meta['created_at'],
            'updated_at_hint' => File.mtime(path).iso8601, 'setup_tags' => meta['tags'],
            'tags_hint' => tags[meta['id']] || [], 'messages_hint' => counts[meta['id']]
          }
        rescue SystemCallError => e
          warn "skip #{path}: #{e.class}: #{e.message}"
          nil
        end
      end.compact.sort_by { |c| [c['updated_at_hint'].to_s, c['id'].to_s] }.reverse # the same order as the browser (LCTYSP-010)
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

    # Tag definitions and memory live in TagStore (data/tags.sqlite. LCTYSP-009). Only validation happens here.
    def tags
      TAGS.all
    end

    def validate_tags!(obj)
      raise HttpError.new(400, 'body must be {"tags": [...]}') unless obj.is_a?(Hash) && obj['tags'].is_a?(Array)
      names = []
      obj['tags'].each do |t|
        raise HttpError.new(400, 'each tag must be an object') unless t.is_a?(Hash)
        raise HttpError.new(400, "invalid tag name: #{t['name'].inspect}") unless t['name'].is_a?(String) && TAG_NAME_RE.match?(t['name'])
        raise HttpError.new(400, 'prompt must be a string') unless t['prompt'].nil? || t['prompt'].is_a?(String)
        mem = t['memory'] ||= []
        ok = mem.is_a?(Array) && mem.all? { |m| m.is_a?(Hash) && m['id'].is_a?(String) && m['text'].is_a?(String) && !m['text'].strip.empty? }
        raise HttpError.new(400, 'memory must be an array of {id, text}') unless ok
        names << t['name']
      end
      raise HttpError.new(400, 'tag names must be unique') unless names.uniq.size == names.size
      ids = obj['tags'].flat_map { |t| t['memory'].map { |m| m['id'] } }
      raise HttpError.new(400, 'memory ids must be unique') unless ids.uniq.size == ids.size
    end

    def put_tags(obj)
      validate_tags!(obj)
      TAGS.replace_all(obj)
    end

    def memory_text!(body)
      text = body.is_a?(Hash) && body['text'].is_a?(String) ? body['text'].strip : ''
      raise HttpError.new(400, 'text is required') if text.empty?
      text
    end

    def add_memory(name, body)
      TAGS.add_memory(name, memory_text!(body), body['source'])
    end

    def edit_memory(name, id, body)
      TAGS.edit_memory(name, id, memory_text!(body))
    end

    def delete_memory(name, id)
      TAGS.delete_memory(name, id)
    end
  end

  # At startup: open the stores (TAGS, INDEX, VECTORS), sync the index with the files and garbage-collect vectors.
  def self.open_data
    FileUtils.mkdir_p(CONV_DIR)
    const_set(:TAGS, TagStore.new(TAGS_DB_PATH))
    const_set(:INDEX, SearchIndex.new(INDEX_PATH))
    const_set(:VECTORS, V1::VectorDB.new(INDEX, DATA_DIR))
    Store.migrate_heads
    convs = Store.conversation_paths.map { |p| [File.basename(p, '.html'), Store.index_state(p)] }.to_h
    INDEX.full_sync(convs)
    VECTORS.gc_all
  end
end
