// Statutory due-date engine shared by the website (window.SCDeadlines) and the reminder cron (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SCDeadlines = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DAY = 86400000;

  function d(y, m, day) { return new Date(Date.UTC(y, m - 1, day)); }
  function addDays(dt, n) { return new Date(dt.getTime() + n * DAY); }
  function parse(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number);
    return d(p[0], p[1], p[2]);
  }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function todayIST() {
    var now = new Date(Date.now() + 330 * 60000);
    return d(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / DAY); }
  function fy(y) { return 'FY ' + (y - 1) + '-' + String(y).slice(2); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmt(dt) { return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear(); }

  var ROC_FEE = '₹100 per day additional fee, no upper limit';
  var LLP_FEE = '₹100 per day additional fee per form';
  var ANNUAL = [30, 7, 1];
  var MONTHLY = [3];

  // profile: { entity: 'pvt'|'opc'|'llp', incDate, agmDate, gst, tds, msme, taxAudit }
  function generate(profile, from, to) {
    profile = profile || {};
    var entity = profile.entity || 'pvt';
    var isCo = entity === 'pvt' || entity === 'opc';
    var inc = parse(profile.incDate);
    var agmOverride = parse(profile.agmDate);
    var out = [];
    function push(key, form, title, date, note, lead, kind) {
      out.push({ key: key + ':' + iso(date), form: form, title: title, date: date, note: note || '', lead: lead || ANNUAL, kind: kind || 'roc' });
    }

    for (var Y = from.getUTCFullYear() - 1; Y <= to.getUTCFullYear() + 1; Y++) {
      var label = fy(Y);
      var fyExists = !inc || inc <= d(Y, 3, 31);
      if (!fyExists) {
        // company did not exist during this financial year: no annual filings
      } else if (isCo) {
        if (entity === 'pvt') {
          var agm = (agmOverride && agmOverride.getUTCFullYear() === Y) ? agmOverride : d(Y, 9, 30);
          if (!agmOverride || agmOverride.getUTCFullYear() !== Y) push('agm', 'AGM', 'Hold the AGM for ' + label, d(Y, 9, 30), 'Within 6 months of the financial year end');
          push('aoc4', 'AOC-4', 'File financial statements for ' + label, addDays(agm, 30), ROC_FEE);
          push('mgt7', 'MGT-7/7A', 'File the annual return for ' + label, addDays(agm, 60), ROC_FEE);
        } else {
          push('aoc4', 'AOC-4', 'File financial statements for ' + label + ' (OPC)', d(Y, 9, 27), ROC_FEE);
          push('mgt7', 'MGT-7A', 'File the annual return for ' + label + ' (OPC)', addDays(d(Y, 9, 30), 60), ROC_FEE);
        }
        push('dpt3', 'DPT-3', 'Return of deposits / outstanding loans as on 31 March ' + Y, d(Y, 6, 30), 'Penalty under section 73 onwards');
        push('itr6', 'ITR-6', 'Company income tax return for ' + label, d(Y, 10, 31), 'Late fee and interest; carry-forward of losses may be lost', ANNUAL, 'tax');
        if (profile.msme) {
          push('msme1', 'MSME-1', 'Half-yearly return of dues to micro & small suppliers (Apr–Sep ' + Y + ')', d(Y, 10, 31), 'Penalty under section 405');
          push('msme1', 'MSME-1', 'Half-yearly return of dues to micro & small suppliers (Oct ' + (Y - 1) + '–Mar ' + Y + ')', d(Y, 4, 30), 'Penalty under section 405');
        }
      } else {
        push('form11', 'Form 11', 'LLP annual return for ' + label, d(Y, 5, 30), LLP_FEE);
        push('form8', 'Form 8', 'LLP statement of account & solvency for ' + label, d(Y, 10, 30), LLP_FEE);
        if (profile.taxAudit) push('itr5', 'ITR-5', 'LLP income tax return for ' + label + ' (audit case)', d(Y, 10, 31), 'Late fee and interest', ANNUAL, 'tax');
        else push('itr5', 'ITR-5', 'LLP income tax return for ' + label + ' (non-audit)', d(Y, 7, 31), 'Check for any CBDT extension', ANNUAL, 'tax');
      }
      if (profile.taxAudit && fyExists) push('3cd', 'Tax audit', 'Tax audit report (Form 3CA/3CB-3CD) for ' + label, d(Y, 9, 30), 'Penalty for failure to furnish the audit report', ANNUAL, 'tax');

      [[6, 15, 'first'], [9, 15, 'second'], [12, 15, 'third'], [3, 15, 'last']].forEach(function (a) {
        push('advtax', 'Advance tax', 'Pay the ' + a[2] + ' advance tax instalment', d(Y, a[0], a[1]), 'Interest on shortfall', [7, 1], 'tax');
      });
      if (profile.tds) {
        [[7, 31, 'Apr–Jun'], [10, 31, 'Jul–Sep'], [1, 31, 'Oct–Dec'], [5, 31, 'Jan–Mar']].forEach(function (a) {
          push('tds', 'TDS return', 'Quarterly TDS statement (' + a[2] + ' quarter)', d(Y, a[0], a[1]), 'Late fee per day of delay, plus interest', [7, 1], 'tax');
        });
      }
      if (profile.gst) {
        for (var m = 1; m <= 12; m++) {
          push('gstr1', 'GSTR-1', 'Outward supplies for the previous month', d(Y, m, 11), 'Late fee per day, capped by turnover', MONTHLY, 'gst');
          push('gstr3b', 'GSTR-3B', 'Summary return and tax payment for the previous month', d(Y, m, 20), 'Late fee per day plus 18% interest on tax', MONTHLY, 'gst');
        }
        push('gstr9', 'GSTR-9', 'GST annual return for ' + fy(Y), d(Y, 12, 31), 'Late fee per day, capped by turnover', ANNUAL, 'gst');
      }
    }

    if (inc) {
      push('bm1', 'Board meeting', 'Hold the first board meeting', addDays(inc, 30), 'Within 30 days of incorporation');
      if (isCo) {
        push('aud1', 'Auditor', 'Board to appoint the first auditor', addDays(inc, 30), 'Within 30 days of incorporation');
        push('inc20a', 'INC-20A', 'Declaration of commencement of business', addDays(inc, 180), '₹50,000 penalty on the company; officers ₹1,000/day up to ₹1 lakh');
      }
    }

    return out
      .filter(function (e) { return e.date >= from && e.date <= to; })
      .sort(function (a, b) { return a.date - b.date || a.form.localeCompare(b.form); });
  }

  // Headline deadlines for the public deadline board: annual ROC and tax items across entity types.
  function headline(from, count) {
    var to = addDays(from, 120);
    var seen = {};
    var all = generate({ entity: 'pvt', msme: true }, from, to)
      .concat(generate({ entity: 'llp' }, from, to))
      .filter(function (e) { return e.kind !== 'gst' && e.form !== 'Advance tax' && e.form !== 'AGM'; })
      .filter(function (e) { var k = e.form + iso(e.date); if (seen[k]) return false; seen[k] = 1; return true; })
      .sort(function (a, b) { return a.date - b.date; });
    return all.slice(0, count || 5);
  }

  // Minimum MCA additional fee for overdue annual forms, assuming the AGM was held on 30 September.
  var LATE_FORMS = {
    aoc4: { label: 'AOC-4', due: function (Y) { return d(Y, 10, 30); } },
    mgt7: { label: 'MGT-7/7A', due: function (Y) { return d(Y, 11, 29); } },
    form8: { label: 'LLP Form 8', due: function (Y) { return d(Y, 10, 30); } },
    form11: { label: 'LLP Form 11', due: function (Y) { return d(Y, 5, 30); } }
  };
  function lateFee(forms, oldestFyEndYear, filingDate) {
    var rows = [];
    var total = 0;
    for (var Y = oldestFyEndYear; Y <= filingDate.getUTCFullYear(); Y++) {
      forms.forEach(function (f) {
        var spec = LATE_FORMS[f];
        if (!spec) return;
        var due = spec.due(Y);
        var late = daysBetween(due, filingDate);
        if (late <= 0) return;
        var fee = late * 100;
        total += fee;
        rows.push({ form: spec.label, fy: fy(Y), due: due, daysLate: late, fee: fee });
      });
    }
    return { rows: rows, total: total };
  }

  return { generate: generate, headline: headline, lateFee: lateFee, todayIST: todayIST, parse: parse, iso: iso, fmt: fmt, addDays: addDays, daysBetween: daysBetween, d: d };
});
