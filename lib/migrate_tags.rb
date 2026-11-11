# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# tools/migrate_tags.rb: move the tag definitions and memory of an older version (the tables tags and memory of
# tags.sqlite, formats 1 and 2) to tag files in t/ (LCTYSP-0009), once, by hand, with the server stopped. The server
# drops those tables when it opens the file (TagStore, format 3), so the tool reads the file before the server has
# started, or a backup of it.
#
#   1. The old tags are read, in their order (position), with their memory (in the order of at).
#   2. Each becomes a new tag file t/NNNNN-<part>.html, numbered after the largest number in t/ (+10 each, as the tag
#      editor numbers new tags). A tag whose part has a tag file already is left as it is (it was migrated before, or
#      defined again by hand): running the tool again adds only the rest. A name the tag editor would refuse is not
#      migrated and reported.
#   3. When every tag could be migrated, the references of conversations in lcty_t.sqlite that are an old display name
#      (Ruby) are changed to its part (ruby), so the conversations show the migrated tag.
#
# The part is derived here as js/tag-names.js does in the browser (tagPart): NFC, lowercase, final sigma as sigma, NFC,
# and the ASCII symbols escaped as ~xx. Ruby's Unicode tables may be older than the browser's; only characters new in
# Unicode could differ.

require 'sqlite3'
require 'time'
require_relative 'config'
require_relative 'tag_files'
require_relative 'uuid'

module Chatty
  module MigrateTags
    module_function

    NAME_MAX = 40 # TAG_NAME_MAX of js/tag-names.js, in code points after NFC
    FORBIDDEN_RE = %r{[\p{Z}\p{C}:;/"'`~\\|]}.freeze
    ESCAPED_RE = /[!#$%&()*<>?\[\]^{}]/.freeze
    MAX_NUMBER = 99_999
    STEP = 10

    # Why the display name cannot be a tag (tagNameError of js/tag-names.js), or nil
    def name_error(name)
      return 'must be valid UTF-8' unless name.valid_encoding?
      n = name.unicode_normalize(:nfc)
      return "must be 1 to #{NAME_MAX} characters" unless (1..NAME_MAX).cover?(n.length)
      return 'must not contain whitespace, control characters or any of : ; / " \' ` ~ \\ |' if FORBIDDEN_RE.match?(n)
      nil
    end

    # The file-name part of a display name (tagPart of js/tag-names.js)
    def part(name)
      n = name.unicode_normalize(:nfc).downcase.tr('ς', 'σ').unicode_normalize(:nfc)
      n.gsub(ESCAPED_RE) { |c| format('~%02x', c.ord) }
    end

    # The old tags of the file at path, [{name, prompt, memory}] in their order, or nil when it holds none (a newer
    # format, whose tables were dropped already, or a file of another kind). The file is opened read-only.
    def read_former(path)
      raise ArgumentError, "#{path}: no such file" unless File.file?(path)
      db = SQLite3::Database.new(path, readonly: true)
      begin
        version = db.get_first_value('PRAGMA user_version').to_i
        tables = db.execute("SELECT name FROM sqlite_master WHERE type = 'table'").map(&:first)
        return nil if version >= 3 || !tables.include?('tags')
        memory = Hash.new { |h, k| h[k] = [] }
        if tables.include?('memory')
          db.execute('SELECT id, tag, text, at, source_conv, source_msg FROM memory ORDER BY at, rowid') do |id, tag, text, at, sc, sm|
            item = { 'id' => id.to_s, 'text' => text.to_s, 'at' => at }
            src = { 'conv_id' => sc, 'msg_id' => sm }.reject { |_, v| v.nil? || v.empty? }
            item['source'] = src unless src.empty?
            memory[tag] << item
          end
        end
        db.execute('SELECT name, prompt FROM tags ORDER BY position, rowid').map do |name, prompt|
          { 'name' => name.to_s, 'prompt' => prompt.to_s, 'memory' => memory[name] }
        end
      ensure
        db.close
      end
    end

    # Write the old tags (from read_former) as new tag files of tag_files (a TagFiles). Returns {migrated:, present:,
    # failed:, refs:}: the names migrated, the names whose part has a tag file already, [name, why] of those not
    # migrated, and {old name => part} for every tag that now has a tag file under another reference than its name.
    def migrate(old_tags, tag_files, out: $stderr)
      result = { migrated: [], present: [], failed: [], refs: {} }
      existing = tag_files.all.first['tags']
      parts = existing.map { |t| TagFiles.nfc_part(t['file']) }
      last = existing.map { |t| t['file'][0, 5].to_i }.max || 0
      ids = existing.flat_map { |t| t['memory'].map { |m| m['id'] } }
      done = {} # part => the old name that took it
      old_tags.each do |t|
        name = t['name']
        if (err = name_error(name))
          fail_tag(result, out, name, "the name #{err}")
          next
        end
        nfc = name.unicode_normalize(:nfc)
        p = part(nfc)
        if done.key?(p)
          fail_tag(result, out, name, "it has the same file name as #{done[p].inspect}")
          next
        end
        done[p] = name
        if parts.include?(p)
          result[:present] << name
          result[:refs][name] = p unless name == p
          out.puts "skip #{name.inspect}: a tag file for #{p.inspect} exists (its memory is not merged)"
          next
        end
        if last + STEP > MAX_NUMBER
          fail_tag(result, out, name, 'the tag numbers have reached 99999 (renumber the tags on /t/)')
          next
        end
        memory = memory_items(t['memory'], ids, name, out)
        tag = { 'file' => format('%05d-%s.html', last + STEP, p), 'name' => nfc, 'ops' => [], 'prompt' => t['prompt'],
                'memory' => memory }
        begin
          tag_files.add_all('tags' => [tag])
        rescue HttpError => e
          fail_tag(result, out, name, e.message)
          next
        end
        last += STEP
        ids.concat(memory.map { |m| m['id'] })
        result[:migrated] << name
        result[:refs][name] = p unless name == p
        out.puts "migrated #{name.inspect} to t/#{tag['file']} (#{memory.size} memory items)"
      end
      result
    end

    # The memory items of one old tag as tag_files takes them: an empty item is dropped, and an id that a tag file
    # cannot hold, or that is taken, is replaced by a new one
    def memory_items(items, ids, name, out)
      seen = []
      items.each_with_object([]) do |m, a|
        if m['text'].strip.empty?
          out.puts "#{name.inspect}: dropped an empty memory item #{m['id'].inspect}"
          next
        end
        item = m.dup
        item['id'] = Uuid.v7 if !TagFiles::MEMORY_ID_RE.match?(item['id']) || ids.include?(item['id']) || seen.include?(item['id'])
        seen << item['id']
        a << item
      end
    end

    def fail_tag(result, out, name, why)
      result[:failed] << [name, why]
      out.puts "could not migrate #{name.inspect}: #{why}"
    end

    # Change the references of conversations in tag_store (a TagStore) by refs ({old name => part}), each
    # conversation's order kept. Returns the number of conversations changed.
    def convert_refs(tag_store, refs)
      return 0 if refs.empty?
      by_cid = Hash.new { |h, k| h[k] = [] }
      tag_store.list.each { |r| by_cid[r['cid']] << r['tag'] }
      by_cid.count do |cid, tags|
        mapped = tags.map { |t| refs.fetch(t, t) }.uniq
        next false if mapped == tags
        tag_store.set_conversation_tags(cid, mapped)
        true
      end
    end

    # tools/migrate_tags.rb [path]: migrate the old tags of path (by default tags.sqlite of the data directory, else
    # lcty_t.sqlite), then the references of lcty_t.sqlite. Returns whether everything could be migrated.
    def main(args, out: $stderr)
      source = args.first || [FORMER_TAGS_DB_PATH, TAGS_DB_PATH].find { |f| File.file?(f) }
      unless source
        out.puts "migrate_tags: neither #{FORMER_TAGS_DB_PATH} nor #{TAGS_DB_PATH} exists; nothing to migrate"
        return args.empty?
      end
      old_tags = read_former(source)
      if old_tags.nil?
        out.puts "migrate_tags: #{source} holds no tag definitions (they were dropped when a newer server opened it); " \
                 'give the path of a backup of tags.sqlite from before'
        return false
      end
      r = migrate(old_tags, TagFiles.new(TAG_DIR, TAG_LOCK_PATH), out: out)
      changed = 0
      if r[:failed].empty?
        require_relative 'tag_store'
        TagStore.rename_former(FORMER_TAGS_DB_PATH, TAGS_DB_PATH)
        changed = convert_refs(TagStore.new(TAGS_DB_PATH), r[:refs])
      else
        out.puts "migrate_tags: the references of conversations were not changed, since #{r[:failed].size} tags " \
                 'could not be migrated'
      end
      out.puts "migrate_tags: #{r[:migrated].size} migrated, #{r[:present].size} present already, " \
               "#{r[:failed].size} failed; the tags of #{changed} conversations changed to the new references"
      r[:failed].empty?
    rescue ArgumentError, SQLite3::Exception => e
      out.puts "migrate_tags: #{e.message}"
      false
    end
  end
end
