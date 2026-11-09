# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# LCTYSP-3022: the scenarios of docs/specs/LCTYSP-3022_rpc-pages.feature, written by hand. Each test has the title of
# its Scenario and one step per line of it.
#
# The server, "a page" and the helpers are those of rpc_support.rb. Pages are connected for one test only and closed
# at its end; the server's own record of its connections (Lcty::Rpc::HUB) is looked at only to wait until it has seen
# a page close.

require_relative 'rpc_support'

class RpcPagesTest < Lcty::Scenarios
  include RpcSupport

  HOLDS = NOTES + %w[c.cmd.holds]

  # A page that has sent initialize; receives: the methods it declares
  def session(receives = NOTES, **opts)
    page(**opts).tap { |pg| pg.instance_variable_set(:@actor, pg.initialize_session(receives)['actorId']) }
  end

  def actor(pg)
    pg.instance_variable_get(:@actor)
  end

  def follow(pg, cid, last = nil)
    pg.call('c.subscribe', 'cid' => cid, 'last' => last)['result']
  end

  # Whether the server still has a connection with the actorId
  def connected?(actor_id)
    Rpc::HUB.receivers('c.batch.updated').any? { |c| c.actor_id == actor_id }
  end

  # Of the responses to the writes that raced, the one written and the ones refused
  def winner_and_losers(responses)
    responses.partition { |r| r['error'].nil? }
  end

  # ---- Writes that race ----

  scenario 'Of eight pages appending after the same element at once, exactly one is written' do
    cid = s = pages = msgs = responses = nil
    step('Given a conversation with a system message and eight pages') do
      cid = create
      s = sys_attrs
      append(cid, nil, s)
      pages = Array.new(8) { session }
    end
    step('When each page appends a user message after the system message at once') do
      msgs = pages.map { |_| user_attrs }
      responses = at_once(pages.zip(msgs)) { |pg, u| append(cid, s['id'], u, via: pg) }
    end
    won = nil
    step('Then exactly one is written and the seven others are refused with error 1 and data.last its id') do
      written, refused = winner_and_losers(responses)
      assert_equal 1, written.size, responses.inspect
      won = msgs[responses.index(written[0])]
      assert_equal [[1, won['id']]] * 7, refused.map { |r| [r['error']['code'], r['error']['data']['last']] }
    end
    step('And the file holds the system message and that user message') do
      assert_equal [s['id'], won['id']], element_ids(cid)
    end
  end

  scenario 'Of four pages appending an lcty-cmd at once, exactly one holds the conversation' do
    cid = u = pages = cmds = responses = won = nil
    step('Given a conversation with a user message and four pages') do
      cid = create
      u = user_attrs
      append(cid, nil, u)
      pages = Array.new(4) { session }
    end
    step('When each page appends an lcty-cmd after the user message at once') do
      cmds = pages.map { |_| cmd_attrs }
      responses = at_once(pages.zip(cmds)) { |pg, c| append_cmd(cid, u['id'], c, via: pg) }
    end
    step('Then exactly one is written and the three others are refused with error 1 and data.last its id') do
      written, refused = winner_and_losers(responses)
      assert_equal 1, written.size, responses.inspect
      won = cmds[responses.index(written[0])]
      assert_equal [[1, won['id']]] * 3, refused.map { |r| [r['error']['code'], r['error']['data']['last']] }
    end
    step('And the file ends with that lcty-cmd') do
      assert_equal [u['id'], won['id']], element_ids(cid)
      assert_match(/\A<lcty-cmd /, file_lines(cid).last)
    end
  end

  # ---- The order of notifications ----

  scenario 'Every page gets the changes in the same order, one version each' do
    writers = cids = watchers = versions = nil
    step('Given three pages, each with a conversation of its own, and two pages that only watch') do
      cids = Array.new(3) { create }
      writers = Array.new(3) { session }
      watchers = Array.new(2) { session }
    end
    step('When the three append ten elements each to their conversations at once') do
      versions = at_once(writers.zip(cids)) do |pg, cid|
        last = nil
        Array.new(10) do
          a = sys_attrs
          r = append(cid, last, a, via: pg)
          last = a['id']
          r['result']['version']
        end
      end.flatten
    end
    seen = nil
    step('Then each watching page gets thirty c_meta records with increasing versions') do
      mine = ->(pg) { pg.records('c_meta').select { |r| cids.include?(r['row']['cid']) } }
      wait_until { watchers.all? { |pg| mine.call(pg).size >= 30 } }
      seen = watchers.map { |pg| mine.call(pg).map { |r| [r['row']['cid'], r['version']] } }
      seen.each do |list|
        assert_equal 30, list.size
        seqs = list.map { |_, v| seq(v) }
        assert_equal seqs.sort.uniq, seqs
      end
    end
    step('And both get them in the same order, with the versions of the thirty responses') do
      assert_equal seen[0], seen[1]
      assert_equal versions.sort_by { |v| seq(v) }, seen[0].map { |_, v| v }
    end
  end

  scenario 'A page following a conversation rebuilds it from the notifications' do
    cid = follower = writer = nil
    step('Given an empty conversation and a page following it') do
      cid = create
      follower = session
      assert follow(follower, cid)['current']
    end
    step('When another page appends a system message, a user message and an lcty-cmd, removes the lcty-cmd, appends a model message and a user message, and removes that user message') do
      writer = session
      s = sys_attrs
      u = user_attrs
      c = cmd_attrs
      m = model_attrs
      u2 = user_attrs('again')
      [append(cid, nil, s, via: writer), append(cid, s['id'], u, via: writer),
       append_cmd(cid, u['id'], c, via: writer), unappend(cid, c['id'], via: writer),
       append(cid, u['id'], m, via: writer), append(cid, m['id'], u2, via: writer),
       unappend(cid, u2['id'], via: writer)].each { |r| assert_nil r['error'] }
    end
    held = []
    step('Then each c_html append names as after the last element the following page holds, and each unappend its last element') do
      recs = -> { follower.records('c_html').select { |r| r['row']['cid'] == cid } }
      wait_until { recs.call.size >= 7 }
      recs.call.each do |r|
        row = r['row']
        if r['op'] == 'append'
          assert held.last == row['after'], "after #{row['after'].inspect}, holding #{held.last.inspect}"
          held << row['attrs']['id']
        else
          assert_equal held.last, row['id']
          held.pop
        end
      end
    end
    step('And the elements the following page holds are those of the file') { assert_equal element_ids(cid), held }
  end

  scenario 'A page that subscribes while another writes misses nothing and gets nothing twice' do
    cid = writer = follower = sub = nil
    subscribed = Queue.new
    step('Given a conversation that a page keeps appending messages to, until ten more after the subscription') do
      cid = create
      pg = session
      writer = Thread.new do
        last = nil
        after = nil # how many were appended once the subscription was answered
        until after && after >= 10
          a = sys_attrs
          assert_nil append(cid, last, a, via: pg)['error']
          last = a['id']
          after = after ? after + 1 : (subscribed.empty? ? nil : 0)
        end
      end
    end
    step('When another page subscribes while it appends') do
      wait_until { element_ids(cid).size >= 5 }
      follower = session
      sub = follow(follower, cid)
      subscribed << true
      writer.join
    end
    notes = nil
    step('Then the first c_html append it gets names as after the last id c.subscribe answered, and each next one the one before') do
      final = element_ids(cid).last
      appends = -> { follower.records('c_html', 'append') }
      wait_until { appends.call.any? { |r| r['row']['attrs']['id'] == final } }
      notes = appends.call.map { |r| r['row'].merge('version' => r['version']) }
      assert_operator notes.size, :>=, 10
      afters = notes.map { |n| n['after'] }
      ids = notes.map { |n| n['attrs']['id'] }
      assert_equal [sub['last']] + ids[0...-1], afters
    end
    step('And every one has a version after that of c.subscribe') do
      assert(notes.all? { |n| seq(n['version']) > seq(sub['version']) })
    end
    step('And the file up to that last id, followed by the elements notified, is the whole file') do
      all = element_ids(cid)
      assert_equal all, all[0..all.index(sub['last'])] + notes.map { |n| n['attrs']['id'] }
    end
  end

  scenario 'A page that follows another conversation stops getting the elements of the first' do
    c1 = c2 = pg = a2 = nil
    step('Given two conversations and a page following the first') do
      c1 = create
      c2 = create
      pg = session
      follow(pg, c1)
    end
    step('When it subscribes to the second, an element is appended to each, it subscribes to nothing and one more is appended to the second') do
      follow(pg, c2)
      a1 = sys_attrs
      a2 = sys_attrs
      append(c1, nil, a1)
      append(c2, nil, a2)
      follow(pg, nil)
      append(c2, a2['id'], sys_attrs)
    end
    step("Then it gets the c_html record of the second conversation's first element only") do
      wait_until { pg.records('c_meta').count { |r| [c1, c2].include?(r['row']['cid']) } >= 3 }
      settle
      assert_equal [[c2, a2['id']]], pg.records('c_html').map { |r| [r['row']['cid'], r['row']['attrs']['id']] }
    end
    step('And it gets the c_meta records of all three') do
      assert_equal [c1, c2, c2], pg.records('c_meta').map { |r| r['row']['cid'] }.select { |c| [c1, c2].include?(c) }
    end
  end

  scenario 'A page that receives nothing still writes, and the others get its actorId' do
    cid = pg = deaf = nil
    step('Given a conversation, a page following it and a page that receives no notification') do
      cid = create
      pg = session
      follow(pg, cid)
      deaf = session([])
    end
    step('When the page that receives nothing appends a message') do
      assert_nil append(cid, nil, sys_attrs, via: deaf)['error']
    end
    step('Then the following page gets its c_html, c_meta and c_recordcount records with the actorId of the writing page') do
      mine = -> { pg.notes('c.batch.updated').map { |m| m['params'] }.select { |b| b['records'].any? { |r| r['row']['cid'] == cid } } }
      wait_until { mine.call.any? }
      settle
      got = mine.call.map { |b| [b['records'].map { |r| r['store'] }, b['actorId']] }
      assert_equal [[%w[c_html c_meta c_recordcount], actor(deaf)]], got
      assert_empty deaf.notes
    end
  end

  # ---- The lcty-cmd between pages ----

  scenario 'The page that holds an lcty-cmd is found by another, and its reply ends the lock' do
    cid = holder = other = u = c = r = held = m = nil
    step('Given a page that has appended a user message and an lcty-cmd and answers that it holds it, and another page following the conversation') do
      cid = create
      c = cmd_attrs
      holder = session(HOLDS, answer: ->(_m, params) { { 'holds' => params['id'] == c['id'] } })
      u = user_attrs
      assert_nil append(cid, nil, u, via: holder)['error']
      assert_nil append_cmd(cid, u['id'], c, via: holder)['error']
      other = session(HOLDS, answer: ->(_m, _p) { { 'holds' => false } })
      assert follow(other, cid, c['id'])['current']
    end
    step('When the other page appends after the lcty-cmd and calls c.cmd.held') do
      r = append(cid, c['id'], user_attrs, via: other)
      held = other.call('c.cmd.held', 'cid' => cid, 'id' => c['id'])['result']
    end
    step('Then the append is refused with error 2 and c.cmd.held answers held with the actorId of the first page') do
      assert_equal [2, c['id']], [r['error']['code'], r['error']['data']['last']]
      assert_equal({ 'held' => true, 'actorId' => actor(holder) }, held)
    end
    step('When the first page removes the lcty-cmd and appends a model message after the user message') do
      m = model_attrs
      assert_nil unappend(cid, c['id'], via: holder)['error']
      assert_nil append(cid, u['id'], m, via: holder)['error']
    end
    step('Then the other page gets the c_html records unappending the lcty-cmd and then appending the model message') do
      wait_until { other.records('c_html').size >= 2 }
      got = other.records('c_html').map { |r| [r['op'], r['row']['id'] || r['row']['attrs']['id']] }
      assert_equal [['unappend', c['id']], ['append', m['id']]], got
    end
    step('And its user message after the model message is written') do
      assert_nil append(cid, m['id'], user_attrs, via: other)['error']
    end
  end

  scenario 'Only the page that holds the lcty-cmd answers held, and only the pages that receive c.cmd.holds are asked' do
    cid = c = holder = nots = deaf = asker = r = nil
    asked = ->(pg) { pg.log.count { |msg| msg['method'] == 'c.cmd.holds' && msg.key?('id') } }
    step('Given a page holding an lcty-cmd, two pages that answer not held, a page that does not receive c.cmd.holds and a page that asks') do
      cid = create
      c = cmd_attrs
      holder = session(HOLDS, answer: ->(_m, params) { { 'holds' => params['id'] == c['id'] } })
      assert_nil append_cmd(cid, nil, c, via: holder)['error']
      nots = Array.new(2) { session(HOLDS, answer: ->(_m, _p) { { 'holds' => false } }) }
      deaf = session(NOTES, answer: ->(_m, _p) { { 'holds' => true } })
      asker = session(HOLDS, answer: ->(_m, _p) { { 'holds' => true } })
    end
    step('When the asking page calls c.cmd.held') { r = asker.call('c.cmd.held', 'cid' => cid, 'id' => c['id'])['result'] }
    step('Then the answer is held with the actorId of the holding page') do
      assert_equal({ 'held' => true, 'actorId' => actor(holder) }, r)
    end
    step('And the two other pages were asked once each, and neither the page that does not receive c.cmd.holds nor the asking page was asked') do
      wait_until { nots.all? { |pg| asked.call(pg) >= 1 } }
      assert_equal [1, 1, 0, 0], [*nots, deaf, asker].map { |pg| asked.call(pg) }
    end
  end

  scenario 'When the page holding an lcty-cmd closes, nobody holds it' do
    cid = c = holder = nil
    step('Given a page that has appended an lcty-cmd and answers that it holds it') do
      cid = create
      c = cmd_attrs
      holder = session(HOLDS, answer: ->(_m, params) { { 'holds' => params['id'] == c['id'] } })
      assert_nil append_cmd(cid, nil, c, via: holder)['error']
    end
    step('When the page closes its connection') do
      holder.close
      wait_until { !connected?(actor(holder)) }
    end
    step("Then another page's c.cmd.held answers not held without waiting for the time to answer") do
      asker = session(HOLDS, answer: ->(_m, _p) { { 'holds' => false } })
      started = Time.now
      r = asker.call('c.cmd.held', 'cid' => cid, 'id' => c['id'])['result']
      assert_equal({ 'held' => false, 'actorId' => nil }, r)
      assert_operator Time.now - started, :<, Rpc.holds_timeout
    end
  end

  # ---- Pages that leave and come back ----

  scenario 'A page that closes does not stop the others getting notifications' do
    cid = pages = gone = nil
    step('Given three pages following a conversation') do
      cid = create
      pages = Array.new(3) { session.tap { |pg| follow(pg, cid) } }
    end
    step('When one of them closes its connection without a close frame and a message is appended') do
      gone = pages.shift
      gone.close
      assert_nil append(cid, nil, sys_attrs)['error']
    end
    step('Then the two others get the c_html record') do
      wait_until { pages.all? { |pg| pg.records('c_html').size == 1 } }
    end
    step('And the server no longer counts the closed page among its connections') do
      wait_until { !connected?(actor(gone)) }
      assert(pages.all? { |pg| connected?(actor(pg)) })
    end
  end

  scenario 'A page that reconnects finds what it missed' do
    cid = s = u = before = again = info = nil
    step('Given a page following a conversation with a system message') do
      cid = create
      s = sys_attrs
      append(cid, nil, s)
      before = page
      info = before.initialize_session
      assert follow(before, cid, s['id'])['current']
    end
    step('When the page closes, a user message is appended, and the page connects again') do
      before.close
      u = user_attrs
      assert_nil append(cid, s['id'], u)['error']
      again = page
    end
    step('Then initialize answers another actorId and a later version') do
      now = again.initialize_session
      refute_equal info['actorId'], now['actorId']
      assert_operator seq(now['version']), :>, seq(info['version'])
    end
    step('And c.list holds the conversation, and c.subscribe holding the system message answers not current with the user message as last') do
      assert(again.call('c.list')['result']['items'].any? { |m| m['cid'] == cid })
      r = follow(again, cid, s['id'])
      assert_equal [false, u['id']], [r['current'], r['last']]
    end
  end

  # ---- Titles ----

  scenario 'Of titles written by two pages at once, the one with the last version stays' do
    cid = writers = watcher = notes = nil
    step('Given a conversation, two pages and a page that watches') do
      cid = create
      writers = Array.new(2) { session }
      watcher = session
    end
    step('When the two pages each change the title ten times at once') do
      at_once(writers.each_with_index.to_a) do |pg, i|
        10.times { |n| assert_nil pg.call('c.update.title', 'cid' => cid, 'title' => "page #{i} #{n}")['error'] }
      end
    end
    step('Then the watching page gets twenty c_meta records of the conversation') do
      mine = -> { watcher.records('c_meta').select { |r| r['row']['cid'] == cid } }
      wait_until { mine.call.size >= 20 }
      notes = mine.call
      assert_equal 20, notes.size
    end
    step('And the title of the one with the last version is the title c.list answers') do
      last = notes.max_by { |r| seq(r['version']) }
      listed = rpc('c.list')['result']['items'].find { |m| m['cid'] == cid }
      assert_equal last['row']['title'], listed['title']
    end
  end
end
