# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3014: the scenarios of docs/specs/LCTYSP-3014_tag-files.feature, written by hand. Each test has the title of its
# Scenario (an Examples row is added in parentheses, by its first column) and one step per line of it, so the two read
# side by side. Every test has its own tag directory and lock file in a temporary directory.

require_relative 'helper'
require 'time'
require 'stringio'
require 'tag_files'

class TagFilesTest < Lcty::Scenarios
  TagFiles = Chatty::TagFiles
  HEADER = <<~HTML
    <!DOCTYPE html>
    <html lang="ja">
    <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="lcty.v1.js"></script>
    <script src="lcty.v1.lang-ja.js"></script>
    <link rel="stylesheet" href="lcty.v1.css" />
    </head>
  HTML

  def setup
    @root = Dir.mktmpdir('lcty-tag-files-')
  end

  def teardown
    FileUtils.rm_rf(@root)
  end

  def dir
    File.join(@root, 't')
  end

  def lock
    File.join(@root, 't.lock')
  end

  def new_files
    @files = TagFiles.new(dir, lock)
  end

  def tag(file, name = file[6...-5], extra = {})
    { 'file' => file, 'name' => name, 'ops' => [], 'prompt' => '', 'memory' => [] }.merge(extra)
  end

  def item(id, text, extra = {})
    { 'id' => id, 'text' => text, 'at' => '2026-11-08T00:00:00+09:00' }.merge(extra)
  end

  def tags
    @files.all[0]['tags']
  end

  def etag
    @files.all[1]
  end

  def replace(set)
    @files.replace_all({ 'tags' => set }, etag)
  end

  def with_tags(*set)
    new_files
    replace(set)
  end

  def read(name)
    File.read(File.join(dir, name), mode: 'r:UTF-8')
  end

  def write(name, body)
    File.write(File.join(dir, name), body)
  end

  def listed
    Dir.children(dir).map { |n| n.dup.force_encoding(Encoding::UTF_8) }.grep(/\A[0-9]{5}-.+\.html\z/).sort
  end

  def snapshot
    Dir.children(dir).sort.map { |n| [n, File.binread(File.join(dir, n))] }
  end

  def assert_http_error(status, message)
    e = assert_raises(Chatty::HttpError) { yield }
    assert_equal status, e.status
    assert_equal message, e.message
  end

  def assert_now(at, before, after)
    t = Time.iso8601(at)
    assert_operator t.to_i, :>=, before.to_i
    assert_operator t.to_i, :<=, after.to_i
  end

  scenario 'A new tag directory has no tags' do
    step('Given a new tag directory') { new_files }
    step('Then get-all lists no tags') { assert_equal [], tags }
    step('And its ETag is a quoted SHA-256') { assert_match(/\A"[0-9a-f]{64}"\z/, etag) }
    step('And the lock file t.lock exists') { assert File.file?(lock) }
  end

  scenario 'A tag is written in the tag file markup' do
    body = nil
    step('Given a new tag directory') { new_files }
    step('When replace-all writes the tag "C#" in "00010-c~23.html" with an add-memory policy, the prompt "# 指示" and a memory item with a source') do
      replace([tag('00010-c~23.html', 'C#',
                   'ops' => [{ 'type' => 'add-memory', 'content' => '一段落にまとめて' }], 'prompt' => '# 指示',
                   'memory' => [item('0190a', 'メモリ1', 'source' => { 'conv_id' => 'c1', 'msg_id' => 'm1' })])])
      body = read('00010-c~23.html')
    end
    step('Then t/00010-c~23.html is the header of a conversation file, <body>, then <lcty-t data-tag="C#">') do
      assert body.start_with?(HEADER + "<body>\n<lcty-t data-tag=\"C#\">\n"), body
    end
    step('And inside it come the <lcty-tagop>, the <lcty-system> and the <lcty-memory>, one per line, each with data-tag="C#"') do
      inner = body.lines[11..13]
      assert_equal '<lcty-tagop data-tag="C#" data-type="add-memory" data-content="一段落にまとめて"></lcty-tagop>', inner[0].chomp
      assert_equal '<lcty-system data-tag="C#" data-content="# 指示"></lcty-system>', inner[1].chomp
      assert inner[2].start_with?('<lcty-memory id="t-mem-0190a" data-tag="C#" '), inner[2]
    end
    step('And the <lcty-memory> has the id "t-mem-" and the item id, data-at, data-source-conv, data-source-msg and data-content') do
      assert_equal '<lcty-memory id="t-mem-0190a" data-tag="C#" data-at="2026-11-08T00:00:00+09:00" ' \
                   'data-source-conv="c1" data-source-msg="m1" data-content="メモリ1"></lcty-memory>', body.lines[13].chomp
    end
    step('And the file ends with </lcty-t>, </body> and </html>') do
      assert body.end_with?("</lcty-memory>\n</lcty-t>\n</body>\n</html>\n"), body
    end
  end

  scenario 'Tags are read back as they were written, in file-name order' do
    a = b = nil
    step('Given a new tag directory') { new_files }
    step('When replace-all writes "00020-b.html" and then "00010-a.html", each with a display name, an add-memory policy, a prompt and memory') do
      a = tag('00010-a.html', 'A', 'ops' => [{ 'type' => 'add-memory', 'content' => "覚えること\n二行目" }],
                                   'prompt' => "<p> & \"quotes\"\r\n\ttab", 'memory' => [item('m1', 'x & <y>'), item('m2', 'z')])
      b = tag('00020-b.html', 'Bé', 'ops' => [{ 'type' => 'add-memory', 'content' => 'b' }], 'prompt' => 'p',
                                    'memory' => [item('m3', 'w', 'source' => { 'conv_id' => 'c1' })])
      replace([b, a])
    end
    step('Then get-all lists "00010-a.html" and then "00020-b.html"') do
      assert_equal %w[00010-a.html 00020-b.html], tags.map { |t| t['file'] }
    end
    step('And each is the same {file, name, ops, prompt, memory} as was written') { assert_equal [a, b], tags }
  end

  scenario 'A tag without a prompt, policies or memory' do
    step('Given a new tag directory') { new_files }
    step('When replace-all writes the tag "empty" with no prompt, no ops and no memory') do
      replace([{ 'file' => '00010-empty.html', 'name' => 'empty' }])
    end
    step('Then its file has <lcty-t> with nothing inside') do
      assert_includes read('00010-empty.html'), "<body>\n<lcty-t data-tag=\"empty\">\n</lcty-t>\n</body>"
    end
    step('And get-all lists it with the prompt "", no ops and no memory') do
      assert_equal [tag('00010-empty.html')], tags
    end
  end

  scenario 'Text that XML cannot hold is written as base64 and read back exactly' do
    t = nil
    step('Given a new tag directory') { new_files }
    step('When replace-all writes a tag whose prompt, policy and memory text contain ESC and whose display name contains U+FFFF') do
      t = tag('00010-x.html', "x\u{FFFF}", 'ops' => [{ 'type' => 'add-memory', 'content' => "a\e" }], 'prompt' => "b\e",
                                           'memory' => [item('m1', "c\e")])
      replace([t])
    end
    step('Then the file has data-content-base64 and data-tag-base64 instead of data-content and data-tag') do
      body = read('00010-x.html')
      assert_includes body, 'data-content-base64='
      assert_includes body, 'data-tag-base64='
      refute_match(/ data-content=/, body)
      refute_match(/ data-tag=/, body)
    end
    step('And get-all returns the strings exactly') { assert_equal [t], tags }
  end

  scenario 'Names are written as they were sent, without normalization' do
    file = "00010-café.html"
    step('Given a new tag directory') { new_files }
    step('When replace-all writes the display name "Café" in decomposed form in "00010-café.html", also decomposed') do
      replace([tag(file, "Café")])
    end
    step('Then t/ has a tag file whose name is exactly the bytes sent') do
      assert_equal [file.b], Dir.children(dir).map(&:b).grep(/\A00010-/n)
    end
    step('And get-all returns the display name exactly as sent') { assert_equal "Café", tags[0]['name'] }
  end

  scenario 'A memory item without a time gets the current time; one with a time keeps it' do
    before = after = nil
    step('Given a new tag directory') { new_files }
    step('When replace-all writes a tag with an item without "at" and an item with the "at" "2026-01-01T00:00:00Z"') do
      before = Time.now
      replace([tag('00010-a.html', 'a', 'memory' => [{ 'id' => 'm1', 'text' => 'x' },
                                                      { 'id' => 'm2', 'text' => 'y', 'at' => '2026-01-01T00:00:00Z' }])])
      after = Time.now
    end
    step('Then get-all gives the first item the time of the request and the second "2026-01-01T00:00:00Z"') do
      first, second = tags[0]['memory']
      assert_now first['at'], before, after
      assert_equal '2026-01-01T00:00:00Z', second['at']
    end
  end

  scenario 'Unknown operation types are ignored when read and not written' do
    step('Given a new tag directory') { new_files }
    step('When replace-all writes a tag with the ops "add-memory" and "x-unknown"') do
      replace([tag('00010-a.html', 'a', 'ops' => [{ 'type' => 'add-memory', 'content' => 'm' },
                                                   { 'type' => 'x-unknown', 'content' => 'u' }])])
    end
    step('Then its file has only the <lcty-tagop> of "add-memory"') do
      assert_equal 1, read('00010-a.html').scan('<lcty-tagop').size
      refute_includes read('00010-a.html'), 'x-unknown'
    end
    step('When a <lcty-tagop data-type="x-other"> is added to the file by hand') do
      write('00010-a.html', read('00010-a.html').sub('</lcty-t>', "<lcty-tagop data-tag=\"a\" data-type=\"x-other\" data-content=\"o\"></lcty-tagop>\n</lcty-t>"))
    end
    step('Then get-all lists only the "add-memory" policy') do
      assert_equal [{ 'type' => 'add-memory', 'content' => 'm' }], tags[0]['ops']
    end
  end

  scenario 'Files that are not tag files are ignored' do
    others = ['.tmp-1.html', 'lcty.v1.js', 'notes.html', '0010-short.html', '00020-.html']
    step('Given a new tag directory with the tag file "00010-a.html"') { with_tags(tag('00010-a.html')) }
    step('And the files ".tmp-1.html", "lcty.v1.js", "notes.html", "0010-short.html" and "00020-.html" in t/') do
      others.each { |n| write(n, '<lcty-t data-tag="other"></lcty-t>') }
    end
    step('Then get-all lists only "00010-a.html"') { assert_equal %w[00010-a.html], tags.map { |t| t['file'] } }
    step('And replace-all with no tags deletes only "00010-a.html"') do
      replace([])
      assert_equal others.sort, Dir.children(dir).sort
    end
  end

  scenario 'A tag file without <lcty-t> is listed as invalid, with a warning' do
    got = nil
    step('Given a new tag directory with the tag file "00010-a.html"') { with_tags(tag('00010-a.html')) }
    step('And the tag file "00020-c~23~2a.html" without <lcty-t>') { write('00020-c~23~2a.html', '<p>nothing</p>') }
    step('Then get-all lists "00010-a.html" and then "00020-c~23~2a.html", and warns about "00020-c~23~2a.html"') do
      _, err = capture_io { got = tags }
      assert_equal %w[00010-a.html 00020-c~23~2a.html], got.map { |t| t['file'] }
      assert_includes err, '00020-c~23~2a.html'
    end
    step('And the second is named "c#*", with no ops, the prompt "", no memory and invalid true') do
      assert_equal tag('00020-c~23~2a.html', 'c#*', 'invalid' => true), got[1]
    end
    step('And the first has no invalid') { refute got[0].key?('invalid') }
  end

  {
    '"ruby"' => %w[ruby ruby],
    '"c~23"' => ['c~23', 'c#'],
    '"~21~23~24~25~26~28~29~2a~3c~3e~3f~5b~5d~5e~7b~7d"' => ['~21~23~24~25~26~28~29~2a~3c~3e~3f~5b~5d~5e~7b~7d',
                                                             '!#$%&()*<>?[]^{}'],
    '"a~7e~20"' => ['a~7e~20', 'a~7e~20'],
    '"a~2A"' => ['a~2A', 'a~2A'],
    '"日本語"' => %w[日本語 日本語]
  }.each do |label, (part, name)|
    scenario "The name of a tag file without <lcty-t> is its part with the escapes undone (#{label})" do
      step("Then the part #{label} gives the name #{name.inspect}") { assert_equal name, TagFiles.name_of_part(part) }
    end
  end

  # "Given a new tag directory with the tag file "00010-a.html" and the tag file "00020-broken.html" without <lcty-t>"
  def with_a_and_broken
    with_tags(tag('00010-a.html'))
    write('00020-broken.html', '<p>by hand</p>')
  end

  # The tags of get-all, without the warning about the file without <lcty-t>
  def quiet_tags
    got = nil
    capture_io { got = tags }
    got
  end

  scenario 'Replace-all keeps a tag file sent back as invalid' do
    step('Given a new tag directory with the tag file "00010-a.html" and the tag file "00020-broken.html" without <lcty-t>') do
      with_a_and_broken
    end
    step('When replace-all sends "00010-a.html" with the prompt "new" and "00020-broken.html" as invalid, with another name and a prompt') do
      capture_io do
        replace([tag('00010-a.html', 'a', 'prompt' => 'new'),
                 tag('00020-broken.html', 'other', 'prompt' => 'p', 'invalid' => true)])
      end
    end
    step('Then "00020-broken.html" is unchanged') { assert_equal '<p>by hand</p>', read('00020-broken.html') }
    step('And get-all lists "00010-a.html" with the prompt "new"') { assert_equal 'new', quiet_tags[0]['prompt'] }
  end

  scenario 'Replace-all deletes a tag file without <lcty-t> left out of the set' do
    step('Given a new tag directory with the tag file "00010-a.html" and the tag file "00020-broken.html" without <lcty-t>') do
      with_a_and_broken
    end
    step('When replace-all sends "00010-a.html" only') { capture_io { replace([tag('00010-a.html')]) } }
    step('Then t/ has only the tag file "00010-a.html"') { assert_equal %w[00010-a.html], listed }
  end

  %w[00010-a.html 00030-c.html].each do |file|
    scenario "Only a tag file without <lcty-t> is kept as invalid (\"#{file}\")" do
      before = nil
      step('Given a new tag directory with the tag file "00010-a.html" and the tag file "00020-broken.html" without <lcty-t>') do
        with_a_and_broken
        before = snapshot
      end
      step("When replace-all sends \"00020-broken.html\" as invalid and \"#{file}\" as invalid") {}
      step("Then it fails with 400 \"only a tag file that cannot be read is kept as it is: \"#{file}\"\"") do
        set = [{ 'file' => '00020-broken.html', 'invalid' => true }, { 'file' => file, 'invalid' => true }]
        assert_http_error(400, "only a tag file that cannot be read is kept as it is: \"#{file}\"") do
          capture_io { replace(set) }
        end
      end
      step('And t/ is unchanged') { assert_equal before, snapshot }
    end
  end

  scenario 'No tag is written over a tag file kept as invalid' do
    before = nil
    step('Given a new tag directory with the tag file "00020-broken.html" without <lcty-t>') do
      new_files
      write('00020-broken.html', '<p>by hand</p>')
    end
    step('And "00020-alias.html" in t/ that is the same file as "00020-broken.html"') do
      # A symbolic link stands for a name the file system takes as the same file (a case-insensitive one, HFS+)
      File.symlink('00020-broken.html', File.join(dir, '00020-alias.html'))
      before = snapshot
    end
    step('When replace-all sends "00020-broken.html" as invalid and a tag in "00020-alias.html"') {}
    step('Then it fails with 400 "the tag file "00020-alias.html" cannot be read, so it cannot be overwritten"') do
      set = [{ 'file' => '00020-broken.html', 'invalid' => true }, tag('00020-alias.html', 'alias')]
      assert_http_error(400, 'the tag file "00020-alias.html" cannot be read, so it cannot be overwritten') do
        capture_io { replace(set) }
      end
    end
    step('And t/ is unchanged') { assert_equal before, snapshot }
  end

  scenario 'Replace-all deletes the tag files left out of the set' do
    step('Given a new tag directory with the tag files "00010-a.html", "00020-b.html" and "00030-c.html"') do
      with_tags(tag('00010-a.html'), tag('00020-b.html'), tag('00030-c.html'))
    end
    step('When replace-all sends "00010-a.html" and "00040-d.html"') { replace([tag('00010-a.html'), tag('00040-d.html')]) }
    step('Then t/ has the tag files "00010-a.html" and "00040-d.html"') { assert_equal %w[00010-a.html 00040-d.html], listed }
  end

  scenario 'Renumbering renames the files and keeps their contents' do
    a = tag('00010-a.html', 'A', 'prompt' => 'pa', 'memory' => [item('m1', 'x')])
    b = tag('00020-b.html', 'B', 'prompt' => 'pb')
    step('Given a new tag directory with the tag files "00010-a.html" and "00020-b.html"') { with_tags(a, b) }
    step('When replace-all sends the same tags as "00010-b.html" and "00020-a.html"') do
      replace([b.merge('file' => '00010-b.html'), a.merge('file' => '00020-a.html')])
    end
    step('Then get-all lists "00010-b.html" and then "00020-a.html" with their contents unchanged') do
      assert_equal [b.merge('file' => '00010-b.html'), a.merge('file' => '00020-a.html')], tags
      assert_equal %w[00010-b.html 00020-a.html], listed
    end
  end

  scenario 'A file just written is not deleted when the directory lists it under another name' do
    step('Given a new tag directory with the tag file "00010-a.html"') { with_tags(tag('00010-a.html')) }
    step('And "00010-alias.html" in t/ that is the same file as "00010-a.html"') do
      # A symbolic link stands for a name the file system lists differently (HFS+ decomposes names): File.identical?
      # says it is the file just written
      File.symlink('00010-a.html', File.join(dir, '00010-alias.html'))
    end
    step('When replace-all sends "00010-a.html" only') { replace([tag('00010-a.html', 'new')]) }
    step('Then "00010-alias.html" is not deleted') { assert File.symlink?(File.join(dir, '00010-alias.html')) }
  end

  scenario 'The ETag follows the set' do
    step('Given a new tag directory with the tag file "00010-a.html"') { with_tags(tag('00010-a.html')) }
    step('Then get-all gives the same ETag twice') { assert_equal etag, etag }
    step('And the ETag after replace-all is the one get-all gives next') do
      assert_equal replace([tag('00010-a.html', 'b')]), etag
    end
    old = nil
    step('When the file is changed by hand') do
      old = etag
      write('00010-a.html', read('00010-a.html').sub('data-tag="b"', 'data-tag="c"'))
    end
    step('Then get-all gives another ETag') { refute_equal old, etag }
    step('When a tag file is added by hand') do
      old = etag
      write('00020-z.html', read('00010-a.html'))
    end
    step('Then get-all gives another ETag again') { refute_equal old, etag }
  end

  {
    'no If-Match' => [->(_) { nil }, 428, 'If-Match is required'],
    'an empty If-Match' => [->(_) { '' }, 428, 'If-Match is required'],
    'the ETag of an earlier set' => [->(t) { t }, 412, 'the tags have changed']
  }.each do |label, (header, status, error)|
    scenario "Replace-all needs the current ETag in If-Match (#{label})" do
      earlier = before = nil
      step('Given a new tag directory with the tag file "00010-a.html"') do
        new_files
        earlier = etag
        replace([tag('00010-a.html')])
        before = snapshot
      end
      step("When replace-all sends a new set with #{label}") {}
      step("Then it fails with #{status} \"#{error}\"") do
        assert_http_error(status, error) { @files.replace_all({ 'tags' => [tag('00020-b.html')] }, header.(earlier)) }
      end
      step('And t/ still has only "00010-a.html", unchanged') { assert_equal before, snapshot }
    end
  end

  {
    '"*"' => ->(_, _) { '*' },
    'the ETag in a list with an older one' => ->(old, now) { "#{old}, #{now}" },
    'the ETag as a weak validator' => ->(_, now) { "W/#{now}" }
  }.each do |label, header|
    scenario "If-Match is accepted in its other forms (#{label})" do
      earlier = nil
      step('Given a new tag directory with the tag file "00010-a.html"') do
        new_files
        earlier = etag
        replace([tag('00010-a.html')])
      end
      step("When replace-all sends a new set with #{label}") do
        @files.replace_all({ 'tags' => [tag('00020-b.html')] }, header.(earlier, etag))
      end
      step('Then it succeeds') { assert_equal %w[00020-b.html], listed }
    end
  end

  {
    '"00010-ruby.html"' => ['00010-ruby.html', nil],
    '"00010-c~23.html"' => ['00010-c~23.html', nil],
    '"99999-日本語.html"' => ['99999-日本語.html', nil],
    'a name of 255 bytes' => ["00010-#{'a' * 244}.html", nil],
    'a name of 256 bytes' => ["00010-#{'a' * 245}.html", 'must be at most 255 bytes'],
    '"0010-ruby.html"' => ['0010-ruby.html', 'must be NNNNN-<name>.html'],
    '"00010ruby.html"' => ['00010ruby.html', 'must be NNNNN-<name>.html'],
    '"00010-.html"' => ['00010-.html', 'must be NNNNN-<name>.html'],
    '"00010-ruby.htm"' => ['00010-ruby.htm', 'must be NNNNN-<name>.html'],
    '"０００１０-ruby.html"' => ['０００１０-ruby.html', 'must be NNNNN-<name>.html'],
    '"00010-a/b.html"' => ['00010-a/b.html', 'must not contain /, \\, : or NUL'],
    'a name with a backslash' => ['00010-a\\b.html', 'must not contain /, \\, : or NUL'],
    '"00010-a:b.html"' => ['00010-a:b.html', 'must not contain /, \\, : or NUL'],
    'a name with NUL' => ["00010-a\u0000b.html", 'must not contain /, \\, : or NUL'],
    'bytes that are not UTF-8' => ["00010-a\xFF.html".dup.force_encoding(Encoding::UTF_8), 'must be valid UTF-8'],
    'a number' => [10, 'must be a string']
  }.each do |label, (name, error)|
    scenario "File names are checked mechanically (#{label})" do
      verdict = error ? "rejected: \"#{error}\"" : 'accepted'
      step("Then the file name #{label} is #{verdict}") do
        error ? assert_equal(error, TagFiles.file_name_error(name)) : assert_nil(TagFiles.file_name_error(name))
      end
    end
  end

  b = { 'file' => '00020-b.html', 'name' => 'b' }
  {
    'the file name "bad.html"' => [{ 'file' => 'bad.html', 'name' => 'x' },
                                   'invalid tag file name "bad.html": must be NNNNN-<name>.html'],
    '"00030-b.html", the same part again' => [{ 'file' => '00030-b.html', 'name' => 'b2' }, 'tag file names must be unique'],
    'a tag that is not an object' => ['x', 'each tag must be an object'],
    'a tag without a display name' => [{ 'file' => '00030-c.html' }, 'name must be a non-empty string'],
    'a tag whose prompt is a number' => [{ 'file' => '00030-c.html', 'name' => 'c', 'prompt' => 1 }, 'prompt must be a string'],
    'a tag whose ops is not an array' => [{ 'file' => '00030-c.html', 'name' => 'c', 'ops' => {} },
                                          'ops must be an array of {type, content}'],
    'a tag with an op type in upper case' => [{ 'file' => '00030-c.html', 'name' => 'c',
                                                'ops' => [{ 'type' => 'Add-Memory', 'content' => 'x' }] },
                                              'ops must be an array of {type, content}'],
    'a tag with two ops of the same type' => [{ 'file' => '00030-c.html', 'name' => 'c',
                                                'ops' => [{ 'type' => 'add-memory', 'content' => 'x' },
                                                          { 'type' => 'add-memory', 'content' => 'y' }] },
                                              'ops must have one entry per type'],
    'a memory item with a blank text' => [{ 'file' => '00030-c.html', 'name' => 'c', 'memory' => [{ 'id' => 'm9', 'text' => ' ' }] },
                                          'memory must be an array of {id, text}'],
    'a memory item whose id has a space' => [{ 'file' => '00030-c.html', 'name' => 'c', 'memory' => [{ 'id' => 'm 9', 'text' => 'x' }] },
                                             'memory must be an array of {id, text}'],
    'a memory item whose at contains ESC' => [{ 'file' => '00030-c.html', 'name' => 'c',
                                                'memory' => [{ 'id' => 'm9', 'text' => 'x', 'at' => "\e" }] },
                                              'memory[0].at contains a character that XML cannot represent: U+001B at 0'],
    "a memory item with the id of another tag's" => [{ 'file' => '00030-c.html', 'name' => 'c',
                                                       'memory' => [{ 'id' => 'mb', 'text' => 'x' }] },
                                                     'memory ids must be unique']
  }.each do |label, (bad, error)|
    scenario "A set that is not valid is rejected as a whole, writing nothing (#{label})" do
      before = nil
      step('Given a new tag directory with the tag file "00010-a.html"') do
        with_tags(tag('00010-a.html'))
        before = snapshot
      end
      step("When replace-all sends \"00020-b.html\" and #{label}") {}
      step("Then it fails with 400 \"#{error}\"") do
        good = b.merge('memory' => [{ 'id' => 'mb', 'text' => 'b' }])
        assert_http_error(400, error) { replace([good, bad]) }
      end
      step('And t/ still has only "00010-a.html", unchanged') { assert_equal before, snapshot }
    end
  end

  scenario 'A body that is not a set of tags is rejected' do
    step('Given a new tag directory') { new_files }
    step('Then replace-all with an array fails with 400 "body must be {"tags": [...]}"') do
      assert_http_error(400, 'body must be {"tags": [...]}') { @files.replace_all([], etag) }
    end
  end

  scenario 'Add-memory appends an item to one tag file' do
    old = new = before = after = b_body = old_etag = nil
    step('Given a new tag directory with the tag files "00010-a.html" with one memory item and "00020-b.html"') do
      old = item('m1', 'old')
      with_tags(tag('00010-a.html', 'a', 'memory' => [old]), tag('00020-b.html'))
      b_body = read('00020-b.html')
      old_etag = etag
    end
    step('When add-memory adds "  remember this  " with the source conversation "c1" and message "m1" to "00010-a.html"') do
      before = Time.now
      new = @files.add_memory('00010-a.html', '  remember this  ', 'conv_id' => 'c1', 'msg_id' => 'm1')
      after = Time.now
    end
    step('Then it returns an item with a UUIDv7 id, the text "remember this", the time of the request and that source') do
      assert Chatty::Uuid.valid?(new['id']), new['id']
      assert_equal 'remember this', new['text']
      assert_now new['at'], before, after
      assert_equal({ 'conv_id' => 'c1', 'msg_id' => 'm1' }, new['source'])
    end
    step('And get-all lists the old item and then the new one under "00010-a.html"') do
      assert_equal [old, new], tags[0]['memory']
    end
    step('And "00020-b.html" is unchanged') { assert_equal b_body, read('00020-b.html') }
    step('And the ETag has changed') { refute_equal old_etag, etag }
  end

  scenario 'Add-memory without a source records none' do
    new = nil
    step('Given a new tag directory with the tag file "00010-a.html"') { with_tags(tag('00010-a.html')) }
    step('When add-memory adds "x" to "00010-a.html" with the source "nope"') do
      new = @files.add_memory('00010-a.html', 'x', 'nope')
    end
    step('Then the item has no source') do
      refute new.key?('source')
      refute tags[0]['memory'][0].key?('source')
    end
  end

  [
    ['"x"', 'x', '"00020-a.html"', '00020-a.html', 404, 'no such tag file'],
    ['"x"', 'x', '"a.html"', 'a.html', 400, 'invalid tag file name: must be NNNNN-<name>.html'],
    ['"   "', '   ', '"00010-a.html"', '00010-a.html', 400, 'text is required'],
    ['a number', 1, '"00010-a.html"', '00010-a.html', 400, 'text is required']
  ].each do |label, text, file_label, file, status, error|
    scenario "Add-memory that cannot be done (#{label}, #{file_label})" do
      body = nil
      step('Given a new tag directory with the tag file "00010-a.html"') do
        with_tags(tag('00010-a.html'))
        body = read('00010-a.html')
      end
      step("When add-memory adds #{label} to #{file_label}") {}
      step("Then it fails with #{status} \"#{error}\"") do
        assert_http_error(status, error) { @files.add_memory(file, text) }
      end
      step('And "00010-a.html" is unchanged') { assert_equal body, read('00010-a.html') }
    end
  end

  scenario 'Add-memory refuses a tag file without <lcty-t>' do
    step('Given a new tag directory with the tag file "00020-broken.html" without <lcty-t>') do
      new_files
      write('00020-broken.html', '<p>by hand</p>')
    end
    step('When add-memory adds "x" to "00020-broken.html"') {}
    step('Then it fails with 409 "the tag file cannot be read"') do
      assert_http_error(409, 'the tag file cannot be read') { capture_io { @files.add_memory('00020-broken.html', 'x') } }
    end
    step('And "00020-broken.html" is unchanged') { assert_equal '<p>by hand</p>', read('00020-broken.html') }
  end
end
