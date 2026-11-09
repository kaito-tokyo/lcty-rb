# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3021: the scenarios of docs/specs/LCTYSP-3021_openapi.feature, written by hand. Each test has the title of its
# Scenario and one step per line of it, so the two read side by side.
#
# lcty.rb is loaded without running, and Lcty.mount_all mounts the site at / on a WEBrick server on 127.0.0.1 (a free
# port), over the tests' data directory (helper.rb). openapi.yaml and public/ are found from the working directory,
# the repository's root.

require_relative 'helper'
require 'net/http'
require 'yaml'
require File.expand_path('../../lcty.rb', __dir__)

class OpenapiTest < Lcty::Scenarios
  REPO_ROOT = File.expand_path('../..', __dir__)
  CID = 'openapi-3021'
  TAG_FILE = '03021-openapi.html'

  def self.port
    @port ||= begin
      Lcty.open_data
      server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, MimeTypes: Lcty::Servlets::MIME_TYPES,
                                       Logger: WEBrick::Log.new(File::NULL), AccessLog: [], DoNotReverseLookup: true)
      Lcty.mount_all(server, '/')
      Thread.new { server.start }
      Minitest.after_run { server.shutdown }
      server.config[:Port]
    end
  end

  def spec
    YAML.safe_load(File.read(File.join(REPO_ROOT, 'openapi.yaml')))
  end

  def request(method, path)
    req = Net::HTTPGenericRequest.new(method.upcase, %w[POST PUT].include?(method.upcase), true, path,
                                      'Accept-Encoding' => 'identity', 'Content-Type' => 'application/json')
    req.body = '{}' if req.request_body_permitted?
    Net::HTTP.start('127.0.0.1', self.class.port) { |h| h.request(req) }
  end

  def write_fixture(dir, name)
    path = File.join(dir, name)
    File.write(path, "<!doctype html>\n")
    (@remove ||= []) << path
  end

  def teardown
    (@remove || []).each { |path| File.delete(path) if File.exist?(path) }
  end

  # The paths a template stands for: every module of public/js/ for {module}, the examples for the other parameters
  def expand(template)
    modules = Dir.glob(File.join(REPO_ROOT, 'public/js/**/*.js')).map { |f| f.delete_prefix("#{REPO_ROOT}/public/js/") }
    paths = template.include?('{module}') ? modules.map { |m| template.sub('{module}', m) } : [template]
    examples = { 'cid' => CID, 'tagfile' => TAG_FILE, 'v1name' => 'lcty.v1.js' }
    paths.map { |p| p.gsub(/\{(\w+)\}/) { examples.fetch(Regexp.last_match(1)) } }
  end

  scenario 'Every path and method of openapi.yaml is answered' do
    answers = []
    step('Given Lcty.mount_all on a WEBrick server') { self.class.port }
    step('And a conversation file and a tag file') do
      write_fixture(Chatty::CONV_DIR, "#{CID}.html")
      write_fixture(Chatty::TAG_DIR, TAG_FILE)
    end
    step('When every path of openapi.yaml is requested with each of its methods') do
      # DELETE last, so that the conversation is still there for the other methods
      ops = spec['paths'].flat_map { |template, methods| methods.keys.map { |m| [m, template] } }
      ops.sort_by { |m, _| m == 'delete' ? 1 : 0 }.each do |method, template|
        expand(template).each { |path| answers << [method.upcase, path, request(method, path).code] }
      end
    end
    step('Then none is answered 404 or 405') do
      refute_empty answers
      assert_equal [], answers.select { |_, _, code| %w[404 405].include?(code) }
    end
  end

  scenario 'A file of public/ that openapi.yaml does not list is 404' do
    answers = []
    step('Given Lcty.mount_all on a WEBrick server') { self.class.port }
    step('When every file of public/ outside lcty.v1/, c/, t/ and js/ that openapi.yaml does not list is requested') do
      listed = spec['paths'].keys
      files = Dir.glob(File.join(REPO_ROOT, 'public/**/*'), File::FNM_DOTMATCH).select { |f| File.file?(f) }
      files.map { |f| f.delete_prefix("#{REPO_ROOT}/public") }.each do |path|
        next if path.start_with?('/lcty.v1/', '/c/', '/t/', '/js/') || listed.include?(path)

        answers << [path, request('get', path).code]
      end
    end
    step('Then each is answered 404') do
      refute_empty answers
      assert_equal [], answers.reject { |_, code| code == '404' }
    end
  end
end
