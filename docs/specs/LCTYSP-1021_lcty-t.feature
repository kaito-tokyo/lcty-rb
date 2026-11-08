# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/lcty_t.worker.js and public/js/api/lcty-t.js (LCTYSP-0009). Each Scenario is a test of the
# same title in tests/unit/lcty-t.spec.js, whose steps are the lines below.

Feature: LCTYSP-1021 The tags in the browser: lcty_t.worker.js

  Every asynchronous operation on the tags runs in a worker, a classic script started with new
  Worker("/lcty_t.worker.js") or new SharedWorker("/lcty_t.worker.js"): the page posts it a message {id, op, endpoint,
  payload} and gets back, on the same port, {id, result}, or {id, errorType} on a failure: "unknownOperation", "error"
  with the error and the status (the HTTP status or null), or "errorMessage" when the error cannot be posted. endpoint
  is the URL of the site's v1/: an absolute URL on the worker's origin ending with "/", or the message is an error
  before any operation. The worker keeps the browser's copy of GET /v1/tags in the IndexedDB database "lcty_t", which no
  other code opens: one row per tag in the store "t_full", keyed by its file name, and the set's ETag as the record
  "set" {etag} in the store "t_set", both written in one transaction. "sync_full" replaces the copy, "get" reads it
  (syncing first when there is none), "put" sends PUT /v1/tags with the If-Match it is given and "addMemory" sends POST
  /v1/tags/:file/memory; both sync afterwards, also when they fail. js/api/lcty-t.js starts one worker per call
  (getTags, putTags, addMemory, forceSyncTags) and runs the calls of a tab one at a time, in the order they were made.

  In the steps the copy is written as the file names of the rows of "t_full", in key order, and the ETag in "t_set".

  Background:
    Given a page on the server's origin
    And /v1/tags and /v1/tags/:file/memory are answered by the test, which records the requests
    And every message to the worker has the endpoint "/v1/" on the page's origin, unless the scenario says otherwise

  Scenario: A sync stores the set with NFC file names and the ETag
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tag "00010-café.html" with the name decomposed and the ETag "e1"
    When the worker is posted {"id": 1, "op": "sync_full"}
    Then it answers with no result
    And the database "lcty_t" is at version 2 with only the stores "t_full" and "t_set"
    And "t_full" has one row per tag, keyed by its file name
    And "t_full" holds the tags ["00010-café.html"] composed and the ETag "e1"

  Scenario: A sync composes the name of an invalid tag, which comes from its file name
    Given there is no database "lcty_t"
    And GET /v1/tags returns the invalid tag "00010-café.html" named "café", both decomposed, and the tag "00020-cafe" U+0301 ".html" with the name decomposed
    When the worker is posted {"id": 1, "op": "sync_full"}
    Then "t_full" holds the invalid tag "00010-café.html" named "café", both composed, with invalid true
    And the other tag keeps its decomposed name

  Scenario: A database at version 1 is dropped and synced again
    Given the database "lcty_t" is at version 1 with the record "set" of the tags ["00010-a.html"] in "t_full"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e2"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["00010-b.html"] and the ETag "e2"
    And the requests sent are GET /v1/tags
    And the database "lcty_t" is at version 2 with only the stores "t_full" and "t_set"

  Scenario: Getting answers the tags in the order of their file names
    Given "t_full" holds the tags ["00020-b.html", "00010-c.html", "00030-a.html"] and the ETag "e1"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["00010-c.html", "00020-b.html", "00030-a.html"] and the ETag "e1"

  Scenario: An empty set is a copy too
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tags [] with the ETag "e1"
    When the worker is posted {"id": 1, "op": "sync_full"}
    And then a new worker is posted {"id": 2, "op": "get"}
    Then it answers the tags [] and the ETag "e1"
    And the requests sent are GET /v1/tags

  Scenario: A sync replaces the set as a whole
    Given "t_full" holds the tags ["00010-a.html", "00020-b.html"] and the ETag "e1"
    And GET /v1/tags returns the tags ["00010-c.html"] with the ETag "e2"
    When the worker is posted {"id": 1, "op": "sync_full"}
    Then it answers with no result
    And "t_full" holds the tags ["00010-c.html"] and the ETag "e2"

  Scenario: Getting without a copy syncs first
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tags ["00010-a.html"] with the ETag "e1"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["00010-a.html"] and the ETag "e1"
    And the requests sent are GET /v1/tags

  Scenario: Getting with a copy sends no request
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e2"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["00010-a.html"] and the ETag "e1"
    And no request is sent

  Scenario: A put sends the If-Match it is given and syncs afterwards
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And PUT /v1/tags answers with the ETag "e3"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e3"
    When the worker is posted {"id": 1, "op": "put", "payload": {"tags": [{"file": "00010-b.html"}], "etag": "e0"}}
    Then it answers "e3"
    And the requests sent are PUT /v1/tags and then GET /v1/tags
    And the PUT has the body {"tags":[{"file":"00010-b.html"}]} and the If-Match "e0"
    And "t_full" holds the tags ["00010-b.html"] and the ETag "e3"

  Scenario: A put that fails answers the error with the status and still syncs
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And PUT /v1/tags answers with the status 412 and "the tags have changed"
    And GET /v1/tags returns the tags ["00010-b.html"] with the ETag "e2"
    When the worker is posted {"id": 1, "op": "put", "payload": {"tags": [], "etag": "e1"}}
    Then it answers the error "412 the tags have changed" with the status 412
    And the requests sent are PUT /v1/tags and then GET /v1/tags
    And "t_full" holds the tags ["00010-b.html"] and the ETag "e2"

  Scenario: Adding memory posts to the tag's file and syncs afterwards
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And POST /v1/tags/:file/memory answers {"id": "m1"}
    And GET /v1/tags returns the tags ["00010-a.html"] with the ETag "e2"
    When the worker is posted {"id": 1, "op": "addMemory", "payload": {"file": "00010-a/b.html", "body": {"text": "t"}}}
    Then it answers {"id": "m1"}
    And the requests sent are POST /v1/tags/00010-a%2Fb.html/memory and then GET /v1/tags
    And the POST has the body {"text":"t"}
    And "t_full" holds the tags ["00010-a.html"] and the ETag "e2"

  Scenario: A failed sync leaves the copy as it was
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    And GET /v1/tags answers with the status 500 and "boom"
    When the worker is posted {"id": 1, "op": "sync_full"}
    Then it answers the error "500 boom" with the status 500
    And "t_full" holds the tags ["00010-a.html"] and the ETag "e1"

  Scenario: A request that fails without an answer has no status
    Given there is no database "lcty_t"
    And GET /v1/tags fails without an answer
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers an error with the status null

  Scenario: An unknown operation is an error
    When the worker is posted {"id": 1, "op": "nope"}
    Then it answers the error type "unknownOperation"
    And no request is sent

  Scenario: The worker closes its connection after the operation
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tags ["00010-a.html"] with the ETag "e1"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["00010-a.html"] and the ETag "e1"
    And the database "lcty_t" can be opened at version 3 without being blocked, while the worker is still alive

  # Playwright's routes do not catch the requests of a SharedWorker, so this scenario uses no request
  Scenario: A SharedWorker answers on the port the message came from
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    When two ports of new SharedWorker("/lcty_t.worker.js") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other
    Then the first port is answered with the id 1, the tags ["00010-a.html"] and the ETag "e1"
    And the second port is answered with the id 2 and the error type "unknownOperation"

  Scenario: A message without an endpoint is an error
    When the worker is posted {"id": 1, "op": "sync_full"} without an endpoint
    Then it answers the error "the message has no endpoint" with the status null
    And no request is sent

  Scenario: An endpoint on another origin is an error
    When the worker is posted {"id": 1, "op": "sync_full", "endpoint": "http://example.com/v1/"}
    Then it answers the error "the endpoint is not on this origin: http://example.com/v1/" with the status null
    And no request is sent

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
