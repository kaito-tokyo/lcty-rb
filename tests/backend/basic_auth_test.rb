# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3025: the scenarios of docs/specs/LCTYSP-3025_basic-auth.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.

require_relative 'helper'
require 'basic_auth'
require 'stringio'

class BasicAuthTest < Lcty::Scenarios
  Password = Chatty::Password
  PW = 'correct horse battery'
  CHALLENGE = 'Basic realm="lcty-rb", charset="UTF-8"'

  # A request with the header Authorization (none when nil), as WEBrick's request answers req['authorization']
  Request = Struct.new(:authorization) do
    def [](name)
      name.casecmp?('authorization') ? authorization : nil
    end
  end

  # The checker with user and password (a hash of few iterations, for speed); its log goes to @log
  def checker(user, password, fail_delay: 0)
    @log = StringIO.new
    Chatty::BasicAuth.new({ user => Password.create(password, iterations: 1000) },
                          logger: WEBrick::Log.new(@log, WEBrick::Log::WARN), fail_delay: fail_delay)
  end

  def basic(user, password)
    "Basic #{["#{user}:#{password}"].pack('m0')}"
  end

  # Authenticates a request with the header; [:returned or the exception, the response's headers, the seconds taken]
  def authenticate(auth, header)
    res = {}
    t = Time.now
    r = begin
      auth.authenticate(Request.new(header), res)
      :returned
    rescue WEBrick::HTTPStatus::Status => e
      e
    end
    [r, res, Time.now - t]
  end

  # How many times Password.verify is called while the block runs
  def verify_calls
    n = 0
    original = Password.method(:verify)
    Password.define_singleton_method(:verify) do |*a|
      n += 1
      original.call(*a)
    end
    yield
    n
  ensure
    Password.define_singleton_method(:verify, original)
  end

  scenario 'A request without credentials is answered with the challenge' do
    auth = r = res = nil
    step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}")) { auth = checker('alice', PW) }
    step('When a request without an Authorization header is authenticated') { r, res, = authenticate(auth, nil) }
    step('Then it raises WEBrick::HTTPStatus::Unauthorized') { assert_kind_of WEBrick::HTTPStatus::Unauthorized, r }
    step(%(And WWW-Authenticate is '#{CHALLENGE}')) { assert_equal CHALLENGE, res['WWW-Authenticate'] }
    step('And nothing is logged') { assert_empty @log.string }
  end

  scenario 'The user and password of a user get in' do
    auth = r = nil
    step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}")) { auth = checker('alice', PW) }
    step(%(When a request with the Basic credentials of "alice" and "#{PW}" is authenticated)) do
      r, = authenticate(auth, basic('alice', PW))
    end
    step('Then it returns') { assert_equal :returned, r }
  end

  [%w[alice correct\ horse\ batterY], ['bob', PW], ['alice', '']].each do |user, password|
    scenario "Other credentials are refused after the delay, and the user is logged (#{user.inspect}, #{password.inspect})" do
      auth = r = took = nil
      step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}", and a delay of 0.2 seconds)) do
        auth = checker('alice', PW, fail_delay: 0.2)
      end
      step("When a request with the Basic credentials of #{user.inspect} and #{password.inspect} is authenticated") do
        r, _, took = authenticate(auth, basic(user, password))
      end
      step('Then it raises WEBrick::HTTPStatus::Unauthorized after 0.2 seconds or more') do
        assert_kind_of WEBrick::HTTPStatus::Unauthorized, r
        assert_operator took, :>=, 0.2
      end
      step("And the log names #{user.inspect} and not the password") do
        assert_includes @log.string, user.inspect
        refute_includes @log.string, password unless password.empty?
      end
    end
  end

  scenario 'An unknown user is checked against a hash too' do
    auth = n = nil
    step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}")) { auth = checker('alice', PW) }
    step(%(When a request with the Basic credentials of "bob" and "#{PW}" is authenticated)) do
      n = verify_calls { authenticate(auth, basic('bob', PW)) }
    end
    step('Then Password.verify was called once') { assert_equal 1, n }
  end

  scenario 'Credentials that were accepted are remembered' do
    auth = n = nil
    step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}")) { auth = checker('alice', PW) }
    step(%(When a request with the Basic credentials of "alice" and "#{PW}" is authenticated three times)) do
      n = verify_calls { 3.times { assert_equal :returned, authenticate(auth, basic('alice', PW))[0] } }
    end
    step('Then Password.verify was called once') { assert_equal 1, n }
  end

  scenario 'A password that is close to a remembered one is checked again' do
    auth = r = nil
    step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}")) { auth = checker('alice', PW) }
    step(%(And the credentials of "alice" and "#{PW}" were accepted)) do
      assert_equal :returned, authenticate(auth, basic('alice', PW))[0]
    end
    step('When a request with the Basic credentials of "alice" and "correct horse batterY" is authenticated') do
      r, = authenticate(auth, basic('alice', 'correct horse batterY'))
    end
    step('Then it raises WEBrick::HTTPStatus::Unauthorized') { assert_kind_of WEBrick::HTTPStatus::Unauthorized, r }
  end

  scenario 'A password that is not ASCII gets in, as UTF-8' do
    pw = 'ただしいうまでんちほっちきすね'
    auth = r = nil
    step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{pw}")) { auth = checker('alice', pw) }
    step(%(When a request with the Basic credentials of "alice" and "#{pw}" is authenticated)) do
      r, = authenticate(auth, basic('alice', pw))
    end
    step('Then it returns') { assert_equal :returned, r }
  end

  [
    ['Digest of "alice"', 'Digest username="alice", realm="lcty-rb", nonce="x", uri="/", response="y"'],
    ['Basic and Base64 without a colon', "Basic #{['alice'].pack('m0')}"],
    ['Basic and bytes that are not UTF-8', "Basic #{["alice:\xff\xfe".b].pack('m0')}"],
    ['Basic and no Base64', 'Basic ****']
  ].each do |name, header|
    scenario "An Authorization header that is not Basic credentials is answered with the challenge (#{name})" do
      auth = r = nil
      step(%(Given Chatty::BasicAuth with the user "alice" and the password "#{PW}")) { auth = checker('alice', PW) }
      step("When a request with the Authorization header #{name} is authenticated") { r, = authenticate(auth, header) }
      step('Then it raises WEBrick::HTTPStatus::Unauthorized') { assert_kind_of WEBrick::HTTPStatus::Unauthorized, r }
      step('And nothing is logged') { assert_empty @log.string }
    end
  end
end
