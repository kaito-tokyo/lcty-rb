# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /c/: conversation files and the files their header line loads (LCTYSP-005). Mounted at /c by chatty.rb.
# /c/ URLs are permanent, so the entry files carry their version in the name (lcty.v1.*), never in the path.
#
# The files under public/c/ (lcty.v1.*; the modules in public/js/ are bundled into lcty.v1.module.js, not copied) belong to the user like the conversation files: they are published
# next to them in data/c/ at startup, so a backup of data/ keeps conversations together with what renders them (LCTYSP-010).
# Path rule: c/lcty.v1.* holds exactly what a conversation file needs where it is (opened directly, offline); a file it
# does not need on its own (the sidebar's meta database worker, …) lives directly under public/ instead (LCTYSP-005).

require 'fileutils'
require 'json'
require 'securerandom'
require 'webrick'
require_relative '../store'
require_relative 'bundle'

module Chatty
  module C
    SRC_DIR = File.join(PUBLIC_DIR, 'c') # public/c/ mirrors /c/ (and data/c/)
    SKIP_RE = /(?:\.d\.ts|\.license)\z/.freeze # Documentation and REUSE files stay in the repository

    # Published name => how it is built from public/c/<name>:
    #   lcty.v1.js                 the ES module: each leading "export" becomes "/*export*/", which turns it into a
    #                              classic script (it has no imports).
    #   lcty.v1.lang-<lang>.json   a language table: checked as JSON and written as lcty.v1.lang-<lang>.js,
    #                              LctyT.addLang("<lang>", <the JSON as written>);
    #   lcty.v1.module.js          the entry of the conversation page: bundled with every module it imports (Bundle).
    #   anything else              copied as it is.
    MODULE_RE = /\Alcty\.v\d+\.module\.js\z/.freeze
    LANG_RE = /\A(lcty\.v\d+\.lang-([a-z-]+))\.json\z/.freeze

    @published = [].freeze # Names relative to data/c/ that /c/ serves besides conversation files
    class << self
      attr_reader :published
    end

    # At startup: mirror public/c/ into data/c/ (atomic replace per file, only when the content changed). Files no longer
    # in public/c/ are left in data/c/ (they belong to the user) but are not served.
    def self.publish_assets
      names = []
      Dir.glob('**/*', base: SRC_DIR).sort.each do |rel|
        src = File.join(SRC_DIR, rel)
        next if File.directory?(src) || SKIP_RE.match?(rel)
        name, body = build(rel, File.binread(src))
        write_if_changed(File.join(CONV_DIR, name), body)
        names << name
      end
      @published = names.freeze
    end

    def self.build(rel, body)
      if rel == 'lcty.v1.js'
        [rel, body.force_encoding(Encoding::UTF_8).gsub(/^export /, '/*export*/ ')]
      elsif MODULE_RE.match?(rel)
        [rel, Bundle.bundle(PUBLIC_DIR, "c/#{rel}")]
      elsif (m = LANG_RE.match(rel))
        json = body.force_encoding(Encoding::UTF_8)
        JSON.parse(json) # raises on a broken table, so the server does not start with it
        ["#{m[1]}.js", "LctyT.addLang(#{m[2].to_json}, #{json.strip});\n"]
      else
        [rel, body]
      end
    end

    def self.write_if_changed(path, body)
      return if File.exist?(path) && File.binread(path) == body.b
      FileUtils.mkdir_p(File.dirname(path))
      tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
      File.binwrite(tmp, body)
      File.rename(tmp, path)
    end

    # Under /c/: .html returns data/c/<id>.html (the conversation file) untouched, the published files (C.published) are static files in data/c/,
    # and /c/ itself redirects to the top page (a new conversation; the query, e.g. ?fork=<id>&at=<n>, goes along).
    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def initialize(server, *options)
        super
        @files = WEBrick::HTTPServlet::FileHandler.new(server, CONV_DIR, FancyIndexing: false)
      end

      def do_GET(req, res)
        name = String.new(req.path_info.to_s.sub(%r{\A/}, ''), encoding: Encoding::UTF_8)
        if name.empty?
          res.set_redirect(WEBrick::HTTPStatus::Found, req.query_string.to_s.empty? ? '/' : "/?#{req.query_string}")
        end
        return @files.do_GET(req, res) if C.published.include?(name)
        id = name[/\A(.+)\.html\z/, 1].to_s
        raise WEBrick::HTTPStatus::NotFound unless ID_RE.match?(id) && File.exist?(Store.conv_path(id))
        res['Content-Type'] = 'text/html; charset=utf-8'
        res.body = File.read(Store.conv_path(id), mode: 'r:UTF-8')
      end
    end
  end
end
