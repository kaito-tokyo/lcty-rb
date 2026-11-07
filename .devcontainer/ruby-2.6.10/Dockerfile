# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The dev container of lcty-rb outside macOS: macOS's Ruby, ruby:2.6.10 (the last 2.6 image, pinned to its manifest
# list), with the libraries of the Gemfile (the versions /usr/bin/ruby has) installed into the image. The build context
# is the repository root, narrowed to the Gemfile and its lock by Dockerfile.dockerignore. Rebuild the container after
# changing them. compose.yml next to this file runs the server in this image on its own (the UI tests use it).

FROM ruby:2.6.10@sha256:a79c8ddb7f3d3748427e2d3a45dcae6d42f1d80d9ae3b98959b3a27b220bf434

# Install exactly Gemfile.lock, now and whenever bundle runs in the container
ENV BUNDLE_FROZEN=true

COPY Gemfile Gemfile.lock /tmp/lcty-rb/
RUN BUNDLE_GEMFILE=/tmp/lcty-rb/Gemfile bundle install && rm -rf /tmp/lcty-rb
