# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The module entries of the operation pages (/c/index.js. LCTYSP-0005):
# public/<path>.js bundled at startup (Bundle) and served from memory at /<path>.js. An entry sits one directory below
# the root of the site, as the pages do, so js/site.js finds the root from the bundle's URL (LCTYSP-0011).

require 'webrick'
require_relative 'config'
require_relative 'c/bundle'

module Chatty
  class ModuleServlet < WEBrick::HTTPServlet::AbstractServlet
    ENTRIES = %w[c/index.js].freeze

    def self.mount_all(server)
      ENTRIES.each { |entry| server.mount("/#{entry}", self, C::Bundle.bundle(PUBLIC_DIR, entry)) }
    end

    def initialize(server, body)
      super(server)
      @body = body
    end

    def do_GET(req, res)
      raise WEBrick::HTTPStatus::NotFound unless req.path_info.to_s.empty?
      res['Content-Type'] = 'text/javascript; charset=utf-8'
      res['Cache-Control'] = 'no-cache'
      res.body = @body
    end
  end
end
