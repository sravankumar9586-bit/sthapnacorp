const crypto = require('crypto');
const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');
const D = require('../assets/deadlines.js');

const SITE = process.env.SITE_URL || 'https://sthapnacorp.com';

function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function cleanDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; }

function cleanProfile(p) {
  p = p || {};
  return {
    entity: ['pvt', 'opc', 'llp'].includes(p.entity) ? p.entity : 'pvt',
    incDate: cleanDate(p.incDate),
    agmDate: cleanDate(p.agmDate),
    gst: !!p.gst, tds: !!p.tds, msme: !!p.msme, taxAudit: !!p.taxAudit,
  };
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — SthapnaCorp</title>
<link rel="stylesheet" href="/assets/site.css"></head><body><main class="section"><div class="wrap narrow"><h1>${title}</h1><p class="lede" style="margin-top:12px">${body}</p>
<p style="margin-top:20px"><a class="btn btn-navy" href="/">Back to SthapnaCorp</a></p></div></main></body></html>`;
}

module.exports = async function (req, res) {
  try {
    if (req.method === 'GET' && req.query.unsubscribe) {
      const r = await query('UPDATE subscribers SET active = FALSE, updated_at = NOW() WHERE token = $1 RETURNING email', [String(req.query.unsubscribe)]);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (!r.rows.length) return res.status(404).send(page('Link not recognised', 'This unsubscribe link is not valid. Email sthapnacorp.support@gmail.com and we will remove you.'));
      return res.status(200).send(page('You are unsubscribed', `${mail.esc(r.rows[0].email)} will not receive any more deadline reminders.`));
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.website) return res.status(200).json({ ok: true });
      const name = clean(b.name, 100);
      const email = clean(b.email, 160).toLowerCase();
      if (!name) return res.status(400).json({ error: 'Please enter your name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please check the email address.' });
      const profile = cleanProfile(b.profile);
      const token = crypto.randomBytes(18).toString('hex');
      const prev = await query("SELECT updated_at > NOW() - INTERVAL '10 minutes' AS recent FROM subscribers WHERE email = $1", [email]);
      const sendMail = mail.configured() && !(prev.rows[0] && prev.rows[0].recent);

      const r = await query(
        `INSERT INTO subscribers (name, email, mobile, company, profile, token)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, mobile = EXCLUDED.mobile, company = EXCLUDED.company,
           profile = EXCLUDED.profile, active = TRUE, updated_at = NOW()
         RETURNING token`,
        [name, email, clean(b.mobile, 20) || null, clean(b.company, 160) || null, JSON.stringify(profile), token]
      );

      if (sendMail) {
        const today = D.todayIST();
        const upcoming = D.generate(profile, today, D.addDays(today, 120)).slice(0, 8);
        const rows = upcoming.map((e) => `<tr><td style="padding:6px 10px 6px 0;white-space:nowrap">${D.fmt(e.date)}</td><td style="padding:6px 0"><strong>${mail.esc(e.form)}</strong> — ${mail.esc(e.title)}</td></tr>`).join('');
        const unsub = `${SITE}/api/subscribe?unsubscribe=${r.rows[0].token}`;
        const jobs = [
          mail.send({
            to: email,
            subject: 'Your compliance reminders are set up — SthapnaCorp',
            html: mail.layout('Your reminders are set up', `
              <p>Hi ${mail.esc(name.split(' ')[0])}, we will email you 30, 7 and 1 day before each of your due dates. Here is what is coming up:</p>
              <table cellpadding="0" cellspacing="0" style="font-size:15px">${rows || '<tr><td>No deadlines in the next four months.</td></tr>'}</table>
              <p>Want us to file these for you? Reply to this email or <a href="https://wa.me/918686145656">message us on WhatsApp</a> for a written quote.</p>
              <p style="font-size:13px;color:#7E786F">Dates are statutory due dates and can change by notification. <a href="${unsub}" style="color:#7E786F">Unsubscribe</a></p>`),
          }),
          mail.send({
            to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
            subject: `New reminder subscriber: ${name} (${profile.entity.toUpperCase()})`,
            html: mail.layout('New reminder subscriber', `<p>${mail.esc(name)} · ${mail.esc(email)} · ${mail.esc(b.mobile || '—')} · ${mail.esc(b.company || '—')}</p><p>Entity: ${profile.entity.toUpperCase()} · GST ${profile.gst ? 'yes' : 'no'} · TDS ${profile.tds ? 'yes' : 'no'} · MSME-1 ${profile.msme ? 'yes' : 'no'}</p>`),
          }),
        ];
        const results = await Promise.allSettled(jobs);
        results.filter((x) => x.status === 'rejected').forEach((x) => console.error('subscribe mail failed:', x.reason && x.reason.message));
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
      const r = await query('SELECT id, created_at, name, email, mobile, company, profile, active FROM subscribers ORDER BY created_at DESC LIMIT 2000');
      return res.status(200).json(r.rows);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('subscribe error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
