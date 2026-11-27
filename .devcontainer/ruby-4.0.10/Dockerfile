# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The dev container of lcty-rb on the Ruby it targets: ruby:4.0.10 (pinned to its manifest list), with the libraries of
# Gemfile.lock installed into the image. The build context is the repository root, narrowed to the Gemfile and its lock
# by Dockerfile.dockerignore. Rebuild the container after changing them. compose.yml next to this file runs the server
# in this image on its own (the UI tests use it).

FROM ruby:4.0.10@sha256:810d9fa40a86d5673ca5850f071805b4ca1c2a9838a603cbe07f43bc288c0f53

# Install exactly Gemfile.lock, now and whenever bundle runs in the container
ENV BUNDLE_FROZEN=true

COPY Gemfile Gemfile.lock /tmp/lcty-rb/
RUN BUNDLE_GEMFILE=/tmp/lcty-rb/Gemfile bundle install && rm -rf /tmp/lcty-rb
