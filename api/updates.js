const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');
const { loadOverrides } = require('./_lib/overrides');
const { SOURCES, runWatch } = require('./_lib/watch');
const D = require('../assets/deadlines.js');

const SITE = process.env.SITE_URL || 'https://sthapnacorp.com';
const FORM_LABEL = Object.fromEntries(D.FORMS);

function isoOrNull(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && D.parse(v) ? String(v) : null; }
function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

async function lastChecked() {
  const r = await query('SELECT MAX(checked_at) AS t FROM watch_sources WHERE ok = TRUE');
  return r.rows[0].t;
}

// Emails active subscribers whose own calendar contains the newly extended deadline.
async function notifySubscribers(o) {
  if (!mail.configured()) return 0;
  await loadOverrides();
  const today = D.todayIST();
  const subs = (await query('SELECT id, name, email, token, profile FROM subscribers WHERE active = TRUE LIMIT 500')).rows;
  const e = mail.esc;
  let sent = 0;
  for (const s of subs) {
    const hit = D.generate(s.profile, D.addDays(today, -60), D.addDays(today, 400))
      .find((ev) => ev.extension && ev.base === o.form_key && ev.extension.to === o.new_due);
    if (!hit) continue;
    const verb = o.kind === 'fee_waiver' ? 'can be filed without additional fee until' : 'is now due on';
    try {
      await mail.send({
        to: s.email,
        subject: `Extension: ${hit.form} ${verb} ${D.fmt(hit.date)}`,
        html: mail.layout('Due date extended', `
          <p>Hi ${e(String(s.name).split(' ')[0])}, an extension has been announced that affects your ${s.profile.entity === 'llp' ? 'LLP' : 'company'}:</p>
          <p style="background:#E6F2EA;padding:12px;border-radius:6px"><strong>${e(hit.form)}</strong> — ${e(hit.title)}<br>
          ${o.kind === 'fee_waiver' ? 'Can be filed without additional fee until' : 'New due date'}: <strong>${D.fmt(hit.date)}</strong> (was ${D.fmt(hit.originalDate)})</p>
          ${o.note ? `<p>${e(o.note)}</p>` : ''}
          ${o.source_url ? `<p>Official source: <a href="${e(o.source_url)}">${e(o.source_title || o.source_url)}</a></p>` : ''}
          <p>Your reminders have moved to the new date. Want us to file it? <a href="https://wa.me/918686145656?text=${encodeURIComponent('Hi SthapnaCorp, please file ' + hit.form + ' for us before ' + D.fmt(hit.date) + '.')}">Message us on WhatsApp</a> or reply to this email.</p>
          <p style="font-size:13px;color:#7E786F"><a href="${SITE}/api/subscribe?unsubscribe=${s.token}" style="color:#7E786F">Unsubscribe</a></p>`),
      });
      sent++;
    } catch (err) { console.error('extension mail failed for', s.id, err.message); }
  }
  return sent;
}

module.exports = async function (req, res) {
  try {
    // Public: approved extensions, used by the website's calendar and deadline bar.
    if (req.method === 'GET' && !isAdmin(req)) {
      const rows = await loadOverrides();
      // Browsers always ask again; Vercel's CDN answers from cache for up to 5 minutes.
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('CDN-Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      return res.status(200).json({
        overrides: rows.map(({ id, ...o }) => Object.assign(o, { form_label: FORM_LABEL[o.form_key] || o.form_key })),
        last_checked: await lastChecked(),
        sources: SOURCES.filter((s) => s.official || s.id === 'pib').map((s) => s.name),
      });
    }
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const [overrides, items, sources] = await Promise.all([
        query(`SELECT id, created_at, form_key, fy_end, to_char(original_due,'YYYY-MM-DD') AS original_due, to_char(new_due,'YYYY-MM-DD') AS new_due,
                      kind, note, source_url, source_title, active, notified_at FROM due_overrides ORDER BY active DESC, new_due DESC LIMIT 200`),
        query(`SELECT id, found_at, source, title, url, published_at, suggestion, status FROM watch_items
               ORDER BY (status = 'new') DESC, COALESCE(published_at, found_at) DESC LIMIT 200`),
        query('SELECT source, checked_at, ok, scanned, matched, error FROM watch_sources'),
      ]);
      const byId = Object.fromEntries(sources.rows.map((r) => [r.source, r]));
      return res.status(200).json({
        forms: D.FORMS,
        overrides: overrides.rows,
        items: items.rows.map((i) => Object.assign(i, { source_name: (SOURCES.find((s) => s.id === i.source) || {}).name || i.source })),
        sources: SOURCES.map((s) => Object.assign({ id: s.id, name: s.name, url: s.url }, byId[s.id] || { ok: null })),
      });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'check') {
        const fresh = await runWatch();
        return res.status(200).json({ ok: true, found: fresh.length });
      }
      if (b.action === 'dismiss') {
        await query("UPDATE watch_items SET status = 'dismissed' WHERE id = $1", [Number(b.item_id)]);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'deactivate') {
        await query('UPDATE due_overrides SET active = FALSE WHERE id = $1', [Number(b.override_id)]);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'create') {
        const o = {
          form_key: clean(b.form_key, 20),
          fy_end: b.fy_end ? Number(b.fy_end) : null,
          original_due: isoOrNull(b.original_due),
          new_due: isoOrNull(b.new_due),
          kind: b.kind === 'fee_waiver' ? 'fee_waiver' : 'extension',
          note: clean(b.note, 500) || null,
          source_url: clean(b.source_url, 500) || null,
          source_title: clean(b.source_title, 300) || null,
        };
        if (!FORM_LABEL[o.form_key]) return res.status(400).json({ error: 'Choose the form.' });
        if (!o.new_due) return res.status(400).json({ error: 'Enter the new due date.' });
        if (o.fy_end && !(o.fy_end >= 2018 && o.fy_end <= 2100)) return res.status(400).json({ error: 'Invalid financial year.' });
        if (!o.fy_end && !o.original_due) return res.status(400).json({ error: 'Enter either the financial year or the original due date.' });
        if (o.source_url && !/^https?:\/\//i.test(o.source_url)) return res.status(400).json({ error: 'The source link must start with http:// or https://' });
        const r = await query(
          `INSERT INTO due_overrides (form_key, fy_end, original_due, new_due, kind, note, source_url, source_title)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [o.form_key, o.fy_end, o.original_due, o.new_due, o.kind, o.note, o.source_url, o.source_title]
        );
        if (b.item_id) await query("UPDATE watch_items SET status = 'applied' WHERE id = $1", [Number(b.item_id)]);
        let notified = 0;
        if (b.notify) {
          notified = await notifySubscribers(o);
          await query('UPDATE due_overrides SET notified_at = NOW() WHERE id = $1', [r.rows[0].id]);
        }
        return res.status(200).json({ ok: true, id: r.rows[0].id, notified });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('updates error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
