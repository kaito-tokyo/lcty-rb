#!/usr/bin/ruby
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# Convert the conversation files of c/ of the data directory to the format of LCTYSP-0013 once, with the server
# stopped (lib/convert_c.rb, LCTYSP-3023). Each file is copied to c-former/ before it is replaced; a file converted
# already is left as it is. Back up the data directory first.
#
#   /usr/bin/ruby tools/convert.rb
#
# LCTY_DATA_DIR says where the data directory is, as for lcty.rb. Exits with 1 when a file could not be converted.

# Without LANG the default is US-ASCII (LCTYSP-0001)
Encoding.default_external = Encoding::UTF_8

abort 'usage: tools/convert.rb (no arguments; LCTY_DATA_DIR says where the data directory is)' unless ARGV.empty?
begin
  require_relative '../lib/config'
rescue Chatty::SettingsError => e # a server_settings.txt or an environment variable that cannot be used
  abort "convert: #{e.message}"
end
require_relative '../lib/convert_c'

exit(Chatty::ConvertC.main ? 0 : 1)
