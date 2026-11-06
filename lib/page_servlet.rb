# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Fixed pages: /tags and /settings (LCTYSP-005).

require 'webrick'
require_relative 'config'

module Chatty
  # Page routing (LCTYSP-005). /tags and /settings return the HTML as is.
  class PageServlet < WEBrick::HTTPServlet::AbstractServlet
    def initialize(server, file)
      super(server)
      @file = File.join(PUBLIC_DIR, file)
    end

    def do_GET(req, res)
      raise WEBrick::HTTPStatus::NotFound unless req.path_info.to_s.empty? || req.path_info == '/'
      res['Content-Type'] = 'text/html; charset=utf-8'
      res.body = File.read(@file, mode: 'r:UTF-8')
    end
  end
end
