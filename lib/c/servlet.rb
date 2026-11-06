# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /c/: conversation files and the files their header lines load (LCTYSP-005). Mounted at /c by chatty.rb.
# /c/ URLs are permanent, so the entry files carry their version in the name (lcty.v1.*), never in the path.
#
# The files under public/c/ (lcty.v1.*; the modules in public/js/ are bundled into lcty.v1.module.js, not copied) belong to the user like the conversation files: they are published
# next to them in data/c/ at startup, so a backup of data/ keeps conversations together with what renders them (LCTYSP-010).
# Over HTTP, a file copied as it is (the stylesheet) is served from public/c/ itself, so an edit there shows at the next
# load without a restart; the built files are served from data/c/.
# Path rule: c/lcty.v1.* holds exactly what a conversation file needs where it is (opened directly, offline); a file it
# does not need on its own (the sidebar's meta database worker, …) lives directly under public/ instead (LCTYSP-005).

require 'fileutils'
require 'securerandom'
require 'webrick'
require_relative '../store'
require_relative 'bundle'

module Chatty
  module C
    SRC_DIR = File.join(PUBLIC_DIR, 'c') # public/c/ mirrors /c/ (and data/c/)
    SKIP_RE = /(?:\.d\.ts|\.license)\z/.freeze # Documentation and REUSE files stay in the repository

    # Published name => how it is built from public/c/<name>:
    #   lcty.v1.module.js          the entry of the conversation page: bundled with every module it imports (Bundle).
    #   anything else              copied as it is. lcty.v1.js and lcty.v1.lang-<lang>.js are classic scripts generated
    #                              from the ES modules next to them (.mjs; the command is in each one's head) and
    #                              committed, so the server does not build them.
    MODULE_RE = /\Alcty\.v\d+\.module\.js\z/.freeze

    @live = [].freeze # Files copied as they are: /c/ serves them from public/c/ (the server's copy)
    @built = {}.freeze # Built files (the bundle), name => body: /c/ serves them from memory
    class << self
      attr_reader :live, :built
    end

    # At startup: mirror public/c/ into data/c/ (atomic replace per file, only when the content changed), so that a
    # conversation file opened directly finds them next to it. /c/ never serves these copies: over HTTP every lcty.v1.*
    # comes from the server (public/c/ or memory), and only conversation files come from data/c/. Files no longer in
    # public/c/ are left in data/c/ (they belong to the user).
    def self.publish_assets
      live = []
      built = {}
      Dir.glob('**/*', base: SRC_DIR).sort.each do |rel|
        src = File.join(SRC_DIR, rel)
        next if File.directory?(src) || SKIP_RE.match?(rel)
        raw = File.binread(src)
        name, body = build(rel, raw)
        write_if_changed(File.join(CONV_DIR, name), body)
        if body.equal?(raw) # build returned the source itself: copied as it is
          live << name
        else
          built[name] = body.freeze
        end
      end
      @live = live.freeze
      @built = built.freeze
    end

    def self.build(rel, body)
      MODULE_RE.match?(rel) ? [rel, Bundle.bundle(PUBLIC_DIR, "c/#{rel}")] : [rel, body]
    end

    def self.write_if_changed(path, body)
      return if File.exist?(path) && File.binread(path) == body.b
      FileUtils.mkdir_p(File.dirname(path))
      tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
      File.binwrite(tmp, body)
      File.rename(tmp, path)
    end

    # Under /c/: <id>.html returns data/c/<id>.html (the conversation file) untouched, the only thing served from data/c/;
    # the files copied as they are (C.live) are static files in public/c/ and the built ones (C.built) come from memory;
    # and /c/ itself redirects to the top page (a new conversation; the query, e.g. ?fork=<id>&at=<n>, goes along).
    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def initialize(server, *options)
        super
        @live_files = WEBrick::HTTPServlet::FileHandler.new(server, SRC_DIR, FancyIndexing: false)
      end

      def do_GET(req, res)
        name = String.new(req.path_info.to_s.sub(%r{\A/}, ''), encoding: Encoding::UTF_8)
        if name.empty?
          res.set_redirect(WEBrick::HTTPStatus::Found, req.query_string.to_s.empty? ? '/' : "/?#{req.query_string}")
        end
        return @live_files.do_GET(req, res) if C.live.include?(name)
        if (body = C.built[name])
          res['Content-Type'] = 'text/javascript; charset=utf-8'
          res['Cache-Control'] = 'no-cache'
          res.body = body
          return
        end
        id = name[/\A(.+)\.html\z/, 1].to_s
        raise WEBrick::HTTPStatus::NotFound unless ID_RE.match?(id) && File.exist?(Store.conv_path(id))
        res['Content-Type'] = 'text/html; charset=utf-8'
        res.body = File.read(Store.conv_path(id), mode: 'r:UTF-8')
      end
    end
  end
end
