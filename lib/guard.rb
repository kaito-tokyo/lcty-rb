# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The request guard (LCTYSP-001): Host / Origin checks against DNS rebinding and CSRF, plus common response headers.

require 'webrick'
require_relative 'config'

module Chatty
  ALLOWED_HOSTS = ["127.0.0.1:#{PORT}", "localhost:#{PORT}"].freeze
  ALLOWED_ORIGINS = ALLOWED_HOSTS.map { |h| "http://#{h}" }.freeze

  # Protection against DNS rebinding and CSRF (LCTYSP-001). Called before every request.
  GUARD = lambda do |req, res|
    host = req['host'].to_s.downcase
    raise WEBrick::HTTPStatus::Forbidden, 'bad host' unless ALLOWED_HOSTS.include?(host)
    origin = req['origin']
    unless %w[GET HEAD].include?(req.request_method)
      raise WEBrick::HTTPStatus::Forbidden, 'bad origin' if origin && !ALLOWED_ORIGINS.include?(origin)
    end
    res['Cache-Control'] = 'no-cache'
    res['X-Content-Type-Options'] = 'nosniff'
    res['Referrer-Policy'] = 'no-referrer'
  end
end
