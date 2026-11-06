#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail
shopt -s nullglob

cd "$(dirname "$0")/../public/c"

ruby -E UTF-8 -e 'puts ARGF.read.gsub(/^export/, "/*export*/").gsub(%r[^//\?], "")' lcty.v1.mjs >lcty.v1.js

for langfile in lcty.v1.lang-*.mjs; do
  ruby -E UTF-8 -e 'puts ARGF.read.gsub(/^import /, "// import ")' "$langfile" >"${langfile%.mjs}.js"
done
