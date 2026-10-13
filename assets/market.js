// Marketplace pages: order form, order tracking, partner sign-up and the professional's dashboard.
(function () {
  var C = window.SCCatalogue;
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(d) { return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); }
  function utm() { try { return JSON.parse(sessionStorage.getItem('sc_utm') || '{}'); } catch (e) { return {}; } }
  function api(url, method, body) {
    return fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; } return j; }); });
  }
  function msg(el, kind, text) { el.className = 'form-msg ' + kind; el.textContent = text; }
  function track(name, p) { if (window.gtag) window.gtag('event', name, p || {}); }

  // ── order form ──
  var orderForm = $('#order-form');
  if (orderForm && C) {
    var sel = orderForm.elements.service_slug;
    sel.innerHTML = '<option value="">Choose a service…</option>' + C.CATS.map(function (c) {
      return '<optgroup label="' + esc(c.name) + '">' + c.services.map(function (s) { return '<option value="' + s.slug + '">' + esc(s.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '<option value="other">Something else (describe below)</option>';
    var picked = $('#svc-picked');
    var showPicked = function () {
      var s = C.find(sel.value);
      picked.className = 'svc-picked' + (s ? ' on' : '');
      picked.innerHTML = s ? '<strong>' + esc(s.name) + '</strong><p>' + esc(s.desc) + '</p>' : '';
    };
    sel.addEventListener('change', showPicked);
    var q = $('#svc-q'), results = $('#svc-results');
    var all = [];
    C.CATS.forEach(function (c) { c.services.forEach(function (s) { all.push({ s: s, hay: (s.name + ' ' + s.desc + ' ' + s.forms.join(' ') + ' ' + c.name).toLowerCase() }); }); });
    q.addEventListener('input', function () {
      var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) { results.innerHTML = ''; return; }
      var hits = all.filter(function (x) { return words.every(function (w) { return x.hay.indexOf(w) >= 0; }); }).slice(0, 8);
      results.innerHTML = hits.length ? hits.map(function (x) { return '<button type="button" data-slug="' + x.s.slug + '">' + esc(x.s.name) + '</button>'; }).join('')
        : '<span class="muted small">No match. Choose "Something else" below and describe it.</span>';
    });
    results.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-slug]');
      if (!b) return;
      sel.value = b.getAttribute('data-slug');
      showPicked();
      results.innerHTML = '';
      q.value = '';
      orderForm.elements.details.focus();
    });
    var want = new URLSearchParams(location.search).get('s');
    if (want && C.find(want)) { sel.value = want; showPicked(); }

    orderForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = orderForm.elements, m = $('.form-msg', orderForm), btn = $('button[type=submit]', orderForm);
      var s = C.find(f.service_slug.value);
      if (!f.service_slug.value) { msg(m, 'err', 'Choose the service you need.'); return; }
      if (f.service_slug.value === 'other' && !f.details.value.trim()) { msg(m, 'err', 'Describe the service you need.'); return; }
      btn.disabled = true;
      api('/api/orders', 'POST', {
        service_slug: s ? s.slug : '', service: s ? s.name : 'Other: ' + f.details.value.trim().slice(0, 120),
        details: f.details.value, city: f.city.value, name: f.name.value, mobile: f.mobile.value, email: f.email.value,
        company: f.company.value, website: f.website.value, page: location.pathname, utm: utm(),
      }).then(function (j) {
        track('generate_lead', { method: 'order', service: s ? s.slug : 'other' });
        var box = $('#order-done');
        $('.ref', box).textContent = j.ref || '';
        var link = $('#order-track', box);
        if (j.track) link.href = j.track; else link.hidden = true;
        orderForm.hidden = true;
        box.hidden = false;
        box.scrollIntoView({ block: 'start' });
      }).catch(function (err) {
        msg(m, 'err', err.message + ' You can also WhatsApp us on +91 86861 45656.');
      }).then(function () { btn.disabled = false; });
    });
  }

  // ── order tracking ──
  var trackBox = $('#track-box');
  if (trackBox) {
    var t = new URLSearchParams(location.search).get('t');
    var STEPS = [['new', 'Received'], ['assigned', 'Professional assigned'], ['accepted', 'Accepted'], ['in_progress', 'In progress'], ['completed', 'Completed']];
    var RANK = { new: 0, unassigned: 0, assigned: 1, accepted: 2, in_progress: 3, completed: 4 };
    if (!t) trackBox.innerHTML = '<p>Open the tracking link from your order email. Lost it? WhatsApp us on +91 86861 45656 with your order number.</p>';
    else api('/api/orders?t=' + encodeURIComponent(t)).then(function (o) {
      var r = RANK[o.status];
      var p = o.professional;
      trackBox.innerHTML =
        '<div class="label">Order ' + esc(o.ref) + ' · placed ' + when(o.created_at) + '</div>' +
        '<h2 style="margin:6px 0 4px">' + esc(o.service) + '</h2>' +
        '<p class="muted">' + esc(o.city || '') + ' · Status: <strong>' + esc(o.status_label) + '</strong></p>' +
        (o.status === 'cancelled' ? '<p class="callout">This order was cancelled.</p>' :
          '<div class="status-steps">' + STEPS.map(function (s, i) { return '<div class="' + (i < r ? 'on' : i === r ? 'now' : '') + '">' + s[1] + '</div>'; }).join('') + '</div>') +
        (p ? '<div class="pro-card"><div class="av">' + esc(p.name.charAt(0)) + '</div><div><strong>' + esc(p.name) + '</strong><br><span class="small">' + esc(p.qualification) + (p.firm ? ' · ' + esc(p.firm) : '') + ' · ' + esc(p.city) + '</span></div></div>' : '') +
        '<h3 style="margin:8px 0 14px">Updates</h3><ul class="timeline">' + o.events.slice().reverse().map(function (e) { return '<li><time>' + when(e.at) + '</time>' + esc(e.message) + '</li>'; }).join('') + '</ul>';
    }).catch(function (err) { trackBox.innerHTML = '<p class="form-msg err" style="display:block">' + esc(err.message) + '</p>'; });
  }

  // ── professional sign-up ──
  var partnerForm = $('#partner-form');
  if (partnerForm && C) {
    $('#cat-checks').innerHTML = C.CATS.map(function (c) {
      return '<label class="check"><input type="checkbox" name="categories" value="' + c.id + '"> <span>' + esc(c.name) + '<br><span class="muted small">' + esc(c.line) + '</span></span></label>';
    }).join('');
    partnerForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = partnerForm.elements, m = $('.form-msg', partnerForm), btn = $('button[type=submit]', partnerForm);
      btn.disabled = true;
      api('/api/providers', 'POST', {
        name: f.name.value, firm: f.firm.value, email: f.email.value, mobile: f.mobile.value, qualification: f.qualification.value,
        membership_no: f.membership_no.value, city: f.city.value, remote_ok: f.remote_ok.checked, about: f.about.value, website: f.website.value,
        categories: $all('input[name=categories]:checked', partnerForm).map(function (x) { return x.value; }),
      }).then(function () {
        track('generate_lead', { method: 'partner_signup' });
        partnerForm.innerHTML = '<div class="done-box"><h2>Application received</h2><p>We will verify your membership and email you within two working days. Once approved, matching orders come straight to your inbox.</p></div>';
      }).catch(function (err) { msg(m, 'err', err.message); }).then(function () { btn.disabled = false; });
    });
  }

  // ── professional dashboard ──
  var dash = $('#pro-app');
  if (dash) {
    var loginBox = $('#pro-login'), board = $('#pro-board');
    if (/expired=1/.test(location.search)) msg($('.form-msg', loginBox), 'err', 'That login link has expired or was already used. Request a new one.');
    var showLogin = function () { loginBox.hidden = false; board.hidden = true; };
    var STATUS_TEXT = { assigned: 'New — accept or decline', accepted: 'Accepted', in_progress: 'In progress', completed: 'Completed' };
    var digits = function (m) { var d = String(m || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };
    var card = function (o) {
      var head = '<div class="meta">' + esc(o.ref) + ' · ' + esc(o.city || '') + ' · received ' + when(o.created_at) + ' <span class="pill-s ' + o.status + '">' + STATUS_TEXT[o.status] + '</span></div>' +
        '<h3>' + esc(o.service) + '</h3>' + (o.company ? '<div class="small muted">' + esc(o.company) + '</div>' : '') +
        (o.details ? '<div class="req">' + esc(o.details) + '</div>' : '');
      if (o.status === 'assigned') {
        return '<div class="order-card new" data-id="' + o.id + '">' + head +
          '<p class="small">Accept by <strong>' + when(o.accept_by) + '</strong> to see the client\'s contact details. After that it goes to the next professional.</p>' +
          '<div class="acts"><button class="btn btn-navy btn-sm" data-act="accept">Accept order</button><button class="btn btn-sm" data-act="decline">Decline</button></div></div>';
      }
      var contact = '<div class="o-contact"><strong>' + esc(o.name) + '</strong> · <a href="tel:+' + digits(o.mobile) + '">' + esc(o.mobile) + '</a>' +
        '<a href="https://wa.me/' + digits(o.mobile) + '" target="_blank" rel="noopener">WhatsApp</a>' + (o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : '') + '</div>';
      if (o.status === 'completed') return '<div class="order-card" data-id="' + o.id + '">' + head + contact + '<div class="small muted">Completed ' + when(o.completed_at) + (o.quote_amount != null ? ' · Fee ₹' + Number(o.quote_amount).toLocaleString('en-IN') : '') + '</div></div>';
      return '<div class="order-card" data-id="' + o.id + '">' + head + contact +
        '<form class="upd"><div class="field" style="margin:0"><label>Status</label><select class="input" name="status">' +
        '<option value="accepted"' + (o.status === 'accepted' ? ' selected' : '') + '>Accepted</option>' +
        '<option value="in_progress"' + (o.status === 'in_progress' ? ' selected' : '') + '>In progress</option>' +
        '<option value="completed">Completed</option></select></div>' +
        '<div class="field" style="margin:0"><label>Update for the client (they get it by email)</label><input class="input" name="message" maxlength="1000" placeholder="e.g. Documents received, application filed on the portal"></div>' +
        '<div class="field" style="margin:0"><label>Fee agreed (₹)</label><input class="input" name="quote_amount" type="number" min="0" step="1" value="' + (o.quote_amount != null ? o.quote_amount : '') + '"></div>' +
        '<button class="btn btn-navy btn-sm" type="submit">Save</button></form></div>';
    };
    var load = function () {
      return api('/api/provider').then(function (j) {
        loginBox.hidden = true; board.hidden = false;
        $('#pro-name').textContent = j.me.name + ' · ' + j.me.qualification + (j.me.firm ? ' · ' + j.me.firm : '');
        var news = j.orders.filter(function (o) { return o.status === 'assigned'; });
        var active = j.orders.filter(function (o) { return o.status === 'accepted' || o.status === 'in_progress'; });
        var done = j.orders.filter(function (o) { return o.status === 'completed'; });
        $('#pro-new').innerHTML = news.length ? news.map(card).join('') : '<p class="muted">No new orders right now. We email you the moment one matches your work.</p>';
        $('#pro-active').innerHTML = active.length ? active.map(card).join('') : '<p class="muted">Nothing in progress.</p>';
        $('#pro-done').innerHTML = done.length ? done.map(card).join('') : '<p class="muted">No completed orders yet.</p>';
        $('#pro-counts').textContent = news.length + ' new · ' + active.length + ' in progress · ' + done.length + ' completed';
      }).catch(function (err) { if (err.status === 401) showLogin(); else alert(err.message); });
    };
    $('form', loginBox).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target, m = $('.form-msg', f), btn = $('button', f);
      btn.disabled = true;
      api('/api/provider', 'POST', { action: 'login', email: f.elements.email.value })
        .then(function () { msg(m, 'ok', 'If this email belongs to an approved professional, a login link is on its way. It works once, for 30 minutes.'); })
        .catch(function (err) { msg(m, 'err', err.message); }).then(function () { btn.disabled = false; });
    });
    board.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-act]');
      if (!b) return;
      var id = Number(b.closest('.order-card').getAttribute('data-id'));
      var act = b.getAttribute('data-act');
      var body = { action: act, order_id: id };
      if (act === 'decline') {
        var reason = prompt('Decline this order? It will go to the next professional. Reason (optional):');
        if (reason === null) return;
        body.reason = reason;
      }
      b.disabled = true;
      api('/api/provider', 'POST', body).then(load).catch(function (err) { alert(err.message); b.disabled = false; });
    });
    board.addEventListener('submit', function (ev) {
      var f = ev.target.closest('form.upd');
      if (!f) return;
      ev.preventDefault();
      var id = Number(f.closest('.order-card').getAttribute('data-id'));
      if (f.elements.status.value === 'completed' && !confirm('Mark this order completed? The client is told by email.')) return;
      api('/api/provider', 'POST', { action: 'update', order_id: id, status: f.elements.status.value, message: f.elements.message.value, quote_amount: f.elements.quote_amount.value })
        .then(load).catch(function (err) { alert(err.message); });
    });
    $('#pro-logout').addEventListener('click', function () { api('/api/provider', 'POST', { action: 'logout' }).then(showLogin, showLogin); });
    load();
  }
})();
