# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/lcty_t.worker.js and public/js/api/lcty-t.js (LCTYSP-0009). Each Scenario is a test of the
# same title in tests/unit/lcty-t.spec.js, whose steps are the lines below.

Feature: LCTYSP-1021 The tags in the browser: lcty_t.worker.js

  Every asynchronous operation on the tags runs in a worker started with new Worker("/js/lcty_t.worker.js",
  { type: "module" }): the page posts it one message {op, ...} and gets one message back, {result} or {error, status}.
  The worker keeps the browser's copy of GET /v1/tags, one record "set" {tags, etag} in the store "t_full" of the
  IndexedDB database "lcty_t", which no other code opens. "sync" replaces the copy, "get" reads it (syncing first when
  there is none), "put" sends PUT /v1/tags with the If-Match it is given and "addMemory" sends
  POST /v1/tags/:file/memory; both sync afterwards, also when they fail. js/api/lcty-t.js starts one worker per call
  (getTags, putTags, addMemory, syncTags) and runs the calls of a tab one at a time, in the order they were made.

  In the steps a record of the copy is written as its tags' file names and its ETag.

  Background:
    Given a page on the server's origin
    And /v1/tags and /v1/tags/:file/memory are answered by the test, which records the requests

  Scenario: A sync stores the set with NFC file names and the ETag
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tag "00010-café.html" with the name decomposed and the ETag "e1"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And the database "lcty_t" is at version 1 with only the store "t_full"
    And "t_full" holds the tags ["00010-café.html"] composed and the ETag "e1"

  Scenario: A sync replaces the set as a whole
    Given "t_full" holds the tags ["00010-a.html", "00020-b.html"] and the ETag "e1"
    And GET /v1/tags returns the tags ["00010-c.html"] with the ETag "e2"
    When the worker is posted {"op": "sync"}
    Then it answers with no result
    And "t_full" holds the tags ["00010-c.html"] and the ETag "e2"

  Scenario: Getting without a copy syncs first
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tags ["00010-a.html"] with the ETag "e1"
    When the worker is posted {"op": "get"}
    Then it answers the tags ["00010-a.html"] and the ETag "e1"
    And the requests sent are GET /v1/tags

  Scenario: Getting with a copy sends no request
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e2"
    When the worker is posted {"op": "get"}
    Then it answers the tags ["00010-a.html"] and the ETag "e1"
    And no request is sent

  Scenario: A put sends the If-Match it is given and syncs afterwards
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And PUT /v1/tags answers with the ETag "e3"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e3"
    When the worker is posted {"op": "put", "tags": [{"file": "00010-b.html"}], "etag": "e0"}
    Then it answers "e3"
    And the requests sent are PUT /v1/tags and then GET /v1/tags
    And the PUT has the body {"tags":[{"file":"00010-b.html"}]} and the If-Match "e0"
    And "t_full" holds the tags ["00010-b.html"] and the ETag "e3"

  Scenario: A put that fails answers the error with the status and still syncs
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And PUT /v1/tags answers with the status 412 and "the tags have changed"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e2"
    When the worker is posted {"op": "put", "tags": [], "etag": "e1"}
    Then it answers the error "412 the tags have changed" with the status 412
    And the requests sent are PUT /v1/tags and then GET /v1/tags
    And "t_full" holds the tags ["00010-b.html"] and the ETag "e2"

  Scenario: Adding memory posts to the tag's file and syncs afterwards
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And POST /v1/tags/:file/memory answers {"id": "m1"}
    And GET /v1/tags returns the tags ["00010-a.html"] with the ETag "e2"
    When the worker is posted {"op": "addMemory", "file": "00010-a/b.html", "body": {"text": "t"}}
    Then it answers {"id": "m1"}
    And the requests sent are POST /v1/tags/00010-a%2Fb.html/memory and then GET /v1/tags
    And the POST has the body {"text":"t"}
    And "t_full" holds the tags ["00010-a.html"] and the ETag "e2"

  Scenario: A failed sync leaves the copy as it was
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And GET /v1/tags answers with the status 500 and "boom"
    When the worker is posted {"op": "sync"}
    Then it answers the error "500 boom" with the status 500
    And "t_full" holds the tags ["00010-a.html"] and the ETag "e1"

  Scenario: A request that fails without an answer has no status
    Given there is no database "lcty_t"
    And GET /v1/tags fails without an answer
    When the worker is posted {"op": "get"}
    Then it answers an error with the status null

  Scenario: An unknown operation is an error
    When the worker is posted {"op": "nope"}
    Then it answers the error "unknown operation: nope" with the status null
    And no request is sent

  Scenario: The worker closes its connection after the operation
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tags ["00010-a.html"] with the ETag "e1"
    When the worker is posted {"op": "get"}
    Then it answers the tags ["00010-a.html"] and the ETag "e1"
    And the database "lcty_t" can be opened at version 2 without being blocked, while the worker is still alive

  Scenario: The calls of a tab run one at a time, in order
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And PUT /v1/tags answers with the ETag "e2" after 300 milliseconds
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e2"
    When putTags([{"file": "00010-b.html"}], "e1") and then getTags() are called without waiting
    Then putTags resolves to "e2"
    And getTags resolves to the tags ["00010-b.html"] and the ETag "e2"
    And the requests sent are PUT /v1/tags and then GET /v1/tags

  Scenario: A call whose worker answers an error rejects with its status
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And PUT /v1/tags answers with the status 412 and "the tags have changed"
    When putTags([], "e0") is called
    Then it rejects with the Error "412 the tags have changed" whose status is 412
