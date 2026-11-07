# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Runs every backend unit test (tests/backend/**/*_test.rb): ruby tests/backend/run.rb [Minitest options], for example
# -n "/same millisecond/" to run the tests whose names match.

Encoding.default_external = Encoding::UTF_8 # Without LANG the default is US-ASCII, as in lcty.rb (LCTYSP-0001)

require_relative 'helper'

Dir[File.join(__dir__, '**', '*_test.rb')].sort.each { |f| require f }
