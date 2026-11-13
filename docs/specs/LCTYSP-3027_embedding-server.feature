# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/embedding/llama_server.rb (LCTYSP-0019). Each Scenario is a test of the same title in
# tests/backend/llama_server_test.rb, whose steps are the lines below. The tests run tests/backend/fake/llama-server in
# place of llama-server.

Feature: LCTYSP-3027 Embedding server

  Chatty::Embedding::LlamaServer starts llama-server for the embedding model as a child process listening on a UNIX
  socket in a directory of its own, polls GET /health until it answers 200, and then embeds texts over the socket,
  keeping the first 256 of 768 dimensions, L2-normalized. A child that exits is started again; stopping sends it TERM
  and removes its pid file and its directory. A child left behind by a server that did not stop cleanly is found by the
  pid file and stopped at the next start.

  Scenario: The child gets its whole command line and no LLAMA_* variable
    Given LLAMA_API_KEY is set in the environment
    When the embedding server is started and becomes ready
    Then the child's command line is the model, --embedding, -c, -b and -ub 8192, -ngl all, --no-webui and --host
    And the socket is embedding.sock in a 0700 directory named lcty-
    And the child sees no LLAMA_* variable
    And the pid file holds its pid and the socket's path

  Scenario: Texts are embedded as 256 dimensions of length 1
    Given a ready embedding server
    When two texts are embedded
    Then each vector is the first 256 of the child's 768 numbers, divided by their length

  Scenario: Embedding before the server is ready is unavailable
    Given an embedding server whose child listens only after 1 second
    When a text is embedded at once
    Then it raises Unavailable

  Scenario: A vector that is not 768 numbers is an error
    Given a ready embedding server whose child answers 100 numbers
    When a text is embedded
    Then it raises Unavailable saying a vector is not 768 numbers

  Scenario: A child that exits is started again
    Given an embedding server whose child exits 0.5 seconds after it starts
    When it has become ready, and then ready again
    Then the log says the child exited and when it is started again
    And the second child has another pid

  Scenario: Stopping ends the child and removes its files
    Given a ready embedding server
    When it is stopped
    Then the child is gone
    And the pid file and the socket's directory are removed

  Scenario: A child left behind is stopped at the next start
    Given a child left running and its pid file, as after a server killed with KILL
    When another embedding server is started with that pid file
    Then the child left behind is gone and its directory removed

  Scenario: A pid file whose pid is not llama-server is left alone
    Given a pid file naming the pid of a process that is not llama-server
    When an embedding server is started with that pid file
    Then that process is still running

  Scenario: A socket path too long for sun_path starts nothing
    Given TMPDIR is a directory whose path is 120 bytes long
    When the embedding server is started
    Then it returns false and the log says the socket path is too long

  Scenario: A llama-server that cannot be found turns semantic search off
    Given the command is a path that does not exist
    When the embedding server is started
    Then the log says it cannot be started
    And it never becomes ready
