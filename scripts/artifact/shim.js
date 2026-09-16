/**
 * Offline stand-in for the LoopDesk API.
 *
 * Reads answer from the frozen snapshot. Writes (connect / attach / disconnect)
 * are replayed in memory so the connect-account flow is genuinely clickable in
 * the published demo — including a stand-in consent screen, because that step is
 * the whole point of the flow and there is no Facebook to bounce off here.
 */
(function () {
  var SNAP = window.__LOOPDESK_DEMO__;
  var real = window.fetch.bind(window);
  var connections = JSON.parse(JSON.stringify(SNAP.connections));

  /* ---------- AI Studio state: assistants, conversations, corrections ---------- */
  var agents = JSON.parse(JSON.stringify(SNAP.agents || []));
  var agentDefaults = JSON.parse(JSON.stringify(SNAP.agents || []));
  var threads = [];        // {id, agent_id, title, created_at}
  var messages = [];       // {id, thread_id, role, content, used, mode, created_at}
  var feedback = [];       // {id, agent_id, message_id, verdict, note}
  var nextMessageId = 1;
  var brandMap = {};
  (SNAP.brand || []).forEach(function (b) { brandMap[b.key] = b.content; });

  function knowledgeFor(agent) {
    var keys = (agent.addons && agent.addons.knowledge) || [];
    var brand = {};
    keys.forEach(function (k) { if (brandMap[k] !== undefined) brand[k] = brandMap[k]; });
    return {
      brand: brand,
      signals: keys.indexOf('signals') >= 0 ? SNAP.signals : undefined,
      ads: keys.indexOf('ads') >= 0 ? SNAP.ads : undefined,
      posts: keys.indexOf('posts') >= 0 ? (SNAP.posts || []).slice(0, 8) : undefined,
    };
  }
  function corrections(agentId) {
    return feedback.filter(function (f) { return f.agent_id === agentId && f.verdict === 'down' && f.note; })
      .map(function (f) { return { note: f.note, created_at: '' }; });
  }
  function agentBy(storeId, slug) {
    return agents.find(function (a) { return a.store_id === storeId && a.slug === slug; }) || null;
  }
  function threadList(agentId) {
    return threads.filter(function (t) { return t.agent_id === agentId; }).map(function (t) {
      return { id: t.id, title: t.title, created_at: t.created_at, messages: messages.filter(function (m) { return m.thread_id === t.id; }).length };
    }).reverse();
  }
  function feedbackSummary(agentId) {
    var mine = feedback.filter(function (f) { return f.agent_id === agentId; });
    return { up: mine.filter(function (f) { return f.verdict === 'up'; }).length, down: mine.filter(function (f) { return f.verdict === 'down'; }).length, corrections: corrections(agentId) };
  }
  function messagesOf(threadId) {
    return messages.filter(function (m) { return m.thread_id === threadId; }).map(function (m) {
      var last = feedback.filter(function (f) { return f.message_id === m.id; }).pop();
      return Object.assign({}, m, { verdict: last ? last.verdict : null });
    });
  }
  var json = function (body, status) {
    return new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json' } });
  };

  var CHANNEL_NAME = {};
  (SNAP.providers || []).forEach(function (p) { CHANNEL_NAME[p.channel] = p; });

  /* ---------- stand-in consent screen ---------- */

  function consent(channel) {
    var p = CHANNEL_NAME[channel] || { name: channel, scopes: [] };
    var asked = p.scopes.filter(function (s) { return s.requested_now; });
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'consent-scrim';
      wrap.innerHTML =
        '<div class="consent-card" role="dialog" aria-modal="true">' +
          '<div class="consent-head">' +
            '<span class="consent-mark">f</span>' +
            '<div><b>' + p.name + '</b><div class="consent-sub">หน้าจอจำลอง · ของจริงจะเป็นหน้าขออนุญาตของ Meta</div></div>' +
          '</div>' +
          '<p class="consent-lead"><b>LoopDesk</b> ขออนุญาตเข้าถึงบัญชีของคุณ:</p>' +
          '<ul class="consent-list">' +
            asked.map(function (s) { return '<li><span class="tick">✓</span>' + s.label + '<code>' + s.scope + '</code></li>'; }).join('') +
          '</ul>' +
          '<p class="consent-note">ขอเท่าที่ระบบใช้จริงในเฟสนี้เท่านั้น · สิทธิ์โพสต์ ยิงแอด และตอบแชท จะขอเพิ่มเมื่อถึงเฟสนั้น</p>' +
          '<div class="consent-actions">' +
            '<button class="consent-no">ยกเลิก</button>' +
            '<button class="consent-yes">ดำเนินการต่อ</button>' +
          '</div>' +
        '</div>';
      var done = function (ok) { wrap.remove(); resolve(ok); };
      wrap.querySelector('.consent-yes').onclick = function () { done(true); };
      wrap.querySelector('.consent-no').onclick = function () { done(false); };
      document.body.appendChild(wrap);
    });
  }

  /* ---------- route table ---------- */

  function capabilitiesOf(id) {
    var acc = (SNAP.connect.picker.accounts || []).find(function (a) { return a.id === id; });
    return acc ? acc.capabilities : { insights: true };
  }

  async function handle(method, url, body) {
    var u = new URL(url, location.origin);
    var p = u.pathname;

    if (p === '/api/providers') return json(SNAP.providers);
    if (p === '/api/stores') return json(SNAP.stores);

    var connect = p.match(/^\/api\/stores\/([^/]+)\/connect\/([^/]+)$/);
    if (connect && method === 'POST') {
      var ch = connect[2];
      var prov = CHANNEL_NAME[ch];
      if (!prov || !prov.implemented) return json({ error: (prov ? prov.name : ch) + ' ยังไม่เปิดให้เชื่อมต่อในเวอร์ชันนี้' }, 501);
      var ok = await consent(ch);
      if (!ok) return json({ error: 'ยกเลิกการเชื่อมต่อจากหน้าขออนุญาต' }, 400);
      return json({ mode: 'demo', grant_id: SNAP.connect.picker.grant_id, note: SNAP.connect.note });
    }

    var accounts = p.match(/^\/api\/stores\/([^/]+)\/connect\/([^/]+)\/accounts$/);
    if (accounts && method === 'GET') return json(SNAP.connect.picker);

    var attach = p.match(/^\/api\/stores\/([^/]+)\/connect\/([^/]+)\/attach$/);
    if (attach && method === 'POST') {
      var storeId = attach[1], channel = attach[2];
      var picked = (body && body.account_ids) || [];
      var expires = new Date(Date.now() + 60 * 86400000).toISOString();
      picked.forEach(function (id) {
        var acc = SNAP.connect.picker.accounts.find(function (a) { return a.id === id; });
        if (!acc) return;
        var rowId = storeId + '-' + channel + '-' + id;
        var row = connections.find(function (c) { return c.id === rowId; });
        if (!row) { row = { id: rowId, channel: channel, external_account_id: id }; connections.push(row); }
        row.display_name = acc.name;
        row.capabilities = capabilitiesOf(id);
        row.status = 'connected';
        row.token_source = 'demo';
        row.scopes = SNAP.connect.picker.scopes;
        row.avatar_url = acc.avatar_url || null;
        row.connected_by = (body && body.by) || 'เจ้าของร้าน';
        row.connected_at = new Date().toISOString();
        row.token_expires_at = expires;
        row.last_error = null;
      });
      if (!picked.length) return json({ error: 'ไม่พบบัญชีที่เลือกในสิทธิ์ที่ได้รับ' }, 400);
      return json({ attached: picked, demo: true, connections: connections });
    }

    var del = p.match(/^\/api\/stores\/([^/]+)\/connections\/(.+)$/);
    if (del && method === 'DELETE') {
      var target = decodeURIComponent(del[2]);
      var row = connections.find(function (c) { return c.id === target; });
      if (!row) return json({ error: 'ไม่พบการเชื่อมต่อนี้' }, 404);
      // Same as the server: keep the row for history, destroy every secret.
      row.status = 'disconnected';
      row.scopes = null;
      row.token_expires_at = null;
      return json({ disconnected: target, connections: connections });
    }

    /* ---------- AI Studio ---------- */
    if (p === '/api/studio/catalog') return json(SNAP.catalog);

    var agentsList = p.match(/^\/api\/stores\/([^/]+)\/agents$/);
    if (agentsList && method === 'GET') return json(agents.filter(function (a) { return a.store_id === agentsList[1]; }));

    var agentOne = p.match(/^\/api\/stores\/([^/]+)\/agents\/([^/]+)$/);
    if (agentOne) {
      var ag = agentBy(agentOne[1], agentOne[2]);
      if (!ag) return json({ error: 'ไม่พบผู้ช่วยตัวนี้' }, 404);
      if (method === 'GET') return json({ agent: ag, threads: threadList(ag.id), feedback: feedbackSummary(ag.id) });
      if (method === 'PUT') {
        var patch = body || {};
        ['instructions', 'examples', 'autonomy', 'enabled', 'effort', 'model'].forEach(function (k) { if (patch[k] !== undefined) ag[k] = patch[k]; });
        if (patch.addons) ag.addons = Object.assign({}, ag.addons, patch.addons);
        ag.updated_at = new Date().toISOString();
        return json(ag);
      }
    }

    var agentReset = p.match(/^\/api\/stores\/([^/]+)\/agents\/([^/]+)\/reset$/);
    if (agentReset && method === 'POST') {
      var cur = agentBy(agentReset[1], agentReset[2]);
      var def = agentDefaults.find(function (a) { return a.id === (cur && cur.id); });
      if (!cur || !def) return json({ error: 'ไม่พบผู้ช่วยตัวนี้' }, 404);
      ['instructions', 'examples', 'addons', 'autonomy', 'effort'].forEach(function (k) { cur[k] = JSON.parse(JSON.stringify(def[k])); });
      return json(cur);
    }

    var agentThread = p.match(/^\/api\/stores\/([^/]+)\/agents\/([^/]+)\/threads\/([^/]+)$/);
    if (agentThread && method === 'GET') {
      var ta = agentBy(agentThread[1], agentThread[2]);
      var th = threads.find(function (t) { return t.id === agentThread[3] && ta && t.agent_id === ta.id; });
      if (!th) return json({ error: 'ไม่พบบทสนทนานี้' }, 404);
      return json({ thread_id: th.id, messages: messagesOf(th.id) });
    }

    var agentChat = p.match(/^\/api\/stores\/([^/]+)\/agents\/([^/]+)\/chat$/);
    if (agentChat && method === 'POST') {
      var ca = agentBy(agentChat[1], agentChat[2]);
      if (!ca) return json({ error: 'ไม่พบผู้ช่วยตัวนี้' }, 404);
      var text = ((body && body.message) || '').trim();
      if (!text) return json({ error: 'ต้องมีข้อความ' }, 400);
      var tid = body.thread_id && threads.some(function (t) { return t.id === body.thread_id && t.agent_id === ca.id; }) ? body.thread_id : null;
      if (!tid) { tid = 'demo-' + Date.now().toString(36); threads.push({ id: tid, agent_id: ca.id, title: text.slice(0, 60), created_at: new Date().toISOString() }); }
      var fixes = corrections(ca.id);
      var know = knowledgeFor(ca);
      var reply = demoReply(ca, know, text);
      var used = {
        knowledge: Object.keys(know.brand).concat(know.signals ? ['signals'] : [], know.ads ? ['ads'] : [], know.posts ? ['posts'] : []),
        actions: (ca.addons && ca.addons.actions) || [], examples: (ca.examples || []).length, corrections: fixes.length, mode: 'demo', model: 'demo',
      };
      messages.push({ id: nextMessageId++, thread_id: tid, role: 'user', content: text, used: null, mode: 'demo', created_at: new Date().toISOString() });
      var mid = nextMessageId++;
      messages.push({ id: mid, thread_id: tid, role: 'assistant', content: reply, used: used, mode: 'demo', created_at: new Date().toISOString() });
      // a short think, so the "กำลังคิด…" state is visible in the demo
      return new Promise(function (resolve) { setTimeout(function () { resolve(json({ thread_id: tid, message_id: mid, reply: reply, mode: 'demo', used: used, refused: false })); }, 450); });
    }

    var agentFeedback = p.match(/^\/api\/stores\/([^/]+)\/agents\/([^/]+)\/feedback$/);
    if (agentFeedback && method === 'POST') {
      var fa = agentBy(agentFeedback[1], agentFeedback[2]);
      var msg = messages.find(function (m) { return m.id === (body && body.message_id); });
      var owner = msg && threads.find(function (t) { return t.id === msg.thread_id; });
      if (!fa || !msg || !owner || owner.agent_id !== fa.id) return json({ error: 'ไม่พบข้อความนี้' }, 404);
      feedback.push({ id: feedback.length + 1, agent_id: fa.id, message_id: msg.id, verdict: body.verdict, note: (body.note || '').trim() || null });
      return json({ id: feedback.length, corrections: corrections(fa.id).length });
    }

    var store = p.match(/^\/api\/stores\/[^/]+\/(\w+)$/);
    if (store && SNAP[store[1]] !== undefined) {
      return json(store[1] === 'connections' ? connections : SNAP[store[1]]);
    }
    return null;
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var body = null;
    try { if (init && init.body) body = JSON.parse(init.body); } catch (e) { /* not json */ }
    var handled = handle(method, url, body);
    return handled.then(function (r) { return r || real(input, init); });
  };

  if (!location.hash) {
    try { history.replaceState(null, '', '#Marketing'); } catch (e) { location.hash = 'Marketing'; }
  }
})();
