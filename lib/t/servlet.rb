# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# /t/: the tag reorder page (LCTYSP-0005, LCTYSP-0009). Mounted at /t by chatty.rb, mirroring /c/: the conversations
# are data/c/ and /c/, the tags data/t/ and /t/.
#
# /t/ (and /t/index.html) is public/t/index.html; its entry /t/index.js is the bundle that ModuleServlet mounts over it.
# Tag files load the lcty.v1.* names next to themselves, as conversation files do, so /t/lcty.v1.* is redirected to
# /lcty.v1/ (LctyV1). /t without its slash is redirected to t/ so that the page's relative paths resolve.
# /t/NNNNN-<part>.html returns the tag file data/t/NNNNN-<part>.html untouched, as /c/<id>.html does a conversation
# file: its <lcty-t> is the tag's page, and its features are the bundle /t/tag-file.js (LCTYSP-0005). Its name starts
# with five digits, so it never collides with index.html or lcty.v1.*.

require 'webrick'
require_relative '../config'
require_relative '../lcty_v1'
require_relative '../tag_files'

module Chatty
  module T
    SRC_DIR = File.join(PUBLIC_DIR, 't')
    class Servlet < WEBrick::HTTPServlet::AbstractServlet
      def initialize(server, *options)
        super
        @page = WEBrick::HTTPServlet::FileHandler.new(server, SRC_DIR, FancyIndexing: false)
      end

      def do_GET(req, res)
        name = String.new(req.path_info.to_s.sub(%r{\A/}, ''), encoding: Encoding::UTF_8)
        if req.path_info.to_s.empty? # /t: the page's relative paths need the slash (a relative Location: t/)
          return res.set_redirect(WEBrick::HTTPStatus::Found, req.query_string.to_s.empty? ? 't/' : "t/?#{req.query_string}")
        end
        return @page.do_GET(req, res) if name.empty? || name == 'index.html'
        LctyV1.redirect(name, res)
        path = File.join(TAG_DIR, name)
        raise WEBrick::HTTPStatus::NotFound unless TagFiles.file_name_error(name).nil? && File.file?(path)
        res['Content-Type'] = 'text/html; charset=utf-8'
        res.body = File.read(path, mode: 'r:UTF-8')
      end
    end
  end
end
