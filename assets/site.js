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

  // ── deadline bar ──
  var bar = $('#dbar .wrap');
  var headline = D.headline(today, 5);
  if (bar && !headline.length) $('#dbar').hidden = true;
  if (bar && headline.length) {
    var first = headline[0];
    var same = headline.filter(function (e) { return D.iso(e.date) === D.iso(first.date); });
    var forms = same.map(function (e) { return e.form; }).join(' & ');
    var n = D.daysBetween(today, first.date);
    var allRoc = same.every(function (e) { return e.note.indexOf('₹100') === 0; });
    bar.innerHTML =
      '<span><strong>' + esc(forms) + '</strong> due ' + D.fmt(first.date) + ' · ' + daysLabel(n) + '</span>' +
      (allRoc ? '<span class="dbar-extra">Late filing costs ₹100 a day per form.</span>' : '') +
      '<a href="' + waUrl('Hi, I need to file ' + forms + ' before ' + D.fmt(first.date) + '. Can you help?') + '" target="_blank" rel="noopener">File it on time →</a>';
  }

  // ── deadline board ──
  var board = $('#board-rows');
  if (board) {
    var bt = $('#board-today');
    if (bt) bt.textContent = 'As of ' + D.fmt(today);
    board.innerHTML = headline.map(function (e) {
      var n = D.daysBetween(today, e.date);
      return '<div class="board-row"><span class="code">' + esc(e.form) + '</span>' +
        '<span class="t">' + esc(e.title) + '<small>' + D.fmt(e.date) + '</small></span>' +
        '<span class="days ' + heat(n) + '">' + daysLabel(n) + '</span></div>';
    }).join('');
  }

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
          msg.textContent = 'Done. Reminders for these deadlines will go to ' + payload.email + ', starting with a confirmation email now.';
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
    var renderFee = function () {
      var forms = feeForm.elements.forms.value.split(',');
      var filed = D.parse(feeForm.elements.filed.value) || today;
      var r = D.lateFee(forms, Number(fySel.value), filed);
      $('#fee-total').textContent = rupees(r.total);
      var label = r.rows.length ? r.rows.length + ' late form' + (r.rows.length > 1 ? 's' : '') + ', filed on ' + D.fmt(filed) : 'Nothing is late yet for these forms on ' + D.fmt(filed) + '.';
      $('#fee-sub').textContent = label;
      $('#fee-rows').innerHTML = r.rows.map(function (row) {
        return '<tr><td>' + esc(row.form) + '</td><td>' + esc(row.fy) + '</td><td>' + D.fmt(row.due) + '</td><td class="num">' + row.daysLate.toLocaleString('en-IN') + '</td><td class="num">' + rupees(row.fee) + '</td></tr>';
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
