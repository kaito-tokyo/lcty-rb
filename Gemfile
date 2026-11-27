# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The libraries the server uses on Ruby 4.0, the Ruby lcty-rb targets (`bundle exec ruby lcty.rb`, README). The code
# keeps to Ruby 2.6, so macOS's /usr/bin/ruby still runs it without Bundler on the versions it has; the dev container
# .devcontainer/ruby-2.6.10 installs those versions for CI instead of using this file.

source "https://rubygems.org"

ruby "~> 4.0.0"

gem "base64", "~> 0.3"
gem "nokogiri", "~> 1.19"
gem "sqlite3", "~> 2.10"
gem "webrick", "~> 1.9"

group :test do
  gem "minitest", "~> 6.1"
end
