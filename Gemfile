# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The libraries the server uses, at the versions macOS's /usr/bin/ruby (2.6.10) has. On a Mac nothing has to be
# installed and the server runs without Bundler (README); this file is for running it on another Ruby 2.6, such as the
# ruby:2.6.10 container of the UI tests in CI (.github/workflows/browser.yml).

source "https://rubygems.org"

ruby "2.6.10"

gem "nokogiri", "1.13.8"
gem "sqlite3", "1.3.13"
gem "webrick", "1.9.1"
