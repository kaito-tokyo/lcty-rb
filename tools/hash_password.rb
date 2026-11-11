#!/usr/bin/ruby
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# Print the option of a user of Basic authentication, --basic-auth=USER:<PBKDF2 hash>, for server_settings.txt
# (lib/password.rb, LCTYSP-0010). The password is asked twice without echo on a terminal; from anything else it is the
# first line of input, so a script can pipe it.
#
#   /usr/bin/ruby tools/hash_password.rb alice >> "$HOME/Library/Application Support/tokyo.kaito.lcty-rb/Data/server_settings.txt"
#
# Exits with 1, printing nothing, when the password cannot be used.

# Without LANG the default is US-ASCII (LCTYSP-0001)
Encoding.default_external = Encoding::UTF_8

abort 'usage: tools/hash_password.rb USER' unless ARGV.size == 1 && !ARGV[0].start_with?('-')
require_relative '../lib/password'

exit(Chatty::Password.ask_option(ARGV[0]) ? 0 : 1)
