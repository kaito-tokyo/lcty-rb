# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of public/js/llm/responses.js and public/js/llm/client.js (LCTYSP-0002). Each Scenario is a test of
# the same title in tests/unit/responses.test.js (in Node.js), whose steps are the lines below.

Feature: LCTYSP-1007 Streaming a reply through the Responses API

  stream({backend, instructions, input, extraBody, signal}) of js/llm/client.js is how a page asks llama-server for a
  reply: the conversation page for each turn and js/tags.js for memory proposals. It picks the adapter of
  backend.api, and the only one is "responses", streamResponses of js/llm/responses.js. That POSTs to
  <base_url>/v1/responses a body made of backend.extra, then extraBody, then model (backend.model or "default"),
  stream: true and input, with instructions when they are not empty; backend.api_key becomes a Bearer token. It
  reads the reply as server-sent events and yields the common events: {type: "text", delta} and
  {type: "thinking", delta} as they arrive, and at the end {type: "done", usage, timings} (with incomplete: true for
  response.incomplete) or {type: "error", message}. A response that is not OK is thrown as "HTTP <status>: <message>",
  and the signal stops the request.

  In the steps the backend is {"base_url": "http://llm.test", "model": "gemma"} unless a step says otherwise.

  Background:
    Given POST http://llm.test/v1/responses is answered by the test, with CORS

  Scenario: The request is a POST of the conversation as JSON
    Given the instructions "Be brief" and the input [{"role": "user", "content": "Hi"}]
    When the reply is streamed
    Then one POST http://llm.test/v1/responses is sent with the Content-Type "application/json"
    And it has no Authorization header
    And its body is exactly {"model": "gemma", "stream": true, "input": [{"role": "user", "content": "Hi"}], "instructions": "Be brief"}

  Scenario Outline: The endpoint is the base URL without its trailing slashes
    Given the backend's base_url is "<base_url>"
    When the reply is streamed
    Then one POST <url> is sent

    Examples:
      | base_url                | url                                  |
      | http://llm.test/        | http://llm.test/v1/responses         |
      | http://llm.test///      | http://llm.test/v1/responses         |
      | http://llm.test/proxy/  | http://llm.test/proxy/v1/responses   |

  Scenario: An API key is sent as a Bearer token
    Given the backend's api_key is "secret-key"
    When the reply is streamed
    Then the request has the Authorization header "Bearer secret-key"

  Scenario: Without a model the request names the model "default"
    Given a backend without a model
    When the reply is streamed
    Then the body's model is "default"

  Scenario: Empty instructions are left out
    Given the instructions ""
    When the reply is streamed
    Then the body has no instructions

  Scenario: backend.extra and extraBody add parameters, extraBody last
    Given the backend's extra is {"temperature": 0.5, "top_k": 40}
    And the extraBody {"top_k": 1, "response_format": {"type": "json_object"}}
    When the reply is streamed
    Then the body has "temperature" 0.5, "top_k" 1 and "response_format" {"type": "json_object"}

  Scenario: extra and extraBody cannot replace model, stream or input
    Given the backend's extra is {"model": "other", "stream": false, "input": "x"}
    And the extraBody {"model": "another", "stream": false, "input": "y"}
    When the reply is streamed
    Then the body's model is "gemma", its stream is true and its input is the one given

  Scenario: Reply text arrives as text events and the stream ends with done
    Given the reply streams the text deltas "Hel" and "lo" and then response.completed with usage and timings
    When the reply is streamed
    Then it yields {"type": "text", "delta": "Hel"}, {"type": "text", "delta": "lo"}
    And then {"type": "done"} with the usage and the timings of response.completed
    And nothing after it

  Scenario: Thinking arrives as thinking events, apart from the text
    Given the reply streams the thinking delta "Let me see", the text delta "Yes" and then response.completed
    When the reply is streamed
    Then it yields {"type": "thinking", "delta": "Let me see"}, {"type": "text", "delta": "Yes"}, {"type": "done"}

  Scenario: An incomplete response ends with done marked incomplete
    Given the reply streams the text delta "Hel" and then response.incomplete with usage and timings
    When the reply is streamed
    Then it yields {"type": "text", "delta": "Hel"}
    And then {"type": "done", "incomplete": true} with the usage and the timings of response.incomplete

  Scenario Outline: A failure in the stream ends it with an error event
    Given the reply streams the text delta "Hel" and then <event>
    And then the text delta "lo"
    When the reply is streamed
    Then it yields {"type": "text", "delta": "Hel"}, {"type": "error", "message": "<message>"}
    And nothing after it

    Examples:
      | event                                                  | message         |
      | an error event with the message "context full"         | context full    |
      | response.failed with the response's error "overloaded" | overloaded      |
      | response.failed without a message                      | unknown error   |

  Scenario: Events after response.completed are not read
    Given the reply streams response.completed and then the text delta "late"
    When the reply is streamed
    Then it yields only {"type": "done"}

  Scenario: [DONE] ends the stream without a done event
    Given the reply streams the text delta "a", then the data [DONE], then the text delta "b"
    When the reply is streamed
    Then it yields only {"type": "text", "delta": "a"}

  Scenario: A stream that ends without response.completed yields only its deltas
    Given the reply streams the text delta "a" and then ends
    When the reply is streamed
    Then it yields only {"type": "text", "delta": "a"}

  Scenario: Other events and data that is not JSON are skipped
    Given the reply streams response.created, the data "not json", response.output_text.done, the text delta "a" and response.completed
    When the reply is streamed
    Then it yields {"type": "text", "delta": "a"}, {"type": "done"}

  Scenario: The type in the data decides, not the SSE event name
    Given the reply streams the SSE event "response.completed" whose data is a text delta "a", and then response.completed
    When the reply is streamed
    Then it yields {"type": "text", "delta": "a"}, {"type": "done"}

  Scenario Outline: A response that is not OK is thrown with its status
    Given llama-server answers with the status <status> and <body>
    When the reply is streamed
    Then it throws the error "<error>"
    And it yields nothing

    Examples:
      | status | body                                          | error                             |
      | 400    | the JSON error message "model not found"      | HTTP 400: model not found         |
      | 500    | a JSON body without an error                  | HTTP 500: Internal Server Error   |
      | 503    | the text "busy"                               | HTTP 503: Service Unavailable     |

  Scenario: A request that fails without a response is thrown as a TypeError
    Given the request to llama-server fails without a response
    When the reply is streamed
    Then it throws a TypeError
    And it yields nothing

  Scenario: An aborted signal stops the request before it is sent
    Given a signal that is already aborted
    When the reply is streamed with it
    Then it throws an AbortError
    And no request reaches llama-server

  Scenario: Aborting while waiting for the response stops the request
    Given llama-server does not answer
    When the reply is streamed with a signal
    And the signal is aborted once the request has arrived
    Then it throws an AbortError
    And it yields nothing

  Scenario Outline: client.js streams through the Responses API
    Given the backend's api is <api>
    When the reply is streamed through stream() of client.js
    Then one POST http://llm.test/v1/responses is sent
    And it yields {"type": "text", "delta": "ok"}, {"type": "done"}

    Examples:
      | api           |
      | not set       |
      | "responses"   |

  Scenario: client.js refuses an api it does not know
    Given the backend's api is "chat"
    When stream() of client.js is called
    Then it throws the error "unsupported api: chat" at once
    And no request reaches llama-server
