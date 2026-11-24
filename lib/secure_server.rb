# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The protective headers of every response (LCTYSP-0016, step 2). Chatty::SecureServer is a WEBrick::HTTPServer whose
# responses are SecureResponse: when a response is sent, the headers below are added from its type and its path, the
# Server header is left out, and an error WEBrick makes is a short body of its own in UTF-8 instead of WEBrick's HTML
# page in ISO-8859-1.
#
#   a page (text/html)   the Content Security Policy of PAGE_CSP
#   a script             SCRIPT_CSP, the policy a worker runs under (connections and WebAssembly of the site)
#   anything else        Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
#   every response       COMMON (nosniff, DENY, no-referrer, the cross-origin policies, Permissions-Policy, ...)
#   the user's data      Cache-Control: private, no-cache: the API under v1/, the conversation files c/<id>.html and
#                        the tag files t/<part>.html; the code keeps the no-cache its servlet gives it
#   a text type          charset=utf-8 when it has no charset
#
# The base URL of the site is the server's config[:LctyBase]. A WebSocket's handshake is written by lib/rpc/websocket.rb
# itself and gets none of these.

require 'json'
require 'webrick'

module Chatty
  # The policy of a page: everything closed, then opened for what the pages load (LCTYSP-0016). connect-src allows any
  # http: and https: origin, for llama-server wherever the user set it; 'self' covers the WebSocket of /v1/rpc.
  PAGE_CSP = [
    "default-src 'none'", "script-src 'self'", "worker-src 'self'", "style-src 'self'", "img-src 'self'",
    "connect-src 'self' http: https:", "object-src 'none'", "base-uri 'none'", "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ').freeze

  # The policy of a script: a worker runs under the policy of its own script, and fuzzy_search.worker.js fetches the
  # vector pair and compiles bdot264.wasm
  SCRIPT_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'"

  # The policy of a response that is neither a page nor a script: one opened as a document runs nothing
  OTHER_CSP = "default-src 'none'; frame-ancestors 'none'"

  # Every feature turned off but sync-xhr, as the OWASP Secure Headers Project proposes
  PERMISSIONS = %w[
    accelerometer autoplay camera clipboard-read clipboard-write cross-origin-isolated display-capture
    encrypted-media fullscreen gamepad geolocation gyroscope hid idle-detection interest-cohort keyboard-map
    magnetometer microphone midi payment picture-in-picture publickey-credentials-get screen-wake-lock serial
    usb web-share xr-spatial-tracking
  ].map { |f| "#{f}=()" }.push('sync-xhr=(self)').join(', ').freeze

  # The headers of every response
  COMMON_HEADERS = {
    'X-Content-Type-Options' => 'nosniff',
    'X-Frame-Options' => 'DENY',
    'Referrer-Policy' => 'no-referrer',
    'Cross-Origin-Opener-Policy' => 'same-origin',
    'Cross-Origin-Resource-Policy' => 'same-origin',
    'Cross-Origin-Embedder-Policy' => 'require-corp',
    'Permissions-Policy' => PERMISSIONS,
    'X-Permitted-Cross-Domain-Policies' => 'none',
    'X-DNS-Prefetch-Control' => 'off',
    'X-Robots-Tag' => 'noindex, nofollow'
  }.freeze

  class SecureResponse < WEBrick::HTTPResponse
    TEXT_TYPE = %r{\A(text/|application/(json|javascript)\b|image/svg\+xml)}.freeze

    # The headers are added as the response is sent, when its type and status are final
    def setup_header
      secure_headers
      super
      @header.delete('server')
    end

    # The body of an error WEBrick makes (set_error): JSON {"error": "<reason>"} under v1/, else "<status> <reason>"
    def create_error_page
      reason = WEBrick::HTTPStatus.reason_phrase(@status).to_s
      if api?
        @header['content-type'] = 'application/json; charset=utf-8'
        @body = JSON.generate('error' => reason.downcase)
      else
        @header['content-type'] = 'text/plain; charset=utf-8'
        @body = "#{@status} #{reason}\n"
      end
    end

    private

    def secure_headers
      type = @header['content-type'].to_s
      @header['content-type'] = "#{type}; charset=utf-8" if TEXT_TYPE.match?(type) && !type.include?('charset=')
      @header['content-security-policy'] =
        if type.start_with?('text/html') then PAGE_CSP
        elsif type.start_with?('text/javascript') then SCRIPT_CSP
        else OTHER_CSP
        end
      COMMON_HEADERS.each { |k, v| @header[k.downcase] = v }
      @header['cache-control'] = 'private, no-cache' if data?
    end

    def base
      @config[:LctyBase] || '/'
    end

    def path
      @request_uri&.path.to_s
    end

    def api?
      path.start_with?("#{base}v1/")
    end

    # Whether the response holds the user's data: the API, a conversation file or a tag file
    def data?
      return true if api?
      return false unless path.start_with?(base)

      rest = path[base.size..]
      (CONV_FILE.match?(rest) && rest != 'c/index.html') || TAG_FILE.match?(rest)
    end

    CONV_FILE = %r{\Ac/[A-Za-z0-9_-]{1,80}\.html\z}.freeze # a conversation file, by the ids of Chatty::ID_RE
    TAG_FILE = %r{\At/(?!\.|lcty\.v1|index\.html\z)[^/]+\.html\z}.freeze # a tag file (as lib/tag_files.rb)
  end

  class SecureServer < WEBrick::HTTPServer
    def create_response(config)
      SecureResponse.new(config)
    end
  end
end
