# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3010: the scenarios of docs/specs/LCTYSP-3010_module-servlet.feature, written by hand. Each test has the title
# of its Scenario and one step per line of it, so the two read side by side. Each test starts a WEBrick server on
# 127.0.0.1 with a free port in a thread and stops it at the end.

require_relative 'helper'
require 'module_servlet'
require 'minitest/mock'
require 'net/http'

class ModuleServletTest < Lcty::Scenarios
  ModuleServlet = Chatty::ModuleServlet
  Bundle = Chatty::C::Bundle

  def setup
    @server = WEBrick::HTTPServer.new(BindAddress: '127.0.0.1', Port: 0, Logger: WEBrick::Log.new(File::NULL),
                                      AccessLog: [])
    @thread = nil
  end

  def teardown
    @server.shutdown
    @thread.join(5) if @thread
  end

  # Sends the request, starting the server on the first one
  def request(method, path)
    @thread ||= Thread.new { @server.start }
    Net::HTTP.start('127.0.0.1', @server.config[:Port]) do |http|
      http.send_request(method, path)
    end
  end

  def mount_all
    ModuleServlet.mount_all(@server)
  end

  %w[c t].each do |dir|
    scenario "mount_all serves the bundle of public/#{dir}/index.js at /#{dir}/index.js" do
      res = nil
      step('Given a server on which ModuleServlet.mount_all has mounted the entries') { mount_all }
      step("When GET /#{dir}/index.js is requested") { res = request('GET', "/#{dir}/index.js") }
      step('Then the status is 200') { assert_equal '200', res.code }
      step("And the body is the bundle of \"#{dir}/index.js\" in public/") do
        assert_equal Bundle.bundle(Chatty::PUBLIC_DIR, "#{dir}/index.js"), res.body.force_encoding('UTF-8')
      end
      step("And its last block is the entry, \"// #{dir}/index.js\"") do
        assert_equal "// #{dir}/index.js", res.body.scan(%r{^// \S+\.js$}).last
      end
    end
  end

  scenario 'The bundle is JavaScript that is revalidated on every load' do
    res = nil
    step('Given a server on which ModuleServlet.mount_all has mounted the entries') { mount_all }
    step('When GET /c/index.js is requested') { res = request('GET', '/c/index.js') }
    step('Then Content-Type is "text/javascript; charset=utf-8"') do
      assert_equal 'text/javascript; charset=utf-8', res['Content-Type']
    end
    step('And Cache-Control is "no-cache"') { assert_equal 'no-cache', res['Cache-Control'] }
  end

  scenario 'The entries are bundled once, when they are mounted' do
    calls = []
    fake = ->(root, entry) { calls << [root, entry]; "// #{entry}\n{\nrun();\n}\n" }
    answers = nil
    step('Given a bundler that counts its calls') { calls.clear }
    Bundle.stub(:bundle, fake) do
      step('When ModuleServlet.mount_all mounts the entries on a server') { mount_all }
    end
    step('And GET /c/index.js is requested twice') { answers = Array.new(2) { request('GET', '/c/index.js').body } }
    step('Then the bundler was called once for each entry, with public/ and "c/index.js", then "t/index.js"') do
      assert_equal [[Chatty::PUBLIC_DIR, 'c/index.js'], [Chatty::PUBLIC_DIR, 't/index.js']], calls
    end
    step('And both answers are the body it returned') do
      assert_equal ["// c/index.js\n{\nrun();\n}\n"] * 2, answers
    end
  end

  scenario 'A module the bundler rejects stops mount_all' do
    err = Bundle::Error.new('js/x.js:3: import() is not allowed: import("./y.js")')
    raised = nil
    step('Given a bundler that rejects a module') { err }
    Bundle.stub(:bundle, ->(_root, _entry) { raise err }) do
      step('When ModuleServlet.mount_all mounts the entries on a server') do
        raised = assert_raises(Bundle::Error) { mount_all }
      end
    end
    step("Then it raises the bundler's error") { assert_same err, raised }
    step('And GET /c/index.js is not found') { assert_equal '404', request('GET', '/c/index.js').code }
  end

  scenario 'The servlet answers the body it was mounted with, byte for byte' do
    body = "// x.js\n{\nconst greeting = \"こんにちは\";\n}\n"
    res = nil
    step('Given the servlet mounted at /x.js with a body holding non-ASCII text') do
      @server.mount('/x.js', ModuleServlet, body)
    end
    step('When GET /x.js is requested') { res = request('GET', '/x.js') }
    step('Then the body is the same bytes in UTF-8') { assert_equal body.b, res.body.b }
    step('And Content-Length is its size in bytes') { assert_equal body.bytesize.to_s, res['Content-Length'] }
  end

  scenario 'A query string does not change the answer' do
    res = nil
    step('Given the servlet mounted at /x.js with a body') { @server.mount('/x.js', ModuleServlet, 'run();') }
    step('When GET /x.js?v=2 is requested') { res = request('GET', '/x.js?v=2') }
    step('Then the status is 200 and the body is that body') do
      assert_equal '200', res.code
      assert_equal 'run();', res.body
    end
  end

  scenario 'A path below the entry is not found' do
    res = nil
    step('Given the servlet mounted at /x.js with a body') { @server.mount('/x.js', ModuleServlet, 'run();') }
    step('When GET /x.js/extra is requested') { res = request('GET', '/x.js/extra') }
    step('Then the status is 404') { assert_equal '404', res.code }
  end

  scenario 'HEAD answers the headers without the body' do
    res = nil
    step('Given the servlet mounted at /x.js with a body') { @server.mount('/x.js', ModuleServlet, 'run();') }
    step('When HEAD /x.js is requested') { res = request('HEAD', '/x.js') }
    step('Then the status is 200 with the JavaScript Content-Type') do
      assert_equal '200', res.code
      assert_equal 'text/javascript; charset=utf-8', res['Content-Type']
    end
    step('And there is no body') { assert_nil res.body }
  end

  scenario 'Methods other than GET and HEAD are not allowed' do
    res = nil
    step('Given the servlet mounted at /x.js with a body') { @server.mount('/x.js', ModuleServlet, 'run();') }
    step('When POST /x.js is requested') { res = request('POST', '/x.js') }
    step('Then the status is 405') { assert_equal '405', res.code }
  end
end
