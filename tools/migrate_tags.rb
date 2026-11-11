#!/usr/bin/ruby
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# Move the tag definitions and memory of an older version (the tables tags and memory of tags.sqlite) to tag files in
# t/ of the data directory once, with the server stopped (lib/migrate_tags.rb, LCTYSP-3026). The server drops those
# tables when it starts, so run it before starting a newer server, or give the path of a backup of tags.sqlite. Back up
# the data directory first.
#
#   /usr/bin/ruby tools/migrate_tags.rb [path of the old tags.sqlite]
#
# LCTY_DATA_DIR says where the data directory is, as for lcty.rb. Exits with 1 when a tag could not be migrated.

# Without LANG the default is US-ASCII (LCTYSP-0001)
Encoding.default_external = Encoding::UTF_8

abort 'usage: tools/migrate_tags.rb [path of the old tags.sqlite]' if ARGV.size > 1 || ARGV.first&.start_with?('-')
begin
  require_relative '../lib/config'
rescue Chatty::SettingsError => e # a server_settings.txt or an environment variable that cannot be used
  abort "migrate_tags: #{e.message}"
end
require_relative '../lib/migrate_tags'

exit(Chatty::MigrateTags.main(ARGV.map { |a| File.expand_path(a) }) ? 0 : 1)
