/* Mission Control: recovery dispatch board.
   Loaded before the main dashboard script; uses its globals at call time
   (API, esc, toast, beginLoad, currentUser). */
(function () {
  'use strict';

  const LABELS = {
    new: 'New', acknowledged: 'Acknowledged', assigned: 'Pilot assigned', en_route: 'En route',
    on_scene: 'On scene / searching', found: 'Found', not_found: 'Not found', closed: 'Closed',
    contacted: 'Acknowledged (old)', resolved: 'Closed (old)',
  };
  const RANK = { new: 0, acknowledged: 1, contacted: 1, assigned: 2, en_route: 3, on_scene: 4, found: 5, not_found: 5, resolved: 6, closed: 6 };
  const ACTIVE = ['new', 'acknowledged', 'contacted', 'assigned', 'en_route', 'on_scene', 'found', 'not_found'];
  const STEPS = [
    { status: 'acknowledged', label: 'Acknowledge' },
    { status: 'assigned', label: 'Assign pilot' },
    { status: 'en_route', label: 'En route' },
    { status: 'on_scene', label: 'On scene' },
    { status: 'found', label: 'Found' },
    { status: 'not_found', label: 'Not found' },
    { status: 'closed', label: 'Close' },
  ];
  const REFRESH_MS = 30000;
  const SEEN_KEY = 'cc_seen_recovery';

  const RQ = { all: [], filter: 'active', openId: null, detail: null, sheetOpen: false, knownIds: null, lastLoaded: null };

  const $ = (id) => document.getElementById(id);
  const label = (s) => LABELS[s] || s || 'New';
  const rank = (s) => (RANK[s] === undefined ? 0 : RANK[s]);
  const animal = (r) => (r.recovery_type === 'deer' ? 'deer' : 'pet');

  // Default Found / Not found messages, picked by request type. Anything that
  // isn't a deer request (including old or unknown types) uses the pet wording,
  // matching animal() above. "Crosshair Creations: " and the STOP line are added
  // by formatSms, so they are not part of these bodies.
  const OUTCOME_TEMPLATES = {
    deer: {
      found: "Good news, we found your deer. We've marked the location and will send you the pin now. Congrats on the harvest.",
      not_found: "We searched the area thoroughly but weren't able to locate your deer this time. Thank you for trusting us with your recovery. We truly appreciate the opportunity. If you end up finding it, please let us know, because we love hearing success stories.",
    },
    pet: {
      found: "Great news, we've located your pet. We'll guide you to them now. Stay calm and approach slowly so they don't spook.",
      not_found: "We weren't able to locate your pet on this search, and we're so sorry. Keep food, water, and something with your scent outside, and call us if they're spotted. Thank you for trusting us. When they make it home, please let us know, because we love a happy ending.",
    },
  };
  function defaultTemplate(r, toStatus, serverTemplates) {
    const byType = OUTCOME_TEMPLATES[animal(r)] || OUTCOME_TEMPLATES.pet;
    if (byType[toStatus]) return byType[toStatus];
    return (serverTemplates || {})[toStatus] || '';
  }

  // currentUser is a top-level `let` in the main dashboard script.
  function me() {
    try { return typeof currentUser === 'undefined' ? null : currentUser; } catch (e) { return null; }
  }
  function canView() {
    const u = me();
    return !!(u && (u.is_owner || u.can_view_recovery_requests));
  }

  // ---------- small helpers ----------
  function seenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function markSeen(id) {
    const s = seenSet(); s.add(id);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s).slice(-500))); } catch (e) { /* private mode */ }
  }
  function isUnseen(r) { return r.status === 'new' && !seenSet().has(r.id); }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function ago(iso) {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(mins)) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const h = Math.floor(mins / 60);
    if (h < 24) return h + ' hr ' + (mins % 60) + ' min ago';
    return Math.floor(h / 24) + ' day' + (h >= 48 ? 's' : '') + ' ago';
  }
  function prettyPhone(p) {
    const d = String(p || '').replace(/\D/g, '').slice(-10);
    return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : (p || '');
  }
  function pill(status) {
    return '<span class="rq-pill rs-' + esc(status || 'new') + '">' + esc(label(status)) + '</span>';
  }

  // Same formatting the server applies, so the preview is exactly what goes out.
  function formatSms(text) {
    let t = String(text || '').trim();
    if (!/^crosshair creations/i.test(t)) t = 'Crosshair Creations: ' + t;
    if (!/\bSTOP\b/.test(t)) t = t + ' Reply STOP to opt out.';
    return t;
  }
  function formatEmail(name, text) {
    return 'Hi ' + (name || 'there') + ',\n\n' + String(text || '').trim() + '\n\nQuestions? Call or text us at (615) 549-5067.\n\n— Crosshair Creations';
  }
  function fillTemplate(tpl, r, pilot, eta) {
    return String(tpl || '')
      .split('{animal}').join(animal(r))
      .split('{pilot}').join(pilot ? pilot : 'Our pilot')
      .split('{eta}').join(eta ? ' Estimated arrival: ' + eta + '.' : '')
      .replace(/\s+/g, ' ').trim();
  }

  async function apiJson(path, opts) {
    const res = await fetch(API + path, Object.assign({ credentials: 'same-origin' }, opts || {}, {
      headers: Object.assign({ 'content-type': 'application/json' }, (opts && opts.headers) || {}),
    }));
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && typeof showLogin === 'function') showLogin();
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  // ---------- list ----------
  async function loadRecovery(opts) {
    const quiet = !!(opts && opts.quiet);
    const statusEl = $('recovery-status');
    if (!quiet && !RQ.all.length) statusEl.textContent = 'Loading...';
    const current = beginLoad('recovery');
    let res;
    try {
      res = await apiJson('/recovery-requests');
    } catch (e) {
      if (!current()) return;
      statusEl.textContent = '';
      if (!quiet) $('recovery-list').innerHTML = '<p class="tele" style="color:var(--danger);">Could not reach the dashboard server.</p>';
      return;
    }
    if (!current()) return;
    if (!res.ok) {
      statusEl.textContent = '';
      $('recovery-list').innerHTML = '<p class="tele" style="color:var(--danger);">' + esc(res.data.error || 'Something went wrong.') + '</p>';
      return;
    }
    const rows = Array.isArray(res.data) ? res.data : [];

    // Announce requests that arrived since the last refresh.
    if (RQ.knownIds) {
      const fresh = rows.filter(r => !RQ.knownIds.has(r.id));
      if (fresh.length) toast(fresh.length === 1 ? '🚨 New recovery request: ' + fresh[0].name : '🚨 ' + fresh.length + ' new recovery requests');
    } else if (!localStorage.getItem(SEEN_KEY)) {
      // First time on this device: don't flag the whole history as new.
      rows.filter(r => r.status === 'new' && Date.now() - new Date(r.created_at).getTime() > 6 * 3600e3).forEach(r => markSeen(r.id));
    }
    RQ.knownIds = new Set(rows.map(r => r.id));
    RQ.all = rows;
    RQ.lastLoaded = new Date();
    statusEl.textContent = '';
    $('rq-updated').textContent = 'Updated ' + RQ.lastLoaded.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    renderList();
    updateBadge();
  }

  function renderList() {
    const counts = { active: 0, closed: 0, all: RQ.all.length };
    RQ.all.forEach(r => { if (ACTIVE.includes(r.status)) counts.active++; else counts.closed++; });
    ['active', 'closed', 'all'].forEach(k => {
      const el = $('rq-count-' + k);
      if (el) el.textContent = counts[k];
    });
    document.querySelectorAll('.rq-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === RQ.filter));

    const rows = RQ.all.filter(r => RQ.filter === 'all' ? true : RQ.filter === 'active' ? ACTIVE.includes(r.status) : !ACTIVE.includes(r.status));
    const list = $('recovery-list');
    if (!rows.length) {
      list.innerHTML = '<p class="tele" style="padding:1rem 0;">' + (RQ.filter === 'active' ? 'No active recovery requests.' : 'Nothing here yet.') + '</p>';
      return;
    }
    list.innerHTML = rows.map(r => {
      const unseen = isUnseen(r);
      const where = r.location_description ? esc(r.location_description) : (r.latitude != null ? 'Pin dropped on map' : 'No location given');
      const pilotLine = r.assigned_pilot ? ' · 🧑‍✈️ ' + esc(r.assigned_pilot) + (r.eta_text ? ' · ETA ' + esc(r.eta_text) : '') : '';
      return '<button class="rq-item rb-' + esc(r.status) + (unseen ? ' unseen' : '') + '" data-id="' + r.id + '">' +
        '<div class="rq-item-top">' +
          '<strong>' + (r.recovery_type === 'deer' ? '🦌' : '🐾') + ' ' + esc(r.name) + '</strong>' +
          (unseen ? '<span class="rq-new-tag">UNREAD</span>' : '') +
          pill(r.status) +
        '</div>' +
        '<div class="rq-item-meta">' + esc(ago(r.created_at)) + ' · ' + esc(prettyPhone(r.phone)) + pilotLine + '</div>' +
        '<div class="rq-item-meta">📍 ' + where + '</div>' +
        (r.failed_messages > 0 ? '<div class="rq-item-warn">⚠️ ' + r.failed_messages + ' message' + (r.failed_messages > 1 ? 's' : '') + ' failed to send</div>' : '') +
      '</button>';
    }).join('');
    list.querySelectorAll('.rq-item').forEach(b => b.addEventListener('click', () => openRequest(Number(b.dataset.id))));
  }

  function updateBadge() {
    const n = RQ.all.filter(r => r.status === 'new').length;
    const badge = $('rq-badge');
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
    const toggle = $('sidebarToggle');
    if (toggle) toggle.classList.toggle('has-alert', n > 0);
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = n > 0 ? '(' + n + ') ' + base : base;
  }

  // ---------- detail ----------
  async function openRequest(id) {
    RQ.openId = id;
    markSeen(id);
    $('rq-list-view').style.display = 'none';
    $('rq-detail-view').style.display = 'block';
    $('rq-detail-view').innerHTML = '<div class="card"><p class="tele">Loading request...</p></div>';
    window.scrollTo({ top: 0 });
    await loadDetail();
  }

  function closeRequest() {
    RQ.openId = null;
    RQ.detail = null;
    $('rq-detail-view').style.display = 'none';
    $('rq-list-view').style.display = 'block';
    renderList();
    updateBadge();
  }

  async function loadDetail() {
    if (!RQ.openId) return;
    const id = RQ.openId;
    const current = beginLoad('recoveryDetail');
    let res;
    try { res = await apiJson('/recovery-requests?id=' + id); } catch (e) { return; }
    if (!current() || RQ.openId !== id) return;
    if (!res.ok) {
      $('rq-detail-view').innerHTML = '<div class="card"><button class="rq-back">← All requests</button><p class="tele" style="color:var(--danger);margin-top:1rem;">' + esc(res.data.error || 'Could not load this request.') + '</p></div>';
      $('rq-detail-view').querySelector('.rq-back').addEventListener('click', closeRequest);
      return;
    }
    RQ.detail = res.data;
    renderDetail();
  }

  function nextActions(status) {
    switch (status) {
      case 'new': return ['acknowledged'];
      case 'acknowledged': case 'contacted': return ['assigned'];
      case 'assigned': return ['en_route'];
      case 'en_route': return ['on_scene'];
      case 'on_scene': return ['found', 'not_found'];
      case 'found': case 'not_found': return ['closed'];
      default: return [];
    }
  }

  function stepState(step, status) {
    if (step.status === status) return 'current';
    if ((step.status === 'found' || step.status === 'not_found') && (status === 'found' || status === 'not_found')) return 'other';
    if (step.status === 'found' || step.status === 'not_found') {
      const outcome = RQ.detail && RQ.detail.request.outcome;
      if (rank(status) > 5) return outcome === step.status ? 'done' : 'other';
    }
    return rank(step.status) < rank(status) ? 'done' : 'todo';
  }

  function renderDetail() {
    const d = RQ.detail;
    const r = d.request;
    const ch = d.channels;
    const actions = nextActions(r.status);
    const hasPin = r.latitude != null && r.longitude != null;
    const dirUrl = hasPin ? 'https://www.google.com/maps/dir/?api=1&destination=' + r.latitude + ',' + r.longitude
      : (r.location_description ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.location_description) : null);
    const isClosed = !ACTIVE.includes(r.status);

    const stepper = STEPS.map(s => {
      const st = stepState(s, r.status);
      return '<button class="rq-step st-' + st + '" data-status="' + s.status + '">' +
        (st === 'done' ? '✓ ' : '') + esc(s.label) + '</button>';
    }).join('');

    const nextButtons = actions.length
      ? actions.map(a => '<button class="primary rq-next" data-status="' + a + '">' +
          (a === 'acknowledged' ? 'Acknowledge request' : a === 'assigned' ? 'Assign pilot + ETA' : a === 'en_route' ? 'Pilot is en route' :
           a === 'on_scene' ? 'On scene / searching' : a === 'found' ? '✓ Found' : a === 'not_found' ? 'Not found' : 'Close + log hours') +
        '</button>').join('')
      : '<button class="rq-next" data-status="acknowledged" data-reopen="1">Reopen request</button>';

    const kv = [
      ['Status', pill(r.status) + (r.status_changed_at ? ' <span class="rq-dim">' + esc(ago(r.status_changed_at)) + '</span>' : '')],
      ['Pilot', r.assigned_pilot ? esc(r.assigned_pilot) : '<span class="rq-dim">Not assigned</span>'],
      ['ETA', r.eta_text ? esc(r.eta_text) : '<span class="rq-dim">—</span>'],
      ['Outcome', r.outcome ? pill(r.outcome) : '<span class="rq-dim">—</span>'],
      ['Hours worked', r.hours_worked != null ? esc(String(Number(r.hours_worked))) : '<span class="rq-dim">—</span>'],
    ].map(([k, v]) => '<div class="rq-kv-k">' + k + '</div><div class="rq-kv-v">' + v + '</div>').join('');

    $('rq-detail-view').innerHTML =
      '<div class="rq-detail-top"><button class="rq-back">← All requests</button><button class="rq-refresh-one">Refresh</button></div>' +
      '<div class="card rq-hero rb-' + esc(r.status) + '">' +
        '<div class="rq-hero-title"><h2>' + (r.recovery_type === 'deer' ? '🦌' : '🐾') + ' ' + esc(r.name) + '</h2>' + pill(r.status) + '</div>' +
        '<div class="rq-dim">' + (r.recovery_type === 'deer' ? 'Deer recovery' : 'Pet recovery') + ' · submitted ' + esc(fmtTime(r.created_at)) + ' (' + esc(ago(r.created_at)) + ')</div>' +
        '<div class="rq-quick">' +
          '<a class="rq-btn-link primary-link" href="tel:' + esc(String(r.phone || '').replace(/[^\d+]/g, '')) + '">📞 Call ' + esc(prettyPhone(r.phone)) + '</a>' +
          (dirUrl ? '<a class="rq-btn-link" target="_blank" rel="noopener" href="' + esc(dirUrl) + '">🗺️ Directions</a>' : '') +
          '<button class="rq-msg-btn">✉️ Message customer</button>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<h3>Dispatch</h3>' +
        '<div class="rq-next-row">' + nextButtons + '</div>' +
        '<div class="rq-stepper">' + stepper + '</div>' +
        '<p class="tele rq-hint">Tap any step to jump to it. Going back asks you to confirm.</p>' +
        '<div class="rq-kv">' + kv + '</div>' +
      '</div>' +

      '<div class="card">' +
        '<h3>Customer</h3>' +
        '<div class="rq-kv">' +
          '<div class="rq-kv-k">Phone</div><div class="rq-kv-v"><a href="tel:' + esc(String(r.phone || '').replace(/[^\d+]/g, '')) + '">' + esc(prettyPhone(r.phone)) + '</a></div>' +
          '<div class="rq-kv-k">Texts</div><div class="rq-kv-v">' + (ch.sms.available ? '✅ Opted in to texts' : '🚫 ' + esc(ch.sms.reason || 'Not available') + ' (call only)') + '</div>' +
          '<div class="rq-kv-k">Email</div><div class="rq-kv-v">' + (r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '<span class="rq-dim">Not provided</span>') + '</div>' +
          '<div class="rq-kv-k">Location</div><div class="rq-kv-v">' + (r.location_description ? esc(r.location_description) : '<span class="rq-dim">Not provided</span>') + (hasPin ? '<br><span class="rq-dim">Pin: ' + Number(r.latitude).toFixed(5) + ', ' + Number(r.longitude).toFixed(5) + '</span>' : '') + '</div>' +
          '<div class="rq-kv-k">Details</div><div class="rq-kv-v rq-pre">' + (r.details ? esc(r.details) : '<span class="rq-dim">None</span>') + '</div>' +
          (r.ip_address ? '<div class="rq-kv-k">IP</div><div class="rq-kv-v rq-dim">' + esc(r.ip_address) + '</div>' : '') +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<h3>Internal note</h3>' +
        '<textarea id="rq-note" rows="2" placeholder="Only your team sees this. e.g. Called, landowner gave permission, meeting at the gate."></textarea>' +
        '<button class="rq-add-note" style="margin-top:0.6rem;">Add note</button>' +
      '</div>' +

      '<div class="card">' +
        '<h3>Timeline</h3>' +
        '<div class="rq-timeline">' + renderTimeline(d) + '</div>' +
      '</div>' +

      '<div class="rq-danger-zone"><button class="danger rq-delete">Delete request</button></div>';

    const view = $('rq-detail-view');
    view.querySelector('.rq-back').addEventListener('click', closeRequest);
    view.querySelector('.rq-refresh-one').addEventListener('click', loadDetail);
    view.querySelector('.rq-msg-btn').addEventListener('click', () => openSheet(null));
    view.querySelectorAll('.rq-next, .rq-step').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.status === r.status && !['assigned', 'en_route', 'closed'].includes(r.status)) return;
      openSheet(b.dataset.status);
    }));
    view.querySelector('.rq-add-note').addEventListener('click', addNote);
    view.querySelector('.rq-delete').addEventListener('click', deleteRequest);
  }

  function msgStatusBadge(m) {
    const s = m.status;
    if (s === 'delivered' || s === 'read') return '<span class="rq-mstat ok">Delivered</span>';
    if (s === 'failed' || s === 'undelivered') return '<span class="rq-mstat bad">' + (s === 'undelivered' ? 'Undelivered' : 'Failed') + '</span>';
    if (s === 'skipped') return '<span class="rq-mstat off">Not sent</span>';
    return '<span class="rq-mstat sent">' + (m.channel === 'sms' ? 'Sent to carrier' : 'Sent') + '</span>';
  }

  function renderTimeline(d) {
    const items = [];
    (d.events || []).forEach(e => {
      if (e.kind === 'message') return; // the messages themselves are listed below
      let title = '';
      if (e.kind === 'created') title = '📥 Request submitted on the website';
      else if (e.kind === 'status') title = '➡️ <b>' + esc(e.actor_name || 'Someone') + '</b> moved it ' + (e.from_status ? 'from ' + pill(e.from_status) + ' ' : '') + 'to ' + pill(e.to_status);
      else if (e.kind === 'note') title = '📝 <b>' + esc(e.actor_name || 'Someone') + '</b> added a note';
      else if (e.kind === 'duplicate') title = '⚠️ Duplicate submission blocked';
      else title = esc(e.kind);
      items.push({ at: e.created_at, html: '<div class="rq-tl-title">' + title + '</div>' + (e.note ? '<div class="rq-tl-body rq-pre">' + esc(e.note) + '</div>' : '') });
    });
    (d.messages || []).forEach(m => {
      const who = m.audience === 'customer' ? 'customer' : 'team';
      const icon = m.channel === 'sms' ? '💬' : '📧';
      const kind = m.channel === 'sms' ? 'Text' : 'Email';
      const to = m.channel === 'sms' ? prettyPhone(m.recipient) : m.recipient;
      items.push({
        at: m.created_at,
        cls: who === 'team' ? ' rq-tl-team' : '',
        html: '<div class="rq-tl-title">' + icon + ' ' + kind + ' to ' + who + ' <span class="rq-dim">(' + esc(to) + ')</span> ' + msgStatusBadge(m) +
          (m.actor_name ? ' <span class="rq-dim">by ' + esc(m.actor_name) + '</span>' : '') + '</div>' +
          (m.error ? '<div class="rq-tl-err">' + esc(m.error) + '</div>' : '') +
          '<details class="rq-tl-msg"><summary>Show message</summary>' + (m.subject ? '<div class="rq-dim">Subject: ' + esc(m.subject) + '</div>' : '') + '<div class="rq-pre">' + esc(m.body) + '</div></details>',
      });
    });
    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    if (!items.length) return '<p class="tele">No activity yet.</p>';
    return items.map(i => '<div class="rq-tl-item' + (i.cls || '') + '"><div class="rq-tl-time">' + esc(fmtTime(i.at)) + '</div>' + i.html + '</div>').join('');
  }

  async function addNote() {
    const ta = $('rq-note');
    const note = ta.value.trim();
    if (!note) return toast('Write a note first');
    const res = await apiJson('/recovery-requests?id=' + RQ.openId, { method: 'PUT', body: JSON.stringify({ action: 'note', note }) });
    if (!res.ok) return toast(res.data.error || 'Could not save the note');
    RQ.detail = Object.assign({}, RQ.detail, res.data);
    renderDetail();
    toast('Note added');
  }

  async function deleteRequest() {
    if (!confirm("Delete this recovery request and its history? This can't be undone.")) return;
    const res = await apiJson('/recovery-requests?id=' + RQ.openId, { method: 'DELETE' });
    if (!res.ok) return toast(res.data.error || 'Could not delete');
    closeRequest();
    loadRecovery();
  }

  // ---------- step / message sheet ----------
  function openSheet(toStatus) {
    const d = RQ.detail;
    if (!d) return;
    const r = d.request;
    const ch = d.channels;
    const isMessageOnly = !toStatus;
    const from = r.status;
    const backward = !isMessageOnly && from !== toStatus && (rank(toStatus) < rank(from) || rank(toStatus) === rank(from));
    if (backward && !confirm('Move this request back from "' + label(from) + '" to "' + label(toStatus) + '"?')) return;

    const templates = d.templates || {};
    const needsPilot = toStatus === 'assigned' || toStatus === 'en_route';
    const needsHours = toStatus === 'closed';
    const defaultPilot = r.assigned_pilot || (me() && me().name) || '';
    const tpl = isMessageOnly ? '' : defaultTemplate(r, toStatus, templates);
    const anyChannel = ch.sms.available || ch.email.available;

    const title = isMessageOnly ? 'Message customer' : (backward ? 'Move back to: ' : 'Mark as: ') + label(toStatus);
    const sheet = $('rq-sheet');
    sheet.innerHTML =
      '<div class="rq-sheet-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<div class="rq-sheet-head"><h3>' + esc(title) + '</h3><button class="rq-sheet-x" aria-label="Close">✕</button></div>' +
        '<div class="rq-dim" style="margin-bottom:0.9rem;">' + (r.recovery_type === 'deer' ? '🦌' : '🐾') + ' ' + esc(r.name) + ' · now ' + pill(r.status) + '</div>' +
        (needsPilot ? '<div class="rq-row2"><div><label class="tele">Pilot</label><input id="sh-pilot" value="' + esc(defaultPilot) + '" placeholder="Pilot name"></div>' +
          '<div><label class="tele">ETA</label><input id="sh-eta" value="' + esc(r.eta_text || '') + '" placeholder="e.g. 25 min or 9:40 PM"></div></div>' : '') +
        (needsHours ? '<div><label class="tele">Hours worked (for billing)</label><input id="sh-hours" type="number" inputmode="decimal" min="0" max="72" step="0.25" value="' + (r.hours_worked != null ? esc(String(Number(r.hours_worked))) : '') + '" placeholder="e.g. 2.5 (0 if nobody flew)"></div>' : '') +
        (isMessageOnly ? '' : '<div><label class="tele">Internal note (optional, team only)</label><textarea id="sh-note" rows="2"></textarea></div>') +

        '<div class="rq-msg-box">' +
          '<div class="tele" style="margin-bottom:0.5rem;">Customer message</div>' +
          (anyChannel
            ? '<div class="rq-channels">' +
                '<label class="' + (ch.sms.available ? '' : 'off') + '"><input type="checkbox" id="sh-sms" ' + (ch.sms.available ? '' : 'disabled') + '> 💬 Text ' + (ch.sms.available ? esc(prettyPhone(r.phone)) : '<span class="rq-dim">— ' + esc(ch.sms.reason) + '</span>') + '</label>' +
                '<label class="' + (ch.email.available ? '' : 'off') + '"><input type="checkbox" id="sh-email" ' + (ch.email.available ? '' : 'disabled') + '> 📧 Email ' + (ch.email.available ? esc(r.email) : '<span class="rq-dim">— no email on file</span>') + '</label>' +
              '</div>' +
              '<textarea id="sh-msg" rows="3" maxlength="640" placeholder="Write a message, or leave blank to skip">' + esc(fillTemplate(tpl, r, needsPilot ? defaultPilot : r.assigned_pilot, needsPilot ? (r.eta_text || '') : r.eta_text)) + '</textarea>' +
              '<div class="rq-dim rq-count" id="sh-count"></div>' +
              '<div class="rq-previews">' +
                (ch.sms.available ? '<div class="rq-preview-wrap" id="sh-sms-prev-wrap"><div class="tele">Text preview</div><div class="rq-preview" id="sh-sms-prev"></div></div>' : '') +
                (ch.email.available ? '<div class="rq-preview-wrap" id="sh-email-prev-wrap"><div class="tele">Email preview</div><div class="rq-preview" id="sh-email-prev"></div></div>' : '') +
              '</div>'
            : '<p class="rq-dim">This customer can\'t be messaged: they didn\'t opt in to texts and left no email. Call them at <a href="tel:' + esc(String(r.phone || '').replace(/[^\d+]/g, '')) + '">' + esc(prettyPhone(r.phone)) + '</a>.</p>') +
        '</div>' +

        '<div class="form-error rq-sheet-err" id="sh-err"></div>' +
        '<div class="rq-sheet-actions">' +
          (anyChannel ? '<button class="primary" id="sh-send">Save &amp; send</button>' : '') +
          (isMessageOnly ? '' : '<button id="sh-skip"' + (anyChannel ? '' : ' class="primary"') + '>' + (anyChannel ? 'Save, don\'t message' : 'Save') + '</button>') +
          '<button id="sh-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    sheet.hidden = false;
    RQ.sheetOpen = true;
    document.body.classList.add('rq-noscroll');

    const msg = $('sh-msg');
    let edited = false;
    const smsBox = $('sh-sms'), emailBox = $('sh-email');
    if (smsBox) smsBox.checked = ch.sms.available && (isMessageOnly || !!tpl);
    if (emailBox) emailBox.checked = ch.email.available && (isMessageOnly || !!tpl);

    function refreshPreview() {
      if (!msg) return;
      const text = msg.value.trim();
      const sms = formatSms(text);
      const sp = $('sh-sms-prev'), ep = $('sh-email-prev');
      if (sp) { sp.textContent = text ? sms : '(nothing will be sent)'; $('sh-sms-prev-wrap').classList.toggle('muted', !(smsBox && smsBox.checked)); }
      if (ep) { ep.textContent = text ? 'Subject: Update on your ' + animal(r) + ' recovery request\n\n' + formatEmail(r.name, text) : '(nothing will be sent)'; $('sh-email-prev-wrap').classList.toggle('muted', !(emailBox && emailBox.checked)); }
      const segs = Math.max(1, Math.ceil(sms.length / 153));
      $('sh-count').textContent = text ? sms.length + ' characters in the text' + (sms.length > 160 ? ' (~' + segs + ' segments)' : '') : 'Blank message: nothing will be sent.';
      const send = $('sh-send');
      if (send) {
        const willSend = text && ((smsBox && smsBox.checked) || (emailBox && emailBox.checked));
        const parts = [];
        if (text && smsBox && smsBox.checked) parts.push('text');
        if (text && emailBox && emailBox.checked) parts.push('email');
        send.disabled = !willSend;
        send.textContent = willSend ? (isMessageOnly ? 'Send ' : 'Save & send ') + parts.join(' + ') : (isMessageOnly ? 'Send' : 'Save & send');
      }
    }
    if (msg) {
      msg.addEventListener('input', () => { edited = true; refreshPreview(); });
      [smsBox, emailBox].forEach(b => b && b.addEventListener('change', refreshPreview));
      ['sh-pilot', 'sh-eta'].forEach(idn => {
        const el = $(idn);
        if (el) el.addEventListener('input', () => {
          if (edited) return;
          msg.value = fillTemplate(tpl, r, $('sh-pilot') ? $('sh-pilot').value.trim() : r.assigned_pilot, $('sh-eta') ? $('sh-eta').value.trim() : r.eta_text);
          refreshPreview();
        });
      });
      refreshPreview();
    }

    const close = () => { sheet.hidden = true; sheet.innerHTML = ''; RQ.sheetOpen = false; document.body.classList.remove('rq-noscroll'); };
    sheet.querySelector('.rq-sheet-x').addEventListener('click', close);
    $('sh-cancel').addEventListener('click', close);
    sheet.onclick = (e) => { if (e.target === sheet) close(); };

    async function submit(withMessage) {
      const err = $('sh-err');
      err.textContent = '';
      const body = { action: isMessageOnly ? 'message' : 'status' };
      if (!isMessageOnly) {
        body.status = toStatus;
        body.confirm_backward = backward;
        if (needsPilot) {
          body.pilot = $('sh-pilot').value.trim();
          body.eta = $('sh-eta').value.trim();
          if (toStatus === 'assigned' && !body.pilot) { err.textContent = "Enter the pilot's name."; return; }
        }
        if (needsHours) {
          const v = $('sh-hours').value.trim();
          if (v === '' || isNaN(Number(v)) || Number(v) < 0) { err.textContent = 'Enter hours worked (0 if nobody flew).'; return; }
          body.hours_worked = Number(v);
        }
        const note = $('sh-note');
        if (note && note.value.trim()) body.note = note.value.trim();
      }
      if (withMessage && msg && msg.value.trim()) {
        body.notify = { sms: !!(smsBox && smsBox.checked), email: !!(emailBox && emailBox.checked), message: msg.value.trim() };
      }
      const buttons = sheet.querySelectorAll('.rq-sheet-actions button');
      buttons.forEach(b => b.disabled = true);
      let res;
      try {
        res = await apiJson('/recovery-requests?id=' + r.id, { method: 'PUT', body: JSON.stringify(body) });
      } catch (e) {
        res = { ok: false, data: { error: 'Could not reach the server. Nothing was changed.' } };
      }
      buttons.forEach(b => b.disabled = false);
      if (!res.ok) { err.textContent = res.data.error || 'Something went wrong.'; refreshPreview(); return; }
      RQ.detail = res.data;
      close();
      renderDetail();
      const sent = res.data.sent || [];
      const summary = sent.map(s => (s.channel === 'sms' ? 'Text ' : 'Email ') + (s.result.ok ? 'sent ✓' : 'FAILED ✗')).join(' · ');
      toast((isMessageOnly ? '' : 'Updated to ' + label(res.data.request.status) + '. ') + (summary || 'No customer message sent.'));
      loadRecovery({ quiet: true });
    }
    const sendBtn = $('sh-send');
    if (sendBtn) sendBtn.addEventListener('click', () => submit(true));
    const skipBtn = $('sh-skip');
    if (skipBtn) skipBtn.addEventListener('click', () => submit(false));
  }

  // ---------- auto-refresh ----------
  function tick() {
    if (document.hidden || RQ.sheetOpen || !canView()) return;
    loadRecovery({ quiet: true });
    if (RQ.openId) loadDetail();
  }
  setInterval(tick, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  // ---------- wiring ----------
  document.querySelectorAll('.rq-filter').forEach(b => b.addEventListener('click', () => {
    RQ.filter = b.dataset.filter;
    renderList();
  }));
  $('refresh-recovery-btn').addEventListener('click', () => loadRecovery());

  window.loadRecovery = loadRecovery;
  window.resetRecoveryBoard = function () {
    RQ.all = []; RQ.knownIds = null; RQ.openId = null; RQ.detail = null;
    $('rq-detail-view').style.display = 'none';
    $('rq-list-view').style.display = 'block';
  };
})();
