# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The module entries of the operation pages (/index.js, /tags.js, /settings.js. LCTYSP-005):
# public/<name>.js bundled at startup (Bundle) and served from memory.

require 'webrick'
require_relative 'config'
require_relative 'c/bundle'

module Chatty
  class ModuleServlet < WEBrick::HTTPServlet::AbstractServlet
    ENTRIES = %w[index.js tags.js settings.js].freeze

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
