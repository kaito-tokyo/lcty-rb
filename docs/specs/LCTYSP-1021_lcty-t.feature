# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/lcty.v1.t.worker.cjs and public/js/api/lcty-t.js (LCTYSP-0009). Each Scenario is a test of the
# same title in tests/unit/lcty-t.spec.js, whose steps are the lines below.

Feature: LCTYSP-1021 The tags in the browser: lcty.v1.t.worker.cjs

  Every asynchronous operation on the tags runs in a worker, a classic script started with new
  Worker("/lcty.v1.t.worker.cjs") or new SharedWorker("/lcty.v1/lcty.v1.t.worker.cjs"): the page posts it a message {id, op, endpoint,
  payload} and gets back, on the same port, {id, result}, or {id, errorType} on a failure: "unknownOperation", "error"
  with the error and the status (the HTTP status or null), or "errorMessage" when the error cannot be posted. endpoint
  is the URL of the site's v1/: an absolute URL on the worker's origin ending with "/", or the message is an error
  before any operation. The worker keeps the browser's copy of GET /v1/tags in the IndexedDB database "lcty_t", which no
  other code opens: one row per tag in the store "t_full", keyed by its file name, and the set's ETag as the record
  "set" {etag} in the store "t_set", both written in one transaction. "sync_full" replaces the copy, "get" reads it
  (syncing first when there is none), "put" sends PUT /v1/tags with the If-Match it is given and "addMemory" sends POST
  /v1/tags/:file/memory; both sync afterwards, also when they fail. js/api/lcty-t.js posts every call
  (getTags, putTags, addMemory, forceSyncTags) to the tab's one worker, started by the first call, and runs the calls
  of a tab one at a time, in the order they were made.

  The database is at version 3 and has two more stores, which follow the server over the page's /v1/rpc connection
  (LCTYSP-0014) and are never read from the server by the worker: "t_has_many_c" (key path ["tag", "cid"]), which
  conversations each tag has, and "sync" (key path "store"), the version "<boot>.<seq>" it was last brought to.
  "replace" fills t_has_many_c with what t.c.list answered unless it holds a newer version of the same boot, "apply"
  writes the t_has_many_c records of one t.batch.updated only onto a copy of the same boot holding an older version,
  and "get_has_many" reads it. js/api/lcty-t.js reads it with readTagsOfConversations(), replaces it with
  readTagsOfConversationsFrom(rpc), writes a batch with applyTagBatch(params), holding a batch that arrives during a
  read until after it, and calls the listeners of onTagsOfConversationsChange(fn) once something was stored.

  In the steps the copy is written as the file names of the rows of "t_full", in key order, and the ETag in "t_set";
  the rows of "t_has_many_c" as ["tag", "cid"] pairs, in key order.

  Background:
    Given a page on the server's origin
    And /v1/tags and /v1/tags/:file/memory are answered by the test, which records the requests
    And every message to the worker has the endpoint "/v1/" on the page's origin, unless the scenario says otherwise

  Scenario: A sync stores the set with NFC file names and the ETag
    Given there is no database "lcty_t"
    And GET /v1/tags returns the tag "00010-café.html" with the name decomposed and the ETag "e1"
    When the worker is posted {"id": 1, "op": "sync_full"}
    Then it answers with no result
    And the database "lcty_t" is at version 3 with only the stores "sync", "t_full", "t_has_many_c" and "t_set"
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
    And the database "lcty_t" is at version 3 with only the stores "sync", "t_full", "t_has_many_c" and "t_set"

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
    When two ports of new SharedWorker("/lcty.v1/lcty.v1.t.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other
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

  Scenario: A replace fills "t_has_many_c" and stores the version
    Given there is no database "lcty_t"
    When the worker is posted a replace of "t_has_many_c" with the rows [["ruby", "c2"], ["go", "c1"]] at "b1.5"
    Then it answers {"applied": true}
    And "t_has_many_c" holds exactly [["go", "c1"], ["ruby", "c2"]]
    And "sync" holds "t_has_many_c" at "b1.5"
    And no request is sent

  Scenario Outline: A replace is written unless the copy is newer in the same boot
    Given "t_has_many_c" holds [["go", "c1"]] at "<held>"
    When the worker is posted a replace of "t_has_many_c" with the rows [["ruby", "c2"]] at "<read>"
    Then it answers {"applied": <applied>}
    And "t_has_many_c" holds exactly <kept>
    And "sync" holds "t_has_many_c" at "<version>"

    Examples:
      | held | read | applied | kept              | version |
      | b1.5 | b1.5 | true    | [["ruby", "c2"]]  | b1.5    |
      | b1.7 | b1.5 | false   | [["go", "c1"]]    | b1.7    |
      | b1.9 | b2.1 | true    | [["ruby", "c2"]]  | b2.1    |

  Scenario: A replace leaves the tags as they were
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    When the worker is posted a replace of "t_has_many_c" with the rows [["go", "c1"]] at "b1.5"
    Then it answers {"applied": true}
    And "t_full" holds the tags ["00010-a.html"] and the ETag "e1"

  Scenario: A change is written onto an older copy of the same boot
    Given "t_has_many_c" holds [["go", "c1"], ["go", "c2"]] at "b1.5"
    When the worker is posted an apply at "b1.6" of a put of ["ruby", "c1"] and a delete of ["go", "c2"]
    Then it answers {"applied": ["t_has_many_c"]}
    And "t_has_many_c" holds exactly [["go", "c1"], ["ruby", "c1"]]
    And "sync" holds "t_has_many_c" at "b1.6"

  Scenario Outline: A change is left when the copy is not older in the same boot
    Given "t_has_many_c" holds [["go", "c1"]] at "<held>"
    When the worker is posted an apply at "<change>" of a put of ["ruby", "c1"]
    Then it answers {"applied": []}
    And "t_has_many_c" holds exactly [["go", "c1"]]
    And "sync" holds "t_has_many_c" at "<held>"

    Examples:
      | change | held |
      | b1.6   | b1.6 |
      | b1.5   | b1.6 |
      | b2.7   | b1.6 |

  Scenario: A change onto a copy that was never filled is left
    Given "t_full" holds the tags ["00010-a.html"] and the ETag "e1"
    When the worker is posted an apply at "b1.6" of a put of ["ruby", "c1"]
    Then it answers {"applied": []}
    And "t_has_many_c" holds exactly []

  Scenario: A change of other stores only does not open the database
    Given there is no database "lcty_t"
    When the worker is posted an apply at "b1.6" of a c_meta put only
    Then it answers {"applied": []}
    And there is still no database "lcty_t"

  Scenario Outline: A bad payload is an error
    When the worker is posted <payload>
    Then it answers the error "<message>" with the status null

    Examples:
      | payload                                                    | message               |
      | a replace of "t_full" at "b1.5"                            | no such store: t_full |
      | a replace of "t_has_many_c" at "5"                         | not a version: 5      |
      | a replace of "t_has_many_c" at "b1.5" with the rows null   | rows must be an array |
      | an apply at "b1" of a put of ["ruby", "c1"]                | not a version: b1     |

  Scenario: Getting the tags of conversations answers the rows by tag, then conversation
    Given "t_has_many_c" holds [["ruby", "c1"], ["go", "c2"], ["go", "c1"]] at "b1.5"
    When the worker is posted {"id": 1, "op": "get_has_many"}
    Then it answers the rows [["go", "c1"], ["go", "c2"], ["ruby", "c1"]] and stale false
    And no request is sent

  Scenario: Getting the tags of conversations before any replace is stale
    Given there is no database "lcty_t"
    When the worker is posted {"id": 1, "op": "get_has_many"}
    Then it answers the rows [] and stale true
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

  Scenario: The tags of conversations are read by conversation
    Given "t_has_many_c" holds [["go", "c1"], ["go", "c2"], ["ruby", "c1"]] at "b1.5"
    When readTagsOfConversations() is called
    Then it resolves to byCid {"c1": ["go", "ruby"], "c2": ["go"]} and stale false

  Scenario: The tags of conversations of a copy never filled are stale
    Given there is no database "lcty_t"
    When readTagsOfConversations() is called
    Then it resolves to byCid {} and stale true

  Scenario: A read over rpc replaces the copy and calls the listeners
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    And a listener is registered with onTagsOfConversationsChange
    When readTagsOfConversationsFrom(rpc) is called with an rpc whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"
    Then the rpc was called with "t.c.list" only
    And the listener was called once
    And "t_has_many_c" holds exactly [["ruby", "c2"]]
    And "sync" holds "t_has_many_c" at "b1.6"

  Scenario: A read over rpc of an older version calls no listener
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.7"
    And a listener is registered with onTagsOfConversationsChange
    When readTagsOfConversationsFrom(rpc) is called with an rpc whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"
    Then the listener was not called
    And "t_has_many_c" holds exactly [["go", "c1"]]

  Scenario: A batch is written onto the copy and calls the listeners
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    And a listener is registered with onTagsOfConversationsChange
    When applyTagBatch is called with a put of ["ruby", "c1"] at "b1.6"
    Then the listener is called once
    And "t_has_many_c" holds exactly [["go", "c1"], ["ruby", "c1"]]
    And "sync" holds "t_has_many_c" at "b1.6"

  Scenario: A batch that arrives during a read is written after it
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    And a listener is registered with onTagsOfConversationsChange
    When readTagsOfConversationsFrom(rpc) is called with an rpc whose "t.c.list" answers the rows [["go", "c2"]] at "b1.6", after applyTagBatch was called with a put of ["ruby", "c2"] at "b1.7"
    Then "t_has_many_c" holds exactly [["go", "c2"], ["ruby", "c2"]]
    And "sync" holds "t_has_many_c" at "b1.7"
    And the listener was called twice
