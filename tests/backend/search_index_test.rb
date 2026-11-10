# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3004: the scenarios of docs/specs/LCTYSP-3004_search-index.feature, written by hand. Each test has the title of
# its Scenario and one step per line of it, so the two read side by side. Every test opens its own index in a temporary
# directory.

require_relative 'helper'
require 'digest'
require 'search_index'

class SearchIndexTest < Lcty::Scenarios
  SearchIndex = Chatty::SearchIndex

  def setup
    @dir = Dir.mktmpdir('lcty-search-index-')
    @indexes = []
  end

  def teardown
    @indexes.each { |i| i.db.close unless i.db.closed? }
    FileUtils.rm_rf(@dir)
  end

  def path
    File.join(@dir, '_index.sqlite')
  end

  def new_index
    i = SearchIndex.new(path)
    @indexes << i
    i
  end

  # The two messages of a round: the user message `id` and its reply
  def round(id, user, reply, at = nil)
    [{ 'role' => 'user', 'id' => id, 'content' => user, 'at' => at },
     { 'role' => 'assistant', 'id' => "#{id}-r", 'content' => reply, 'at' => at }]
  end

  def ids_of(results)
    results.map { |r| r['id'] }
  end

  scenario 'A user message and the reply that follows make a round' do
    messages = rounds = nil
    step('Given a user message "u1" with "Hello" at "2026-01-01T00:00:00Z" and a reply "Hi there" at "2026-01-01T00:00:05Z"') do
      messages = [{ 'role' => 'user', 'id' => 'u1', 'content' => 'Hello', 'at' => '2026-01-01T00:00:00Z' },
                  { 'role' => 'assistant', 'content' => 'Hi there', 'at' => '2026-01-01T00:00:05Z' }]
    end
    step('When SearchIndex.rounds_for derives the rounds of the conversation "c1"') do
      rounds = SearchIndex.rounds_for('c1', messages)
    end
    step('Then there is one round whose id is "u1" and whose conversation is "c1"') do
      assert_equal 1, rounds.size
      assert_equal 'u1', rounds[0]['msg_id']
      assert_equal 'c1', rounds[0]['conv_id']
    end
    step('And its one part is "Hello", a blank line and "Hi there"') { assert_equal ["Hello\n\nHi there"], rounds[0]['parts'] }
    step('And it is at the time of the reply') { assert_equal '2026-01-01T00:00:05Z', rounds[0]['at'] }
    step('And its rev is the first 16 hex digits of the SHA-256 of its text') do
      assert_equal Digest::SHA256.hexdigest("Hello\n\nHi there")[0, 16], rounds[0]['rev']
    end
  end

  scenario 'Rounds that are inherited, without an id or without a finished reply are left out' do
    messages = rounds = nil
    step('Given an inherited user message with a reply, a user message without an id with a reply, and a user message followed by another user message') do
      messages = [{ 'role' => 'user', 'id' => 'i1', 'content' => 'inherited', 'inherited' => true },
                  { 'role' => 'assistant', 'content' => 'a1', 'inherited' => true },
                  { 'role' => 'user', 'content' => 'no id' },
                  { 'role' => 'assistant', 'content' => 'a2' },
                  { 'role' => 'user', 'id' => 'u3', 'content' => 'followed by a user message' }]
    end
    step('And a last user message without a reply') do
      messages << { 'role' => 'user', 'id' => 'u4', 'content' => 'no reply yet' }
    end
    step('When SearchIndex.rounds_for derives the rounds') { rounds = SearchIndex.rounds_for('c1', messages) }
    step('Then there are none') { assert_equal [], rounds }
  end

  scenario 'A round without a time on its reply takes the time of the user message' do
    messages = rounds = nil
    step('Given a user message at "2026-01-01T00:00:00Z" and a reply without a time') do
      messages = [{ 'role' => 'user', 'id' => 'u1', 'content' => 'q', 'at' => '2026-01-01T00:00:00Z' },
                  { 'role' => 'assistant', 'content' => 'a' }]
    end
    step('When SearchIndex.rounds_for derives the rounds') { rounds = SearchIndex.rounds_for('c1', messages) }
    step('Then the round is at "2026-01-01T00:00:00Z"') { assert_equal '2026-01-01T00:00:00Z', rounds[0]['at'] }
  end

  scenario 'A round with empty content has only the other message\'s text' do
    messages = rounds = nil
    step('Given a user message with empty content and a reply "only the reply"') do
      messages = round('u1', '', 'only the reply')
    end
    step('When SearchIndex.rounds_for derives the rounds') { rounds = SearchIndex.rounds_for('c1', messages) }
    step('Then the round\'s text is "only the reply"') { assert_equal ['only the reply'], rounds[0]['parts'] }
  end

  scenario 'A round longer than 6000 characters is split into parts' do
    messages = rounds = nil
    step('Given a user message of 4000 characters and a reply of 4000 characters') do
      messages = round('u1', 'a' * 4000, 'b' * 4000)
    end
    step('When SearchIndex.rounds_for derives the rounds') { rounds = SearchIndex.rounds_for('c1', messages) }
    step('Then the round has two parts, of 6000 and 2002 characters, that join into its text') do
      parts = rounds[0]['parts']
      assert_equal [6000, 2002], parts.map(&:length)
      assert_equal "#{'a' * 4000}\n\n#{'b' * 4000}", parts.join
    end
  end

  scenario 'The rev of a round changes when its text changes' do
    before = after = nil
    step('When SearchIndex.rounds_for derives a round, and again after the reply was changed') do
      before = SearchIndex.rounds_for('c1', round('u1', 'q', 'first answer'))[0]['rev']
      after = SearchIndex.rounds_for('c1', round('u1', 'q', 'second answer'))[0]['rev']
    end
    step('Then the two revs differ') do
      assert_match(/\A[0-9a-f]{16}\z/, before)
      refute_equal before, after
    end
  end

  scenario 'Normalizing applies NFKC and lowercases' do
    step('Then SearchIndex.normalize turns "ＷＥＢｒｉｃｋ" into "webrick"') do
      assert_equal 'webrick', SearchIndex.normalize('ＷＥＢｒｉｃｋ')
    end
    step('And it turns nil into ""') { assert_equal '', SearchIndex.normalize(nil) }
  end

  scenario 'A synced round is found by a keyword' do
    index = nil
    step('Given a new index') { index = new_index }
    step('When a conversation with a round about "WEBrick servers" is synced') do
      index.sync('c1', round('u1', 'Tell me about WEBrick servers', 'They are threaded'))
    end
    step('Then a keyword search for "webrick" finds that round with its conversation and its text as the snippet') do
      assert_equal [{ 'id' => 'u1', 'conv_id' => 'c1', 'snippet' => 'Tell me about WEBrick servers They are threaded' }],
                   index.keyword_search('webrick')
    end
  end

  scenario 'Keyword search ignores width and case' do
    index = nil
    step('Given a new index with a round whose reply is "ＷＥＢｒｉｃｋ is a server"') do
      index = new_index
      index.sync('c1', round('u1', 'What is it?', 'ＷＥＢｒｉｃｋ is a server'))
    end
    step('Then a keyword search for "WEBRICK" finds it') { assert_equal ['u1'], ids_of(index.keyword_search('WEBRICK')) }
  end

  scenario 'A two-character term such as 京都 is required in the text' do
    index = nil
    step('Given a new index with a round about 京都 and a round about 東京') do
      index = new_index
      index.sync('c1', round('kyoto', '京都に行きたい', '京都はいいですね') + round('tokyo', '東京に行きたい', '東京は大きい'))
    end
    step('Then a keyword search for "京都" finds only the round about 京都') do
      assert_equal ['kyoto'], ids_of(index.keyword_search('京都'))
    end
    step('And a keyword search for "都" finds only the round about 京都') do
      assert_equal ['kyoto'], ids_of(index.keyword_search('都'))
    end
  end

  scenario 'Rounds found by short terms alone are newest first' do
    index = nil
    step('Given a new index with three rounds that mention 京都, at three different times') do
      index = new_index
      index.sync('c1', round('mid', '京都 2', 'ok', '2026-01-02T00:00:00Z') +
                       round('old', '京都 1', 'ok', '2026-01-01T00:00:00Z') +
                       round('new', '京都 3', 'ok', '2026-01-03T00:00:00Z'))
    end
    step('Then a keyword search for "京都" finds them newest first') do
      assert_equal %w[new mid old], ids_of(index.keyword_search('京都'))
    end
  end

  scenario 'A short term next to a long one filters the rounds the long one finds' do
    index = nil
    step('Given a new index with a round about temples in 京都 and a round about temples in 奈良') do
      index = new_index
      index.sync('c1', round('kyoto', 'temples in 京都', 'many') + round('nara', 'temples in 奈良', 'many'))
    end
    step('Then a keyword search for "temple 奈良" finds only the round about 奈良') do
      assert_equal ['nara'], ids_of(index.keyword_search('temple 奈良'))
    end
  end

  scenario 'Percent signs and underscores in a short term are matched literally' do
    index = nil
    step('Given a new index with a round that says "50% off" and a round that says "500 off"') do
      index = new_index
      index.sync('c1', round('pct', 'sale', '50% off') + round('num', 'sale', '500 off'))
    end
    step('Then a keyword search for "%" finds only the round that says "50% off"') do
      assert_equal ['pct'], ids_of(index.keyword_search('%'))
    end
    step('And a keyword search for "_" finds nothing') { assert_equal [], index.keyword_search('_') }
  end

  scenario 'The round with more of the query ranks first' do
    index = nil
    step('Given a new index with a round about "search" and a round about "search engines"') do
      index = new_index
      index.sync('c1', round('plain', 'how do I search', 'like this') + round('engine', 'how do search engines work', 'well'))
    end
    step('Then a keyword search for "search engine" finds the round about "search engines" first') do
      assert_equal %w[engine plain], ids_of(index.keyword_search('search engine'))
    end
  end

  scenario 'An empty query finds nothing' do
    index = nil
    step('Given a new index with a round') do
      index = new_index
      index.sync('c1', round('u1', 'something', 'else'))
    end
    step('Then a keyword search for "" finds nothing') { assert_equal [], index.keyword_search('') }
    step('And a keyword search for spaces finds nothing') { assert_equal [], index.keyword_search("  \t ") }
  end

  scenario 'Keyword search keeps to the allowed conversations and the limit' do
    index = nil
    step('Given a new index with rounds about "pancakes" in the conversations "c1", "c2" and "c3"') do
      index = new_index
      %w[c1 c2 c3].each { |c| index.sync(c, round("#{c}-u", "pancakes for #{c}", 'yum')) }
    end
    step('Then a keyword search for "pancakes" allowed only "c2" finds only the round of "c2"') do
      assert_equal [{ 'id' => 'c2-u', 'conv_id' => 'c2', 'snippet' => 'pancakes for c2 yum' }],
                   index.keyword_search('pancakes', allowed: ['c2'])
    end
    step('And a keyword search for "pancakes" allowed no conversations finds nothing') do
      assert_equal [], index.keyword_search('pancakes', allowed: [])
    end
    step('And a keyword search for "pancakes" with the limit 2 finds two rounds') do
      assert_equal 2, index.keyword_search('pancakes', limit: 2).size
    end
  end

  scenario 'A round split into parts is found once' do
    index = nil
    step('Given a new index with a round of two parts that both mention "zebra"') do
      index = new_index
      index.sync('c1', round('u1', "zebra #{'a' * 6500}", 'zebra'))
    end
    step('Then a keyword search for "zebra" finds the round once') do
      assert_equal ['u1'], ids_of(index.keyword_search('zebra'))
    end
  end

  scenario 'The limit counts rounds, not their parts' do
    index = nil
    step('Given a new index with a round of two parts that both mention "zebra" three times, and two rounds that mention it once') do
      index = new_index
      index.sync('c1', round('u1', "zebra zebra zebra #{'a' * 6500}", 'zebra zebra zebra'))
      %w[c2 c3].each { |c| index.sync(c, round("u-#{c}", "zebra #{'b' * 6500}", 'no')) }
    end
    step('Then a keyword search for "zebra" with the limit 2 finds two rounds, the first of them first') do
      found = ids_of(index.keyword_search('zebra', limit: 2))
      assert_equal 2, found.uniq.size, found.inspect
      assert_equal 'u1', found.first
    end
  end

  scenario 'A snippet stays on the term when normalizing changes the length of the text before it' do
    index = result = nil
    text = "#{'㍿' * 100} needle #{'y' * 200}"
    step('Given a new index with a round of 100 "㍿", the word "needle" and 200 "y"') do
      index = new_index
      index.sync('c1', round('u1', text, ''))
    end
    step('When a keyword search for "needle" finds it') do
      result = index.keyword_search('needle')
      assert_equal ['u1'], ids_of(result)
    end
    step('Then the snippet is "…" and the 140 characters that start 46 characters before "needle"') do
      start = text.index('needle') - 46
      assert_equal "…#{text[start, 140]}", result[0]['snippet']
    end
  end

  scenario 'A snippet starts shortly before the first matching term' do
    index = result = nil
    text = "#{'x' * 200} needle #{'y' * 200}"
    step('Given a new index with a round of 200 "x", the word "needle" and 200 "y"') do
      index = new_index
      index.sync('c1', round('u1', text, ''))
    end
    step('When a keyword search for "needle" finds it') do
      result = index.keyword_search('needle')
      assert_equal ['u1'], ids_of(result)
    end
    step('Then the snippet is "…" and the 140 characters that start 46 characters before "needle"') do
      start = text.index('needle') - 46
      assert_equal "…#{text[start, 140]}", result[0]['snippet']
    end
  end

  scenario 'Snippets are given for known rounds and left out for unknown ones' do
    index = result = nil
    step('Given a new index with a synced round "u1" in the conversation "c1"') do
      index = new_index
      index.sync('c1', round('u1', 'Hello', 'world'))
    end
    step('When snippets are asked for "u1" and an unknown id with the query "Hello"') do
      result = index.snippets(%w[u1 unknown], 'Hello')
    end
    step('Then only "u1" has a snippet, with its conversation "c1"') do
      assert_equal({ 'u1' => { 'conv_id' => 'c1', 'snippet' => 'Hello world' } }, result)
    end
  end

  scenario 'Syncing again with the same messages changes nothing' do
    index = messages = nil
    calls = 0
    step('Given a new index with a listener and a synced conversation') do
      index = new_index
      messages = round('u1', 'q', 'a')
      index.sync('c1', messages)
      index.on_change { calls += 1 }
    end
    step('When the conversation is synced again with the same messages') { index.sync('c1', messages) }
    step('Then the listener is not called') { assert_equal 0, calls }
  end

  scenario 'Syncing a changed round replaces it and calls the listener' do
    index = nil
    calls = 0
    step('Given a new index with a listener and a synced round about "apricots"') do
      index = new_index
      index.sync('c1', round('u1', 'fruit', 'apricots'))
      index.on_change { calls += 1 }
    end
    step('When the round\'s reply is changed to be about "blueberries" and the conversation is synced') do
      index.sync('c1', round('u1', 'fruit', 'blueberries'))
    end
    step('Then the listener is called once') { assert_equal 1, calls }
    step('And a keyword search for "apricots" finds nothing') { assert_equal [], index.keyword_search('apricots') }
    step('And a keyword search for "blueberries" finds the round') do
      assert_equal ['u1'], ids_of(index.keyword_search('blueberries'))
    end
  end

  scenario 'Syncing without a round deletes it' do
    index = first = nil
    calls = 0
    step('Given a new index with a listener and a synced conversation of two rounds') do
      index = new_index
      first = round('u1', 'lemon one', 'ok')
      index.sync('c1', first + round('u2', 'lemon two', 'ok'))
      index.on_change { calls += 1 }
    end
    step('When the conversation is synced with only its first round') { index.sync('c1', first) }
    step('Then the listener is called once') { assert_equal 1, calls }
    step('And a keyword search finds only the first round') { assert_equal ['u1'], ids_of(index.keyword_search('lemon')) }
  end

  scenario 'A message id already indexed for another conversation is skipped' do
    index = nil
    err = ''
    step('Given a new index with a round "u1" synced for the conversation "c1"') do
      index = new_index
      index.sync('c1', round('u1', 'original walnut', 'ok'))
    end
    step('When a copy of that round is synced for the conversation "c2"') do
      _, err = capture_io { index.sync('c2', round('u1', 'copied walnut', 'ok')) }
    end
    step('Then a warning names the message and both conversations') do
      assert_includes err, 'skip message u1 of c2: already indexed for c1'
    end
    step('And the round still belongs to "c1"') do
      assert_equal [{ 'id' => 'u1', 'conv_id' => 'c1', 'snippet' => 'original walnut ok' }], index.keyword_search('walnut')
    end
  end

  scenario 'Sync records the tags' do
    index = messages = nil
    calls = 0
    step('Given a new index with a listener') do
      index = new_index
      index.on_change { calls += 1 }
    end
    step('When a conversation of three messages, one inherited, is synced with the tags "b" and "a"') do
      messages = [{ 'role' => 'system', 'content' => 'inherited', 'inherited' => true }] + round('u1', 'q', 'a')
      index.sync('c1', messages, %w[b a])
    end
    step('Then convs_with_tags finds it for "b" and for "a"') do
      assert_equal [%w[c1], %w[c1]], [index.convs_with_tags(%w[b]), index.convs_with_tags(%w[a])]
    end
    step('When it is synced again with only the tag "c"') { index.sync('c1', messages, ['c']) }
    step('Then convs_with_tags finds it for "c" and no longer for "b"') do
      assert_equal [%w[c1], []], [index.convs_with_tags(%w[c]), index.convs_with_tags(%w[b])]
    end
    step('And the listener was called only for the first sync, which added a round') { assert_equal 1, calls }
  end

  scenario 'Conversations with all the given tags are found' do
    index = nil
    step('Given a new index with the conversation "c1" tagged "a" and "b" and the conversation "c2" tagged "a"') do
      index = new_index
      index.sync('c1', [], %w[a b])
      index.sync('c2', [], %w[a])
    end
    step('Then convs_with_tags finds "c1" and "c2" for "a"') { assert_equal %w[c1 c2], index.convs_with_tags(%w[a]).sort }
    step('And it finds only "c1" for "a" and "b"') { assert_equal %w[c1], index.convs_with_tags(%w[a b]) }
    step('And it finds only "c1" for "a", "a" and "b"') { assert_equal %w[c1], index.convs_with_tags(%w[a a b]) }
    step('And it finds nothing for "a" and "z"') { assert_equal [], index.convs_with_tags(%w[a z]) }
    step('And it finds nothing for no tags') { assert_equal [], index.convs_with_tags([]) }
  end

  scenario 'A full sync drops conversations that no longer exist and calls the listener' do
    index = c1 = nil
    calls = 0
    step('Given a new index with a listener and the synced conversations "c1" and "c2", both tagged') do
      index = new_index
      c1 = round('u1', 'mango one', 'ok')
      index.sync('c1', c1, ['x'])
      index.sync('c2', round('u2', 'mango two', 'ok'), ['y'])
      index.on_change { calls += 1 }
    end
    step('When a full sync is given only "c1", without tags') { index.full_sync('c1' => [c1, nil]) }
    step('Then the round of "c2" is not found') { assert_equal ['u1'], ids_of(index.keyword_search('mango')) }
    step('And convs_with_tags finds nothing for the tag of "c2"') { assert_equal [], index.convs_with_tags(%w[y]) }
    step('And nothing for the tag "c1" had before') { assert_equal [], index.convs_with_tags(%w[x]) }
    step('And the listener is called') { assert_equal 1, calls }
  end

  scenario 'Removing a deleted conversation leaves nothing of it' do
    index = nil
    calls = 0
    step('Given a new index with a listener and the synced conversations "c1" and "c2", both tagged') do
      index = new_index
      index.sync('c1', round('u1', 'mango one', 'ok'), ['x'])
      index.sync('c2', round('u2', 'mango two', 'ok'), ['y'])
      index.on_change { calls += 1 }
    end
    step('When "c2" is removed') { index.remove('c2') }
    step('Then the round of "c2" is not found') { assert_equal ['u1'], ids_of(index.keyword_search('mango')) }
    step('And convs_with_tags finds "c1" for its tag and nothing for the tag of "c2"') do
      assert_equal [%w[c1], []], [index.convs_with_tags(%w[x]), index.convs_with_tags(%w[y])]
    end
    step('And the listener is called once') { assert_equal 1, calls }
    step('And removing "c2" again, or the never indexed "c9", leaves "c1" as it is without calling the listener') do
      index.remove('c2')
      index.remove('c9')
      assert_equal %w[c1], index.convs_with_tags(%w[x])
      assert_equal ['u1'], ids_of(index.keyword_search('mango'))
      assert_equal 1, calls
    end
  end

  scenario 'An index is kept when it is opened again' do
    index = nil
    step('Given an index with a synced round about "persimmons"') do
      first = new_index
      first.sync('c1', round('u1', 'persimmons', 'ok'))
      first.db.close
    end
    step('When the file is opened again') { index = new_index }
    step('Then a keyword search for "persimmons" finds the round') do
      assert_equal ['u1'], ids_of(index.keyword_search('persimmons'))
    end
  end

  scenario 'An index is discarded, with its WAL, and opened anew empty, as at every start' do
    index = nil
    step('Given an index with a synced round about "medlars" and a cached count, closed') do
      first = new_index
      first.sync('c1', round('u1', 'medlars', 'ok'))
      first.put_record_count('rpc-1', 3)
      first.db.close
    end
    step('When SearchIndex.discard is called on its file') { SearchIndex.discard(path) }
    step('Then the file, its -wal and its -shm are gone') do
      assert_equal [false] * 3, [path, "#{path}-wal", "#{path}-shm"].map { |f| File.exist?(f) }
    end
    step('When it is opened again') { index = new_index }
    step('Then a keyword search for "medlars" finds nothing, and the count of "rpc-1" is unknown') do
      assert_equal [], ids_of(index.keyword_search('medlars'))
      assert_nil index.record_count('rpc-1')
    end
    step('And it has no table vectors and no schema version') do
      assert_nil index.db.get_first_value("SELECT 1 FROM sqlite_master WHERE name = 'vectors'")
      assert_equal 0, index.db.get_first_value('PRAGMA user_version')
    end
  end
end
