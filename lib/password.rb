# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# The password hashes of Basic authentication (LCTYSP-0010): PBKDF2-HMAC-SHA256 with OWASP's 600,000 iterations, a
# random salt of 16 bytes and the 32 bytes of SHA-256, written as a PHC string,
#
#   $pbkdf2-sha256$i=600000$<salt>$<hash>
#
# (salt and hash in Base64 without padding), so that a hash made with other parameters is still checked with its own.
# It needs only the OpenSSL of Ruby, which macOS's Ruby and the Linux images have alike. `lcty.rb hash-password` makes
# the line of a user for the settings, and lib/basic_auth.rb checks the requests with them.

require 'openssl'

module Chatty
  module Password
    module_function

    ALGORITHM = 'pbkdf2-sha256'
    ITERATIONS = 600_000
    SALT_BYTES = 16
    HASH_BYTES = 32
    # NIST SP 800-63B-4: at least 15 characters for a password used on its own, at least 64 allowed. The upper bound in
    # bytes keeps a request from making the server hash a megabyte
    MIN_CHARS = 15
    MAX_BYTES = 1024
    # A user name of the Basic credentials: no ":" (it ends the name there) and nothing invisible
    USER_RE = /\A[^:\p{Space}\p{Cntrl}]+\z/.freeze
    PHC_RE = %r{\A\$#{ALGORITHM}\$i=([1-9][0-9]{0,8})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)\z}.freeze

    class Error < StandardError; end

    # What is wrong with password as a new one, or nil
    def problem(password)
      return 'the password is not UTF-8' unless password.dup.force_encoding('UTF-8').valid_encoding?
      return "the password is shorter than #{MIN_CHARS} characters" if password.dup.force_encoding('UTF-8').size < MIN_CHARS
      return "the password is longer than #{MAX_BYTES} bytes" if password.bytesize > MAX_BYTES

      nil
    end

    # The PHC string of password, with a new salt unless one is given (the tests). Not named hash, which every object
    # has already
    def create(password, salt: OpenSSL::Random.random_bytes(SALT_BYTES), iterations: ITERATIONS)
      raise Error, problem(password) if problem(password)

      "$#{ALGORITHM}$i=#{iterations}$#{b64(salt)}$#{b64(derive(password, salt, iterations))}"
    end

    # Whether password is the one of phc (a PHC string of hash). Raises Error when phc is not one
    def verify(password, phc)
      iterations, salt, expected = parse(phc)
      return false if password.bytesize > MAX_BYTES

      secure_compare(derive(password, salt, iterations), expected)
    end

    # [iterations, salt, hash] of a PHC string; raises Error when it is not one of ALGORITHM
    def parse(phc)
      m = PHC_RE.match(phc) or raise Error, "not a password hash ($#{ALGORITHM}$i=<iterations>$<salt>$<hash>)"
      salt = m[2].unpack1('m')
      hash = m[3].unpack1('m')
      raise Error, "the salt is shorter than #{SALT_BYTES} bytes" if salt.bytesize < SALT_BYTES
      raise Error, "the hash is not #{HASH_BYTES} bytes" if hash.bytesize != HASH_BYTES

      [Integer(m[1]), salt, hash]
    end

    # The option of the settings for user with password
    def option(user, password)
      raise Error, "the user name #{user.inspect} is empty or has \":\", a space or a control character" unless
        USER_RE.match?(user)

      "--basic-auth=#{user}:#{create(password)}"
    end

    def derive(password, salt, iterations)
      OpenSSL::KDF.pbkdf2_hmac(password, salt: salt, iterations: iterations, length: HASH_BYTES, hash: 'sha256')
    end

    def b64(bytes)
      [bytes].pack('m0').delete('=')
    end

    # Compares every byte, so the time does not tell how much matched (Ruby 2.6's OpenSSL has no secure_compare)
    def secure_compare(a, b)
      return false unless a.bytesize == b.bytesize

      a.bytes.zip(b.bytes).reduce(0) { |acc, (x, y)| acc | (x ^ y) }.zero?
    end
  end
end
