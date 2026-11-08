# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /lcty.v1/: the scripts and the style sheet of every page, served as they are from public/lcty.v1/ (LCTYSP-0005), so an
# edit there shows at the next load without a restart. Mounted at /lcty.v1 by lcty.rb.
#
# Conversation files and tag files load them by the names of version 1 next to themselves (lcty.v1.js,
# lcty.v1.lang-<lang>.js, lcty.v1.css, and lcty.v1.module.js, which lcty.v1.js imports): those names are permanent, as
# the files on disk keep them. /c/ and /t/ answer them with a redirect to the one file here (LEGACY), so every page uses
# the same file and the browser keeps one copy of it. The redirect is 302 with Cache-Control: max-age=86400
# (REDIRECT_MAX_AGE): a browser keeps it for a day without asking again, and where it points can still change, since a
# 302 is never kept longer than that (a 301 or 308 would be kept for good). The files here carry Cache-Control:
# no-cache, so a cached copy is checked (304) before it is used. A file that a redirect has pointed to keeps being
# served, so a redirect kept from before a change still leads to a working file.
#
# What a file opened directly (offline) needs is copied from here into the data directories at startup, under the names
# of version 1 (C.publish_assets).

require 'webrick'
require_relative 'config'

module Chatty
  module LctyV1
    SRC_DIR = File.join(PUBLIC_DIR, 'lcty.v1')
    SKIP_RE = /(?:\.d\.c?ts|\.license)\z/.freeze # Documentation and REUSE files stay in the repository

    # The names of version 1 that pages load next to themselves, and the file of public/lcty.v1/ each one is
    LEGACY = {
      'lcty.v1.js' => 'lcty.v1.cjs',
      'lcty.v1.css' => 'lcty.v1.css',
      'lcty.v1.module.js' => 'lcty.v1.async.mjs'
    }.freeze
    LANG_RE = /\Alcty\.v1\.lang-([a-z]{2,3}(?:-[a-z0-9]+)*)\.js\z/i.freeze
    REDIRECT_MAX_AGE = 86_400 # seconds a browser keeps a redirect: a day

    # The file of public/lcty.v1/ that the version 1 name stands for, or nil when name is not one
    def self.file_for(name)
      file = LEGACY[name] || (m = LANG_RE.match(name)) && "lcty.v1.lang-#{m[1]}.cjs"
      file if file && File.file?(File.join(SRC_DIR, file))
    end

    # Answer a version 1 name under /c/ or /t/ with a redirect to its file here, kept by the browser for
    # REDIRECT_MAX_AGE (set_redirect raises the 302, which WEBrick sends); false when name is not one. The Location is
    # relative, so the site may be under any path.
    def self.redirect(name, res)
      file = file_for(name)
      return false unless file
      res['Cache-Control'] = "max-age=#{REDIRECT_MAX_AGE}"
      res.set_redirect(WEBrick::HTTPStatus::Found, "../lcty.v1/#{file}")
    end

    # /lcty.v1/<file>: public/lcty.v1/<file> with Cache-Control: no-cache (and the ETag of WEBrick's file handler)
    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def initialize(server, *options)
        super
        @files = WEBrick::HTTPServlet::FileHandler.new(server, SRC_DIR, FancyIndexing: false)
      end

      def do_GET(req, res)
        name = req.path_info.to_s.sub(%r{\A/}, '')
        raise WEBrick::HTTPStatus::NotFound if name.empty? || name.include?('/') || SKIP_RE.match?(name)
        res['Cache-Control'] = 'no-cache'
        @files.do_GET(req, res)
      end
    end
  end
end
