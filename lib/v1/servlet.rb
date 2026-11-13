# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /v1/: the JSON API and the vector pair of semantic search (LCTYSP-0006, LCTYSP-0019). Mounted at /v1 by lcty.rb.

require 'webrick'
require 'json'
require 'socket'
require 'securerandom'
require 'digest'
require_relative '../store'
require_relative '../embedding'

module Chatty
  module V1
    MAX_BODY = 64 * 1024 * 1024

    # Defaults of the browser settings (GET /v1/defaults.json). The browser stores its own changes (LCTYSP-0010).
    # The API key matches llm-backend/run-llama-cpp.sh ("<hostname>-<user>"): a guard against connecting to the wrong server.
    def self.defaults
      {
        'base_url' => 'http://127.0.0.1:9931',
        'api_key' => "#{Socket.gethostname}-#{ENV['USER']}",
        'model' => 'gemma-4-26b-a4b-it'
      }
    end

    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      %w[GET POST PUT PATCH DELETE].each do |m|
        define_method("do_#{m}") { |req, res| dispatch(req, res) }
      end

      private

      def dispatch(req, res)
        # WEBrick paths are ASCII-8BIT; passed to SQLite as is they compare as BLOBs and never match, so convert to UTF-8
        parts = req.path_info.to_s.split('/').reject(&:empty?).map { |p| String.new(p, encoding: Encoding::UTF_8) }
        raise HttpError.new(400, 'invalid path encoding') unless parts.all?(&:valid_encoding?)
        route(req.request_method, parts, req, res)
      rescue HttpError => e
        json(res, e.status, 'error' => e.message)
      rescue JSON::ParserError => e
        json(res, 400, 'error' => "invalid JSON: #{e.message}")
      end

      def route(method, parts, req, res)
        return if method == 'GET' && parts.size == 1 && serve_pair(parts[0], req, res)

        case [method, parts.join('/')]
        when ['GET', 'defaults.json']
          return json(res, 200, V1.defaults)
        when ['GET', 'tags']
          # Every tag file, with one ETag for the set (LCTYSP-0009)
          body, etag = TAG_FILES.all
          res['ETag'] = etag
          return json(res, 200, body)
        when ['PUT', 'tags']
          # Replace all: If-Match must be the ETag of the set the browser edited (428 without it, 412 when it changed)
          res['ETag'] = TAG_FILES.replace_all(parse_body(req), req['if-match'])
          return json(res, 200, 'ok' => true)
        when ['POST', 'search']
          # Keyword search only (semantic search and the RRF merge happen in the browser. LCTYSP-0007)
          body = parse_body(req)
          raise HttpError.new(400, 'body must be an object') unless body.is_a?(Hash)
          tags = Array(body['tags'])
          allowed = tags.empty? ? nil : INDEX.convs_with_tags(tags)
          limit = body.fetch('limit', nil) || 50
          raise HttpError.new(400, 'limit must be a number') unless limit.is_a?(Numeric)
          limit = [[limit.to_i, 1].max, 200].min
          return json(res, 200, 'results' => INDEX.keyword_search(body['q'].to_s, limit: limit, allowed: allowed))
        when ['POST', 'snippets']
          body = parse_body(req)
          raise HttpError.new(400, 'body must be {"ids": [...]}') unless body.is_a?(Hash) && body['ids'].is_a?(Array)
          return json(res, 200, INDEX.snippets(body['ids'].first(200).map(&:to_s), body['q'].to_s))
        end

        if method == 'POST' && parts.size == 3 && parts[0] == 'tags' && parts[2] == 'memory'
          # Add a memory item to the tag in file parts[1] (00010-ruby.html). Editing and deleting go through PUT /v1/tags
          body = parse_body(req)
          raise HttpError.new(400, 'body must be an object') unless body.is_a?(Hash)
          return json(res, 201, TAG_FILES.add_memory(parts[1], body['text'], body['source']))
        end

        case [method, parts[0], parts.size, parts[2]]
        when ['GET', 'conversations', 1, nil]
          json(res, 200, Store.list_conversations)
        when ['POST', 'conversations', 1, nil]
          id = Store.create(parse_body(req))
          reindex(id)
          json(res, 201, 'ok' => true)
        when ['GET', 'conversations', 2, nil]
          json(res, 200, Store.conversation(parts[1]))
        when ['POST', 'conversations', 3, 'lines']
          Store.append(parts[1], parse_body(req))
          reindex(parts[1])
          json(res, 200, 'ok' => true)
        when ['POST', 'conversations', 3, 'pop']
          body = parse_body(req)
          raise HttpError.new(400, 'body must be an object') unless body.is_a?(Hash)
          Store.pop(parts[1], body['from'])
          reindex(parts[1])
          json(res, 200, 'ok' => true)
        when ['DELETE', 'conversations', 2, nil]
          # Announced to the pages as c.batch.updated (the conversation leaves c_meta and c_recordcount) and, apart, as
          # t.batch.updated for its tags (LCTYSP-0014)
          id = parts[1]
          path = Store.conv_path(id)
          gone = []
          Chatty.commit('c.batch.updated') do
            next [] unless File.exist?(path)
            gone = Embedding.message_ids_of(path)
            File.unlink(path)
            %w[c_meta c_recordcount].map { |s| { 'store' => s, 'op' => 'delete', 'row' => { 'cid' => id } } }
          end
          Embedding.messages_removed(gone) # their rows of the vector pair are filled with NaN (LCTYSP-0019)
          INDEX.remove(id)
          TAGS.delete_conversation_tags(id)
          C_STORE.delete_stats_of(id) # what was measured of its replies (lcty_c.sqlite)
          json(res, 200, 'ok' => true)
        else
          raise HttpError.new(404, 'no such endpoint')
        end
      end

      PAIR_FILE_RE = /\Avectors\.([0-9a-z]+_\d+)\.(json|dat|idx)\z/.freeze

      # The vector pair of LCTYSP-0019 (lib/embedding.rb): GET vectors.<name>.json, and .dat and .idx by Range (whole
      # without one). 503 before the pair is open. Returns whether it answered.
      def serve_pair(file, req, res)
        m = PAIR_FILE_RE.match(file)
        pair = Embedding.pair
        return false unless m
        return json(res, 503, 'error' => 'the vector pair is not open') if pair.nil?
        return false unless m[1] == Embedding.name
        return serve_summary(pair, req, res) if m[2] == 'json'

        serve_range(pair, m[2].to_sym, req, res)
      end

      # The JSON of the pair, revalidated by an ETag of its content
      def serve_summary(pair, req, res)
        body = JSON.generate(pair.summary)
        etag = %("#{Digest::SHA256.hexdigest(body)[0, 32]}")
        res['ETag'] = etag
        res['Cache-Control'] = 'no-cache'
        return res.status = 304 if req['if-none-match'].to_s.split(/\s*,\s*/).include?(etag)

        json_body(res, 200, body)
        true
      end

      # bytes=<first>-<last> of .dat or .idx: 206, or 412 when If-Match names another generation, or 416. Without
      # Range, the whole file (its records), 200
      def serve_range(pair, kind, req, res)
        etag = %("#{pair.rev}")
        res['ETag'] = etag
        if (im = req['if-match']) && im.strip != '*' && !im.split(/\s*,\s*/).include?(etag)
          return json(res, 412, 'error' => 'another generation of the pair')
        end
        unless req['range']
          res['Content-Type'] = 'application/octet-stream'
          res.body = pair.read(kind, 0, Float::INFINITY)[0].to_s
          return true
        end
        r = /\Abytes=(\d+)-(\d+)\z/.match(req['range'].to_s.strip)
        first, last = r && [r[1].to_i, r[2].to_i]
        body, size = first && first <= last ? pair.read(kind, first, last) : [nil, pair.read(kind, 0, 0)[1]]
        unless body
          res['Content-Range'] = "bytes */#{size}"
          return json(res, 416, 'error' => 'only bytes=<first>-<last> within the file')
        end
        res.status = 206
        res['Content-Type'] = 'application/octet-stream'
        res['Content-Range'] = "bytes #{first}-#{first + body.bytesize - 1}/#{size}"
        res.body = body
        true
      end

      def json_body(res, status, body)
        res.status = status
        res['Content-Type'] = 'application/json; charset=utf-8'
        res.body = body
      end

      def reindex(id)
        messages, tags = Store.index_state(Store.existing_conv_path(id))
        INDEX.sync(id, messages, tags)
      end

      def parse_body(req)
        len = req.content_length
        raise HttpError.new(413, 'too large') if len > MAX_BODY
        raw = (req.body || '').dup.force_encoding(Encoding::UTF_8)
        raise HttpError.new(400, 'invalid UTF-8') unless raw.valid_encoding?
        JSON.parse(raw)
      end

      def json(res, status, obj)
        res.status = status
        res['Content-Type'] = 'application/json; charset=utf-8'
        res.body = JSON.generate(obj)
      end
    end
  end
end
