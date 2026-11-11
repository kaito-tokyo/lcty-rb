# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Basic authentication of every request (LCTYSP-0010): the users are those of --basic-auth (Chatty.basic_users), each
# with a hash of lib/password.rb. The password travels as it is, so HTTPS (a reverse proxy) is what protects it on the
# way; this only decides who gets in.
#
# A hash takes about 0.2 s to check, and a browser sends the credentials with every request. So a user and password
# that were accepted are remembered, as an HMAC with a key made at startup (not the password itself, and not a hash
# that is quick to guess at); the others are checked again each time, one at a time, so that guessing costs one core at
# most, and answered after a delay. An unknown user is checked against a hash of its own, so the time does not tell
# which users there are.

require 'openssl'
require 'webrick'
require_relative 'password'

module Chatty
  class BasicAuth
    REALM = 'lcty-rb'
    # How many accepted users and passwords are remembered; past it they are forgotten and checked again
    REMEMBERED = 256

    attr_reader :realm

    # users {user => PHC string}; logger gets a line for every refused user (never the password); fail_delay is the
    # seconds a refusal waits
    def initialize(users, logger:, fail_delay: 1.0)
      @users = users
      @logger = logger
      @fail_delay = fail_delay
      @realm = REALM
      @key = OpenSSL::Random.random_bytes(32)
      @accepted = {}
      @lock = Mutex.new # the remembered ones
      @check = Mutex.new # one hash checked at a time
      @nobody = Password.create(OpenSSL::Random.random_bytes(24).unpack1('H*'))
    end

    # Returns when req carries the credentials of a user; otherwise answers 401 with the challenge (raising
    # WEBrick::HTTPStatus::Unauthorized, which WEBrick turns into the response). Called by WEBrick's RequestCallback,
    # before any servlet, the WebSocket of /v1/rpc included.
    def authenticate(req, res)
      user, password = credentials(req['authorization'])
      return if user && accepted?(user, password)

      if user
        @logger.error("Basic #{@realm}: #{user.inspect}: refused (an unknown user or a wrong password)")
        sleep @fail_delay
      end
      # RFC 7617: the browser is to send the user and password in UTF-8
      res['WWW-Authenticate'] = %(Basic realm="#{@realm}", charset="UTF-8")
      raise WEBrick::HTTPStatus::Unauthorized
    end

    private

    # [user, password] of an Authorization header of Basic, or nil when there is none or it is not one
    def credentials(header)
      m = /\ABasic +([A-Za-z0-9+\/]+=*) *\z/i.match(header.to_s) or return nil
      pair = m[1].unpack1('m').force_encoding('UTF-8')
      return nil unless pair.valid_encoding? && pair.include?(':')

      pair.split(':', 2)
    end

    def accepted?(user, password)
      # The length of the user first, so that no other user and password make the same bytes
      mark = OpenSSL::HMAC.digest('SHA256', @key, "#{user.bytesize}:#{user}#{password}")
      return true if @lock.synchronize { @accepted[mark] }

      hash = @users[user]
      ok = @check.synchronize { Password.verify(password, hash || @nobody) } && hash
      return false unless ok

      @lock.synchronize do
        @accepted.clear if @accepted.size >= REMEMBERED
        @accepted[mark] = true
      end
    end
  end
end
