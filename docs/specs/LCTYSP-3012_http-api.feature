# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/v1/servlet.rb (LCTYSP-0006, with LCTYSP-0003, LCTYSP-0004, LCTYSP-0007, LCTYSP-0008 and
# LCTYSP-0009). Each Scenario is a test of the same title in tests/backend/v1_servlet_test.rb, whose steps are the lines
# below.

Feature: LCTYSP-3012 HTTP API

  Chatty::V1::Servlet, mounted at /v1, answers the JSON API on the same origin as the pages: the defaults of the
  browser settings, conversations (create, read, append, pop, delete and the lists), keyword search and snippets, the
  tag files (get-all and replace-all with an ETag, and adding memory), and the vector pair of semantic search (its JSON,
  and its files by Range: LCTYSP-3028). Bodies
  are JSON unless stated otherwise, and every error is {"error": "…"} with an HTTP status. Paths and query values are
  read as UTF-8, and request bodies are limited to 64 MiB.

  Scenario: The defaults of the browser settings
    When GET /v1/defaults.json is requested
    Then the status is 200 and the body is JSON
    And it has the base_url "http://127.0.0.1:9931" and the model "gemma-4-26b-a4b-it", and no embedding_model
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
      | tags that are not unique              | "tags must be an array of unique tag references" |
      | a tag reference with a slash          | "tags must be an array of unique tag references" |
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
      | a tags line with a tag reference with a space                | "tags must be an array of unique tag references" |

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
    And what was measured of a reply of it is recorded in lcty_c.sqlite
    When DELETE /v1/conversations/<id> is requested
    Then the status is 200 and the body is {"ok": true}
    And GET /v1/conversations/<id> answers 404
    And it is not in /v1/conversations
    And a search for its word no longer finds its round
    And its current tags are forgotten
    And the search index keeps no tag for it
    And lcty_c.sqlite keeps nothing measured of its replies
    And deleting it again still answers 200

  Scenario: Deleting a conversation is announced to the pages
    Given a conversation whose tags were changed to ["gone"], and the changes announced through Chatty.commit recorded
    When DELETE /v1/conversations/<id> is requested
    Then a c.batch.updated deletes it from c_meta and c_recordcount
    And a t.batch.updated deletes its row of t_has_many_c
    And deleting it again announces no record

  Scenario: GET /v1/meta-all.json is no longer served
    Given a conversation
    When GET /v1/meta-all.json is requested
    Then the status is 404 with the error "no such endpoint"

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

  Scenario: The tags are read with an ETag for the whole set
    When GET /v1/tags is requested
    Then the status is 200 and the body is {"tags": [...]}, each with file, name, ops, prompt and memory
    And the response has an ETag

  Scenario: The tag files are replaced as a whole with If-Match
    Given the tags and the ETag from GET /v1/tags
    When PUT /v1/tags sends them and a new tag file with a policy, a prompt and a memory item, with the ETag in If-Match
    Then the status is 200 and the body is {"ok": true}
    And the response has a new ETag, the one GET /v1/tags gives next
    And GET /v1/tags has the new tag with its policy, its prompt and its memory item
    And the tags that were there before are kept

  Scenario Outline: Replacing the tags without the current ETag
    Given the tags and the ETag from GET /v1/tags, changed since by another PUT
    When PUT /v1/tags sends a new set <if-match>
    Then the status is <status> with the error <error>
    And the tags are unchanged

    Examples:
      | if-match                      | status | error                   |
      | without If-Match              | 428    | "If-Match is required"  |
      | with the old ETag in If-Match | 412    | "the tags have changed" |

  Scenario Outline: Tag sets that are not valid are rejected with 400
    When PUT /v1/tags sends <tags> with the current ETag
    Then the status is 400 with the error <error>
    And the tags are unchanged

    Examples:
      | tags                            | error                                                             |
      | an array                        | "body must be {\"tags\": [...]}"                                  |
      | a file name without its number  | "invalid tag file name \"ruby.html\": must be NNNNN-<name>.html"  |
      | two files with the same part    | "tag file names must be unique"                                   |
      | a memory item with a blank text | "memory must be an array of {id, text}"                           |

  Scenario: A memory item is added to a tag file
    Given a tag file with a display name in Japanese and the ETag from GET /v1/tags
    When POST /v1/tags/<file>/memory sends {"text": "  remember this  ", "source": {"conv_id": "c1"}}
    Then the status is 201 and the item has a UUIDv7 id, the text "remember this", the time it was added and the source
    And GET /v1/tags has the item under the tag
    And GET /v1/tags has another ETag

  Scenario Outline: Memory requests that cannot be done
    Given a tag file with a memory item
    When <request> is requested
    Then the status is <status> with the error <error>
    And the tag file is unchanged

    Examples:
      | request                                              | status | error                                               |
      | POST /v1/tags/<unknown file>/memory with a text      | 404    | "no such tag file"                                  |
      | POST /v1/tags/<name without number>/memory with a text | 400  | "invalid tag file name: must be NNNNN-<name>.html"  |
      | POST /v1/tags/<file>/memory with a blank text        | 400    | "text is required"                                  |
      | POST /v1/tags/<file>/memory with an array            | 400    | "body must be an object"                            |

  Scenario Outline: An unknown endpoint is 404
    When <request> is requested
    Then the status is 404 with the error "no such endpoint"

    Examples:
      | request                         |
      | GET /v1/nope                    |
      | GET /v1/vectors/pending         |
      | PUT /v1/vectors                 |
      | DELETE /v1/defaults.json        |
      | PATCH /v1/conversations         |
      | GET /v1/tags/a/memory           |
      | PATCH /v1/tags/a/memory/b       |
      | DELETE /v1/tags/a/memory/b      |
      | GET /v1/conversations/a/lines   |

  Scenario: A path that is not UTF-8 is rejected
    When GET /v1/conversations/%FF is requested
    Then the status is 400 with the error "invalid path encoding"
