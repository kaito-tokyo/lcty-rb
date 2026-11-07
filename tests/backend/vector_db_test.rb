# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3007: the scenarios of docs/specs/LCTYSP-3007_vector-db.feature, written by hand. Each test has the title of
# its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
#
# Every test has a search index and a data directory of its own in a temporary folder (not Lcty.open_data).

require_relative 'helper'
require 'securerandom'
require 'search_index'
require 'v1/vector_db'

class VectorDBTest < Lcty::Scenarios
  VectorDB = Chatty::V1::VectorDB
  VectorRecords = Chatty::V1::VectorRecords
  Uuid = Chatty::Uuid
  ROW = 1056
  LONG_USER = 'a' * 3500
  LONG_REPLY = 'b' * 3498 # "a…a\n\nb…b" is 7,000 characters

  def setup
    @dir = Dir.mktmpdir('lcty-vector-db-')
    @indexes = []
    @index = open_index
    @vdb = VectorDB.new(@index, @dir)
  end

  def teardown
    @indexes.each do |index|
      begin
        index.db.close
      rescue StandardError
        nil
      end
    end
    FileUtils.rm_rf(@dir)
  end

  def open_index
    index = Chatty::SearchIndex.new(File.join(@dir, '_index.sqlite'))
    @indexes << index
    index
  end

  def at(hhmm)
    "2026-01-01T#{hhmm}:00Z"
  end

  def messages(id, user, reply, time)
    [{ 'role' => 'user', 'id' => id, 'content' => user, 'at' => time },
     { 'role' => 'assistant', 'content' => reply, 'at' => time }]
  end

  # A round (a user message and its reply) as a conversation of its own: {'id', 'rev', 'conv', 'at'}
  def add_round(hhmm = '10:00', user: "question #{SecureRandom.hex(4)}", reply: 'answer', index: @index)
    round = { 'id' => Uuid.v7, 'conv' => "conv-#{SecureRandom.hex(4)}", 'at' => at(hhmm) }
    change_round(round, user: user, reply: reply, index: index)
  end

  # Rewrite the round's text (an edit, an undo …) and update its rev
  def change_round(round, user:, reply: 'answer', index: @index)
    msgs = messages(round['id'], user, reply, round['at'])
    index.sync(round['conv'], msgs)
    round['user'] = user
    round['rev'] = Chatty::SearchIndex.rounds_for(round['conv'], msgs).first['rev']
    round
  end

  def delete_round(round, index: @index)
    index.sync(round['conv'], [])
  end

  # A 768-dimension unit vector (Float32 LE), different for each seed
  def unit(seed = 1)
    v = Array.new(768) { |i| Math.sin(seed * 1000 + i) }
    n = Math.sqrt(v.inject(0.0) { |s, x| s + x * x })
    v.map { |x| x / n }.pack('e*')
  end

  def body(pairs)
    pairs.map { |id, vec| VectorRecords.pack(id, vec) }.join
  end

  # Register one vector per part of the round
  def put_round(round, vecs = [unit], model: 'm', vdb: @vdb)
    vdb.put(model, { round['id'] => round['rev'] }, body(vecs.map { |v| [round['id'], v] }))
  end

  def pending_ids(model = 'm')
    @vdb.pending(model, 16).map { |r| r['id'] }
  end

  # The distributed row of a 768-dimension vector stored as it is: its first 256 dims renormalized, then 32 zero bytes
  def row_of(vec)
    v = vec.unpack('e256')
    n = Math.sqrt(v.inject(0.0) { |s, x| s + x * x })
    v.map { |x| x / n }.pack('e*') + ("\0" * 32).b
  end

  def dat_path
    File.join(@dir, '_vectors.eg2_264.dat')
  end

  def idx_path
    File.join(@dir, '_vectors.eg2_264.idx')
  end

  def dat
    File.binread(dat_path)
  end

  def idx_ids
    File.binread(idx_path).scan(/.{16}/m).map { |b| Uuid.from_bytes(b) }
  end

  # Read the vector DB file of the model with a connection of its own
  def vector_file(model)
    db = SQLite3::Database.new(File.join(@dir, "_vectors.#{model}.sqlite"))
    yield db
  ensure
    db.close if db
  end

  def stored(model, id)
    vector_file(model) { |db| db.execute('SELECT vec FROM vectors WHERE msg_id = ? ORDER BY part', [id]).map(&:first) }
  end

  def stored_ids(model)
    vector_file(model) { |db| db.execute('SELECT DISTINCT msg_id FROM vectors ORDER BY msg_id').map(&:first) }
  end

  def vector_db_files
    Dir.glob(File.join(@dir, '_vectors.*.sqlite'))
  end

  # The error the block raises (nil when it raises none)
  def error_of
    yield
    nil
  rescue StandardError => e
    e
  end

  def assert_http_error(status, message, error)
    assert_kind_of Chatty::HttpError, error
    assert_equal status, error.status
    assert_equal message, error.message
  end

  # ---- pending ----

  scenario 'Rounds without vectors are pending, newest first' do
    rounds = list = nil
    step('Given three rounds answered at 10:00, 12:00 and 11:00') { rounds = %w[10:00 12:00 11:00].map { |t| add_round(t) } }
    step('When VectorDB#pending lists the rounds of the model "m" up to 16') { list = @vdb.pending('m', 16) }
    step('Then it returns the three rounds, the one of 12:00 first and the one of 10:00 last') do
      assert_equal [rounds[1], rounds[2], rounds[0]].map { |r| r['id'] }, list.map { |r| r['id'] }
    end
    step('And each has its id, its rev and its text as the only part') do
      [rounds[1], rounds[2], rounds[0]].zip(list).each do |round, item|
        assert_equal({ 'id' => round['id'], 'rev' => round['rev'], 'parts' => ["#{round['user']}\n\nanswer"] }, item)
      end
    end
  end

  scenario 'Pending lists at most the limit' do
    rounds = list = nil
    step('Given three rounds answered at 10:00, 11:00 and 12:00') { rounds = %w[10:00 11:00 12:00].map { |t| add_round(t) } }
    step('When VectorDB#pending lists the rounds of the model "m" up to 2') { list = @vdb.pending('m', 2) }
    step('Then it returns the rounds of 12:00 and 11:00') do
      assert_equal [rounds[2]['id'], rounds[1]['id']], list.map { |r| r['id'] }
    end
  end

  scenario 'A long round is pending with all its parts' do
    round = list = nil
    step('Given a round of 7,000 characters') { round = add_round(user: LONG_USER, reply: LONG_REPLY) }
    step('When VectorDB#pending lists the rounds of the model "m" up to 16') { list = @vdb.pending('m', 16) }
    step('Then the round has two parts, of 6,000 and 1,000 characters, in order') do
      assert_equal [round['id']], list.map { |r| r['id'] }
      parts = list[0]['parts']
      assert_equal [6000, 1000], parts.map(&:length)
      assert_equal "#{LONG_USER}\n\n#{LONG_REPLY}", parts.join
    end
  end

  # ---- put ----

  scenario 'Registered vectors are no longer pending' do
    rounds = result = nil
    step('Given two rounds without vectors') { rounds = [add_round('10:00'), add_round('11:00')] }
    step('When VectorDB#put registers a vector for the first round with its rev for the model "m"') do
      result = put_round(rounds[0])
    end
    step('Then it returns 1 accepted and no stale ids') { assert_equal({ 'accepted' => 1, 'stale' => [] }, result) }
    step('And only the second round is pending for the model "m"') { assert_equal [rounds[1]['id']], pending_ids }
  end

  scenario 'Vectors are kept per embedding model' do
    round = nil
    step('Given a round with a vector registered for the model "a"') do
      round = add_round
      put_round(round, model: 'a')
    end
    step('Then the round is not pending for the model "a"') { assert_equal [], pending_ids('a') }
    step('But it is pending for the model "b"') { assert_equal [round['id']], pending_ids('b') }
    step('And the data directory has the files _vectors.a.sqlite and _vectors.b.sqlite') do
      assert_equal %w[_vectors.a.sqlite _vectors.b.sqlite], vector_db_files.map { |f| File.basename(f) }.sort
    end
  end

  scenario 'More models than SQLite can attach at once are all served' do
    round = nil
    pendings = {}
    step('Given a round with a vector registered for the model "m0"') do
      round = add_round
      put_round(round, model: 'm0')
    end
    step('When the round\'s pending state is asked for the models "m1" to "m11"') do
      (1..11).each { |i| pendings["m#{i}"] = pending_ids("m#{i}") }
    end
    step('Then it is pending for each of them') do
      (1..11).each { |i| assert_equal [round['id']], pendings["m#{i}"], "m#{i}" }
    end
    step('And the round is still not pending for the model "m0"') { assert_equal [], pending_ids('m0') }
  end

  scenario "Put drops an id whose rev is not the current one" do
    round = result = nil
    step('Given a round without vectors') { round = add_round }
    step('When VectorDB#put registers a vector for it with the rev "0000000000000000"') do
      result = @vdb.put('m', { round['id'] => '0000000000000000' }, body([[round['id'], unit]]))
    end
    step("Then it returns 0 accepted and the round's id as stale") do
      assert_equal({ 'accepted' => 0, 'stale' => [round['id']] }, result)
    end
    step('And the round is still pending') { assert_equal [round['id']], pending_ids }
  end

  scenario 'Put drops an id whose part count does not match' do
    round = result = nil
    step('Given a round of 7,000 characters, which has two parts') { round = add_round(user: LONG_USER, reply: LONG_REPLY) }
    step('When VectorDB#put registers one vector for it with its rev') { result = put_round(round, [unit]) }
    step("Then it returns 0 accepted and the round's id as stale") do
      assert_equal({ 'accepted' => 0, 'stale' => [round['id']] }, result)
    end
    step('And the round is still pending') { assert_equal [round['id']], pending_ids }
  end

  scenario 'Put drops an id that is not a round' do
    id = result = nil
    step('Given an id that no round has') { id = Uuid.v7 }
    step('When VectorDB#put registers a vector for it with a rev') do
      result = @vdb.put('m', { id => '0123456789abcdef' }, body([[id, unit]]))
    end
    step('Then it returns 0 accepted and that id as stale') { assert_equal({ 'accepted' => 0, 'stale' => [id] }, result) }
  end

  scenario 'Put accepts some ids and drops others in one body' do
    rounds = result = nil
    step('Given two rounds without vectors') { rounds = [add_round('10:00'), add_round('11:00')] }
    step('When VectorDB#put registers a vector for each, the second with a wrong rev') do
      revs = { rounds[0]['id'] => rounds[0]['rev'], rounds[1]['id'] => 'ffffffffffffffff' }
      result = @vdb.put('m', revs, body([[rounds[0]['id'], unit(1)], [rounds[1]['id'], unit(2)]]))
    end
    step("Then it returns 1 accepted and the second round's id as stale") do
      assert_equal({ 'accepted' => 1, 'stale' => [rounds[1]['id']] }, result)
    end
    step('And only the second round is pending') { assert_equal [rounds[1]['id']], pending_ids }
  end

  scenario 'Put replaces every vector of an id' do
    round = nil
    step('Given a round of two parts with the vectors A and B registered') do
      round = add_round(user: LONG_USER, reply: LONG_REPLY)
      assert_equal 1, put_round(round, [unit(1), unit(2)])['accepted']
    end
    step('When VectorDB#put registers the vectors C and D for it') do
      assert_equal 1, put_round(round, [unit(3), unit(4)])['accepted']
    end
    step('Then the exported rows are those of C and D, in that order') do
      @vdb.export('m')
      assert_equal row_of(unit(3)) + row_of(unit(4)), dat
      assert_equal [round['id'], round['id']], idx_ids
    end
  end

  scenario 'Put without a rev for an id of the body is a 400' do
    round = error = nil
    step('Given a round without vectors') { round = add_round }
    step('When VectorDB#put registers a vector for it without its rev') do
      error = error_of { @vdb.put('m', {}, body([[round['id'], unit]])) }
    end
    step('Then it raises an HttpError 400 saying "rev is missing for <the id>"') do
      assert_http_error(400, "rev is missing for #{round['id']}", error)
    end
    step('And the round is still pending') { assert_equal [round['id']], pending_ids }
  end

  scenario 'Put of a body that is not whole records is a 400' do
    error = nil
    step('When VectorDB#put registers 100 bytes') { error = error_of { @vdb.put('m', {}, ("\0" * 100).b) } }
    step('Then it raises an HttpError 400 saying "length 100 is not a multiple of 3104"') do
      assert_http_error(400, 'length 100 is not a multiple of 3104', error)
    end
  end

  {
    'zeros' => Array.new(768, 0.0),
    'ones and one NaN' => Array.new(768, 1.0).tap { |v| v[5] = Float::NAN },
    'ones and one infinity' => Array.new(768, 1.0).tap { |v| v[5] = Float::INFINITY }
  }.each do |values, floats|
    scenario "Put rejects a vector that cannot be normalized (#{values})" do
      round = error = nil
      step('Given a round without vectors') { round = add_round }
      step("When VectorDB#put registers for it a vector of #{values}") do
        error = error_of { put_round(round, [floats.pack('e*')]) }
      end
      step('Then it raises an HttpError 400 saying "vector must be finite and non-zero"') do
        assert_http_error(400, 'vector must be finite and non-zero', error)
      end
      step('And the round is still pending') { assert_equal [round['id']], pending_ids }
    end
  end

  scenario 'Put rejects a vector whose first 256 dimensions are all zero' do
    round = other = error = nil
    step('Given a round without vectors') { round = add_round('10:00') }
    step('And another round without vectors') { other = add_round('11:00') }
    step('When VectorDB#put registers in one body a good vector for the other round and, for the round, a vector of 256 zeros and then ones') do
      head_zero = (Array.new(256, 0.0) + Array.new(512, 1.0)).pack('e*')
      error = error_of do
        @vdb.put('m', { other['id'] => other['rev'], round['id'] => round['rev'] },
                 body([[other['id'], unit], [round['id'], head_zero]]))
      end
    end
    step('Then it raises an HttpError 400 saying "the first 256 dimensions of a vector must not all be zero"') do
      assert_http_error(400, 'the first 256 dimensions of a vector must not all be zero', error)
    end
    step('And both rounds are still pending') { assert_equal [other['id'], round['id']], pending_ids }
  end

  {
    '"../m"' => '../m',
    '"a b"' => 'a b',
    '""' => '',
    '"m" repeated 81 times' => 'm' * 81
  }.each do |label, model|
    scenario "An invalid model name is a 400 (#{label})" do
      error = nil
      step("When VectorDB#pending lists the rounds of the model #{label}") { error = error_of { @vdb.pending(model, 16) } }
      step("Then it raises an HttpError 400 saying \"invalid model name: #{label}\"") do
        assert_http_error(400, "invalid model name: #{model.inspect}", error)
      end
      step('And no vector DB file is made') do
        assert_equal [], vector_db_files
        assert_equal [], Dir.glob(File.join(File.dirname(@dir), '_vectors.m.sqlite*')) if model == '../m'
      end
    end
  end

  scenario 'Vectors are stored L2-normalized' do
    round = nil
    step('Given a round without vectors') { round = add_round }
    step('When VectorDB#put registers for it a unit vector multiplied by 3') do
      put_round(round, [unit.unpack('e*').map { |x| x * 3 }.pack('e*')])
    end
    step('Then the stored 768-dimension vector has the length 1 and the direction of the unit vector') do
      vecs = stored('m', round['id'])
      assert_equal 1, vecs.size
      v = vecs[0].unpack('e*')
      assert_equal 768, v.size
      assert_in_delta 1.0, Math.sqrt(v.inject(0.0) { |s, x| s + x * x }), 1e-5
      v.zip(unit.unpack('e*')).each { |x, y| assert_in_delta y, x, 1e-6 }
    end
  end

  scenario 'A unit vector is stored as it was sent' do
    round = nil
    step('Given a round without vectors') { round = add_round }
    step('When VectorDB#put registers for it a unit vector') { put_round(round, [unit]) }
    step('Then the stored 768-dimension vector is the same bytes') { assert_equal [unit], stored('m', round['id']) }
  end

  scenario 'The distributed vector is the first 256 dimensions renormalized' do
    round = nil
    step('Given a round with a vector registered whose first 256 dimensions are 2 and the rest are 1') do
      round = add_round
      put_round(round, [(Array.new(256, 2.0) + Array.new(512, 1.0)).pack('e*')])
    end
    step('When VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then the row of the round is 256 values of 1/16') do
      assert_equal ROW, dat.bytesize
      dat[0, 1024].unpack('e*').each { |x| assert_in_delta 1.0 / 16, x, 1e-7 }
    end
    step('And it is followed by 32 zero bytes') { assert_equal ("\0" * 32).b, dat[1024, 32] }
  end

  # ---- export ----

  scenario 'Export writes the rows and the ids of the valid vectors' do
    short = long = paths = nil
    step('Given a round of 11:00 with one part and a round of 10:00 with two parts, all with vectors of the model "m"') do
      short = add_round('11:00')
      long = add_round('10:00', user: LONG_USER, reply: LONG_REPLY)
      put_round(short, [unit(1)])
      put_round(long, [unit(2), unit(3)])
    end
    step('When VectorDB#export writes the distribution files of the model "m"') { paths = @vdb.export('m') }
    step('Then it returns the paths _vectors.eg2_264.dat and _vectors.eg2_264.idx in the data directory') do
      assert_equal [dat_path, idx_path], paths
    end
    step('And the .dat file has 3 rows of 1,056 bytes and the .idx file 3 ids of 16 bytes') do
      assert_equal 3 * ROW, File.size(dat_path)
      assert_equal 3 * 16, File.size(idx_path)
    end
    step('And the rows are the two parts of the 10:00 round, then the 11:00 round') do
      assert_equal row_of(unit(2)) + row_of(unit(3)) + row_of(unit(1)), dat
      assert_equal [long['id'], long['id'], short['id']], idx_ids
    end
    step('And no temporary file is left') { assert_equal [], Dir.glob(File.join(@dir, '*.tmp-*')) }
  end

  scenario 'Export of a model without vectors writes empty files' do
    step('When VectorDB#export writes the distribution files of the model "empty"') { @vdb.export('empty') }
    step('Then both files are empty') { assert_equal [0, 0], [File.size(dat_path), File.size(idx_path)] }
  end

  scenario 'Export leaves out the vectors of a changed round' do
    rounds = nil
    step('Given two rounds with vectors of the model "m"') do
      rounds = [add_round('10:00'), add_round('11:00')]
      put_round(rounds[0], [unit(1)])
      put_round(rounds[1], [unit(2)])
    end
    step('When the text of the first round changes') { change_round(rounds[0], user: 'edited question') }
    step('And VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then only the second round has a row') do
      assert_equal row_of(unit(2)), dat
      assert_equal [rounds[1]['id']], idx_ids
    end
  end

  scenario 'Export reuses the files until the vectors change' do
    rounds = nil
    step('Given two rounds, the first with a vector of the model "m", and the exported files') do
      rounds = [add_round('10:00'), add_round('11:00')]
      put_round(rounds[0], [unit(1)])
      @vdb.export('m')
    end
    step('When the .dat file is overwritten with "x"') { File.binwrite(dat_path, 'x') }
    step('And VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then the .dat file is still "x"') { assert_equal 'x', dat }
    step('When VectorDB#put registers a vector for the second round') { put_round(rounds[1], [unit(2)]) }
    step('And VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then the .dat file has the rows of both rounds') do
      assert_equal row_of(unit(1)) + row_of(unit(2)), dat
      assert_equal rounds.map { |r| r['id'] }, idx_ids
    end
  end

  scenario 'Export rewrites the files when the rounds change' do
    round = nil
    step('Given a round with a vector of the model "m" and its exported files') do
      round = add_round
      put_round(round)
      @vdb.export('m')
    end
    step('When the .dat file is overwritten with "x"') { File.binwrite(dat_path, 'x') }
    step('And a new round is added to the search index') { add_round('12:00') }
    step('And VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then the .dat file has the row of the round again') do
      assert_equal row_of(unit), dat
      assert_equal [round['id']], idx_ids
    end
  end

  scenario 'Export rewrites the files for another model' do
    round = nil
    step('Given a round with a vector of the model "m" and its exported files') do
      round = add_round
      put_round(round)
      @vdb.export('m')
    end
    step('When VectorDB#export writes the distribution files of the model "other", which has no vectors') do
      @vdb.export('other')
    end
    step('Then both files are empty') { assert_equal [0, 0], [File.size(dat_path), File.size(idx_path)] }
    step('When VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then the .dat file has the row of the round again') do
      assert_equal row_of(unit), dat
      assert_equal [round['id']], idx_ids
    end
  end

  scenario 'Export rewrites the files when one is missing' do
    round = nil
    step('Given a round with a vector of the model "m" and its exported files') do
      round = add_round
      put_round(round)
      @vdb.export('m')
    end
    step('When the .idx file is deleted') { File.delete(idx_path) }
    step('And VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then both files are there with the row and the id of the round') do
      assert_equal row_of(unit), dat
      assert_equal [round['id']], idx_ids
    end
  end

  scenario 'Export removes the former distribution files' do
    former = nil
    step('Given the vector DB of the model "m" in the data directory') { @vdb.pending('m', 1) }
    step('And the files _vectors.m.256.rows, _vectors.m.256.ids and _vectors.m.256.bin beside it') do
      former = %w[rows ids bin].map { |ext| File.join(@dir, "_vectors.m.256.#{ext}") }
      former.each { |f| File.binwrite(f, 'old') }
    end
    step('When VectorDB#export writes the distribution files of the model "m"') { @vdb.export('m') }
    step('Then those three files are gone') { assert_equal [false] * 3, former.map { |f| File.exist?(f) } }
    step('And the vector DB _vectors.m.sqlite is kept') { assert File.exist?(File.join(@dir, '_vectors.m.sqlite')) }
  end

  # ---- garbage collection ----

  scenario 'The vectors of an undone change are reused' do
    round = original = nil
    step('Given a round with a vector of the model "m"') do
      round = add_round
      original = round['user']
      put_round(round)
    end
    step('When the text of the round changes') { change_round(round, user: 'edited question') }
    step('Then the round is pending again') { assert_equal [round['id']], pending_ids }
    step('When the text changes back') { change_round(round, user: original) }
    step('Then the round is not pending') { assert_equal [], pending_ids }
    step('And VectorDB#export writes its row') do
      @vdb.export('m')
      assert_equal row_of(unit), dat
    end
  end

  scenario 'Garbage collection deletes the vectors that match no current round' do
    rounds = n = err = nil
    step('Given three rounds with vectors of the model "m"') do
      rounds = %w[10:00 11:00 12:00].map { |t| add_round(t) }
      rounds.each_with_index { |r, i| put_round(r, [unit(i)]) }
    end
    step('When the text of the first round changes and the second round is deleted') do
      change_round(rounds[0], user: 'edited question')
      delete_round(rounds[1])
    end
    step('And VectorDB#gc collects the model "m"') { _, err = capture_io { n = @vdb.gc('m') } }
    step('Then it returns 2 and warns "gc: removed 2 stale vectors from _vectors.m.sqlite"') do
      assert_equal 2, n
      assert_equal "gc: removed 2 stale vectors from _vectors.m.sqlite\n", err
    end
    step('And only the vector of the third round is left in _vectors.m.sqlite') do
      assert_equal [rounds[2]['id']], stored_ids('m')
    end
  end

  scenario 'Garbage collection with nothing stale is quiet' do
    n = err = nil
    step('Given a round with a vector of the model "m"') { put_round(add_round) }
    step('When VectorDB#gc collects the model "m"') { _, err = capture_io { n = @vdb.gc('m') } }
    step('Then it returns 0 and warns nothing') do
      assert_equal 0, n
      assert_equal '', err
    end
  end

  {
    '"../m"' => '../m',
    'nil' => nil
  }.each do |label, model|
    scenario "Garbage collection of an invalid model name does nothing (#{label})" do
      n = nil
      step("When VectorDB#gc collects the model #{label}") { n = @vdb.gc(model) }
      step('Then it returns 0') { assert_equal 0, n }
      step('And no vector DB file is made') { assert_equal [], vector_db_files }
    end
  end

  scenario 'Garbage collection at startup collects every vector DB of the directory' do
    rounds = index = vdb = nil
    step('Given two rounds with vectors of the models "a" and "b"') do
      rounds = [add_round('10:00'), add_round('11:00')]
      %w[a b].each { |model| rounds.each_with_index { |r, i| put_round(r, [unit(i)], model: model) } }
    end
    step('And a new search index and VectorDB opened on the same files, as at the next start') do
      index = open_index
      vdb = VectorDB.new(index, @dir)
    end
    step('When the first round is deleted') { delete_round(rounds[0], index: index) }
    step('And VectorDB#gc_all collects the data directory') { capture_io { vdb.gc_all } }
    step('Then _vectors.a.sqlite and _vectors.b.sqlite keep only the vectors of the second round') do
      assert_equal [rounds[1]['id']], stored_ids('a')
      assert_equal [rounds[1]['id']], stored_ids('b')
    end
  end

  scenario 'A vector DB of another schema version is rebuilt' do
    round = result = nil
    step('Given a file _vectors.m.sqlite whose user_version is 0 and whose vectors table has other columns') do
      vector_file('m') do |db|
        db.execute('CREATE TABLE vectors (msg_id TEXT, old BLOB)')
        db.execute("INSERT INTO vectors VALUES ('x', x'00')")
      end
    end
    step('And a round without vectors') { round = add_round }
    step('When VectorDB#pending lists the rounds of the model "m" up to 16') { result = @vdb.pending('m', 16) }
    step('Then the round is pending') { assert_equal [round['id']], result.map { |r| r['id'] } }
    step('When VectorDB#put registers a vector for it with its rev') { result = put_round(round) }
    step('Then it returns 1 accepted and no stale ids') { assert_equal({ 'accepted' => 1, 'stale' => [] }, result) }
    step("And the file's user_version is 1") do
      assert_equal 1, vector_file('m') { |db| db.get_first_value('PRAGMA user_version') }
      assert_equal [round['id']], stored_ids('m')
    end
  end
end
