# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /c/: conversation files, the files their header lines load, and the new conversation page (LCTYSP-0005). Mounted at
# /c by chatty.rb. /c/ URLs are permanent, so the entry files carry their version in the name (lcty.v1.*), never in the
# path.
#
# The files under public/c/ (lcty.v1.*, and index.html, the new conversation page served at /c/ itself) are served as
# they are from public/c/ itself, so an edit there shows at the next load without a restart; data/c/ serves only
# conversation files. The page's entry /c/index.js is the bundle that ModuleServlet mounts over it. lcty.v1.js and
# lcty.v1.lang-<lang>.js are classic scripts generated from the ES modules next to them (.mjs; the command is in each
# one's head) and committed, and lcty.v1.module.js imports the modules in public/js/ itself (../js/, js/ of the site).
# The pages here link to each other with paths relative to /c/ ("./", "<id>.html"), so the site may be served under any
# path; /c without its slash is redirected to c/ so that they resolve.
# What reading a conversation offline needs, lcty.v1.js (the frame) and lcty.v1.css, is also published next to the
# conversation files in data/c/ at startup, so a backup of data/ keeps conversations together with what renders them
# (LCTYSP-0010). Opened directly, a file shows with the English x-default texts and without features.
# Path rule: c/lcty.v1.* holds exactly what a conversation file needs where it is (opened directly, offline); a file it
# does not need on its own (the sidebar's meta sync worker, …) lives under public/ outside public/c/ instead (LCTYSP-0005).

require 'fileutils'
require 'securerandom'
require 'webrick'
require_relative '../store'

module Chatty
  module C
    SRC_DIR = File.join(PUBLIC_DIR, 'c') # public/c/ mirrors /c/ (and data/c/)
    SKIP_RE = /(?:\.d\.ts|\.license)\z/.freeze # Documentation and REUSE files stay in the repository

    OFFLINE = %w[lcty.v1.js lcty.v1.css].freeze # Copied into data/c/: what a conversation file opened directly reads
    # Every data directory that holds HTML gets its own copy, so its files load them by name alone (LCTYSP-0010): the
    # root, c/ (conversation files) and t/ (tag files)
    OFFLINE_DIRS = [DATA_DIR, CONV_DIR, TAG_DIR].freeze

    @published = [].freeze # Names under public/c/ that /c/ serves (from public/c/) besides conversation files
    class << self
      attr_reader :published
    end

    # At startup: list what /c/ serves, and copy OFFLINE into each of OFFLINE_DIRS (atomic replace per file, only when
    # the content changed). /c/ never serves these copies. Other files there (copies an older server made, …) are left
    # as they are: they belong to the user.
    def self.publish_assets
      @published = Dir.glob('**/*', base: SRC_DIR).sort.reject do |rel|
        File.directory?(File.join(SRC_DIR, rel)) || SKIP_RE.match?(rel)
      end.freeze
      OFFLINE.each do |name|
        body = File.binread(File.join(SRC_DIR, name))
        OFFLINE_DIRS.each { |dir| write_if_changed(File.join(dir, name), body) }
      end
    end

    def self.write_if_changed(path, body)
      return if File.exist?(path) && File.binread(path) == body.b
      FileUtils.mkdir_p(File.dirname(path))
      tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
      File.binwrite(tmp, body)
      File.rename(tmp, path)
    end

    # Under /c/: <id>.html returns data/c/<id>.html (the conversation file) untouched, the only thing served from data/c/;
    # the published files (C.published) are static files in public/c/; and /c/ itself is the new conversation page,
    # public/c/index.html (its query, e.g. ?fork=<id>&at=<n>, is read by the page). /c is redirected to c/ with its query.
    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def initialize(server, *options)
        super
        @files = WEBrick::HTTPServlet::FileHandler.new(server, SRC_DIR, FancyIndexing: false)
      end

      def do_GET(req, res)
        name = String.new(req.path_info.to_s.sub(%r{\A/}, ''), encoding: Encoding::UTF_8)
        if name.empty?
          if req.path_info.to_s.empty? # /c: the page's relative paths need the slash (a relative Location: c/)
            res.set_redirect(WEBrick::HTTPStatus::Found, req.query_string.to_s.empty? ? 'c/' : "c/?#{req.query_string}")
          end
          return @files.do_GET(req, res) # /c/: public/c/index.html
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
