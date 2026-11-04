#!/bin/dash

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

set -e

cd "$(dirname "$0")"

_HOSTNAME="$(hostname)"
: "${LLAMA_API_KEY:=${_HOSTNAME:?}-${USER:?}}"
export LLAMA_API_KEY
: "${LLAMA_ARG_MODELS_PRESET:=$PWD/llama-cpp.ini}"
export LLAMA_ARG_MODELS_PRESET
: "${LLAMA_ARG_HOST:=127.0.0.1}"
export LLAMA_ARG_HOST
export LLAMA_ARG_PORT="${PORT:-9931}"
export LLAMA_ARG_UI=0
export LLAMA_ARG_LOG_TIMESTAMPS=1
export LLAMA_ARG_ENDPOINT_METRICS=1

exec llama-server --sleep-idle-seconds "${SLEEP_IDLE_SECONDS:-3600}"
