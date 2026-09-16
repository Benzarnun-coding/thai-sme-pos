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
