# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/v1/servlet.rb (LCTYSP-0006, with LCTYSP-0003, LCTYSP-0004, LCTYSP-0007, LCTYSP-0008 and
# LCTYSP-0009). Each Scenario is a test of the same title in tests/backend/v1_servlet_test.rb, whose steps are the lines
# below.

Feature: LCTYSP-3012 HTTP API

  Chatty::V1::Servlet, mounted at /v1, answers the JSON API on the same origin as the pages: the defaults of the
  browser settings, conversations (create, read, append, pop, delete and the lists), keyword search and snippets, tag
  definitions and their memory, and the vectors (the pending rounds, registration and the distribution files). Bodies
  are JSON unless stated otherwise, and every error is {"error": "…"} with an HTTP status. Paths and query values are
  read as UTF-8, and request bodies are limited to 64 MiB.

  Scenario: The defaults of the browser settings
    When GET /v1/defaults.json is requested
    Then the status is 200 and the body is JSON
    And it has the base_url "http://127.0.0.1:9931", the model "gemma-4-26b-a4b-it" and the embedding_model "embeddinggemma-2"
    And its api_key is the host name and the user joined by "-"

  Scenario: A new conversation is created and listed
    When POST /v1/conversations creates a conversation with the title "Hello", the tag "t", an inherited user message, a user message and an assistant message
    Then the status is 201 and the body is {"ok": true}
    And GET /v1/conversations lists it with the title "Hello", 3 messages and the tags ["t"]
    And its message_ids are only the id of its own user message

  Scenario: A conversation is read as its meta, title, tags and messages
    Given a conversation with the title "Greeting" whose assistant message has content_html
    When GET /v1/conversations/<id> is requested
    Then the body has its meta, the title "Greeting", its tags and its 2 messages
    And the messages have neither type nor content_html

  Scenario Outline: A conversation that cannot be created is rejected with 400
    When POST /v1/conversations sends <body>
    Then the status is 400 with the error <error>

    Examples:
      | body                                  | error                                        |
      | an array                              | "body must be an object"                     |
      | no meta                               | "meta must be an object"                     |
      | a meta without an id                  | "invalid id"                                 |
      | an id with a space                    | "invalid id"                                 |
      | tags that are not unique              | "tags must be an array of unique tag names"  |
      | a tags line                           | "line type not allowed: \"tags\""            |
      | a message id that is not a UUIDv7     | "message id must be a UUIDv7: \"abc\""       |
      | a command that is not a command name  | "invalid command: \"Send!\""                 |

  Scenario: Creating a conversation whose id exists is a conflict
    Given a conversation
    When POST /v1/conversations creates another one with the same id
    Then the status is 409 with the error "already exists"
    And the conversation file is unchanged

  Scenario: A body that is not JSON is rejected
    When POST /v1/conversations sends "{not json"
    Then the status is 400 with an error that starts with "invalid JSON: "

  Scenario: A body that is not UTF-8 is rejected
    When POST /v1/conversations sends the bytes of a JSON string with the byte 0xff in it
    Then the status is 400 with the error "invalid UTF-8"

  Scenario: A body over 64 MiB is rejected before it is read
    When a POST to /v1/conversations says its Content-Length is 64 MiB and one byte, and sends no body
    Then the status is 413 with the error "too large"

  Scenario Outline: An unknown or invalid conversation id
    When <request> is requested
    Then the status is <status> with the error <error>

    Examples:
      | request                                          | status | error       |
      | GET /v1/conversations/<unknown id>               | 404    | "not found" |
      | GET /v1/conversations/a.b                        | 400    | "invalid id" |
      | POST /v1/conversations/<unknown id>/lines        | 404    | "not found" |
      | POST /v1/conversations/<unknown id>/pop          | 404    | "not found" |
      | DELETE /v1/conversations/a.b                     | 400    | "invalid id" |

  Scenario: Appending lines adds messages and sets the title and the tags
    Given a conversation with a user and an assistant message and the tag "a"
    When POST /v1/conversations/<id>/lines appends a user message, a title line "Renamed" and a tags line ["b"]
    Then the status is 200 and the body is {"ok": true}
    And the conversation has 3 messages, the title "Renamed" and the tags ["b"]
    And the conversation file has the title "Renamed" but not the tag "b"

  Scenario Outline: Lines that cannot be appended are rejected with 400
    Given a conversation with a user and an assistant message and the tag "a"
    When POST /v1/conversations/<id>/lines sends <lines>
    Then the status is 400 with the error <error>
    And the conversation file is unchanged

    Examples:
      | lines                                                        | error                                         |
      | an object                                                    | "lines must be an array of objects"           |
      | a meta line                                                  | "line type not allowed: \"meta\""             |
      | a valid message and a message whose id is not a UUIDv7       | "message id must be a UUIDv7: \"nope\""       |
      | an assistant message whose content_html is a number          | "content_html must be a string"               |
      | a tags line with a tag name with a space                     | "tags must be an array of unique tag names"   |

  Scenario: Popping the last turn deletes the messages from there
    Given a conversation with the messages user, assistant, user, assistant
    When POST /v1/conversations/<id>/pop sends {"from": 2}
    Then the status is 200 and the body is {"ok": true}
    And the conversation has its first 2 messages left

  Scenario: Popping before the last user message is a conflict
    Given a conversation with the messages user, assistant, user, assistant
    When POST /v1/conversations/<id>/pop sends {"from": 1}
    Then the status is 409 with the error "can only pop the last turn (from must be >= index of the last user message)"
    And the conversation still has 4 messages

  Scenario: Popping from past the last message changes nothing
    Given a conversation with the messages user, assistant, user, assistant
    When POST /v1/conversations/<id>/pop sends {"from": 10}
    Then the status is 200 and the body is {"ok": true}
    And the conversation still has 4 messages

  Scenario Outline: A pop that is not understood is rejected with 400
    Given a conversation with the messages user, assistant, user, assistant
    When POST /v1/conversations/<id>/pop sends <body>
    Then the status is 400 with the error <error>

    Examples:
      | body           | error                     |
      | an array       | "body must be an object"  |
      | {"from": "2"}  | "from must be an integer" |
      | {"from": -1}   | "from must be an integer" |

  Scenario: Deleting a conversation removes it with its tags and its index entries
    Given a conversation with a round with a unique word whose tags were changed to ["gone"]
    When DELETE /v1/conversations/<id> is requested
    Then the status is 200 and the body is {"ok": true}
    And GET /v1/conversations/<id> answers 404
    And it is in neither /v1/conversations nor /v1/meta-all.json
    And a search for its word no longer finds its round
    And its current tags are forgotten
    And the search index keeps no count for it
    And deleting it again still answers 200, leaving no count either

  Scenario: The meta of every conversation is listed newest first
    Given a conversation created with the tag "setup" whose tags were changed to ["now"], last modified in 2002
    And a conversation last modified in 2001
    When GET /v1/meta-all.json is requested
    Then the one of 2002 is listed before the one of 2001
    And the one of 2002 has its id, title, created_at, updated_at_hint, the setup_tags ["setup"], the tags_hint ["now"] and the messages_hint 2

  Scenario: Keyword search finds rounds and can be limited to tags
    Given two conversations with a round with the same unique word, only one of them with the tag "pick"
    When POST /v1/search searches for the word
    Then the results include both rounds with their conversation ids and snippets with the word
    When POST /v1/search searches for the word with the tags ["pick"]
    Then the result is only the round of the conversation with the tag "pick"

  Scenario: The search limit is kept between 1 and 200
    Given three conversations with the tag "lim", each with a round with the same unique word
    Then POST /v1/search for the word with the tags ["lim"] and the limit 2 returns 2 results
    And with the limit 0 it returns 1 result
    And with the limit 1000 it returns all 3

  Scenario: A search body that is not an object is rejected
    When POST /v1/search sends an array
    Then the status is 400 with the error "body must be an object"

  Scenario Outline: A search limit that is not a number is rejected
    When POST /v1/search sends a word with the limit <limit>
    Then the status is 400 with the error "limit must be a number"

    Examples:
      | limit |
      | "10"  |
      | []    |
      | true  |

  Scenario: Snippets of rounds by id
    Given a round with a unique word
    When POST /v1/snippets sends its id and an unknown id with the word as q
    Then the body maps its id to its conversation id and a snippet with the word
    And the unknown id is left out

  Scenario: Snippets need a list of ids
    When POST /v1/snippets sends {"q": "x"}
    Then the status is 400 with the error "body must be {\"ids\": [...]}"

  Scenario: The tag definitions are replaced as a whole
    Given the tag definitions from GET /v1/tags
    When PUT /v1/tags sends them with a new tag that has a prompt and a memory item
    Then the status is 200 and the body is {"ok": true}
    And GET /v1/tags has the new tag last, with its prompt and its memory item
    And the tags that were there before are kept

  Scenario: A renamed tag keeps its memory
    Given a tag with a memory item
    When PUT /v1/tags sends the same definitions with the tag under a new name and the same memory item
    Then GET /v1/tags has the new name with the memory item
    And the old name is gone

  Scenario Outline: Tag definitions that are not valid are rejected with 400
    When PUT /v1/tags sends <tags>
    Then the status is 400 with the error <error>
    And the tag definitions are unchanged

    Examples:
      | tags                                     | error                                       |
      | an array                                 | "body must be {\"tags\": [...]}"            |
      | a tag that is not an object              | "each tag must be an object"                |
      | a tag name with a space                  | "invalid tag name: \"a b\""                 |
      | a prompt that is a number                | "prompt must be a string"                   |
      | a memory item with a blank text          | "memory must be an array of {id, text}"     |
      | two tags with the same name              | "tag names must be unique"                  |
      | two memory items with the same id        | "memory ids must be unique"                 |

  Scenario: Memory items are added, edited and deleted
    Given a tag with a name in Japanese
    When POST /v1/tags/<name>/memory sends {"text": "  remember this  ", "source": {"conv_id": "c1"}}
    Then the status is 201 and the item has an id starting with "mem-", the text "remember this", the time it was added and the source
    When PATCH /v1/tags/<name>/memory/<item id> sends {"text": "edited"}
    Then the status is 200 and the item has the text "edited"
    When DELETE /v1/tags/<name>/memory/<item id> is requested
    Then the status is 200 and the body is {"ok": true}
    And GET /v1/tags has the tag without memory

  Scenario Outline: Memory requests that cannot be done
    Given a tag with a memory item
    When <request> is requested
    Then the status is <status> with the error <error>

    Examples:
      | request                                                    | status | error                  |
      | POST /v1/tags/<unknown tag>/memory with a text             | 404    | "no such tag"          |
      | POST /v1/tags/<name>/memory with a blank text              | 400    | "text is required"     |
      | POST /v1/tags/<name>/memory with an array                  | 400    | "text is required"     |
      | PATCH /v1/tags/<unknown tag>/memory/<item id> with a text  | 404    | "no such tag"          |
      | PATCH /v1/tags/<name>/memory/<unknown id> with a text      | 404    | "no such memory item"  |
      | DELETE /v1/tags/<unknown tag>/memory/<item id>             | 404    | "no such tag"          |
      | DELETE /v1/tags/<name>/memory/<unknown id>                 | 404    | "no such memory item"  |

  Scenario: The rounds waiting for embeddings
    Given a conversation with a round of the user text "question" and the assistant text "answer"
    When GET /v1/vectors/pending is requested with a model
    Then the round is listed with its id, its revision and the parts ["question\n\nanswer"]

  Scenario: The pending list is newest first and its limit is kept between 1 and 16
    Given a conversation with 17 rounds, each newer than any other round
    When GET /v1/vectors/pending is requested with a model
    Then with the limit 2 it lists the 2 newest rounds, newest first
    And with the limit 0 it lists 1 round
    And with the limit 100 it lists 16 rounds

  Scenario Outline: The pending list needs a valid model
    When GET /v1/vectors/pending is requested with <model>
    Then the status is 400 with the error <error>

    Examples:
      | model         | error                            |
      | no model      | "model is required"              |
      | the model a/b | "invalid model name: \"a/b\""    |

  Scenario: Registered vectors take their round off the pending list
    Given a round waiting for embeddings with a model
    When PUT /v1/vectors sends a vector for it with its revision
    Then the status is 200 and the body is {"accepted": 1, "stale": []}
    And the round is no longer pending for that model

  Scenario: A vector for an old revision is stale
    Given a round waiting for embeddings with a model
    When PUT /v1/vectors sends a vector for it with another revision
    Then the body is {"accepted": 0, "stale": [<its id>]}
    And the round is still pending for that model

  Scenario Outline: A vector registration that is not valid is rejected with 400
    Given a round waiting for embeddings with a model
    When PUT /v1/vectors sends <request>
    Then the status is 400 with the error <error>

    Examples:
      | request                                 | error                                                         |
      | no model                                | "model is required"                                           |
      | 17 revisions                            | "at most 16 ids per request"                                  |
      | the magic lctyvBE0                      | "magic must be lctyvLE0"                                      |
      | the size 1024                           | "size must be 3072"                                           |
      | the entry_count 0                       | "entry_count must be a positive integer"                      |
      | the entry_count 2 with one record       | "body must be 2 records of 3104 bytes"                        |
      | a record with a wrong control block     | "record 0: bad control block (expected lctyvLE0 + 3072)"      |
      | a record without a revision             | "rev is missing for <its id>"                                 |
      | a zero vector                           | "vector must be finite and non-zero"                          |

  Scenario: The distribution files carry one ETag and answer 304 when unchanged
    When GET /v1/vectors.eg2_264.dat and GET /v1/vectors.eg2_264.idx are requested
    Then both are 200 application/octet-stream with the same ETag
    And the .dat has 1,056 bytes per row and the .idx 16 bytes per row, for the same number of rows
    And GET /v1/vectors.eg2_264.dat with If-None-Match of that ETag answers 304 without a body

  Scenario: The distribution files follow a registered vector
    Given the ETag of the distribution files
    When PUT /v1/vectors registers a vector of the model "embeddinggemma-2" for a new round
    Then GET /v1/vectors.eg2_264.idx has another ETag
    And its rows include the id of the round
    And the row of the round in the .dat is the first 256 dimensions of its vector, of length 1, followed by 32 zero bytes

  Scenario Outline: An unknown endpoint is 404
    When <request> is requested
    Then the status is 404 with the error "no such endpoint"

    Examples:
      | request                         |
      | GET /v1/nope                    |
      | DELETE /v1/defaults.json        |
      | PATCH /v1/conversations         |
      | GET /v1/tags/a/memory           |
      | GET /v1/conversations/a/lines   |

  Scenario: A path that is not UTF-8 is rejected
    When GET /v1/conversations/%FF is requested
    Then the status is 400 with the error "invalid path encoding"
