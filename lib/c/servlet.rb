# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /c/: conversation files and the files their header lines load (LCTYSP-0005). Mounted at /c by chatty.rb.
# /c/ URLs are permanent, so the entry files carry their version in the name (lcty.v1.*), never in the path.
#
# The files under public/c/ (lcty.v1.*) are served as they are from public/c/ itself, so an edit there shows at the next
# load without a restart; data/c/ serves only conversation files. lcty.v1.js and lcty.v1.lang-<lang>.js are classic
# scripts generated from the ES modules next to them (.mjs; the command is in each one's head) and committed, and
# lcty.v1.module.js imports the modules in public/js/ itself (served from the server's root).
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

    @published = [].freeze # Names under public/c/ that /c/ serves (from public/c/) besides conversation files
    class << self
      attr_reader :published
    end

    # At startup: list what /c/ serves, and copy OFFLINE into data/c/ (atomic replace per file, only when the content
    # changed). /c/ never serves these copies. Other files in data/c/ (copies an older server made, …) are left as they
    # are: they belong to the user.
    def self.publish_assets
      @published = Dir.glob('**/*', base: SRC_DIR).sort.reject do |rel|
        File.directory?(File.join(SRC_DIR, rel)) || SKIP_RE.match?(rel)
      end.freeze
      OFFLINE.each { |name| write_if_changed(File.join(CONV_DIR, name), File.binread(File.join(SRC_DIR, name))) }
    end

    def self.write_if_changed(path, body)
      return if File.exist?(path) && File.binread(path) == body.b
      FileUtils.mkdir_p(File.dirname(path))
      tmp = "#{path}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
      File.binwrite(tmp, body)
      File.rename(tmp, path)
    end

    # Under /c/: <id>.html returns data/c/<id>.html (the conversation file) untouched, the only thing served from data/c/;
    # the published files (C.published) are static files in public/c/; and /c/ itself redirects to the top page (a new conversation; the query, e.g. ?fork=<id>&at=<n>, goes along).
    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def initialize(server, *options)
        super
        @files = WEBrick::HTTPServlet::FileHandler.new(server, SRC_DIR, FancyIndexing: false)
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
