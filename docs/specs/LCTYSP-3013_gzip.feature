# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of Chatty::GzipServer in lcty.rb (LCTYSP-0001, LCTYSP-0005 and LCTYSP-0006). Each Scenario is a test of
# the same title in tests/backend/gzip_test.rb, whose steps are the lines below.

Feature: LCTYSP-3013 Transparent gzip

  Chatty::GzipServer is the WEBrick server of lcty.rb, which gzips the responses of every servlet once the servlet has
  finished. Only 200 responses to GET whose type is text-like (text/*, application/json, application/javascript and
  image/svg+xml), whose body has at least 1,024 bytes and that are not encoded yet are gzipped, and only for a client
  whose Accept-Encoding allows gzip (gzip, x-gzip or *, with a q-value above 0). Such responses carry
  "Vary: Accept-Encoding" whether they are gzipped or not; the ETag is kept as it is.

  Scenario: A large text response is gzipped for a client that accepts gzip
    Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8"
    When it is requested with Accept-Encoding "gzip"
    Then the status is 200 with Content-Encoding "gzip" and Vary "Accept-Encoding"
    And the Content-Length is the length of the gzipped body
    And the body inflates to the 2,000 bytes

  Scenario: A client that does not say Accept-Encoding gets the plain body, with Vary
    Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8"
    When it is requested without Accept-Encoding
    Then the body is the 2,000 bytes, without Content-Encoding
    And Vary is "Accept-Encoding"

  Scenario Outline: A Vary the servlet set is kept
    Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8" with Vary "<own>"
    When it is requested with Accept-Encoding "gzip"
    Then the body is gzipped and Vary is "<vary>"

    Examples:
      | own                     | vary                    |
      | Cookie                  | Cookie, Accept-Encoding |
      | Cookie, accept-encoding | Cookie, accept-encoding |
      | *                       | *                       |

  Scenario Outline: Accept-Encoding and its q-values decide whether the body is gzipped
    Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8"
    When it is requested with Accept-Encoding <header>
    Then the body is <sent>
    And Vary is "Accept-Encoding"

    Examples:
      | header                  | sent    |
      | "gzip"                  | gzipped |
      | "GZIP"                  | gzipped |
      | "x-gzip"                | gzipped |
      | "*"                     | gzipped |
      | "deflate, gzip;q=0.5"   | gzipped |
      | "gzip;q=0.001"          | gzipped |
      | "gzip ; Q=1"            | gzipped |
      | "gzip;q=0"              | plain   |
      | "*;q=0"                 | plain   |
      | "gzip;q=0, *"           | plain   |
      | "identity"              | plain   |
      | "br, deflate"           | plain   |
      | ""                      | plain   |

  Scenario Outline: Only text-like types are gzipped
    Given a servlet that answers 2,000 bytes of <type>
    When it is requested with Accept-Encoding "gzip"
    Then the body is <sent>

    Examples:
      | type                                | sent    |
      | "text/html; charset=utf-8"          | gzipped |
      | "text/css; charset=utf-8"           | gzipped |
      | "text/javascript; charset=utf-8"    | gzipped |
      | "application/json; charset=utf-8"   | gzipped |
      | "application/javascript"            | gzipped |
      | "image/svg+xml"                     | gzipped |
      | "image/png"                         | plain   |
      | "application/octet-stream"          | plain   |
      | "application/wasm"                  | plain   |
      | "application/xml"                   | plain   |

  Scenario: A response that is not gzipped for its type has no Vary
    Given a servlet that answers 2,000 bytes of "application/octet-stream"
    When it is requested with Accept-Encoding "gzip"
    Then the body is the 2,000 bytes, without Content-Encoding
    And there is no Vary

  Scenario Outline: Bodies under 1,024 bytes are left alone
    Given a servlet that answers <size> bytes of "text/plain; charset=utf-8"
    When it is requested with Accept-Encoding "gzip"
    Then the body is <sent>
    And Vary is <vary>

    Examples:
      | size  | sent    | vary              |
      | 0     | plain   | not set           |
      | 1,023 | plain   | not set           |
      | 1,024 | gzipped | "Accept-Encoding" |

  Scenario Outline: Only 200 responses to GET are gzipped
    Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8" with the status <status>
    When it is requested by <method> with Accept-Encoding "gzip"
    Then the status is <status> without Content-Encoding

    Examples:
      | method | status |
      | GET    | 404    |
      | GET    | 500    |
      | GET    | 206    |
      | POST   | 200    |
      | HEAD   | 200    |

  Scenario: A body the servlet has encoded itself is left alone
    Given a servlet that answers 2,000 bytes of "text/plain; charset=utf-8" with Content-Encoding "br"
    When it is requested with Accept-Encoding "gzip, br"
    Then the body is the 2,000 bytes with Content-Encoding "br"
    And there is no Vary

  Scenario: A static file is gzipped from the file, keeping its ETag
    Given a static file of 5,000 bytes of text served by WEBrick's file handler
    When it is requested with Accept-Encoding "gzip"
    Then the body inflates to the bytes of the file, with Content-Encoding "gzip" and the Content-Length of the gzipped body
    And the ETag is that of the file, as without gzip

  Scenario: A small static file is left alone
    Given a static file of 100 bytes of text served by WEBrick's file handler
    When it is requested with Accept-Encoding "gzip"
    Then the body is the bytes of the file, without Content-Encoding

  Scenario: A part of a static file (206) is left alone
    Given a static file of 5,000 bytes of text served by WEBrick's file handler
    When the bytes 0-1999 of it are requested with Accept-Encoding "gzip"
    Then the status is 206 and the body is those 2,000 bytes, without Content-Encoding

  Scenario: A conditional GET of a static file still answers 304
    Given a static file of 5,000 bytes of text served by WEBrick's file handler
    And its ETag from a request with Accept-Encoding "gzip"
    When it is requested with If-None-Match of that ETag and Accept-Encoding "gzip"
    Then the status is 304 without a body or Content-Encoding
