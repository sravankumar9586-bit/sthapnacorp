(function () {
  // Edit these once: WhatsApp number (country code, no +) and optional Google Analytics / Ads IDs.
  var CONFIG = {
    whatsapp: '918686145656',
    gaId: '',            // e.g. 'G-XXXXXXXXXX'
    adsId: '',           // e.g. 'AW-1234567890'
    adsLeadLabel: ''     // conversion label for a lead, e.g. 'AbCdEfGhIj'
  };

  var D = window.SCDeadlines;
  var today = D.todayIST();
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function daysLabel(n) { return n === 0 ? 'due today' : n === 1 ? '1 day left' : n + ' days left'; }
  function heat(n) { return n <= 7 ? 'hot' : n <= 30 ? 'warm' : 'cool'; }
  function waUrl(text) { return 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(text); }

  // ── analytics ──
  if (CONFIG.gaId || CONFIG.adsId) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + (CONFIG.gaId || CONFIG.adsId);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    if (CONFIG.gaId) window.gtag('config', CONFIG.gaId);
    if (CONFIG.adsId) window.gtag('config', CONFIG.adsId);
  }
  function track(name, params) { if (window.gtag) window.gtag('event', name, params || {}); }
  function trackLead(kind) {
    track('generate_lead', { lead_type: kind });
    if (CONFIG.adsId && CONFIG.adsLeadLabel) track('conversion', { send_to: CONFIG.adsId + '/' + CONFIG.adsLeadLabel });
  }

  // ── campaign source (kept for the session so leads show which ad or post they came from) ──
  try {
    var q = new URLSearchParams(location.search);
    var utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid'].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k).slice(0, 120); });
    if (Object.keys(utm).length) sessionStorage.setItem('sc_utm', JSON.stringify(utm));
  } catch (e) { /* storage blocked */ }
  function getUtm() { try { return JSON.parse(sessionStorage.getItem('sc_utm') || '{}'); } catch (e) { return {}; } }

  // ── WhatsApp links ──
  $all('[data-wa]').forEach(function (a) {
    var text = a.getAttribute('data-wa') || 'Hi SthapnaCorp, I need help with a company compliance matter.';
    a.href = waUrl(text);
    a.target = '_blank';
    a.rel = 'noopener';
    a.addEventListener('click', function () { track('contact_whatsapp', { label: text.slice(0, 80) }); });
  });

  // ── mobile menu ──
  var head = $('.site-head');
  var menuBtn = $('.menu-btn');
  if (head && menuBtn) {
    menuBtn.addEventListener('click', function () {
      head.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', head.classList.contains('open') ? 'true' : 'false');
    });
    $all('.nav a', head).forEach(function (a) { a.addEventListener('click', function () { head.classList.remove('open'); }); });
  }

  // ── app bar on phones + installable app ──
  if (!document.querySelector('.app-bar')) {
    var here = location.pathname.replace(/\/$/, '') || '/';
    var items = [['/', '🏠', 'Home'], ['/services', '🗂️', 'Services'], ['/order', '➕', 'Order'], ['/my', '📋', 'My orders']];
    var barEl = document.createElement('nav');
    barEl.className = 'app-bar';
    barEl.setAttribute('aria-label', 'App');
    barEl.innerHTML = items.map(function (x) {
      var on = x[0] === '/' ? here === '/' : here.indexOf(x[0]) === 0;
      return '<a href="' + x[0] + '"' + (on ? ' class="on" aria-current="page"' : '') + '><span class="i" aria-hidden="true">' + x[1] + '</span>' + x[2] + '</a>';
    }).join('');
    document.body.appendChild(barEl);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  // ── deadline bar + board (re-drawn when official extensions load) ──
  var headline = [];
  function renderTop() {
    headline = D.headline(today, 5);
    var bar = $('#dbar .wrap');
    if (bar) $('#dbar').hidden = !headline.length;
    if (bar && headline.length) {
      var first = headline[0];
      var same = headline.filter(function (e) { return D.iso(e.date) === D.iso(first.date); });
      var forms = same.map(function (e) { return e.form; }).join(' & ');
      var n = D.daysBetween(today, first.date);
      var allRoc = same.every(function (e) { return e.note.indexOf('₹100') === 0; });
      var ext = same.filter(function (e) { return e.extension; })[0];
      bar.innerHTML =
        '<span><strong>' + esc(forms) + '</strong> due ' + D.fmt(first.date) + ' · ' + daysLabel(n) + '</span>' +
        (ext ? '<span class="dbar-extra">Extended from ' + D.fmt(ext.originalDate) + '.</span>' : allRoc ? '<span class="dbar-extra">Late filing costs ₹100 a day per form.</span>' : '') +
        '<a href="' + waUrl('Hi, I need to file ' + forms + ' before ' + D.fmt(first.date) + '. Can you help?') + '" target="_blank" rel="noopener">File it on time →</a>';
    }
    var board = $('#board-rows');
    if (board) {
      var bt = $('#board-today');
      if (bt) bt.textContent = 'As of ' + D.fmt(today);
      board.innerHTML = headline.map(function (e) {
        var n = D.daysBetween(today, e.date);
        return '<div class="board-row"><span class="code">' + esc(e.form) + '</span>' +
          '<span class="t">' + esc(e.title) + '<small>' + D.fmt(e.date) + (e.extension ? ' · extended' : '') + '</small></span>' +
          '<span class="days ' + heat(n) + '">' + daysLabel(n) + '</span></div>';
      }).join('');
    }
  }
  renderTop();

  // ── compliance calendar ──
  var calForm = $('#cal-form');
  var calOut = $('#cal-out');
  function calProfile() {
    var f = calForm.elements;
    return {
      entity: f.entity.value,
      incDate: f.incDate.value || '',
      agmDate: f.agmDate ? f.agmDate.value || '' : '',
      gst: f.gst.checked, tds: f.tds.checked, msme: f.msme.checked, taxAudit: f.taxAudit.checked
    };
  }
  function renderCal() {
    var p = calProfile();
    var agmField = $('#agm-field');
    if (agmField) agmField.hidden = p.entity !== 'pvt';
    var events = D.generate(p, today, D.addDays(today, 365));
    var month = -1;
    var html = '';
    events.forEach(function (e) {
      var m = e.date.getUTCFullYear() * 12 + e.date.getUTCMonth();
      if (m !== month) {
        month = m;
        html += '<div class="cal-month">' + MONTHS[e.date.getUTCMonth()] + ' ' + e.date.getUTCFullYear() + '</div>';
      }
      var n = D.daysBetween(today, e.date);
      html += '<div class="cal-item"><div class="cal-date tnum">' + e.date.getUTCDate() + '<small>' + MONTHS[e.date.getUTCMonth()].slice(0, 3) + '</small></div>' +
        '<div class="cal-body"><span class="code">' + esc(e.form) + '</span><span class="ttl">' + esc(e.title) + '</span>' +
        (e.extension ? '<div class="ext">' + (e.extension.kind === 'fee_waiver' ? 'No additional fee until ' + D.fmt(e.date) + ' (normally ' + D.fmt(e.originalDate) + ')' : 'Extended from ' + D.fmt(e.originalDate)) +
          (e.extension.source_url ? ' · <a href="' + esc(e.extension.source_url) + '" target="_blank" rel="noopener">official notice</a>' : '') + '</div>' : '') +
        (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') + '</div>' +
        '<span class="pill ' + heat(n) + '">' + daysLabel(n) + '</span></div>';
    });
    calOut.innerHTML = html || '<p class="muted">No deadlines in the next 12 months for this profile.</p>';
    var count = $('#cal-count');
    if (count) count.textContent = events.length + ' deadlines in the next 12 months';
  }
  if (calForm && calOut) {
    calForm.addEventListener('input', renderCal);
    calForm.addEventListener('change', renderCal);
    renderCal();
  }

  // ── reminder subscription ──
  var subForm = $('#sub-form');
  if (subForm) {
    subForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = $('.form-msg', subForm);
      var btn = $('button[type=submit]', subForm);
      var f = subForm.elements;
      var payload = {
        name: f.name.value.trim(), email: f.email.value.trim(), mobile: f.mobile.value.trim(),
        company: f.company.value.trim(), website: f.website.value,
        profile: calForm ? calProfile() : { entity: 'pvt' }
      };
      btn.disabled = true;
      fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || 'Request failed');
          msg.className = 'form-msg ok';
          msg.textContent = res.j.queued
            ? 'Thanks, we have your details. We will be in touch about these deadlines.'
            : 'Done. Reminders for these deadlines will go to ' + payload.email + ', starting with a confirmation email now.';
          subForm.reset();
          trackLead('reminder_subscribe');
        })
        .catch(function (err) {
          msg.className = 'form-msg err';
          msg.textContent = (err && err.message && err.message !== 'Request failed' ? err.message + ' ' : '') + 'If this keeps happening, WhatsApp us on +91 86861 45656 and we will add you manually.';
        })
        .then(function () { btn.disabled = false; });
    });
  }

  // ── late fee calculator ──
  var feeForm = $('#fee-form');
  var renderFee = null;
  if (feeForm) {
    var fySel = feeForm.elements.oldest;
    var latestFyEnd = today.getUTCFullYear() - (today.getUTCMonth() < 3 ? 1 : 0);
    for (var Y = latestFyEnd; Y >= 2019; Y--) {
      var o = document.createElement('option');
      o.value = Y;
      o.textContent = 'FY ' + (Y - 1) + '-' + String(Y).slice(2);
      if (Y === latestFyEnd - 1) o.selected = true;
      fySel.appendChild(o);
    }
    feeForm.elements.filed.value = D.iso(today);
    renderFee = function () {
      var forms = feeForm.elements.forms.value.split(',');
      var filed = D.parse(feeForm.elements.filed.value) || today;
      var r = D.lateFee(forms, Number(fySel.value), filed);
      $('#fee-total').textContent = rupees(r.total);
      var label = r.rows.length ? r.rows.length + ' late form' + (r.rows.length > 1 ? 's' : '') + ', filed on ' + D.fmt(filed) : 'Nothing is late yet for these forms on ' + D.fmt(filed) + '.';
      $('#fee-sub').textContent = label;
      $('#fee-rows').innerHTML = r.rows.map(function (row) {
        return '<tr><td>' + esc(row.form) + (row.note ? '<small class="fee-note">' + esc(row.note) + '</small>' : '') + '</td><td>' + esc(row.fy) + '</td><td>' + D.fmt(row.due) + '</td><td class="num">' + row.daysLate.toLocaleString('en-IN') + '</td><td class="num">' + rupees(row.fee) + '</td></tr>';
      }).join('');
      $('#fee-table').hidden = !r.rows.length;
      var years = r.rows.reduce(function (acc, row) { acc[row.fy] = 1; return acc; }, {});
      var nYears = Object.keys(years).length;
      $('#fee-warning').hidden = nYears < 3 || forms[0].indexOf('form') === 0;
      var cta = $('#fee-cta');
      cta.href = waUrl('Hi, I have pending ' + r.rows.map(function (x) { return x.form + ' (' + x.fy + ')'; }).join(', ') + '. Estimated late fee ' + rupees(r.total) + '. Please advise.');
    };
    feeForm.addEventListener('input', renderFee);
    feeForm.addEventListener('change', renderFee);
    renderFee();
  }

  // ── official extensions (approved after checking MCA, CBDT, CBIC and PIB daily) ──
  function renderUpdates(data) {
    var box = $('#official-updates');
    if (!box) return;
    var live = (data.overrides || []).filter(function (o) { return D.daysBetween(today, D.parse(o.new_due)) >= -30; });
    var checked = data.last_checked ? new Date(data.last_checked) : null;
    var when = checked ? checked.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
    box.innerHTML = '<h3>Official extensions</h3>' +
      (live.length ? '<ul>' + live.map(function (o) {
        return '<li><strong>' + esc(o.form_label) + (o.fy_end ? ' (FY ' + (o.fy_end - 1) + '-' + String(o.fy_end).slice(2) + ')' : '') + '</strong> — ' +
          (o.kind === 'fee_waiver' ? 'no additional fee until ' : 'due date extended to ') + D.fmt(D.parse(o.new_due)) +
          (o.source_url ? ' · <a href="' + esc(o.source_url) + '" target="_blank" rel="noopener">' + esc(o.source_title || 'official notice') + '</a>' : '') + '</li>';
      }).join('') + '</ul>' : '<p>No extensions are currently in force. All dates shown are the regular statutory due dates.</p>') +
      '<p class="muted">We check MCA, CBDT (Income Tax), CBIC (GST) and PIB announcements every day' + (when ? '. Last checked ' + when : '') + '. The calendar, reminders and late-fee estimates follow any extension automatically.</p>';
    box.hidden = false;
  }
  if (window.fetch && (document.querySelector('#official-updates, #dbar, #cal-form, #fee-form'))) {
    fetch('/api/updates').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data) return;
      D.setOverrides(data.overrides || []);
      renderTop();
      if (calForm && calOut) renderCal();
      if (renderFee) renderFee();
      renderUpdates(data);
    }).catch(function () { /* the regular statutory dates stay on screen */ });
  }

  // ── compliance health check ──
  var hcForm = $('#hc-form');
  if (hcForm) {
    var ENT = { pvt: 'private limited company', opc: 'OPC', llp: 'LLP' };
    var renderHc = function () {
      var f = hcForm.elements;
      var v = function (n) { var el = hcForm.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ''; };
      var entity = v('entity'), age = v('age');
      $all('.hc-q', hcForm).forEach(function (q) {
        var hideFor = (q.getAttribute('data-hide-for') || '').split(' ');
        q.hidden = hideFor.indexOf(entity) >= 0 || (q.getAttribute('data-hide-age') === age && age !== '');
      });
      var level = $('#hc-level'), summary = $('#hc-summary'), list = $('#hc-issues'), lead = $('#hc-lead');
      if (entity === 'none') {
        level.className = 'hc-level ok';
        level.textContent = 'Start with the right structure';
        summary.innerHTML = 'Private limited, LLP or OPC? Each has different costs, compliance and fundraising options. <a href="/incorporate">Compare and apply online</a>, or ask us which suits you.';
        list.innerHTML = '';
        $('#hc-message').value = 'Health check: not registered yet, wants help choosing a structure.';
        $('#hc-wa').href = waUrl('Hi SthapnaCorp, I want to start a business. Which structure should I choose?');
        lead.querySelector('h3').textContent = 'Get free advice on the right structure';
        return;
      }
      lead.querySelector('h3').textContent = 'Get a free review of these points';
      var isCo = entity !== 'llp';
      var high = [], med = [], check = [];
      var filings = age === 'new' ? 'na' : v('filings');
      var formsTxt = isCo ? 'AOC-4 and MGT-7' : 'Form 8 and Form 11';
      if (filings === 'many') high.push((isCo ? 'Two or more years of ' + formsTxt + ' pending. At three years every director is disqualified under section 164(2) and the Registrar can strike the company off.' : 'Two or more years of ' + formsTxt + ' pending. The LLP can be struck off and the designated partners face penalties.') + ' The late fee grows by ₹100 a day per form.');
      if (filings === 'one') high.push('One year of ' + formsTxt + ' pending. The additional fee is growing by ₹100 a day for each form.');
      if (filings === 'late') med.push('Some filings were late. Check that the additional fees were paid and that no adjudication notice is pending.');
      if (filings === 'unsure') check.push('Whether every past ' + formsTxt + ' was filed');
      var din = v('din');
      if (din === 'no') high.push('Deactivated DINs block every MCA filing until DIR-3 KYC is filed with the ₹5,000 fee.');
      if (din === 'unsure') check.push('The KYC status of each DIN');
      if (isCo) {
        var inc = v('inc20a');
        if (inc === 'no') high.push('Without INC-20A the company cannot start business or borrow, and faces a ₹50,000 penalty.');
        if (inc === 'unsure') check.push('Whether INC-20A was filed');
        var aud = v('auditor');
        if (aud === 'no') high.push('Every company must have a statutory auditor. Without one, the accounts cannot be audited or filed.');
        if (aud === 'unsure') check.push('The auditor appointment (ADT-1)');
        var mins = v('minutes');
        if (mins === 'no') med.push('Board minutes and statutory registers are mandatory. Gaps surface in bank loans, due diligence and funding rounds.');
        if (mins === 'unsure') check.push('Minutes books and statutory registers');
      }
      var gst = v('gst');
      if (gst === 'pending') high.push('Pending GST returns attract daily late fees and interest, can block e-way bills, and stop your customers from claiming input tax credit.');
      var cls, head;
      if (high.length) { cls = 'bad'; head = 'High risk: act now'; }
      else if (med.length || check.length >= 3) { cls = 'warn'; head = 'Needs attention'; }
      else { cls = 'ok'; head = check.length ? 'Mostly fine, a few things to confirm' : 'Looks healthy'; }
      level.className = 'hc-level ' + cls;
      level.textContent = head;
      summary.textContent = high.length + med.length
        ? (high.length + med.length) + ' issue' + (high.length + med.length > 1 ? 's' : '') + ' found for your ' + ENT[entity] + (check.length ? ', and ' + check.length + ' thing' + (check.length > 1 ? 's' : '') + ' to confirm.' : '.')
        : (check.length ? 'No problems reported. Confirm these from your MCA records:' : 'Keep it that way: get reminders from the compliance calendar below.');
      list.innerHTML = high.map(function (t) { return '<li class="hi">' + esc(t) + '</li>'; }).join('') +
        med.map(function (t) { return '<li class="md">' + esc(t) + '</li>'; }).join('') +
        check.map(function (t) { return '<li class="ck">Check: ' + esc(t) + '</li>'; }).join('');
      var lines = ['Health check (' + ENT[entity] + ', registered ' + ({ old: 'before Apr 2025', fy26: 'FY 2025-26', 'new': 'Apr 2026 or later' })[age] + '): ' + head]
        .concat(high.map(function (t) { return 'HIGH: ' + t; }), med.map(function (t) { return 'MEDIUM: ' + t; }), check.map(function (t) { return 'CHECK: ' + t; }));
      $('#hc-message').value = lines.join('\n').slice(0, 1900);
      $('#hc-wa').href = waUrl('Hi SthapnaCorp, I did the compliance health check on your website. Result: ' + head + '. ' + (high.length + med.length) + ' issue(s), ' + check.length + ' to confirm. Please review my company.');
    };
    hcForm.addEventListener('change', renderHc);
    renderHc();
    var hcWa = $('#hc-wa');
    if (hcWa) { hcWa.target = '_blank'; hcWa.rel = 'noopener'; hcWa.addEventListener('click', function () { track('contact_whatsapp', { label: 'health check' }); }); }
  }

  // ── "enquire about this" buttons fill the contact form ──
  $all('[data-service]').forEach(function (el) {
    el.addEventListener('click', function () {
      var sel = $('#lead-service');
      if (!sel) return;
      var want = el.getAttribute('data-service');
      $all('option', sel).forEach(function (o) { if (o.value === want || o.textContent === want) sel.value = o.value; });
    });
  });

  // ── lead forms ──
  $all('form.lead-form').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = $('.form-msg', form);
      var btn = $('button[type=submit]', form);
      var f = form.elements;
      var payload = {
        name: f.name.value.trim(), mobile: f.mobile.value.trim(), email: f.email ? f.email.value.trim() : '',
        company: f.company ? f.company.value.trim() : '', service: f.service ? f.service.value : '',
        message: f.message ? f.message.value.trim() : '', website: f.website ? f.website.value : '',
        page: location.pathname, utm: getUtm()
      };
      btn.disabled = true;
      fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || 'Request failed');
          msg.className = 'form-msg ok';
          msg.innerHTML = 'Thanks, ' + esc(payload.name.split(' ')[0]) + '. We will call you on ' + esc(payload.mobile) + ' within one working day with a written quote. ' +
            '<a href="' + waUrl('Hi, I just sent an enquiry on your website about ' + (payload.service || 'compliance') + '. My name is ' + payload.name + '.') + '" target="_blank" rel="noopener">Prefer WhatsApp? Message us now.</a>';
          form.reset();
          trackLead(payload.service || 'general');
        })
        .catch(function (err) {
          msg.className = 'form-msg err';
          msg.innerHTML = esc(err && err.message !== 'Request failed' ? err.message + ' ' : '') + 'Your enquiry did not go through. Please <a href="' + waUrl('Hi, I need help with ' + (payload.service || 'compliance') + '. ' + payload.message) + '" target="_blank" rel="noopener">message us on WhatsApp</a> or email sthapnacorp@gmail.com.';
        })
        .then(function () { btn.disabled = false; });
    });
  });
})();
