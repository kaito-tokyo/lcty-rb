# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# The behaviour of lib/module_servlet.rb (LCTYSP-0005, LCTYSP-0011). Each Scenario is a test of the same title in
# tests/backend/module_servlet_test.rb, whose steps are the lines below.

Feature: LCTYSP-3010 Module servlet

  Chatty::ModuleServlet serves the module entries of the pages from memory. ModuleServlet.mount_all bundles each entry
  of public/ (only index.js, the new conversation page's entry) once, when the server starts, and mounts it at
  /<entry>; a module that breaks the bundler's conventions stops the server from starting. A GET answers the bundle as
  JavaScript in UTF-8 that the browser must revalidate (Cache-Control: no-cache), and any path below the entry is not
  found. Each scenario starts a WEBrick server on 127.0.0.1 with a free port and requests it over HTTP.

  Scenario: mount_all serves the bundle of public/index.js at /index.js
    Given a server on which ModuleServlet.mount_all has mounted the entries
    When GET /index.js is requested
    Then the status is 200
    And the body is the bundle of "index.js" in public/
    And its last block is the entry, "// index.js"

  Scenario: The bundle is JavaScript that is revalidated on every load
    Given a server on which ModuleServlet.mount_all has mounted the entries
    When GET /index.js is requested
    Then Content-Type is "text/javascript; charset=utf-8"
    And Cache-Control is "no-cache"

  Scenario: The entries are bundled once, when they are mounted
    Given a bundler that counts its calls
    When ModuleServlet.mount_all mounts the entries on a server
    And GET /index.js is requested twice
    Then the bundler was called once, with public/ and "index.js"
    And both answers are the body it returned

  Scenario: A module the bundler rejects stops mount_all
    Given a bundler that rejects a module
    When ModuleServlet.mount_all mounts the entries on a server
    Then it raises the bundler's error
    And GET /index.js is not found

  Scenario: The servlet answers the body it was mounted with, byte for byte
    Given the servlet mounted at /x.js with a body holding non-ASCII text
    When GET /x.js is requested
    Then the body is the same bytes in UTF-8
    And Content-Length is its size in bytes

  Scenario: A query string does not change the answer
    Given the servlet mounted at /x.js with a body
    When GET /x.js?v=2 is requested
    Then the status is 200 and the body is that body

  Scenario: A path below the entry is not found
    Given the servlet mounted at /x.js with a body
    When GET /x.js/extra is requested
    Then the status is 404

  Scenario: HEAD answers the headers without the body
    Given the servlet mounted at /x.js with a body
    When HEAD /x.js is requested
    Then the status is 200 with the JavaScript Content-Type
    And there is no body

  Scenario: Methods other than GET and HEAD are not allowed
    Given the servlet mounted at /x.js with a body
    When POST /x.js is requested
    Then the status is 405
