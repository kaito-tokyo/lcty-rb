# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# tools/convert.rb: convert the conversation files of c/ from LCTYSP-0003 to LCTYSP-0013 (lcty-msg), once, by hand,
# with the server stopped. Nothing converts them at startup: they are the user's data (LCTYSP-0013, Moving existing
# files).
#
# For each file in the format of LCTYSP-0003, in this order:
#   1. the tags it was created with (data-setup-tags) go to lcty_t.sqlite, unless its tags were changed since (a row
#      is there already);
#   2. data-timings, data-usage and data-client of its replies go to lcty_c.sqlite (CStore);
#   3. the file as it was is copied to c-former/ (never deleted; a copy already there stops the conversion of the file);
#   4. the file is replaced, atomically, by its conversion, with its modification time kept.
# Every element is checked and written by the code of /v1/rpc (Rpc::ConvStore.check and build), so a converted file is
# one /v1/rpc could have written. A file that cannot be converted is left as it was, and the others go on.

require 'fileutils'
require 'securerandom'
require 'time'
require_relative 'config'
require_relative 'conv_html'
require_relative 'uuid'
require_relative 'rpc/conv_store'

module Chatty
  module ConvertC
    module_function

    ConvStore = Lcty::Rpc::ConvStore

    # tools/convert.rb, with the server stopped: convert the conversation files of c/ of the data directory once, with
    # its TagStore and CStore, and report the counts to out. Returns whether every file could be converted.
    def main(out: $stderr)
      require_relative 'tag_store'
      require_relative 'c_store'
      TagStore.rename_former(FORMER_TAGS_DB_PATH, TAGS_DB_PATH)
      tags = TagStore.new(TAGS_DB_PATH)
      c_store = CStore.new(C_DB_PATH)
      begin
        r = run(tags: tags, c_store: c_store, out: out)
      ensure
        c_store.close
      end
      out.puts "convert: #{r[:converted].size} converted, #{r[:current].size} already lcty-msg, " \
               "#{r[:failed].size} failed (the files as they were are in #{FORMER_CONV_DIR})"
      r[:failed].empty?
    end

    # Convert every file of conv_dir; tags is a TagStore, c_store a CStore. Returns {converted:, current:, failed:},
    # the names of the files in each case, and reports each converted or failed file to out.
    def run(conv_dir: CONV_DIR, former_dir: FORMER_CONV_DIR, tags:, c_store:, out: $stderr)
      result = { converted: [], current: [], failed: [] }
      Dir.glob(File.join(conv_dir, '*.html')).sort.each do |path|
        name = File.basename(path)
        cid = File.basename(path, '.html')
        unless ID_RE.match?(cid)
          out.puts "skip #{name}: the file name is not a valid conversation id"
          next
        end
        begin
          if convert_file(path, cid, former_dir, tags, c_store)
            result[:converted] << name
            out.puts "converted #{name}"
          else
            result[:current] << name
          end
        rescue StandardError => e
          result[:failed] << name
          out.puts "could not convert #{name}: #{e.class}: #{e.message}"
        end
      end
      result
    end

    # Convert one file; false when it is in the format of LCTYSP-0013 already
    def convert_file(path, cid, former_dir, tags, c_store)
      File.open(path, 'r+:UTF-8') do |f|
        f.flock(File::LOCK_EX)
        text = f.read
        return false if ConvHtml.lcty_msg?(text)
        mtime = f.mtime
        entries = ConvHtml.decode(text, File.basename(path)).map(&:first)
        meta = ConvHtml.current_meta(entries)
        raise ConvHtml::FormatError, 'the meta cannot be read' if meta.empty?
        fallback_at = mtime.iso8601
        lines, stats = elements(meta, entries, fallback_at)
        title = ConvHtml.current_title(entries)
        created_at = meta['created_at'] || fallback_at
        converted = ConvHtml::HEADER + ConvHtml.title_line(title ? title['title'] : '') + "\n" +
                    %(<lcty-c id="c-#{cid}" data-created-at="#{ConvStore.esc_attr(created_at)}" />\n) +
                    lines.map { |l| "#{l}\n" }.join

        setup_tags = Array(meta['tags'])
        tags.set_conversation_tags(cid, setup_tags, created_at) if !setup_tags.empty? && tags.conversation_tags(cid).nil?
        stats.each { |id, s| c_store.put_message_stats(id, cid, s) }

        FileUtils.mkdir_p(former_dir)
        former = File.join(former_dir, File.basename(path))
        File.open(former, File::WRONLY | File::CREAT | File::EXCL) { |g| g.write(text) }
        File.utime(File.atime(former), mtime, former)

        tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
        File.open(tmp, 'w:UTF-8') do |g|
          g.write(converted)
          g.flush
          g.fsync
        end
        File.utime(File.atime(tmp), mtime, tmp)
        File.rename(tmp, path)
      end
      true
    rescue Errno::EEXIST
      raise ConvHtml::FormatError, "#{File.basename(former_dir)}/#{File.basename(path)} exists already"
    end

    # The lines of the elements and the stats of the replies ({element id => {timings, usage, client}}):
    # - lcty-setup becomes a system lcty-msg without data-tag (none when the instructions are empty);
    # - user and assistant become user and model, with the ids of today behind the new prefixes (a new UUIDv7 for an
    #   id that is not one); data-inherited is dropped;
    # - a reply whose data-status is other than completed is dropped (its data-error with it);
    # - data-thinking becomes an lcty-thinking before its reply, with a new id;
    # - an lcty-cmd gets an id;
    # - div.user-text becomes <article>, an article written by lcty.v1 keeps its presentation, and
    #   data-content-integrity is computed.
    def elements(meta, entries, fallback_at)
      lines = []
      stats = {}
      add = lambda do |tag, attrs, inner|
        lines << ConvStore.build(tag, ConvStore.check(tag, attrs, inner), inner)
      end
      instructions = meta['instructions'].to_s
      unless instructions.empty?
        add.('lcty-msg', { 'data-role' => 'system', 'id' => "sys-#{Uuid.v7}" }.merge(text_attrs(instructions)),
             article(instructions))
      end
      entries.each do |o|
        case o['type']
        when 'message'
          next if o['role'] == 'assistant' && o['status'] && o['status'] != 'completed'
          id = Uuid.valid?(o['id']) ? o['id'] : Uuid.v7
          at = o['at'] || fallback_at
          content = o['content'].to_s
          if o['role'] == 'user'
            add.('lcty-msg', { 'data-role' => 'user', 'id' => "msg-u-#{id}", 'data-at' => at }.merge(text_attrs(content)),
                 article(content))
          elsif o['role'] == 'assistant'
            thinking = o['thinking'].to_s
            unless thinking.empty?
              add.('lcty-thinking', { 'id' => "think-#{Uuid.v7}", 'data-at' => at }.merge(text_attrs(thinking)),
                   article(thinking))
            end
            html = o['content_html']
            add.('lcty-msg', { 'data-role' => 'model', 'id' => "msg-m-#{id}", 'data-at' => at }.merge(text_attrs(content)),
                 html ? "<article>#{html}</article>" : article(content))
            s = CStore::STATS.map { |k| [k, o[k]] }.to_h
            stats["msg-m-#{id}"] = s unless s.values.all?(&:nil?)
          else
            raise ConvHtml::FormatError, "unknown data-role: #{o['role'].inspect}"
          end
        when 'cmd'
          add.('lcty-cmd', { 'id' => "cmd-#{Uuid.v7}", 'data-op' => o['op'].to_s, 'data-at' => o['at'] || fallback_at }, '')
        end
      end
      [lines, stats]
    end

    # The text attributes: the integrity placeholder (the check computes it) and the text, as data-content-base64 when
    # XML cannot hold it
    def text_attrs(text)
      attrs = { 'data-content-integrity' => 'sha384-' }
      if ConvHtml::XML_FORBIDDEN.match?(text)
        attrs.merge('data-content-base64' => [text.b].pack('m0'))
      else
        attrs.merge('data-content' => text)
      end
    end

    # An <article> holding text alone (the presentation of a user message, and of the others when none was written)
    def article(text)
      "<article>#{text.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;').gsub("\r", '&#13;')}</article>"
    end
  end
end
