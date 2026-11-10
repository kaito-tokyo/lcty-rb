# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3020: the scenarios of docs/specs/LCTYSP-3020_rpc.feature, written by hand. Each test has the title of its
# Scenario (an Examples row is added in parentheses, by its first columns) and one step per line of it.
#
# The server, "a page" and the helpers are those of rpc_support.rb.

require_relative 'rpc_support'

class RpcTest < Lcty::Scenarios
  include RpcSupport

  # ---- Transports ----

  scenario "initialize answers the protocol, the version and the connection's actorId" do
    pg = r = nil
    step('Given a page') { pg = page }
    step('When it sends initialize') { r = pg.initialize_session }
    step('Then the result has the protocol, the version and an actorId that is a UUID') do
      assert_equal 'lcty-rpc-prototype', r['protocol']
      assert_match(/\A\h+\.\d+\z/, r['version'])
      assert_match(/\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/, r['actorId'])
    end
  end

  scenario 'POST is not a transport' do
    res = nil
    step('When a request is sent with POST') do
      body = JSON.generate('jsonrpc' => '2.0', 'method' => 'initialize', 'id' => 1)
      res = Net::HTTP.post(URI("http://127.0.0.1:#{port}/v1/rpc"), body, 'Content-Type' => 'application/json')
    end
    step('Then the status is 405') { assert_equal '405', res.code }
  end

  [['as a WebSocket', 'http://evil.example'], ['as a WebSocket', 'http://allowed.test:1']].each do |how, origin|
    scenario "A request of an origin that is not allowed is refused (#{how}, #{origin})" do
      status = nil
      step("When a request is sent #{how} with Origin \"#{origin}\"") { status = Page.status_of(port, origin) }
      step('Then the status is 403') { assert_equal '403', status }
    end
  end

  scenario 'GET without Upgrade is answered 426' do
    res = nil
    step('When /v1/rpc is requested with GET') { res = Net::HTTP.get_response(URI("http://127.0.0.1:#{port}/v1/rpc")) }
    step('Then the status is 426') { assert_equal '426', res.code }
  end

  [125, 126, 127, 65_535, 65_536, 600_000].each do |length|
    scenario "A message of any length arrives whole (#{length})" do
      pg = r = nil
      step('Given a page') { pg = page }
      step("When it sends a request of #{length} bytes") do
        base = JSON.generate('jsonrpc' => '2.0', 'method' => 'initialize', 'params' => { 'pad' => '' }, 'id' => 1)
        text = JSON.generate('jsonrpc' => '2.0', 'method' => 'initialize',
                             'params' => { 'pad' => 'x' * (length - base.bytesize) }, 'id' => 1)
        assert_equal length, text.bytesize
        pg.send_text(text)
        r = Timeout.timeout(10) { loop { m = pg.instance_variable_get(:@inbox).pop; break m if m.is_a?(Hash) && m['id'] == 1 } }
      end
      step('Then the response comes back') { assert_equal 'lcty-rpc-prototype', r['result']['protocol'] }
    end
  end

  # ---- Sessions ----

  scenario 'initialize gives each connection its own actorId' do
    a = b = a1 = a2 = b1 = nil
    step('Given two pages') { a = page; b = page }
    step('When both send initialize, and the first sends it again') do
      a1 = a.initialize_session['actorId']
      b1 = b.initialize_session['actorId']
      a2 = a.initialize_session['actorId']
    end
    step('Then each has a UUID of its own, and the first keeps its one') do
      uuid = /\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/
      assert_match uuid, a1
      assert_match uuid, b1
      refute_equal a1, b1
      assert_equal a1, a2
    end
  end

  scenario 'rpc.discover returns the OpenRPC document of the methods the server receives' do
    pg = doc = receives = nil
    step('Given a page') { pg = page; receives = pg.initialize_session['capabilities']['receives'] }
    step('When it calls rpc.discover') { doc = pg.call('rpc.discover')['result'] }
    step("Then the document's methods for the server are those initialize says the server receives") do
      assert_equal receives.sort, doc['methods'].select { |m| m['x-receiver'] == 'server' }.map { |m| m['name'] }.sort
    end
  end

  scenario 'A page receives only the notifications it declared' do
    pg = cid = nil
    step('Given a page that declared it receives nothing, following a conversation') do
      cid = create
      pg = page
      pg.initialize_session([])
      pg.call('c.subscribe', 'cid' => cid, 'last' => nil)
    end
    step('When an element is appended to the conversation') { append(cid, nil, sys_attrs) }
    step('Then the page gets no notification') do
      settle
      assert_empty pg.notes
    end
  end

  # ---- Conversations ----

  [%w[ja lcty.v1.js\ and\ lcty.v1.lang-ja.js], %w[en lcty.v1.js\ only]].each do |lang, scripts|
    scenario "c.create writes the head the page chose (#{lang})" do
      lines = nil
      step("When a conversation is created with lang \"#{lang}\"") { lines = file_lines(create(lang: lang)) }
      step("Then line 1 is <html lang=\"#{lang}\"> and line 2 loads \"#{scripts}\"") do
        assert_includes lines[0], %(<html lang="#{lang}" />)
        srcs = lines[1].scan(/<script src="([^"]+)">/).flatten
        assert_equal(lang == 'ja' ? %w[lcty.v1.js lcty.v1.lang-ja.js] : %w[lcty.v1.js], srcs)
      end
      step('And line 3 is a title slot of 64 bytes') { assert lines[2].start_with?('<title id="__64">') }
    end
  end

  scenario 'c.create refuses a conversation that exists' do
    cid = r = nil
    step('Given a conversation') { cid = create }
    step('When it is created again') do
      r = rpc('c.create', 'cid' => cid, 'createdAt' => '2026-11-09T12:00:00+09:00', 'title' => 't', 'lang' => 'ja',
                          'titleMaxSize' => 64, 'lctyVersion' => 'v1')
    end
    step('Then the error is 5') { assert_equal 5, r['error']['code'] }
  end

  scenario 'Elements are appended after the element named' do
    cid = s = u = nil
    step('Given a conversation') { cid = create }
    step('When a system message is appended after null and a user message after it') do
      s = sys_attrs
      u = user_attrs
      assert_nil append(cid, nil, s)['error']
      assert_nil append(cid, s['id'], u, "<article>#{u['data-content']}</article>")['error']
    end
    step('Then the file holds the two elements in that order') do
      ids = file_lines(cid).drop(4).map { |l| l[/\sid="([^"]+)"/, 1] }
      assert_equal [s['id'], u['id']], ids
    end
  end

  scenario 'An append that names another element than the last is refused with the last id' do
    cid = s = r = nil
    step('Given a conversation with a system message') { cid = create; s = sys_attrs; append(cid, nil, s) }
    step('When a message is appended after null') { r = append(cid, nil, sys_attrs) }
    step('Then the error is 1 with data.last the id of the system message') do
      assert_equal 1, r['error']['code']
      assert_equal s['id'], r['error']['data']['last']
    end
  end

  scenario 'A request sent again is recognised by the last id' do
    cid = u = r = nil
    step('Given a conversation with a user message just appended') do
      cid = create
      u = user_attrs
      append(cid, nil, u, "<article>#{u['data-content']}</article>")
    end
    step('When the same append is sent again') { r = append(cid, nil, u, "<article>#{u['data-content']}</article>") }
    step('Then the error is 1 with data.last the id of that user message') do
      assert_equal 1, r['error']['code']
      assert_equal u['id'], r['error']['data']['last']
    end
  end

  scenario 'An lcty-cmd locks the conversation until it is unappended' do
    cid = cmd = r1 = r2 = nil
    step('Given a conversation whose last element is an lcty-cmd') do
      cid = create
      cmd = cmd_attrs
      assert_nil rpc('c.append.cmd', 'cid' => cid, 'after' => nil, 'attrs' => cmd)['error']
    end
    step('When a message is appended after the lcty-cmd, and another lcty-cmd too') do
      r1 = append(cid, cmd['id'], sys_attrs)
      r2 = rpc('c.append.cmd', 'cid' => cid, 'after' => cmd['id'], 'attrs' => cmd_attrs)
    end
    step('Then both are refused with error 2') { assert_equal [2, 2], [r1['error']['code'], r2['error']['code']] }
    step('And after c.unappend of the lcty-cmd the message is appended') do
      assert_nil rpc('c.unappend', 'cid' => cid, 'id' => cmd['id'])['error']
      assert_nil append(cid, nil, sys_attrs)['error']
    end
  end

  faults = {
    'the attributes out of order' => ->(t) { [{ 'id' => "msg-m-#{Chatty::Uuid.v7}", 'data-role' => 'model', 'data-at' => t, 'data-content' => 'x' }, '<article><p>x</p></article>'] },
    'an id prefix of another role' => ->(t) { [{ 'data-role' => 'model', 'id' => "msg-u-#{Chatty::Uuid.v7}", 'data-at' => t, 'data-content' => 'x' }, '<article><p>x</p></article>'] },
    'a <script> in its article' => ->(t) { [{ 'data-role' => 'model', 'id' => "msg-m-#{Chatty::Uuid.v7}", 'data-at' => t, 'data-content' => 'x' }, '<article><script>alert(1)</script></article>'] },
    'a user article other than its text' => ->(t) { [{ 'data-role' => 'user', 'id' => "msg-u-#{Chatty::Uuid.v7}", 'data-at' => t, 'data-content' => 'x' }, '<article><b>x</b></article>'] },
    'a control character in data-content' => ->(t) { [{ 'data-role' => 'model', 'id' => "msg-m-#{Chatty::Uuid.v7}", 'data-at' => t, 'data-content' => "a\u0001b" }, '<article><p>x</p></article>'] }
  }
  faults.each do |fault, build|
    scenario "An element that breaks a rule of the format is refused (#{fault})" do
      cid = r = nil
      step('Given a conversation') { cid = create }
      step("When a message is appended with #{fault}") do
        attrs, inner = build.call('2026-11-09T12:00:00+09:00')
        r = append(cid, nil, attrs, inner)
      end
      step('Then the error is 3') { assert_equal 3, r['error']['code'] }
    end
  end

  scenario 'The server fills in the integrity placeholder' do
    cid = r = nil
    step('Given a conversation') { cid = create }
    step('When a message is appended with data-content-integrity "sha384-"') do
      attrs = { 'data-role' => 'system', 'id' => "sys-#{Chatty::Uuid.v7}", 'data-content-integrity' => 'sha384-',
                'data-content' => '短く答えて' }
      r = append(cid, nil, attrs)
    end
    step('Then the attributes written have the SHA-384 of the text in base64') do
      expected = "sha384-#{Base64.strict_encode64(Digest::SHA384.digest('短く答えて'))}"
      assert_equal expected, r['result']['attrs']['data-content-integrity']
      assert_includes file_lines(cid).last, expected
    end
  end

  scenario 'c.unappend removes only the last element' do
    cid = a = b = r = nil
    step('Given a conversation with two messages') do
      cid = create
      a = sys_attrs
      b = sys_attrs
      append(cid, nil, a)
      append(cid, a['id'], b)
    end
    step('When c.unappend names the first one') { r = rpc('c.unappend', 'cid' => cid, 'id' => a['id']) }
    step('Then the error is 1, and c.unappend of the second removes it') do
      assert_equal 1, r['error']['code']
      assert_nil rpc('c.unappend', 'cid' => cid, 'id' => b['id'])['error']
      assert_equal [a['id']], file_lines(cid).drop(4).map { |l| l[/\sid="([^"]+)"/, 1] }
    end
  end

  scenario 'A conversation of LCTYSP-0003 is never written but its title' do
    cid = before = u = errors = nil
    step('Given a conversation file of LCTYSP-0003 in c/ with a user message') do
      cid = new_cid
      u = Chatty::Uuid.v7
      FileUtils.mkdir_p(Rpc::ConvStore::DIR)
      File.write(Rpc::ConvStore.path(cid), Chatty::ConvHtml.document(
        [{ 'type' => 'meta', 'id' => cid, 'created_at' => '2026-11-09T12:00:00+09:00', 'tags' => [], 'instructions' => 'sys' },
         { 'type' => 'message', 'id' => u, 'role' => 'user', 'at' => '2026-11-09T12:00:00+09:00', 'content' => 'q' }]
      ))
      before = File.read(Rpc::ConvStore.path(cid))
    end
    step('When a message is appended to it and its last element is unappended') do
      errors = [append(cid, "c-msg-#{u}", user_attrs)['error'], unappend(cid, "c-msg-#{u}")['error']]
    end
    step('Then both are refused with error 6 and the file has not changed') do
      assert_equal [6, 6], errors.map { |e| e['code'] }
      assert_equal({ 'cid' => cid }, errors[0]['data'])
      assert_equal before, File.read(Rpc::ConvStore.path(cid))
    end
    step('And c.update.title still changes its title') do
      assert_equal 'New', rpc('c.update.title', 'cid' => cid, 'title' => 'New')['result']['title']
      assert_equal before.lines.drop(3), File.read(Rpc::ConvStore.path(cid)).lines.drop(3)
    end
  end

  scenario 'A user or model message brings the search index up to date' do
    cid = m = nil
    hits = -> { Rpc.index.keyword_search('zebrafish').map { |h| h['conv_id'] } }
    step('Given a conversation') { cid = create }
    step('When a user message and a model message are appended') do
      u = user_attrs('q')
      m = model_attrs('zebrafish')
      append(cid, nil, u)
      append(cid, u['id'], m)
    end
    step('Then the search index finds the round by a word of the reply') { assert_equal [cid], hits.() }
    step('When the model message is unappended') { unappend(cid, m['id']) }
    step('Then the search index no longer finds it') { assert_equal [], hits.() }
  end

  # ---- What was measured of a reply ----

  scenario 'c.stats.put records what was measured of a reply and c.stats.list returns it' do
    cid = id = nil
    step('Given a conversation') { cid = create }
    step('When c.stats.put records timings and usage for a model message') do
      id = "msg-m-#{Chatty::Uuid.v7}"
      r = rpc('c.stats.put', 'cid' => cid, 'id' => id, 'timings' => { 'prompt_n' => 3 }, 'usage' => { 'output_tokens' => 2 })
      assert_equal({}, r['result'])
    end
    step('Then c.stats.list returns them for its id, with client null') do
      assert_equal [{ 'id' => id, 'timings' => { 'prompt_n' => 3 }, 'usage' => { 'output_tokens' => 2 }, 'client' => nil }],
                   rpc('c.stats.list', 'cid' => cid)['result']['items']
    end
    step('And c.stats.put again replaces them') do
      rpc('c.stats.put', 'cid' => cid, 'id' => id, 'client' => { 'ttft_ms' => 5 })
      assert_equal [{ 'id' => id, 'timings' => nil, 'usage' => nil, 'client' => { 'ttft_ms' => 5 } }],
                   rpc('c.stats.list', 'cid' => cid)['result']['items']
    end
  end

  {
    'an id that is not a reply' => [->(cid) { { 'cid' => cid, 'id' => "msg-u-#{Chatty::Uuid.v7}" } }, 3],
    'timings that are not object' => [->(cid) { { 'cid' => cid, 'id' => "msg-m-#{Chatty::Uuid.v7}", 'timings' => 'x' } }, 3],
    'an unknown conversation' => [->(_cid) { { 'cid' => new_cid, 'id' => "msg-m-#{Chatty::Uuid.v7}" } }, 4]
  }.each do |what, (params, code)|
    scenario "c.stats.put refuses a bad request (#{what})" do
      cid = r = nil
      step('Given a conversation') { cid = create }
      step('When c.stats.put is called with the params of the example') do
        r = rpc('c.stats.put', instance_exec(cid, &params))
      end
      step("Then the error is #{code}") { assert_equal code, r['error']['code'] }
    end
  end

  # ---- Following a conversation ----

  scenario 'Element notifications go only to the page following the conversation' do
    c1 = c2 = p1 = p2 = nil
    step('Given two conversations and two pages, each following one of them') do
      c1 = create
      c2 = create
      p1 = page
      p2 = page
      [[p1, c1], [p2, c2]].each { |pg, c| pg.initialize_session; pg.call('c.subscribe', 'cid' => c, 'last' => nil) }
    end
    step('When an element is appended to each conversation') do
      append(c1, nil, sys_attrs)
      append(c2, nil, sys_attrs)
    end
    step('Then each page gets the c_html records of its own conversation only') do
      settle
      assert_equal [c1], p1.records('c_html').map { |r| r['row']['cid'] }
      assert_equal [c2], p2.records('c_html').map { |r| r['row']['cid'] }
    end
  end

  scenario "c.subscribe tells whether the page's last element is still the last one" do
    cid = s = pg = r1 = r2 = nil
    step('Given a conversation with a system message') { cid = create; s = sys_attrs; append(cid, nil, s) }
    step('When a page subscribes holding nothing, and again holding the system message') do
      pg = page
      pg.initialize_session
      r1 = pg.call('c.subscribe', 'cid' => cid, 'last' => nil)['result']
      r2 = pg.call('c.subscribe', 'cid' => cid, 'last' => s['id'])['result']
    end
    step('Then the first answer is not current and the second is current') do
      assert_equal [false, s['id']], [r1['current'], r1['last']]
      assert_equal true, r2['current']
    end
  end

  scenario 'A c_meta record goes to every page with the meta of the conversation' do
    pg = cid = nil
    step('Given a page following nothing') { pg = page; pg.initialize_session }
    step('When a conversation is created') { cid = create(lang: 'en', title: 'Hello') }
    step('Then the page gets a c.batch.updated with only version, actorId and records') do
      settle
      batch = pg.notes('c.batch.updated').find { |n| n['params']['records'].any? { |r| r['row']['cid'] == cid } }
      assert batch
      assert_equal %w[actorId records version], batch['params'].keys.sort
    end
    step('And its c_meta record has a row of only cid, lang, title, titleTypeId, updatedAt and createdAt') do
      r = pg.records('c_meta', 'put').find { |x| x['row']['cid'] == cid }
      assert_equal %w[cid lang title titleTypeId updatedAt createdAt], r['row'].keys
      assert_equal ['en', 'Hello', '__64', '2026-11-09T12:00:00+09:00'],
                   r['row'].values_at('lang', 'title', 'titleTypeId', 'createdAt')
    end
  end

  scenario 'One change is one c.batch.updated, without the c_html records for a page that does not follow' do
    cid = follower = other = nil
    step('Given a page following a conversation and a page following nothing') do
      cid = create
      follower = page
      other = page
      follower.initialize_session
      other.initialize_session
      follower.call('c.subscribe', 'cid' => cid, 'last' => nil)
    end
    step('When an element is appended to the conversation') { assert_nil append(cid, nil, sys_attrs)['error'] }
    step('Then the following page gets one c.batch.updated with a c_html, a c_meta and a c_recordcount record') do
      settle
      assert_equal [%w[c_html c_meta c_recordcount]], follower.notes('c.batch.updated').map { |m| m['params']['records'].map { |r| r['store'] } }
    end
    step('And the other gets one with the same version and only the c_meta and c_recordcount records') do
      assert_equal [%w[c_meta c_recordcount]], other.notes('c.batch.updated').map { |m| m['params']['records'].map { |r| r['store'] } }
      assert_equal follower.notes.map { |m| m['params']['version'] }, other.notes.map { |m| m['params']['version'] }
    end
  end

  scenario 'c_recordcount counts every element but lcty-c' do
    pg = cid = nil
    step('Given a page following nothing') { pg = page; pg.initialize_session }
    step('When a conversation is created, a system message, a user message and an lcty-cmd are appended, and the lcty-cmd is unappended') do
      cid = create
      s = sys_attrs
      u = user_attrs
      c = cmd_attrs
      [append(cid, nil, s), append(cid, s['id'], u), append_cmd(cid, u['id'], c), unappend(cid, c['id'])]
        .each { |r| assert_nil r['error'] }
    end
    step('Then the page gets c_recordcount records of 0, 1, 2, 3 and 2') do
      settle
      assert_equal [0, 1, 2, 3, 2], pg.records('c_recordcount', 'put').select { |r| r['row']['cid'] == cid }.map { |r| r['row']['count'] }
    end
    step('And the file has as many lines as the last count and 4') { assert_equal 2 + 4, file_lines(cid).size }
  end

  # ---- The cache of the counts ----

  scenario 'The count is cached in _index.sqlite whenever the file is written' do
    cid = s = u = nil
    seen = []
    step('When a conversation is created, a system message and a user message are appended, and the user message is unappended') do
      cid = create
      seen << Rpc::ConvStore.cached_record_count(cid)
      s = sys_attrs
      u = user_attrs
      append(cid, nil, s)
      append(cid, s['id'], u)
      seen << Rpc::ConvStore.cached_record_count(cid)
      unappend(cid, u['id'])
      seen << Rpc::ConvStore.cached_record_count(cid)
    end
    step('Then the cached count is 0 after creating it, 2 after the appends and 1 after unappending') do
      assert_equal [0, 2, 1], seen
    end
  end

  scenario 'A conversation the cache has no count for has an unknown count' do
    cid = nil
    step('Given a conversation with a system message whose cached count is removed') do
      cid = create
      append(cid, nil, sys_attrs)
      Rpc.index.db.execute('DELETE FROM c_recordcount WHERE cid = ?', [cid])
    end
    step('Then its cached count is unknown, not read from the file') { assert_nil Rpc::ConvStore.cached_record_count(cid) }
  end

  scenario 'At startup the cache is filled from the files' do
    empty = two = nil
    step('Given a conversation with no element and one with two, and a cache that holds neither but a count for a conversation that does not exist') do
      empty = create
      two = create
      s = sys_attrs
      append(two, nil, s)
      append(two, s['id'], user_attrs)
      Rpc.index.replace_record_counts('no-such-conversation' => 7)
    end
    step('When the cache is filled as at startup') { Rpc::ConvStore.fill_record_counts }
    step('Then it holds 0 and 2 for the two conversations and nothing for the other') do
      assert_equal [0, 2], [empty, two].map { |c| Rpc::ConvStore.cached_record_count(c) }
      assert_nil Rpc.index.record_count('no-such-conversation')
    end
  end

  scenario 'c.recordcount.list returns every cached count with the version' do
    empty = two = gone = r = nil
    step('Given a conversation with no element, one with two, and one with a system message whose cached count is removed') do
      empty = create
      two = create
      s = sys_attrs
      append(two, nil, s)
      append(two, s['id'], user_attrs)
      gone = create
      append(gone, nil, sys_attrs)
      Rpc.index.db.execute('DELETE FROM c_recordcount WHERE cid = ?', [gone])
    end
    step('When c.recordcount.list is called') { r = rpc('c.recordcount.list')['result'] }
    step('Then the items are rows of only cid and count, ordered by cid, with 0 and 2 for the first two') do
      assert_match(/\A\h+\.\d+\z/, r['version'])
      assert(r['items'].all? { |i| i.keys == %w[cid count] })
      cids = r['items'].map { |i| i['cid'] }
      assert_equal cids.sort, cids
      counts = r['items'].map { |i| [i['cid'], i['count']] }.to_h
      assert_equal [0, 2], [counts[empty], counts[two]]
    end
    step('And the conversation whose count is not cached is not among them') do
      refute(r['items'].any? { |i| i['cid'] == gone })
    end
    step('And the version is that of the last change') { assert_equal rpc('initialize', 'capabilities' => { 'receives' => [] })['result']['version'], r['version'] }
  end

  scenario 'A notification names the actor that made the change' do
    cid = a = b = me = nil
    step('Given two pages following a conversation') do
      cid = create
      a = page
      b = page
      me = a.initialize_session['actorId']
      b.initialize_session
      [a, b].each { |pg| pg.call('c.subscribe', 'cid' => cid, 'last' => nil) }
    end
    step('When the first appends an element') { assert_nil append(cid, nil, sys_attrs, via: a)['error'] }
    step('Then both get a c_html record with the actorId of the first') do
      settle
      assert_equal [me], a.records('c_html').map { |r| r['actorId'] }
      assert_equal [me], b.records('c_html').map { |r| r['actorId'] }
    end
  end

  scenario "The notification of a page's own change comes before its response" do
    cid = pg = nil
    step('Given a page following a conversation') do
      cid = create
      pg = page
      pg.initialize_session
      pg.call('c.subscribe', 'cid' => cid, 'last' => nil)
    end
    step('When it appends an element') { append(cid, nil, sys_attrs, via: pg) }
    step('Then it gets c.batch.updated before the response') do
      kinds = pg.log.map { |m| m['method'] || 'response' }
      i_note = kinds.index('c.batch.updated')
      i_resp = kinds.rindex('response')
      assert i_note && i_note < i_resp, kinds.inspect
    end
  end

  # ---- Lists and titles ----

  scenario 'c.list returns the meta of every conversation with the version' do
    c1 = c2 = r = nil
    step('Given two conversations') { c1 = create(title: 'one'); c2 = create(lang: 'en', size: 128, title: 'two') }
    step('When c.list is called') { r = rpc('c.list')['result'] }
    step('Then the items hold both with their cid, lang, title, titleTypeId, updatedAt and createdAt') do
      assert_match(/\A\h+\.\d+\z/, r['version'])
      items = r['items'].select { |m| [c1, c2].include?(m['cid']) }.sort_by { |m| [c1, c2].index(m['cid']) }
      assert_equal [%w[cid lang title titleTypeId updatedAt createdAt]] * 2, items.map(&:keys)
      at = '2026-11-09T12:00:00+09:00'
      assert_equal [[c1, 'ja', 'one', '__64', at], [c2, 'en', 'two', '__128', at]],
                   items.map { |m| m.values_at('cid', 'lang', 'title', 'titleTypeId', 'createdAt') }
      assert(items.all? { |m| m['updatedAt'].match?(/\A\d{4}-\d\d-\d\dT/) })
    end
  end

  # ---- The tags of conversations ----

  scenario 't.c.list returns which conversations each tag has with the version' do
    c1 = c2 = r = nil
    step('Given two conversations, the first tagged "z" and "a" and the second "a" in the tag store') do
      c1 = create
      c2 = create
      Rpc.tags.set_conversation_tags(c1, %w[z a])
      Rpc.tags.set_conversation_tags(c2, %w[a])
    end
    step('When t.c.list is called') { r = rpc('t.c.list')['result'] }
    step('Then the items hold z of the first, a of the first and a of the second in that order, each only tag and cid') do
      assert(r['items'].all? { |i| i.keys == %w[tag cid] })
      assert_equal [['z', c1], ['a', c1], ['a', c2]],
                   r['items'].select { |i| [c1, c2].include?(i['cid']) }.map { |i| i.values_at('tag', 'cid') }
    end
    step('And the version is that of the last change') { assert_equal rpc('initialize', 'capabilities' => { 'receives' => [] })['result']['version'], r['version'] }
  end

  scenario 'A change of the tags made outside /v1/rpc is one t.batch.updated with no actor' do
    tp = cp = cid = nil
    step('Given a page receiving t.batch.updated and one receiving only c.batch.updated') do
      tp = page
      tp.initialize_session(%w[t.batch.updated])
      cp = page
      cp.initialize_session
    end
    step('When the tags of a conversation are set to "a" and "b" in the tag store, then to "b"') do
      cid = new_cid
      Rpc.tags.set_conversation_tags(cid, %w[a b])
      Rpc.tags.set_conversation_tags(cid, %w[b])
      settle
    end
    mine = nil
    step('Then the first page gets two t.batch.updated with only version, actorId and records, the actorId null') do
      mine = tp.notes('t.batch.updated').select { |n| n['params']['records'].any? { |x| x['row']['cid'] == cid } }
      assert_equal 2, mine.size
      assert(mine.all? { |n| n['params'].keys.sort == %w[actorId records version] && n['params']['actorId'].nil? })
    end
    step('And their records put a and b, then delete a, and the second has the larger version') do
      assert_equal [[%w[put a], %w[put b]], [%w[delete a]]],
                   mine.map { |n| n['params']['records'].map { |x| [x['op'], x['row']['tag']] } }
      assert(mine.all? { |n| n['params']['records'].all? { |x| x['store'] == 't_has_many_c' && x['row'] == { 'tag' => x['row']['tag'], 'cid' => cid } } })
      first, second = mine.map { |n| n['params']['version'].split('.').last.to_i }
      assert_operator first, :<, second
    end
    step('And the other page gets no t.batch.updated') { assert_empty cp.notes('t.batch.updated') }
  end

  scenario 'c.update.title fits the title into the slot and sends a c_meta record' do
    cid = pg = r = nil
    long = 'a much longer title that cannot fit'
    step('Given a conversation with a title slot of 32 bytes, and a page receiving c.batch.updated') do
      cid = create(size: 32)
      pg = page
      pg.initialize_session
    end
    step('When its title is changed to a longer one') { r = rpc('c.update.title', 'cid' => cid, 'title' => long)['result'] }
    step('Then the result and the notification have the title cut to the slot') do
      settle
      assert_operator r['title'].bytesize + '</title><!--'.bytesize, :<=, 32
      assert long.start_with?(r['title'])
      note = pg.records('c_meta').reverse.find { |n| n['row']['cid'] == cid }
      assert_equal r['title'], note['row']['title']
    end
  end

  # ---- Who holds an lcty-cmd ----

  scenario 'c.cmd.held finds the page that holds the lcty-cmd' do
    holder = asker = me = r = nil
    cmd = cmd_attrs
    step('Given a page that answers c.cmd.holds with true') do
      holder = page(answer: ->(_m, params) { { 'holds' => params['id'] == cmd['id'] } })
      me = holder.initialize_session(%w[c.cmd.holds])['actorId']
    end
    step('When another page calls c.cmd.held') do
      asker = page
      asker.initialize_session
      r = asker.call('c.cmd.held', 'cid' => create, 'id' => cmd['id'])['result']
    end
    step('Then the result is held, with the actorId of the first page') { assert_equal [true, me], [r['held'], r['actorId']] }
  end

  scenario 'A page that does not answer counts as not holding the lcty-cmd' do
    r = nil
    step('Given a page that receives c.cmd.holds but never answers') { page.initialize_session(%w[c.cmd.holds]) }
    step('When another page calls c.cmd.held') do
      Rpc.holds_timeout = 0.5
      asker = page
      asker.initialize_session
      r = asker.call('c.cmd.held', 'cid' => create, 'id' => cmd_attrs['id'])['result']
    ensure
      Rpc.holds_timeout = 2.0
    end
    step('Then the result is not held once the time to answer is over') { assert_equal [false, nil], [r['held'], r['actorId']] }
  end

  # ---- Pages that stop reading ----

  scenario 'A page that stops reading is dropped without holding up the others' do
    stalled = cid = times = nil
    step('Given a page that receives every notification, follows a conversation and never reads') do
      Rpc::Peer.queue_max = 8
      stalled = page(read: false, rcvbuf: 4096)
      cid = create
      stalled.send_text(JSON.generate('jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize',
                                      'params' => { 'capabilities' => { 'receives' => NOTES } }))
      stalled.send_text(JSON.generate('jsonrpc' => '2.0', 'id' => 2, 'method' => 'c.subscribe',
                                      'params' => { 'cid' => cid, 'last' => nil }))
      sleep 0.2
    end
    step('When more changes are made than its queue holds') do
      big = 'あ' * 350_000 # about 1 MB: 20 of them are more than the kernel buffers (a few MB on Linux) take
      last = nil
      times = Array.new(20) do
        a = sys_attrs(big)
        t = Time.now
        assert_nil append(cid, last, a)['error']
        last = a['id']
        Time.now - t
      end
    ensure
      Rpc::Peer.queue_max = 1024
    end
    step("Then every change is answered at once, and the page's connection is closed") do
      assert_operator times.max, :<, 1.0
      sock = stalled.instance_variable_get(:@sock)
      eof = false
      Timeout.timeout(10) do
        loop { sock.readpartial(1 << 20) }
      rescue EOFError, Errno::ECONNRESET
        eof = true
      end
      assert eof
    end
  end
end
