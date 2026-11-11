# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /v1/: the JSON API and the vector binaries (LCTYSP-0006). Mounted at /v1 by lcty.rb.

require 'webrick'
require 'json'
require 'socket'
require 'securerandom'
require 'digest'
require_relative '../store'
require_relative 'vector_db'

module Chatty
  module V1
    MAX_BODY = 64 * 1024 * 1024
    MAX_PUT_IDS = 16 # The rev list of PUT /v1/vectors is in the query, so keep the URL short (WEBrick allows up to 2083 bytes)

    # Defaults of the browser settings (GET /v1/defaults.json). The browser stores its own changes (LCTYSP-0010).
    # The API key matches llm-backend/run-llama-cpp.sh ("<hostname>-<user>"): a guard against connecting to the wrong server.
    def self.defaults
      {
        'base_url' => 'http://127.0.0.1:9931',
        'api_key' => "#{Socket.gethostname}-#{ENV['USER']}",
        'model' => 'gemma-4-26b-a4b-it',
        'embedding_model' => 'embeddinggemma-2'
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
        case [method, parts.join('/')]
        when ['GET', 'defaults.json']
          return json(res, 200, V1.defaults)
        when ['GET', 'vectors/pending']
          model = query_model(req.query)
          limit = [[(req.query['limit'] || 16).to_i, 1].max, MAX_PUT_IDS].min
          return json(res, 200, VECTORS.pending(model, limit))
        when ['PUT', 'vectors']
          # The body is a registration vector binary (768 dims). Revisions come in the query as ?rev=<id>:<rev>,… (LCTYSP-0008)
          q = WEBrick::HTTPUtils.parse_query(req.query_string.to_s)
          model = query_model(q)
          revs = q['rev'].to_s.split(',').map { |p| p.split(':', 2) }.select { |a| a.size == 2 }.to_h
          raise HttpError.new(400, "at most #{MAX_PUT_IDS} ids per request") if revs.size > MAX_PUT_IDS
          raise HttpError.new(413, 'too large') if req.content_length > MAX_BODY
          # Before reading the body, check its shape against magic, size and entry_count in the query (also checked per record)
          size = Integer(q['size'].to_s, exception: false)
          count = Integer(q['entry_count'].to_s, exception: false)
          raise HttpError.new(400, 'magic must be lctyvLE0') unless q['magic'] == 'lctyvLE0'
          raise HttpError.new(400, "size must be #{VectorDB::DIM * 4}") unless size == VectorDB::DIM * 4
          raise HttpError.new(400, 'entry_count must be a positive integer') unless count && count > 0
          unless req.content_length == count * (VectorRecords::HEAD + size)
            raise HttpError.new(400, "body must be #{count} records of #{VectorRecords::HEAD + size} bytes")
          end
          return json(res, 200, VECTORS.put(model, revs, (req.body || '').b))
        when ['GET', 'vectors.eg2_264.dat'], ['GET', 'vectors.eg2_264.idx']
          # The distribution of the default embedding model (LCTYSP-0008), built in memory on every request and never
          # stored. Both carry the same ETag, a digest of the pair, so the browser can tell a pair fetched across a
          # change; 304 if unchanged
          dat, idx = VECTORS.export(V1.defaults['embedding_model'])
          etag = %("#{Digest::SHA256.hexdigest("#{dat.bytesize}:#{dat}#{idx}")[0, 32]}")
          res['ETag'] = etag
          if req['if-none-match'] == etag
            res.status = 304
            return
          end
          res['Content-Type'] = 'application/octet-stream'
          res.body = parts[0] == 'vectors.eg2_264.dat' ? dat : idx
          return
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
          Chatty.commit('c.batch.updated') do
            next [] unless File.exist?(path)
            File.unlink(path)
            %w[c_meta c_recordcount].map { |s| { 'store' => s, 'op' => 'delete', 'row' => { 'cid' => id } } }
          end
          INDEX.remove(id)
          TAGS.delete_conversation_tags(id)
          C_STORE.delete_stats_of(id) # what was measured of its replies (lcty_c.sqlite)
          json(res, 200, 'ok' => true)
        else
          raise HttpError.new(404, 'no such endpoint')
        end
      end

      def reindex(id)
        messages, tags = Store.index_state(Store.existing_conv_path(id))
        INDEX.sync(id, messages, tags)
      end

      # WEBrick query values are ASCII-8BIT; passed to SQLite as is they compare as BLOBs. Convert to UTF-8
      def query_model(q)
        model = String.new(q['model'].to_s, encoding: Encoding::UTF_8)
        raise HttpError.new(400, 'model is required') if model.empty? || !model.valid_encoding?
        model
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
