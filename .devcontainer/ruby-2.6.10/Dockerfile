# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The dev container of macOS's Ruby, which lcty-rb still runs on: ruby:2.6.10 (the last 2.6 image, pinned to its
# manifest list), with the versions of the libraries /usr/bin/ruby has. They are installed here rather than from a
# Gemfile, which targets Ruby 4.0 (README). compose.yml next to this file runs the server in this image on its own (the
# UI tests use it).

FROM ruby:2.6.10@sha256:a79c8ddb7f3d3748427e2d3a45dcae6d42f1d80d9ae3b98959b3a27b220bf434

RUN gem install --no-document nokogiri:1.13.8 sqlite3:1.3.13 webrick:1.9.1
