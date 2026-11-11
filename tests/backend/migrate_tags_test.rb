# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3026: the scenarios of docs/specs/LCTYSP-3026_migrate-tags.feature, written by hand. Each test has the title of
# its Scenario and one step per line of it, the Background first, so the two read side by side.
#
# Every test migrates into a directory of its own: the shared data directory of the other tests is never touched.

require_relative 'helper'
require 'stringio'
require 'json'
require 'sqlite3'
require 'tag_files'
require 'tag_store'
require 'migrate_tags'
require 'open3'
require 'rbconfig'

class MigrateTagsTest < Lcty::Scenarios
  MigrateTags = Chatty::MigrateTags
  AT = '2026-11-01T09:00:00+09:00'

  def teardown
    FileUtils.rm_rf(@dir) if @dir
  end

  def background
    step('Given an old tags.sqlite of format 2, an empty t/ and a TagStore of the test\'s own') do
      @dir = Dir.mktmpdir('lcty-migrate-tags-')
      @old = File.join(@dir, 'tags.sqlite')
      @tag_dir = File.join(@dir, 't')
      @tag_files = Chatty::TagFiles.new(@tag_dir, File.join(@dir, 't.lock'))
      @tag_store = Chatty::TagStore.new(File.join(@dir, 'lcty_t.sqlite'))
    end
  end

  # An old tags.sqlite of format 2 at path, with tags [{name, prompt, memory: [[id, text, at, conv, msg]]}] and
  # conversation_tags {cid => [names]}
  def old_db(path, tags, conversations = {})
    db = SQLite3::Database.new(path)
    db.execute_batch(<<~SQL)
      CREATE TABLE tags (name TEXT PRIMARY KEY, prompt TEXT, position INTEGER NOT NULL);
      CREATE TABLE memory (id TEXT PRIMARY KEY, tag TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE ON DELETE CASCADE,
        text TEXT NOT NULL, at TEXT NOT NULL, source_conv TEXT, source_msg TEXT);
      CREATE INDEX memory_tag ON memory(tag, at);
      CREATE TABLE conversation_tags (conv_id TEXT PRIMARY KEY, tags TEXT NOT NULL, at TEXT NOT NULL);
      PRAGMA user_version = 2;
    SQL
    tags.each_with_index do |t, i|
      db.execute('INSERT INTO tags (name, prompt, position) VALUES (?, ?, ?)', [t[:name], t[:prompt], i])
      (t[:memory] || []).each { |m| db.execute('INSERT INTO memory VALUES (?, ?, ?, ?, ?, ?)', [m[0], t[:name], *m[1..-1]]) }
    end
    conversations.each { |cid, names| db.execute('INSERT INTO conversation_tags VALUES (?, ?, ?)', [cid, JSON.generate(names), AT]) }
    db.close
  end

  def migrate(tags)
    old_db(@old, tags)
    out = StringIO.new
    [MigrateTags.migrate(MigrateTags.read_former(@old), @tag_files, out: out), out.string]
  end

  def files
    Dir.children(@tag_dir).select { |n| Chatty::TagFiles::LISTED_RE.match?(n) }.sort
  end

  def tag(file)
    @tag_files.parse(file, File.read(File.join(@tag_dir, file), mode: 'r:UTF-8'))
  end

  # A tag file written as the tag editor writes it
  def tag_file(file, name, prompt = '')
    File.write(File.join(@tag_dir, file),
               @tag_files.build('file' => file, 'name' => name, 'ops' => [], 'prompt' => prompt, 'memory' => []))
  end

  scenario 'Each old tag becomes a tag file with its prompt and memory' do
    background
    step('Given the old tags "Ruby" with the prompt "be brief" and two memory items, one with a source, and "C#" with none') do
      @tags = [{ name: 'Ruby', prompt: 'be brief',
                 memory: [['mem-000000000001', 'likes blocks', AT, 'conv-a', 'msg-b'],
                          ['mem-000000000002', 'uses 2.6', '2026-11-02T09:00:00+09:00', nil, nil]] },
               { name: 'C#', prompt: nil }]
    end
    step('When MigrateTags.migrate runs') { @result, = migrate(@tags) }
    step('Then t/ has 00010-ruby.html named "Ruby" and 00020-c~23.html named "C#"') do
      assert_equal %w[00010-ruby.html 00020-c~23.html], files
      assert_equal 'Ruby', tag('00010-ruby.html')['name']
      assert_equal 'C#', tag('00020-c~23.html')['name']
      assert_equal %w[Ruby C#], @result[:migrated]
    end
    step('And the first has the prompt "be brief" and the two memory items with their ids, times and source') do
      t = tag('00010-ruby.html')
      assert_equal 'be brief', t['prompt']
      assert_equal [{ 'id' => 'mem-000000000001', 'text' => 'likes blocks', 'at' => AT,
                      'source' => { 'conv_id' => 'conv-a', 'msg_id' => 'msg-b' } },
                    { 'id' => 'mem-000000000002', 'text' => 'uses 2.6', 'at' => '2026-11-02T09:00:00+09:00' }], t['memory']
    end
  end

  scenario 'The part is derived as the browser derives it' do
    background
    names = nil
    step('Given the names "Ruby", "C#", "ΟΔΟΣ" and "Ａ(b)"') { names = ['Ruby', 'C#', 'ΟΔΟΣ', 'Ａ(b)'] }
    step('When MigrateTags.part derives their parts') { @parts = names.map { |n| MigrateTags.part(n) } }
    step('Then they are "ruby", "c~23", "οδοσ" and "ａ~28b~29"') do
      assert_equal ['ruby', 'c~23', 'οδοσ', 'ａ~28b~29'], @parts
    end
  end

  scenario 'New tags are numbered after the tag files there are' do
    background
    before = nil
    step('Given t/ has 00040-go.html') do
      tag_file('00040-go.html', 'Go')
      before = File.read(File.join(@tag_dir, '00040-go.html'))
    end
    step('When MigrateTags.migrate runs with the old tag "Ruby"') { migrate([{ name: 'Ruby' }]) }
    step('Then t/ has 00040-go.html as it was and 00050-ruby.html') do
      assert_equal %w[00040-go.html 00050-ruby.html], files
      assert_equal before, File.read(File.join(@tag_dir, '00040-go.html'))
    end
  end

  scenario 'A tag whose part has a tag file is left as it is' do
    background
    step('Given t/ has 00010-ruby.html with the prompt "new"') { tag_file('00010-ruby.html', 'Ruby', 'new') }
    step('When MigrateTags.migrate runs with the old tag "Ruby" with the prompt "old"') do
      @result, = migrate([{ name: 'Ruby', prompt: 'old' }])
    end
    step('Then "Ruby" is reported as present, and 00010-ruby.html still has the prompt "new"') do
      assert_equal ['Ruby'], @result[:present]
      assert_equal({ 'Ruby' => 'ruby' }, @result[:refs])
      assert_equal %w[00010-ruby.html], files
      assert_equal 'new', tag('00010-ruby.html')['prompt']
    end
  end

  scenario 'Running it again migrates nothing twice' do
    background
    step('Given the old tags "Ruby" and "Go" migrated once') { migrate([{ name: 'Ruby' }, { name: 'Go' }]) }
    step('When MigrateTags.migrate runs again') do
      @result = MigrateTags.migrate(MigrateTags.read_former(@old), @tag_files, out: StringIO.new)
    end
    step('Then both are reported as present and t/ has the same two files') do
      assert_equal({ migrated: [], present: %w[Ruby Go], failed: [], refs: { 'Ruby' => 'ruby', 'Go' => 'go' } }, @result)
      assert_equal %w[00010-ruby.html 00020-go.html], files
    end
  end

  scenario 'A name the tag editor refuses is reported and the others are migrated' do
    background
    out = nil
    step('Given the old tags "a/b" and "Go"') { @tags = [{ name: 'a/b' }, { name: 'Go' }] }
    step('When MigrateTags.migrate runs') { @result, out = migrate(@tags) }
    step('Then "a/b" is reported as failed because of its characters, and t/ has 00010-go.html only') do
      assert_equal ['a/b'], @result[:failed].map(&:first)
      assert_match(%r{could not migrate "a/b": the name must not contain}, out)
      assert_equal %w[00010-go.html], files
    end
  end

  scenario 'Two names with the same part migrate the first only' do
    background
    step('Given the old tags "Ruby" and "ruby"') { @tags = [{ name: 'Ruby' }, { name: 'ruby' }] }
    step('When MigrateTags.migrate runs') { @result, = migrate(@tags) }
    step('Then "Ruby" is migrated and "ruby" is reported as failed') do
      assert_equal ['Ruby'], @result[:migrated]
      assert_equal [['ruby', 'it has the same file name as "Ruby"']], @result[:failed]
      assert_equal %w[00010-ruby.html], files
    end
  end

  scenario 'An empty memory item is dropped and an id a tag file cannot hold is replaced' do
    background
    step('Given the old tag "Ruby" with a memory item of blank text and one whose id is "a b"') do
      @tags = [{ name: 'Ruby', memory: [['mem-1', '  ', AT, nil, nil], ['a b', 'kept', AT, nil, nil]] }]
    end
    step('When MigrateTags.migrate runs') { migrate(@tags) }
    step('Then 00010-ruby.html has one memory item, with a new id') do
      memory = tag('00010-ruby.html')['memory']
      assert_equal ['kept'], memory.map { |m| m['text'] }
      refute_equal 'a b', memory.first['id']
      assert_match Chatty::TagFiles::MEMORY_ID_RE, memory.first['id']
    end
  end

  scenario 'The references of conversations become the parts' do
    background
    changed = nil
    step('Given conversations tagged "Ruby" and "x", and "ruby" and "Ruby"') do
      @tag_store.set_conversation_tags('conv-a', %w[Ruby x])
      @tag_store.set_conversation_tags('conv-b', %w[ruby Ruby])
    end
    step('When MigrateTags.convert_refs runs with "Ruby" migrated to "ruby"') do
      changed = MigrateTags.convert_refs(@tag_store, 'Ruby' => 'ruby')
    end
    step('Then the first has the tags "ruby" and "x" and the second "ruby"') do
      assert_equal 2, changed
      assert_equal %w[ruby x], @tag_store.conversation_tags('conv-a')
      assert_equal %w[ruby], @tag_store.conversation_tags('conv-b')
    end
  end

  scenario 'TagFiles#add_all writes nothing when a part has a tag file' do
    background
    error = nil
    step('Given t/ has 00010-ruby.html') { tag_file('00010-ruby.html', 'Ruby') }
    step('When TagFiles#add_all is given 00020-go.html and 00030-ruby.html') do
      new = %w[00020-go.html 00030-ruby.html].map { |f| { 'file' => f, 'name' => f[6...-5], 'prompt' => '' } }
      error = assert_raises(Chatty::HttpError) { @tag_files.add_all('tags' => new) }
    end
    step('Then it raises 409 and t/ has 00010-ruby.html only') do
      assert_equal 409, error.status
      assert_equal %w[00010-ruby.html], files
    end
  end

  scenario 'A file of format 3 or later has nothing to migrate' do
    background
    path = nil
    step('Given a tags.sqlite of format 3') do
      path = File.join(@dir, 'format3.sqlite')
      db = SQLite3::Database.new(path)
      db.execute_batch('CREATE TABLE conversation_tags (conv_id TEXT PRIMARY KEY, tags TEXT NOT NULL, at TEXT NOT NULL); ' \
                       'PRAGMA user_version = 3;')
      db.close
    end
    step('When MigrateTags.read_former reads it') { @read = MigrateTags.read_former(path) }
    step('Then it returns nil') { assert_nil @read }
  end

  TOOL = File.expand_path('../../tools/migrate_tags.rb', __dir__)

  # tools/migrate_tags.rb run in a new process with args, the data directory `dir`: [out, err, status]
  def run_tool(dir, *args)
    env = { 'LCTY_DATA_DIR' => dir, 'LCTY_BIND_IP' => nil, 'LCTY_BASE_URL' => nil, 'LCTY_ALLOWED_ORIGIN' => nil,
            'LCTY_BASIC_AUTH' => nil }
    Open3.capture3(env, RbConfig.ruby, TOOL, *args)
  end

  scenario 'tools/migrate_tags.rb migrates the tags of the data directory of LCTY_DATA_DIR' do
    background
    data = err = status = nil
    step('Given tags.sqlite of format 2 in the data directory with the tag "Ruby", and a conversation tagged "Ruby"') do
      data = File.join(@dir, 'data')
      FileUtils.mkdir_p(data)
      old_db(File.join(data, 'tags.sqlite'), [{ name: 'Ruby', prompt: 'p' }], 'conv-a' => ['Ruby'])
    end
    step('When tools/migrate_tags.rb is run with LCTY_DATA_DIR the directory of the test') { _, err, status = run_tool(data) }
    step('Then it exits with the status 0 and prints "migrate_tags: 1 migrated, 0 present already, 0 failed"') do
      assert_equal 0, status.exitstatus, err
      assert_match(/migrate_tags: 1 migrated, 0 present already, 0 failed; the tags of 1 conversations/, err)
    end
    step('And t/ has 00010-ruby.html and the conversation has the tag "ruby" in lcty_t.sqlite') do
      assert File.file?(File.join(data, 't', '00010-ruby.html'))
      refute File.exist?(File.join(data, 'tags.sqlite'))
      assert_equal %w[ruby], Chatty::TagStore.new(File.join(data, 'lcty_t.sqlite')).conversation_tags('conv-a')
    end
  end

  scenario 'tools/migrate_tags.rb refuses a file whose tables were dropped' do
    background
    data = err = status = nil
    step('Given lcty_t.sqlite of format 4 in the data directory') do
      data = File.join(@dir, 'data')
      FileUtils.mkdir_p(data)
      Chatty::TagStore.new(File.join(data, 'lcty_t.sqlite'))
    end
    step('When tools/migrate_tags.rb is run with LCTY_DATA_DIR the directory of the test') { _, err, status = run_tool(data) }
    step('Then it exits with the status 1 and prints that it holds no tag definitions') do
      assert_equal 1, status.exitstatus
      assert_match(/holds no tag definitions/, err)
    end
  end
end
