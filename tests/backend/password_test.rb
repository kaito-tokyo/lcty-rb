# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3024: the scenarios of docs/specs/LCTYSP-3024_password.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.

require_relative 'helper'
require 'password'
require 'open3'
require 'rbconfig'
require 'stringio'

class PasswordTest < Lcty::Scenarios
  Password = Chatty::Password
  PW = 'correct horse battery'
  SYNTAX = 'not a password hash ($pbkdf2-sha256$i=<iterations>$<salt>$<hash>)'

  # Base64 without padding, as in a PHC string (used where the scenarios are defined)
  def self.b64(bytes)
    [bytes].pack('m0').delete('=')
  end

  scenario "PBKDF2 derives the bytes of RFC 7914's test vector" do
    bytes = nil
    step('When Password.derive is given the password "passwd", the salt "salt" and 1 iteration') do
      bytes = Password.derive('passwd', 'salt', 1)
    end
    step('Then the bytes are 55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc') do
      assert_equal '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc', bytes.unpack1('H*')
    end
  end

  scenario 'A hash is a PHC string of PBKDF2-SHA256' do
    phc = nil
    step(%(When Password.create hashes "#{PW}")) { phc = Password.create(PW) }
    step('Then it is "$pbkdf2-sha256$i=600000$" and two parts in Base64 without padding') do
      assert_match(%r{\A\$pbkdf2-sha256\$i=600000\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+\z}, phc)
    end
    step('And the salt is 16 bytes and the hash 32 bytes') do
      _, salt, hash = Password.parse(phc)
      assert_equal [16, 32], [salt.bytesize, hash.bytesize]
    end
  end

  scenario 'A hash accepts its password and no other' do
    phc = nil
    step(%(Given the hash of "#{PW}")) { phc = Password.create(PW) }
    step(%(Then Password.verify accepts "#{PW}")) { assert Password.verify(PW, phc) }
    step('And it refuses "correct horse batterY" and ""') do
      refute Password.verify('correct horse batterY', phc)
      refute Password.verify('', phc)
    end
  end

  scenario 'Two hashes of one password differ by their salt' do
    a = b = nil
    step(%(When Password.create hashes "#{PW}" twice)) { a, b = Array.new(2) { Password.create(PW) } }
    step('Then the two hashes differ') { refute_equal a, b }
    step('And each accepts the password') { assert(Password.verify(PW, a) && Password.verify(PW, b)) }
  end

  scenario 'A hash made with other iterations is checked with its own' do
    phc = nil
    step(%(Given the hash of "#{PW}" made with 1000 iterations)) { phc = Password.create(PW, iterations: 1000) }
    step('Then it starts with "$pbkdf2-sha256$i=1000$"') { assert phc.start_with?('$pbkdf2-sha256$i=1000$'), phc }
    step(%(And Password.verify accepts "#{PW}")) { assert Password.verify(PW, phc) }
  end

  [
    ['14 characters', 'a' * 14, 'the password is shorter than 15 characters'],
    ['1025 bytes', 'a' * 1025, 'the password is longer than 1024 bytes'],
    ['bytes that are not UTF-8', "\xff".b * 20, 'the password is not UTF-8']
  ].each do |name, password, message|
    scenario "A new password that cannot be used is refused (#{name})" do
      e = nil
      step("When Password.create is given #{name}") { e = assert_raises(Password::Error) { Password.create(password) } }
      step(%(Then it raises Password::Error "#{message}")) { assert_equal message, e.message }
    end
  end

  scenario 'Fifteen characters are enough, whatever their bytes' do
    pw = phc = nil
    step('When Password.create is given 15 characters of 3 bytes each') do
      pw = 'あ' * 15
      phc = Password.create(pw, iterations: 1000)
    end
    step('Then it returns a hash that accepts them') { assert Password.verify(pw, phc) }
  end

  salt = b64('s' * 16)
  hash = b64('h' * 32)
  [
    ['a hash of another algorithm', "$pbkdf2-sha512$i=1000$#{salt}$#{hash}", SYNTAX],
    ['a hash without iterations', "$pbkdf2-sha256$#{salt}$#{hash}", SYNTAX],
    ['a hash whose salt is 8 bytes', "$pbkdf2-sha256$i=1000$#{b64('s' * 8)}$#{hash}", 'the salt is shorter than 16 bytes'],
    ['a hash of 16 bytes', "$pbkdf2-sha256$i=1000$#{salt}$#{b64('h' * 16)}", 'the hash is not 32 bytes']
  ].each do |name, string, message|
    scenario "A string that is not a hash of PBKDF2-SHA256 is refused (#{name})" do
      e = nil
      step("When Password.verify is given #{name}") do
        e = assert_raises(Password::Error) { Password.verify(PW, string) }
      end
      step(%(Then it raises Password::Error "#{message}")) { assert_equal message, e.message }
    end
  end

  scenario 'The option of a user is --basic-auth with the user and the hash' do
    option = nil
    step(%(When Password.option is given the user "alice" and the password "#{PW}")) do
      option = Password.option('alice', PW)
    end
    step('Then it starts with "--basic-auth=alice:$pbkdf2-sha256$i=600000$"') do
      assert option.start_with?('--basic-auth=alice:$pbkdf2-sha256$i=600000$'), option
    end
    step('And the hash after "alice:" accepts the password') do
      assert Password.verify(PW, option.delete_prefix('--basic-auth=alice:'))
    end
  end

  ['', 'al:ice', 'al ice', "al\tice"].each do |user|
    scenario "A user name that cannot be one of Basic credentials is refused (#{user.inspect})" do
      e = nil
      step("When Password.option is given the user #{user.inspect}") do
        e = assert_raises(Password::Error) { Password.option(user, PW) }
      end
      step('Then it raises Password::Error that names the user') { assert_includes e.message, user.inspect }
    end
  end

  # ---- tools/hash_password.rb ----

  TOOL = File.expand_path('../../tools/hash_password.rb', __dir__)

  # tools/hash_password.rb run in a new process with args and input: [out, err, status]
  def run_tool(*args, input: '')
    Open3.capture3(RbConfig.ruby, TOOL, *args, stdin_data: input)
  end

  # A terminal that is typed lines; echoed is whether a line was read with echo
  class Terminal
    attr_reader :echoed

    def initialize(*lines)
      @lines = lines.map { |l| "#{l}\n" }
      @echoed = false
      @quiet = false
    end

    def tty?
      true
    end

    def gets
      @echoed ||= !@quiet
      @lines.shift
    end

    def noecho
      @quiet = true
      yield self
    ensure
      @quiet = false
    end
  end

  scenario 'tools/hash_password.rb prints the option of the user for the password piped in' do
    out = status = nil
    step(%(When tools/hash_password.rb is run with "alice" and the input "#{PW}")) do
      out, _, status = run_tool('alice', input: "#{PW}\n")
    end
    step('Then it exits with the status 0 and prints one line "--basic-auth=alice:" and a hash') do
      assert_equal 0, status.exitstatus
      assert_match(/\A--basic-auth=alice:\$pbkdf2-sha256\$i=600000\$\S+\n\z/, out)
    end
    step(%(And the hash accepts "#{PW}")) { assert Password.verify(PW, out.chomp.delete_prefix('--basic-auth=alice:')) }
  end

  scenario 'tools/hash_password.rb refuses a password that cannot be used' do
    out = err = status = nil
    step('When tools/hash_password.rb is run with "alice" and the input "too short"') do
      out, err, status = run_tool('alice', input: "too short\n")
    end
    step('Then it exits with the status 1, prints nothing and says "hash_password: the password is shorter than 15 characters"') do
      assert_equal 1, status.exitstatus
      assert_empty out
      assert_equal "hash_password: the password is shorter than 15 characters\n", err
    end
  end

  scenario 'tools/hash_password.rb without one user prints its usage' do
    err = status = nil
    step('When tools/hash_password.rb is run with no argument') { _, err, status = run_tool }
    step('Then it exits with the status 1 and prints "usage: tools/hash_password.rb USER"') do
      assert_equal 1, status.exitstatus
      assert_equal "usage: tools/hash_password.rb USER\n", err
    end
  end

  scenario 'On a terminal the password is asked twice, without echo' do
    term = out = err = r = nil
    step(%(Given a terminal typed "#{PW}" twice)) { term = Terminal.new(PW, PW) }
    step('When Password.ask_option runs for "alice" on it') do
      out = StringIO.new
      err = StringIO.new
      r = Password.ask_option('alice', input: term, out: out, err: err)
    end
    step('Then it asks "Password: " and "Again: ", reading neither with echo') do
      assert_equal "Password: \nAgain: \n", err.string
      refute term.echoed
    end
    step('And it returns true and prints the option of "alice"') do
      assert r
      assert out.string.start_with?('--basic-auth=alice:$pbkdf2-sha256$'), out.string
    end
  end

  scenario 'On a terminal two passwords that differ print nothing' do
    term = out = err = r = nil
    step(%(Given a terminal typed "#{PW}" and "correct horse batterY")) do
      term = Terminal.new(PW, 'correct horse batterY')
    end
    step('When Password.ask_option runs for "alice" on it') do
      out = StringIO.new
      err = StringIO.new
      r = Password.ask_option('alice', input: term, out: out, err: err)
    end
    step('Then it returns false, prints nothing and says "hash_password: the two passwords differ"') do
      refute r
      assert_empty out.string
      assert err.string.end_with?("hash_password: the two passwords differ\n"), err.string
    end
  end
end
