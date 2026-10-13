// Marketplace pages: ordering, the customer's "My orders" app, partner sign-up and the expert's jobs page.
(function () {
  var C = window.SCCatalogue;
  var ICONS = { register: '🏢', annual: '📅', changes: '🔁', fema: '🌐', exit: '🚪', tax: '🧾', licences: '📜', telangana: '🏛️', ip: '™️', legal: '⚖️' };
  var SUPPORT_WA = 'https://wa.me/918686145656';
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(d) { return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); }
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }
  function utm() { try { return JSON.parse(sessionStorage.getItem('sc_utm') || '{}'); } catch (e) { return {}; } }
  function api(url, method, body) {
    return fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; } return j; }); });
  }
  function msg(el, kind, text) { el.className = 'form-msg ' + kind; el.textContent = text; }
  function track(name, p) { if (window.gtag) window.gtag('event', name, p || {}); }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 3 * 1024 * 1024) return reject(new Error('Files must be under 3 MB. Compress the PDF or photo and try again.'));
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(new Error('Could not read the file.')); };
      fr.readAsDataURL(file);
    });
  }
  function upload(file, extra) {
    return readFile(file).then(function (data) {
      return api('/api/files', 'POST', Object.assign({ name: file.name, mime: file.type || 'application/octet-stream', data: data }, extra));
    });
  }
  // Chat bubbles shared by the customer and expert views.
  function chatHtml(messages, me) {
    if (!messages.length) return '<p class="muted small chat-empty">No messages yet.</p>';
    var label = { client: 'Customer', expert: 'Expert', admin: 'SthapnaCorp' };
    return messages.map(function (m) {
      return '<div class="bubble ' + (m.sender === me ? 'me' : 'them') + (m.sender === 'admin' ? ' admin' : '') + '"><div class="who">' + (m.sender === me ? 'You' : label[m.sender]) + ' · ' + when(m.at) + '</div>' + esc(m.body) + '</div>';
    }).join('');
  }
  function filesHtml(files, q) {
    if (!files.length) return '<p class="muted small">No documents yet.</p>';
    var by = { client: 'customer', expert: 'expert', admin: 'SthapnaCorp' };
    return '<ul class="file-list">' + files.map(function (f) {
      return '<li><a href="/api/files?id=' + f.id + (q || '') + '">' + esc(f.name) + '</a><span class="muted small"> · ' + kb(f.size) + ' · from ' + by[f.uploaded_by] + ' · ' + when(f.at) + '</span></li>';
    }).join('') + '</ul>';
  }

  // ── order page ──
  var orderForm = $('#order-form');
  if (orderForm && C) {
    var settings = {};
    var picked = null;
    var f = orderForm.elements;
    var priceLine = function (slug) {
      var s = settings[slug] || {};
      return (s.price != null ? '<strong>' + rupees(s.price) + '</strong>' : 'Quote in 1 working day') + (s.turnaround ? ' · ' + esc(s.turnaround) : '');
    };
    var active = function (svc) { return !(settings[svc.slug] && settings[svc.slug].active === false); };
    var drawTiles = function () {
      $('#cat-tiles').innerHTML = C.CATS.map(function (c) {
        return '<button type="button" class="cat-tile" data-cat="' + c.id + '"><span class="ic">' + (ICONS[c.id] || '•') + '</span><strong>' + esc(c.name) + '</strong><small>' + esc(c.line) + '</small></button>';
      }).join('') + '<button type="button" class="cat-tile" data-other="1"><span class="ic">💬</span><strong>Something else</strong><small>Describe what you need</small></button>';
    };
    var svcRow = function (s) {
      return '<button type="button" class="svc-row" data-slug="' + s.slug + '"><span><strong>' + esc(s.name) + '</strong><small>' + esc(s.desc) + '</small></span><span class="svc-meta">' + priceLine(s.slug) + '<em>Select →</em></span></button>';
    };
    var showCat = function (id) {
      var c = C.CATS.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      $('#cat-title').textContent = c.name;
      $('#svc-list').innerHTML = c.services.filter(active).map(svcRow).join('');
      $('#cat-tiles').hidden = true; $('#cat-list').hidden = false;
      $('#cat-list').scrollIntoView({ block: 'start' });
    };
    var choose = function (slug) {
      var s = slug === 'other' ? null : C.find(slug);
      picked = s;
      f.service_slug.value = s ? s.slug : 'other';
      var st = s ? settings[s.slug] || {} : {};
      $('#svc-picked').innerHTML = s
        ? '<div><div class="label">You are ordering</div><strong>' + esc(s.name) + '</strong><p>' + esc(s.desc) + '</p><p class="price-line">' + priceLine(s.slug) + (st.note ? ' · ' + esc(st.note) : '') + '</p></div>'
        : '<div><div class="label">You are ordering</div><strong>Something else</strong><p>Describe it below and we will match the right expert.</p></div>';
      $('#svc-picked').insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-sm" id="svc-change">Change</button>');
      f.details.required = !s;
      f.details.placeholder = s ? 'Anything the expert should know (optional)' : 'What do you need? e.g. "Bank asked for a CA certificate of net worth"';
      $('#step-pick').hidden = true; $('#step-details').hidden = false;
      $('#step-details').scrollIntoView({ block: 'start' });
      track('select_item', { item_id: s ? s.slug : 'other' });
    };
    orderForm.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-cat],[data-other],[data-slug],#svc-change,#cat-back');
      if (!t) return;
      if (t.id === 'svc-change') { $('#step-pick').hidden = false; $('#step-details').hidden = true; return; }
      if (t.id === 'cat-back') { $('#cat-tiles').hidden = false; $('#cat-list').hidden = true; return; }
      if (t.hasAttribute('data-other')) return choose('other');
      if (t.hasAttribute('data-cat')) return showCat(t.getAttribute('data-cat'));
      choose(t.getAttribute('data-slug'));
    });
    var all = [];
    C.CATS.forEach(function (c) { c.services.forEach(function (s) { all.push({ s: s, hay: (s.name + ' ' + s.desc + ' ' + s.forms.join(' ') + ' ' + c.name).toLowerCase() }); }); });
    $('#svc-q').addEventListener('input', function () {
      var words = this.value.toLowerCase().split(/\s+/).filter(Boolean);
      var out = $('#svc-results');
      if (!words.length) { out.innerHTML = ''; return; }
      var hits = all.filter(function (x) { return active(x.s) && words.every(function (w) { return x.hay.indexOf(w) >= 0; }); }).slice(0, 6);
      out.innerHTML = hits.length ? hits.map(function (x) { return svcRow(x.s); }).join('') : '<p class="muted small">No match. Choose "Something else" below and describe it.</p>';
    });
    drawTiles();
    var want = new URLSearchParams(location.search).get('s');
    api('/api/services').then(function (j) { settings = j.settings || {}; }).catch(function () {}).then(function () {
      if (want && C.find(want)) choose(want);
    });
    orderForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = $('.form-msg', orderForm), btn = $('button[type=submit]', orderForm);
      if (!f.service_slug.value) { msg(m, 'err', 'Choose the service you need.'); return; }
      if (!picked && !f.details.value.trim()) { msg(m, 'err', 'Describe what you need.'); return; }
      btn.disabled = true;
      api('/api/orders', 'POST', {
        service_slug: picked ? picked.slug : '', service: picked ? picked.name : 'Other: ' + f.details.value.trim().slice(0, 120),
        details: f.details.value, city: f.city.value, name: f.name.value, mobile: f.mobile.value, email: f.email.value,
        company: f.company.value, website: f.website.value, page: location.pathname, utm: utm(),
      }).then(function (j) {
        track('generate_lead', { method: 'order', service: picked ? picked.slug : 'other' });
        if (j.url) { location.href = j.url + '&new=1'; return; }
        msg(m, 'ok', 'Thank you. We have your order and will contact you within one working day.');
      }).catch(function (err) {
        msg(m, 'err', err.message + ' You can also WhatsApp us on +91 86861 45656.');
      }).then(function () { btn.disabled = false; });
    });
  }

  // ── customer app: My orders ──
  var myApp = $('#my-app');
  if (myApp) {
    var qs = new URLSearchParams(location.search);
    var tokenQ = qs.get('t');
    var current = null, timer = null;
    var STEPS = ['Placed', 'Expert assigned', 'Quote', 'Paid', 'In progress', 'Completed'];
    var show = function (id) { ['my-login', 'my-list', 'my-order'].forEach(function (x) { $('#' + x).hidden = x !== id; }); };
    var orderQ = function (o) { return tokenQ ? { t: tokenQ } : { id: o.id }; };
    var orderUrlQ = function () { return tokenQ ? 't=' + encodeURIComponent(tokenQ) : 'id=' + current.id; };

    var drawList = function (j) {
      show('my-list');
      $('#my-hello').textContent = 'Hi ' + j.me.name.split(' ')[0];
      $('#my-orders').innerHTML = j.orders.length ? j.orders.map(function (o) {
        return '<a class="order-tile' + (o.needs_action ? ' attn' : '') + '" href="/my?id=' + o.id + '"><div><div class="meta">' + esc(o.ref) + ' · ' + when(o.created_at) + '</div><strong>' + esc(o.service) + '</strong>' +
          '<div class="st ' + o.status + '">' + esc(o.status_label) + (o.needs_action ? ' · action needed' : '') + '</div></div><span class="go">›</span></a>';
      }).join('') : '<div class="panel" style="text-align:center"><p>No orders yet.</p><a class="btn btn-gold" href="/order">Order a service</a></div>';
    };
    var drawOrder = function (o, keepChat) {
      current = o;
      show('my-order');
      var draft = keepChat && $('#chat-input') ? $('#chat-input').value : '';
      var q = tokenQ ? '&t=' + encodeURIComponent(tokenQ) : '';
      var stepHtml = o.status === 'cancelled' ? '<p class="callout">This order was cancelled.</p>' :
        '<div class="status-steps six">' + STEPS.map(function (s, i) { return '<div class="' + (i < o.step ? 'on' : i === o.step ? 'now' : '') + '">' + s + '</div>'; }).join('') + '</div>';
      var action = '';
      if (o.can.pay || o.can.approve) {
        action = '<div class="action-card"><div class="label">Your quote</div><div class="big">' + rupees(o.price) + '</div>' + (o.quote_note ? '<p class="note">' + esc(o.quote_note) + '</p>' : '') +
          '<p class="small muted">Includes the expert\'s fee. Government fees, if any, are shown in the quote note or charged at actuals.</p>' +
          (o.can.pay ? '<button class="btn btn-gold btn-lg" id="pay-btn">Pay ' + rupees(o.price) + ' securely</button>' : '<button class="btn btn-gold btn-lg" id="approve-btn">Accept quote</button><p class="small muted" style="margin-top:8px">SthapnaCorp will send you a payment link by WhatsApp or email.</p>') +
          '<p class="small" style="margin-top:8px">Questions first? Message your expert below.</p></div>';
      } else if (o.status === 'approved') {
        action = '<div class="action-card"><div class="label">Quote accepted</div><div class="big">' + rupees(o.price) + '</div><p>SthapnaCorp will send you a payment link shortly. Work starts as soon as it is paid.</p></div>';
      } else if (o.can.rate) {
        action = '<div class="action-card"><div class="label">How was your expert?</div><div class="rate" id="rate">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-star="' + n + '" aria-label="' + n + ' stars">☆</button>'; }).join('') + '</div>' +
          '<textarea class="input" id="review" rows="2" maxlength="1000" placeholder="Anything you want to tell us (optional)"></textarea><button class="btn btn-navy" id="rate-btn" style="margin-top:10px">Submit rating</button></div>';
      } else if (o.rating) {
        action = '<div class="action-card soft">You rated this order <span class="stars">' + stars(o.rating) + '</span>. Thank you!</div>';
      } else if (o.step === 0 && o.status !== 'cancelled') {
        action = '<div class="action-card soft"><div class="pulse"></div> We are finding the right expert for you. You will get an email as soon as one is assigned.</div>';
      }
      var ex = o.expert;
      var expertHtml = ex ? '<div class="pro-card"><div class="av">' + esc(ex.name.charAt(0)) + '</div><div><div class="label">Your SthapnaCorp expert</div><strong>' + esc(ex.name) + '</strong> · ' + esc(ex.qualification) +
        '<br><span class="small">' + (ex.rating ? '<span class="stars">★ ' + ex.rating + '</span> (' + ex.ratings + ') · ' : '') + (ex.completed ? ex.completed + ' orders completed · ' : 'New on SthapnaCorp · ') + esc(ex.city) + '</span></div></div>' : '';
      $('#my-order').innerHTML =
        (tokenQ && !o.signed_in ? '' : '<a class="back" href="/my">‹ My orders</a>') +
        (qs.get('new') ? '<div class="form-msg ok" style="display:block;margin-bottom:14px">Order placed. We have emailed you a link to this page.</div>' : '') +
        '<div class="panel"><div class="label">Order ' + esc(o.ref) + ' · ' + when(o.created_at) + '</div><h2 style="margin:6px 0 4px">' + esc(o.service) + '</h2>' +
        '<p class="muted">' + esc(o.city || '') + ' · <strong>' + esc(o.status_label) + '</strong></p>' + stepHtml + action + expertHtml + '</div>' +
        '<div class="my-grid"><div class="panel"><h3>Chat with ' + (ex ? 'your expert' : 'SthapnaCorp') + '</h3><div class="chat" id="chat">' + chatHtml(o.messages, 'client') + '</div>' +
        (o.can.message ? '<form class="chat-form" id="chat-form"><textarea class="input" id="chat-input" rows="2" maxlength="3000" placeholder="Type a message"></textarea><div class="chat-acts"><label class="btn btn-sm file-btn">📎 Attach<input type="file" id="file-input" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"></label><button class="btn btn-navy btn-sm" type="submit">Send</button></div><div class="form-msg" role="status"></div></form>' : '') +
        '</div><div><div class="panel"><h3>Documents</h3>' + filesHtml(o.files, q) + '</div>' +
        '<div class="panel" style="margin-top:16px"><h3>Updates</h3><ul class="timeline">' + o.events.slice().reverse().map(function (e) { return '<li><time>' + when(e.at) + '</time>' + esc(e.message) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="panel" style="margin-top:16px"><h3>Need help?</h3><p class="small">WhatsApp SthapnaCorp on <a href="' + SUPPORT_WA + '?text=' + encodeURIComponent('Hi, about order ' + o.ref) + '" target="_blank" rel="noopener">' + esc(o.support_phone) + '</a> quoting ' + esc(o.ref) + '.</p>' +
        (o.can.cancel ? '<button class="btn btn-sm" id="cancel-btn">Cancel order</button>' : '') + '</div></div></div>';
      if (draft) $('#chat-input').value = draft;
      var chat = $('#chat'); chat.scrollTop = chat.scrollHeight;
    };
    var loadOrder = function (keep) {
      var p = tokenQ ? 't=' + encodeURIComponent(tokenQ) : 'id=' + encodeURIComponent(qs.get('id'));
      return api('/api/my?' + p).then(function (o) { drawOrder(o, keep); }).catch(function (err) {
        if (!keep) { show('my-order'); $('#my-order').innerHTML = '<div class="panel"><p>' + esc(err.message) + '</p><a class="btn btn-navy" href="/my">Sign in</a></div>'; }
      });
    };
    var act = function (body) { return api('/api/my', 'POST', Object.assign(body, orderQ(current))).then(function () { return loadOrder(true); }); };
    var loadScript = function (src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('Could not load the payment window. Check your connection.')); }; document.head.appendChild(s); }); };

    myApp.addEventListener('click', function (ev) {
      var t = ev.target;
      var star = t.closest('[data-star]');
      if (star) {
        var n = Number(star.getAttribute('data-star'));
        $('#rate').setAttribute('data-value', n);
        $all('#rate button').forEach(function (b, i) { b.textContent = i < n ? '★' : '☆'; b.classList.toggle('on', i < n); });
        return;
      }
      if (t.id === 'rate-btn') {
        var v = Number($('#rate').getAttribute('data-value'));
        if (!v) { alert('Tap the stars to choose a rating.'); return; }
        act({ action: 'rate', stars: v, review: $('#review').value }).catch(function (e) { alert(e.message); });
      }
      if (t.id === 'approve-btn') { t.disabled = true; act({ action: 'approve' }).catch(function (e) { alert(e.message); t.disabled = false; }); }
      if (t.id === 'cancel-btn') {
        var reason = prompt('Cancel this order? Tell us why (optional):');
        if (reason === null) return;
        act({ action: 'cancel', reason: reason }).catch(function (e) { alert(e.message); });
      }
      if (t.id === 'pay-btn') {
        t.disabled = true;
        Promise.all([api('/api/my', 'POST', Object.assign({ action: 'pay' }, orderQ(current))), window.Razorpay ? null : loadScript('https://checkout.razorpay.com/v1/checkout.js')])
          .then(function (r) {
            var p = r[0];
            var rz = new window.Razorpay({
              key: p.key_id, amount: p.amount, currency: 'INR', order_id: p.rzp_order_id, name: 'SthapnaCorp', description: p.description,
              prefill: { name: p.name, email: p.email, contact: p.mobile }, theme: { color: '#0D1B3E' },
              handler: function (resp) { act(Object.assign({ action: 'paid' }, resp)).then(function () { track('purchase', { value: p.amount / 100, currency: 'INR' }); }).catch(function (e) { alert(e.message); }); },
              modal: { ondismiss: function () { t.disabled = false; } },
            });
            rz.open();
          }).catch(function (e) { alert(e.message); t.disabled = false; });
      }
    });
    myApp.addEventListener('submit', function (ev) {
      if (ev.target.id !== 'chat-form') return;
      ev.preventDefault();
      var input = $('#chat-input'), m = $('.form-msg', ev.target);
      if (!input.value.trim()) return;
      var body = input.value;
      input.value = '';
      api('/api/my', 'POST', Object.assign({ action: 'message', body: body }, orderQ(current))).then(function () { return loadOrder(true); })
        .catch(function (e) { input.value = body; msg(m, 'err', e.message); });
    });
    myApp.addEventListener('change', function (ev) {
      if (ev.target.id !== 'file-input' || !ev.target.files[0]) return;
      var m = $('#chat-form .form-msg');
      msg(m, 'ok', 'Uploading…');
      upload(ev.target.files[0], orderQ(current)).then(function () { m.className = 'form-msg'; return loadOrder(true); }).catch(function (e) { msg(m, 'err', e.message); });
      ev.target.value = '';
    });

    // sign in with a code
    var login = $('#my-login');
    $('#code-form', login).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.target, m = $('.form-msg', form);
      if (!form.elements.code.value) {
        api('/api/my', 'POST', { action: 'code', email: form.elements.email.value }).then(function () {
          $('#code-field').hidden = false; form.elements.code.focus();
          $('button', form).textContent = 'Sign in';
          msg(m, 'ok', 'If you have ordered with this email, a 6-digit code is on its way. It is valid for 10 minutes.');
        }).catch(function (e) { msg(m, 'err', e.message); });
        return;
      }
      api('/api/my', 'POST', { action: 'verify', email: form.elements.email.value, code: form.elements.code.value })
        .then(function () { location.reload(); }).catch(function (e) { msg(m, 'err', e.message); });
    });
    $('#my-logout').addEventListener('click', function () { api('/api/my', 'POST', { action: 'logout' }).then(function () { location.href = '/my'; }); });

    if (tokenQ || qs.get('id')) {
      loadOrder(false);
      timer = setInterval(function () { if (!document.hidden && current) loadOrder(true); }, 20000);
    } else {
      api('/api/my').then(drawList).catch(function (err) { if (err.status === 401) show('my-login'); else alert(err.message); });
    }
  }

  // ── expert sign-up ──
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
        partnerForm.innerHTML = '<div class="done-box"><h2>Application received</h2><p>We will verify your membership and email you within two working days. Once approved, matching jobs come straight to your inbox.</p></div>';
      }).catch(function (err) { msg(m, 'err', err.message); }).then(function () { btn.disabled = false; });
    });
  }

  // ── expert app: My jobs ──
  var dash = $('#pro-app');
  if (dash) {
    var loginBox = $('#pro-login'), board = $('#pro-board');
    var openChats = {};
    if (/expired=1/.test(location.search)) msg($('.form-msg', loginBox), 'err', 'That login link has expired or was already used. Request a new one.');
    var showLogin = function () { loginBox.hidden = false; board.hidden = true; };
    var PILL = { assigned: 'New — accept or decline', accepted: 'Send your quote', quoted: 'Waiting for customer payment', approved: 'Customer accepted · payment pending', paid: 'Paid · start work', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
    var card = function (o) {
      var head = '<div class="meta">' + esc(o.ref) + ' · ' + esc(o.city || '') + ' · ' + when(o.created_at) + ' <span class="pill-s ' + o.status + '">' + PILL[o.status] + '</span></div>' +
        '<h3>' + esc(o.service) + '</h3>' + (o.company ? '<div class="small muted">' + esc(o.company) + '</div>' : '') +
        (o.details ? '<div class="req">' + esc(o.details) + '</div>' : '');
      if (o.status === 'assigned') {
        return '<div class="order-card new" data-id="' + o.id + '">' + head + (o.price != null ? '<p class="small">Fixed price ' + rupees(o.price) + ' · you earn ' + rupees(o.money.expert_earning) + '</p>' : '') +
          '<p class="small">Accept by <strong>' + when(o.accept_by) + '</strong>, or it goes to the next expert.</p>' +
          '<div class="acts"><button class="btn btn-navy btn-sm" data-act="accept">Accept job</button><button class="btn btn-sm" data-act="decline">Decline</button></div></div>';
      }
      var money = o.price != null ? '<div class="money">Price ' + rupees(o.price) + ' · platform fee ' + o.money.pct + '% · <strong>you earn ' + rupees(o.money.expert_earning) + '</strong>' +
        (o.status === 'completed' ? ' · ' + (o.payout_status === 'paid' ? 'paid out' : 'payout due') : '') + '</div>' : '';
      var body = '';
      if (['accepted', 'quoted', 'approved'].indexOf(o.status) >= 0) {
        body = '<form class="quote-form"><div class="field" style="margin:0"><label>Your total fee (₹)</label><input class="input" name="amount" type="number" min="1" step="1" value="' + (o.price != null ? o.price : '') + '" required></div>' +
          '<div class="field" style="margin:0"><label>What it includes, documents needed, timeline</label><input class="input" name="note" maxlength="1500" value="' + esc(o.quote_note || '') + '"></div>' +
          '<button class="btn btn-navy btn-sm" type="submit">' + (o.status === 'accepted' ? 'Send quote' : 'Update quote') + '</button></form>';
      } else if (o.status === 'paid' || o.status === 'in_progress') {
        body = '<form class="upd"><div class="field" style="margin:0"><label>Status</label><select class="input" name="status">' +
          '<option value="in_progress"' + (o.status === 'in_progress' ? ' selected' : '') + '>In progress</option><option value="completed">Completed</option></select></div>' +
          '<div class="field" style="margin:0"><label>Update for the customer</label><input class="input" name="message" maxlength="1000" placeholder="e.g. Application filed; SRN shared in documents"></div>' +
          '<button class="btn btn-navy btn-sm" type="submit">Save</button></form>';
      } else if (o.status === 'completed' && o.rating) {
        body = '<div class="small">Customer rating: <span class="stars">' + stars(o.rating) + '</span></div>';
      }
      var chat = o.status !== 'cancelled' ? '<details class="job-chat" data-chat="' + o.id + '"' + (openChats[o.id] ? ' open' : '') + '><summary>Chat with ' + esc(o.customer || 'customer') + ' & documents' + (o.message_count ? ' (' + o.message_count + ')' : '') + '</summary><div class="chat-body"><p class="muted small">Loading…</p></div></details>' : '';
      return '<div class="order-card" data-id="' + o.id + '">' + head + money + body + chat + '</div>';
    };
    var loadChat = function (id) {
      var box = $('details[data-chat="' + id + '"] .chat-body');
      if (!box) return;
      api('/api/provider?order=' + id).then(function (j) {
        var draft = $('textarea', box) ? $('textarea', box).value : '';
        box.innerHTML = '<div class="chat">' + chatHtml(j.messages, 'expert') + '</div>' +
          '<form class="chat-form" data-id="' + id + '"><textarea class="input" rows="2" maxlength="3000" placeholder="Message the customer (they get it by email)"></textarea><div class="chat-acts"><label class="btn btn-sm file-btn">📎 Attach<input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" data-id="' + id + '"></label><button class="btn btn-navy btn-sm" type="submit">Send</button></div><div class="form-msg"></div></form>' +
          '<h4 style="margin:14px 0 6px">Documents</h4>' + filesHtml(j.files, '');
        if (draft) $('textarea', box).value = draft;
        var c = $('.chat', box); c.scrollTop = c.scrollHeight;
      }).catch(function (e) { box.innerHTML = '<p class="form-msg err" style="display:block">' + esc(e.message) + '</p>'; });
    };
    var load = function () {
      return api('/api/provider').then(function (j) {
        loginBox.hidden = true; board.hidden = false;
        $('#pro-name').textContent = j.me.name + ' · ' + j.me.qualification;
        $('#pro-rating').textContent = j.me.rating ? '★ ' + j.me.rating + ' (' + j.me.ratings + ' ratings)' : 'No ratings yet';
        $('#pro-online').checked = !!j.me.available;
        $('#pro-online-label').textContent = j.me.available ? 'Online — receiving new jobs' : 'Offline — no new jobs';
        $('#pro-earn-due').textContent = rupees(j.earnings.due);
        $('#pro-earn-paid').textContent = rupees(j.earnings.paid_out);
        var news = j.jobs.filter(function (o) { return o.status === 'assigned'; });
        var active = j.jobs.filter(function (o) { return ['accepted', 'quoted', 'approved', 'paid', 'in_progress'].indexOf(o.status) >= 0; });
        var done = j.jobs.filter(function (o) { return o.status === 'completed' || o.status === 'cancelled'; });
        $('#pro-new').innerHTML = news.length ? news.map(card).join('') : '<p class="muted">No new jobs right now. We email you the moment one matches your work.</p>';
        $('#pro-active').innerHTML = active.length ? active.map(card).join('') : '<p class="muted">Nothing in progress.</p>';
        $('#pro-done').innerHTML = done.length ? done.map(card).join('') : '<p class="muted">No completed jobs yet.</p>';
        $('#pro-counts').textContent = news.length + ' new · ' + active.length + ' active · ' + done.filter(function (o) { return o.status === 'completed'; }).length + ' completed';
        Object.keys(openChats).forEach(function (id) { if (openChats[id]) loadChat(id); });
      }).catch(function (err) { if (err.status === 401) showLogin(); else alert(err.message); });
    };
    $('form', loginBox).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target, m = $('.form-msg', f), btn = $('button', f);
      btn.disabled = true;
      api('/api/provider', 'POST', { action: 'login', email: f.elements.email.value })
        .then(function () { msg(m, 'ok', 'If this email belongs to an approved expert, a login link is on its way. It works once, for 30 minutes.'); })
        .catch(function (err) { msg(m, 'err', err.message); }).then(function () { btn.disabled = false; });
    });
    board.addEventListener('toggle', function (ev) {
      var d = ev.target;
      if (!d.matches || !d.matches('details[data-chat]')) return;
      var id = d.getAttribute('data-chat');
      openChats[id] = d.open;
      if (d.open) loadChat(id);
    }, true);
    board.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-act]');
      if (!b) return;
      var id = Number(b.closest('.order-card').getAttribute('data-id'));
      var a = b.getAttribute('data-act');
      var body = { action: a, order_id: id };
      if (a === 'decline') {
        var reason = prompt('Decline this job? It will go to the next expert. Reason (optional):');
        if (reason === null) return;
        body.reason = reason;
      }
      b.disabled = true;
      api('/api/provider', 'POST', body).then(load).catch(function (err) { alert(err.message); b.disabled = false; });
    });
    board.addEventListener('submit', function (ev) {
      var form = ev.target;
      ev.preventDefault();
      var cardEl = form.closest('.order-card');
      var id = Number(cardEl ? cardEl.getAttribute('data-id') : form.getAttribute('data-id'));
      if (form.classList.contains('quote-form')) {
        api('/api/provider', 'POST', { action: 'quote', order_id: id, amount: form.elements.amount.value, note: form.elements.note.value }).then(load).catch(function (e) { alert(e.message); });
      } else if (form.classList.contains('upd')) {
        if (form.elements.status.value === 'completed' && !confirm('Mark this job completed? The customer is told by email and asked to rate you.')) return;
        api('/api/provider', 'POST', { action: 'update', order_id: id, status: form.elements.status.value, message: form.elements.message.value }).then(load).catch(function (e) { alert(e.message); });
      } else if (form.classList.contains('chat-form')) {
        var ta = $('textarea', form);
        if (!ta.value.trim()) return;
        var text = ta.value; ta.value = '';
        api('/api/provider', 'POST', { action: 'message', order_id: id, body: text }).then(function () { loadChat(id); }).catch(function (e) { ta.value = text; alert(e.message); });
      }
    });
    board.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'pro-online') {
        api('/api/provider', 'POST', { action: 'availability', available: t.checked }).then(load).catch(function (e) { alert(e.message); });
        return;
      }
      if (t.type === 'file' && t.files[0]) {
        var id = Number(t.getAttribute('data-id'));
        upload(t.files[0], { order_id: id }).then(function () { loadChat(id); }).catch(function (e) { alert(e.message); });
        t.value = '';
      }
    });
    $('#pro-logout').addEventListener('click', function () { api('/api/provider', 'POST', { action: 'logout' }).then(showLogin, showLogin); });
    load();
    setInterval(function () { if (!document.hidden && !board.hidden && !document.activeElement.closest('form')) load(); }, 60000);
  }
})();
