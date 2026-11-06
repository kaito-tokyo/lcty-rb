# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Server settings (LCTYSP-010): only the environment variables PORT and LCTY_DATA_DIR; everything else is a browser setting.

module Chatty
  ROOT = File.expand_path('..', __dir__)
  PUBLIC_DIR = File.join(ROOT, 'public')
  # Default: the macOS per-user application data folder, outside the repository. A relative LCTY_DATA_DIR is resolved
  # against the repository root.
  DEFAULT_DATA_DIR = File.join(Dir.home, 'Library', 'Application Support', 'tokyo.kaito.lcty-rb', 'Data')
  DATA_DIR = File.expand_path(ENV['LCTY_DATA_DIR'].to_s.empty? ? DEFAULT_DATA_DIR : ENV['LCTY_DATA_DIR'], ROOT)
  CONV_DIR = File.join(DATA_DIR, 'c') # Same layout as the URL /c/<id>.html (LCTYSP-003)
  TAGS_DB_PATH = File.join(DATA_DIR, 'tags.sqlite') # Source of truth (tag definitions and memory)
  # Files in data/ starting with _ are derived data that can be rebuilt after deletion (LCTYSP-010)
  INDEX_PATH = File.join(DATA_DIR, '_index.sqlite')
  PORT = Integer(ENV['PORT'].to_s.empty? ? 8765 : ENV['PORT'])
  BIND = '127.0.0.1'
  ID_RE = /\A[A-Za-z0-9_-]{1,80}\z/
  TAG_NAME_RE = /\A[^\s:]{1,40}\z/ # No whitespace or ':' (to tell it apart from tag:name in search)

  class HttpError < StandardError
    attr_reader :status
    def initialize(status, message)
      super(message)
      @status = status
    end
  end
end
