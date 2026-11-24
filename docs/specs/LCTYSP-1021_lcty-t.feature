# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/lcty.v1/lcty.v1.t.worker.cjs and public/js/api/lcty-t.js (LCTYSP-0009, LCTYSP-0014). Each
# Scenario is a test of the same title in tests/unit/lcty-t.spec.js, whose steps are the lines below.

Feature: LCTYSP-1021 The tags in the browser: lcty.v1.t.worker.cjs

  Every asynchronous operation on the browser's copies of the tags runs in a worker, a classic script started with new
  Worker("/lcty.v1/lcty.v1.t.worker.cjs") or new SharedWorker("/lcty.v1/lcty.v1.t.worker.cjs"): the page posts it a
  message {id, op, payload} and gets back, on the same port, {id, result}, or {id, errorType} on a failure:
  "unknownOperation", "error" with the error, or "errorMessage" when the error cannot be posted. The worker sends no
  request: it keeps the copies in the IndexedDB database "lcty_t" (version 3), which no other code opens, and the page
  reads the lists over its /v1/rpc connection (LCTYSP-0014) and posts what it got.

  The database holds two copies, each with its row in the store "sync" (key path "store"), the version "<boot>.<seq>"
  it was last brought to. The copy "t_full" is the tag definitions of t.list: one row per tag in the store "t_full",
  keyed by its file name, and the set's ETag as the record "set" {etag} in the store "t_set", both written in one
  transaction. The copy "t_has_many_c" (key path ["tag", "cid"]) is which conversations each tag has, from t.c.list. A
  copy without its row in "sync" has never been filled and is stale. "replace" fills a copy with what its list answered
  unless it holds a newer version of the same boot; "apply" writes the records of one t.batch.updated, each copy its own
  (those of "t_set" belong to "t_full") and only when it holds an older version of the same boot; "get" reads the tags,
  sorted by their order (those without one last, ties in file-name order), and "get_has_many" the tags of
  conversations.

  js/api/lcty-t.js posts every operation to the tab's one worker, started by the first call, and runs them one at a
  time, in the order they were called. getTags() reads the copy, after reading t.list and t.c.list over the tab's
  connection (js/api/tab-rpc.js) when it is stale; putTags is t.replace and addMemory is t.memory.add over that
  connection, and when they fail the lists are read again before the error is passed on. readTagsOfConversations()
  reads the tags of conversations, readTagsFrom(rpc) reads both lists and replaces the copies, applyTagBatch(params)
  writes a batch, holding one that arrives during a read until after it, and the listeners of onTagsChange(fn) are
  called once a change of either copy was stored.

  In the steps the copy of the tags is written as the file names of the rows of "t_full", in key order, and the ETag
  in "t_set"; the rows of "t_has_many_c" as ["tag", "cid"] pairs, in key order. Where a scenario uses /v1/rpc, the
  WebSocket is answered by the test instead of the server: it answers "initialize" and the methods the scenario names,
  and records every call.

  Background:
    Given a page on the server's origin

  Scenario: A replace stores the tags with NFC file names and the ETag
    Given there is no database "lcty_t"
    When the worker is posted a replace of "t_full" with the tag "café.html", its name decomposed, at "b1.5" with the ETag "e1"
    Then it answers {"applied": true}
    And the database "lcty_t" is at version 3 with only the stores "sync", "t_full", "t_has_many_c" and "t_set"
    And "t_full" has one row per tag, keyed by its file name
    And "t_full" holds the tags ["café.html"] composed and the ETag "e1"
    And "sync" holds "t_full" at "b1.5"

  Scenario: A replace composes the name of an invalid tag, which comes from its file name
    Given there is no database "lcty_t"
    When the worker is posted a replace of "t_full" with the invalid tag "café.html" named "café", both decomposed, and the tag "cafe" U+0301 "s.html" with the name decomposed
    Then "t_full" holds the invalid tag "café.html" named "café", both composed, with invalid true
    And the other tag keeps its decomposed name

  Scenario: A database at version 1 is dropped, and the copy is stale
    Given the database "lcty_t" is at version 1 with the record "set" of the tags ["a.html"] in "t_full"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags [], the ETag null and stale true
    And the database "lcty_t" is at version 3 with only the stores "sync", "t_full", "t_has_many_c" and "t_set"

  Scenario: Getting answers the tags in their order, those without one last
    Given "t_full" holds the tags ["a.html", "b.html", "c.html", "d.html"] with the orders [20, null, 10, 20] and the ETag "e1" at "b1.5"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["c.html", "a.html", "d.html", "b.html"], the ETag "e1" and stale false

  Scenario: Getting the tags of a copy never filled is stale
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags [], the ETag null and stale true

  Scenario: An empty set is a copy too
    Given there is no database "lcty_t"
    When the worker is posted a replace of "t_full" with the tags [] at "b1.5" with the ETag "e1"
    And then a new worker is posted {"id": 2, "op": "get"}
    Then it answers the tags [], the ETag "e1" and stale false

  Scenario: A replace replaces the set as a whole
    Given "t_full" holds the tags ["a.html", "b.html"] and the ETag "e1" at "b1.5"
    When the worker is posted a replace of "t_full" with the tags ["c.html"] at "b1.6" with the ETag "e2"
    Then it answers {"applied": true}
    And "t_full" holds the tags ["c.html"] and the ETag "e2"
    And "sync" holds "t_full" at "b1.6"

  Scenario Outline: A replace of the tags is written unless the copy is newer in the same boot
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "<held>"
    When the worker is posted a replace of "t_full" with the tags ["b.html"] at "<read>" with the ETag "e2"
    Then it answers {"applied": <applied>}
    And "t_full" holds the tags <kept> and the ETag "<etag>"
    And "sync" holds "t_full" at "<version>"

    Examples:
      | held | read | applied | kept               | etag | version |
      | b1.5 | b1.5 | true    | ["b.html"]   | e2   | b1.5    |
      | b1.7 | b1.5 | false   | ["a.html"]   | e1   | b1.7    |
      | b1.9 | b2.1 | true    | ["b.html"]   | e2   | b2.1    |

  Scenario: A replace of the tags leaves the tags of conversations as they were
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    When the worker is posted a replace of "t_full" with the tags ["a.html"] at "b1.6" with the ETag "e1"
    Then it answers {"applied": true}
    And "t_has_many_c" holds exactly [["go", "c1"]]
    And "sync" holds "t_has_many_c" at "b1.5"

  Scenario: An unknown operation is an error
    When the worker is posted {"id": 1, "op": "nope"}
    Then it answers the error type "unknownOperation"

  Scenario: The worker closes its connection after the operation
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    When the worker is posted {"id": 1, "op": "get"}
    Then it answers the tags ["a.html"], the ETag "e1" and stale false
    And the database "lcty_t" can be opened at version 3 without being blocked, while the worker is still alive

  Scenario: A SharedWorker answers on the port the message came from
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    When two ports of new SharedWorker("/lcty.v1/lcty.v1.t.worker.cjs") are posted {"id": 1, "op": "get"} and {"id": 2, "op": "nope"}, one after the other
    Then the first port is answered with the id 1, the tags ["a.html"], the ETag "e1" and stale false
    And the second port is answered with the id 2 and the error type "unknownOperation"

  Scenario: A replace fills "t_has_many_c" and stores the version
    Given there is no database "lcty_t"
    When the worker is posted a replace of "t_has_many_c" with the rows [["ruby", "c2"], ["go", "c1"]] at "b1.5"
    Then it answers {"applied": true}
    And "t_has_many_c" holds exactly [["go", "c1"], ["ruby", "c2"]]
    And "sync" holds "t_has_many_c" at "b1.5"

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
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    When the worker is posted a replace of "t_has_many_c" with the rows [["go", "c1"]] at "b1.5"
    Then it answers {"applied": true}
    And "t_full" holds the tags ["a.html"] and the ETag "e1"

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
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    When the worker is posted an apply at "b1.6" of a put of ["ruby", "c1"]
    Then it answers {"applied": []}
    And "t_has_many_c" holds exactly []

  Scenario: A change of the tags is written onto an older copy of the same boot
    Given "t_full" holds the tags ["a.html", "b.html"] and the ETag "e1" at "b1.5"
    When the worker is posted an apply at "b1.6" of a put of the tag "c.html", a delete of "a.html" and the ETag "e2"
    Then it answers {"applied": ["t_full"]}
    And "t_full" holds the tags ["b.html", "c.html"] and the ETag "e2"
    And "sync" holds "t_full" at "b1.6"

  Scenario: A change of the tags composes the file names
    Given "t_full" holds the tags ["café.html"] and the ETag "e1" at "b1.5"
    When the worker is posted an apply at "b1.6" of a delete of "café.html" and a put of the tag "cafés.html", both decomposed
    Then it answers {"applied": ["t_full"]}
    And "t_full" holds the tags ["cafés.html"] composed and the ETag "e1"

  Scenario Outline: A change of the tags is left when the copy is not older in the same boot
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "<held>"
    When the worker is posted an apply at "<change>" of a put of the tag "b.html" and the ETag "e2"
    Then it answers {"applied": []}
    And "t_full" holds the tags ["a.html"] and the ETag "e1"
    And "sync" holds "t_full" at "<held>"

    Examples:
      | change | held |
      | b1.6   | b1.6 |
      | b1.5   | b1.6 |
      | b2.7   | b1.6 |

  Scenario: A change of the tags onto a copy that was never filled is left
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    When the worker is posted an apply at "b1.6" of a put of the tag "a.html" and the ETag "e2"
    Then it answers {"applied": []}
    And "t_full" holds the tags [] and the ETag null

  Scenario Outline: A batch of both copies is applied to each under its own version
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "<held>"
    And "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    When the worker is posted an apply at "b1.6" of a put of the tag "b.html", the ETag "e2" and a put of ["ruby", "c1"]
    Then it answers {"applied": <applied>}
    And "t_full" holds the tags <kept> and the ETag "<etag>"
    And "sync" holds "t_full" at "<version>"
    And "t_has_many_c" holds exactly [["go", "c1"], ["ruby", "c1"]]
    And "sync" holds "t_has_many_c" at "b1.6"

    Examples:
      | held | applied                       | kept                             | etag | version |
      | b1.5 | ["t_full", "t_has_many_c"]    | ["a.html", "b.html"] | e2   | b1.6    |
      | b1.7 | ["t_has_many_c"]              | ["a.html"]                 | e1   | b1.7    |

  Scenario: A change of other stores only does not open the database
    Given there is no database "lcty_t"
    When the worker is posted an apply at "b1.6" of a c_meta put only
    Then it answers {"applied": []}
    And there is still no database "lcty_t"

  Scenario Outline: A bad payload is an error
    When the worker is posted <payload>
    Then it answers the error "<message>"

    Examples:
      | payload                                                    | message                  |
      | a replace of "c_meta" at "b1.5"                            | no such store: c_meta    |
      | a replace of "t_has_many_c" at "5"                         | not a version: 5         |
      | a replace of "t_has_many_c" at "b1.5" with the rows null   | rows must be an array    |
      | an apply at "b1" of a put of ["ruby", "c1"]                | not a version: b1        |
      | an apply at "b1.6" with the records null                   | records must be an array |

  Scenario: Getting the tags of conversations answers the rows by tag, then conversation
    Given "t_has_many_c" holds [["ruby", "c1"], ["go", "c2"], ["go", "c1"]] at "b1.5"
    When the worker is posted {"id": 1, "op": "get_has_many"}
    Then it answers the rows [["go", "c1"], ["go", "c2"], ["ruby", "c1"]] and stale false

  Scenario: Getting the tags of conversations before any replace is stale
    Given there is no database "lcty_t"
    When the worker is posted {"id": 1, "op": "get_has_many"}
    Then it answers the rows [] and stale true

  Scenario: The calls of a tab run one at a time, in order
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    When applyTagBatch is called with a put of the tag "b.html" at "b1.6" and then getTags() without waiting
    Then getTags resolves to the tags ["a.html", "b.html"] and the ETag "e1"

  Scenario: A call whose worker answers an error rejects with the error
    When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags [] at "5" with the ETag "e1"
    Then it rejects with the Error "not a version: 5"

  Scenario: Getting the tags of a copy never filled reads the lists over the tab's connection
    Given there is no database "lcty_t"
    And /v1/rpc answers "t.list" with the tags ["a.html"] at "b1.5" with the ETag "e1", and "t.c.list" with the rows [["go", "c1"]] at "b1.5"
    When getTags() is called
    Then it resolves to the tags ["a.html"] and the ETag "e1"
    And the methods called over /v1/rpc are "initialize", "t.list" and "t.c.list"
    And "t_has_many_c" holds exactly [["go", "c1"]]

  Scenario: Getting the tags of a filled copy opens no connection
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    And /v1/rpc answers "t.list" with the tags ["b.html"] at "b1.6" with the ETag "e2", and "t.c.list" with the rows [] at "b1.6"
    When getTags() is called
    Then it resolves to the tags ["a.html"] and the ETag "e1"
    And no connection to /v1/rpc is opened

  Scenario: putTags sends t.replace with the ETag and resolves to the new one
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    And /v1/rpc answers "t.replace" with the ETag "e2" at "b1.6"
    When putTags([{"file": "b.html"}], "e1") is called
    Then it resolves to "e2"
    And the methods called over /v1/rpc are "initialize" and "t.replace"
    And "t.replace" was called with {"tags": [{"file": "b.html"}], "etag": "e1"}

  Scenario: A putTags that fails reads the lists again and rejects with the error
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    And /v1/rpc answers "t.replace" with the error 8 "the tags have changed", "t.list" with the tags ["b.html"] at "b1.6" with the ETag "e2", and "t.c.list" with the rows [] at "b1.6"
    When putTags([], "e1") is called
    Then it rejects with an RpcError "the tags have changed" whose code is TAGS_CHANGED, 8
    And the methods called over /v1/rpc are "initialize", "t.replace", "t.list" and "t.c.list"
    And "t_full" holds the tags ["b.html"] and the ETag "e2"

  Scenario: addMemory sends t.memory.add and resolves to the item
    Given /v1/rpc answers "t.memory.add" with the item {"id": "m1", "text": "t", "at": "2026-11-15T00:00:00Z"} at "b1.6"
    When addMemory("a.html", {"text": "t", "source": {"cid": "c1"}}) is called
    Then it resolves to the item {"id": "m1", "text": "t", "at": "2026-11-15T00:00:00Z"}
    And the methods called over /v1/rpc are "initialize" and "t.memory.add"
    And "t.memory.add" was called with {"file": "a.html", "text": "t", "source": {"cid": "c1"}}

  Scenario: The tags of conversations are read by conversation
    Given "t_has_many_c" holds [["go", "c1"], ["go", "c2"], ["ruby", "c1"]] at "b1.5"
    When readTagsOfConversations() is called
    Then it resolves to byCid {"c1": ["go", "ruby"], "c2": ["go"]} and stale false

  Scenario: The tags of conversations of a copy never filled are stale
    Given there is no database "lcty_t"
    When readTagsOfConversations() is called
    Then it resolves to byCid {} and stale true

  Scenario: A read over rpc replaces the copies and calls the listeners
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    And "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    And a listener is registered with onTagsChange
    When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags ["b.html"] at "b1.6" with the ETag "e2" and whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"
    Then the rpc was called with "t.list" and then "t.c.list"
    And the listener was called once
    And "t_full" holds the tags ["b.html"] and the ETag "e2"
    And "sync" holds "t_full" at "b1.6"
    And "t_has_many_c" holds exactly [["ruby", "c2"]]
    And "sync" holds "t_has_many_c" at "b1.6"

  Scenario: A read over rpc of an older version calls no listener
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.7"
    And "t_has_many_c" holds [["go", "c1"]] at "b1.7"
    And a listener is registered with onTagsChange
    When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags ["b.html"] at "b1.6" with the ETag "e2" and whose "t.c.list" answers the rows [["ruby", "c2"]] at "b1.6"
    Then the listener was not called
    And "t_full" holds the tags ["a.html"] and the ETag "e1"
    And "t_has_many_c" holds exactly [["go", "c1"]]

  Scenario: A batch is written onto the copy and calls the listeners
    Given "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    And a listener is registered with onTagsChange
    When applyTagBatch is called with a put of ["ruby", "c1"] at "b1.6"
    Then the listener is called once
    And "t_has_many_c" holds exactly [["go", "c1"], ["ruby", "c1"]]
    And "sync" holds "t_has_many_c" at "b1.6"

  Scenario: A batch of the tags calls the listeners too
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    And a listener is registered with onTagsChange
    When applyTagBatch is called with a delete of "a.html" and the ETag "e2" at "b1.6"
    Then the listener is called once
    And "t_full" holds the tags [] and the ETag "e2"
    And "sync" holds "t_full" at "b1.6"

  Scenario: A batch that arrives during a read is written after it
    Given "t_full" holds the tags ["a.html"] and the ETag "e1" at "b1.5"
    And "t_has_many_c" holds [["go", "c1"]] at "b1.5"
    And a listener is registered with onTagsChange
    When readTagsFrom(rpc) is called with an rpc whose "t.list" answers the tags ["a.html"] at "b1.6" with the ETag "e1" and whose "t.c.list" answers the rows [["go", "c2"]] at "b1.6", after applyTagBatch was called with a put of ["ruby", "c2"] at "b1.7"
    Then "t_has_many_c" holds exactly [["go", "c2"], ["ruby", "c2"]]
    And "sync" holds "t_has_many_c" at "b1.7"
    And "sync" holds "t_full" at "b1.6"
    And the listener was called twice
