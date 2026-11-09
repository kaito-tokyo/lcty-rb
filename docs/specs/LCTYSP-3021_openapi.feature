# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# openapi.yaml at the root of the repository, the list of every path the site answers, against what Lcty.mount_all
# mounts (lcty.rb). Each Scenario is a test of the same title in tests/backend/openapi_test.rb, whose steps are the
# lines below.

Feature: LCTYSP-3021 The paths of openapi.yaml

  openapi.yaml lists every path and method of the site, relative to LCTY_BASE_URL. The site is Lcty.mount_all on a
  WEBrick server at "/", over the tests' data directory with one conversation file and one tag file. A path parameter
  is replaced by an example: cid by the conversation, tagfile by the tag file, v1name by "lcty.v1.js", and module by
  every module of public/js/. Bodies are "{}", sent as application/json; a request only has to reach its servlet, so
  any status but 404 and 405 will do.

  Scenario: Every path and method of openapi.yaml is answered
    Given Lcty.mount_all on a WEBrick server
    And a conversation file and a tag file
    When every path of openapi.yaml is requested with each of its methods
    Then none is answered 404 or 405

  Scenario: A file of public/ that openapi.yaml does not list is 404
    Given Lcty.mount_all on a WEBrick server
    When every file of public/ outside lcty.v1/, c/, t/ and js/ that openapi.yaml does not list is requested
    Then each is answered 404
