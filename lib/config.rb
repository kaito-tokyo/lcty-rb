# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Server settings (LCTYSP-0010): only environment variables. This file reads PORT, LCTY_HOST and LCTY_DATA_DIR (lcty.rb
# reads LCTY_BASE_URL, lib/rpc/servlet.rb LCTY_ALLOWED_ORIGIN); everything else is a browser setting.

module Chatty
  ROOT = File.expand_path('..', __dir__)
  PUBLIC_DIR = File.join(ROOT, 'public')
  # Default: the per-user application data folder, outside the repository (LCTYSP-0010). On macOS (and, for now, Windows)
  # ~/Library/Application Support; elsewhere $XDG_DATA_HOME, or ~/.local/share when it is unset or not absolute (the XDG
  # Base Directory spec). A relative LCTY_DATA_DIR is resolved against the repository root.
  APP_ID = 'tokyo.kaito.lcty-rb'
  XDG_DATA_HOME = ENV['XDG_DATA_HOME'].to_s.start_with?('/') ? ENV['XDG_DATA_HOME'] : File.join(Dir.home, '.local', 'share')
  DEFAULT_DATA_DIR =
    if RUBY_PLATFORM =~ /darwin|mswin|mingw|cygwin/
      File.join(Dir.home, 'Library', 'Application Support', APP_ID, 'Data')
    else
      File.join(XDG_DATA_HOME, APP_ID, 'Data')
    end
  DATA_DIR = File.expand_path(ENV['LCTY_DATA_DIR'].to_s.empty? ? DEFAULT_DATA_DIR : ENV['LCTY_DATA_DIR'], ROOT)
  CONV_DIR = File.join(DATA_DIR, 'c') # Same layout as the URL /c/<id>.html (LCTYSP-0003)
  TAG_DIR = File.join(DATA_DIR, 't') # Source of truth: one HTML file per tag (LCTYSP-0009)
  TAG_LOCK_PATH = File.join(DATA_DIR, 't.lock') # Holds no data: flock is taken on it for t/
  TAGS_DB_PATH = File.join(DATA_DIR, 'tags.sqlite') # Source of truth (the current tags of conversations)
  # Files in data/ starting with _ are derived data that can be rebuilt after deletion (LCTYSP-0010)
  INDEX_PATH = File.join(DATA_DIR, '_index.sqlite')
  PORT = Integer(ENV['PORT'].to_s.empty? ? 45280 : ENV['PORT'])
  BIND = ENV['LCTY_HOST'].to_s.empty? ? '127.0.0.1' : ENV['LCTY_HOST'] # The address to listen on
  BIND_URL_HOST = BIND.include?(':') ? "[#{BIND}]" : BIND # As written in a URL (an IPv6 address in brackets)
  ID_RE = /\A[A-Za-z0-9_-]{1,80}\z/
  # A reference from a conversation to a tag: the file-name part of its tag file (`c~23` for C#), derived by the browser
  # (LCTYSP-0009). Checked mechanically only, never rewritten: no whitespace (data-setup-tags is space separated, and
  # the search box splits on JavaScript's \s, which also takes U+3000, U+00A0 and U+FEFF), no control character, no
  # '/', '\' or ':', and at most TAG_REF_MAX_BYTES (255 minus "NNNNN-" and ".html")
  TAG_REF_RE = %r{\A[^[:space:][:cntrl:]\u{FEFF}/\\:]+\z}.freeze
  TAG_REF_MAX_BYTES = 244

  def self.tag_ref?(s)
    s.is_a?(String) && s.valid_encoding? && s.bytesize <= TAG_REF_MAX_BYTES && TAG_REF_RE.match?(s)
  end

  class HttpError < StandardError
    attr_reader :status
    def initialize(status, message)
      super(message)
      @status = status
    end
  end
end
