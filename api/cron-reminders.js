const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin, safeEqual } = require('./_lib/auth');
const D = require('../assets/deadlines.js');

const SITE = process.env.SITE_URL || 'https://sthapnacorp.com';

// Pick the tightest reminder window the deadline has entered, e.g. leads [30,7,1] and 5 days left → 7.
function dueWindow(lead, daysLeft) {
  const fits = lead.filter((l) => daysLeft <= l).sort((a, b) => a - b);
  return fits.length ? fits[0] : null;
}

function waText(items) {
  return encodeURIComponent('Hi SthapnaCorp, please handle these for us: ' + items.map((i) => `${i.e.form} (due ${D.fmt(i.e.date)})`).join(', '));
}

module.exports = async function (req, res) {
  const cronOk = process.env.CRON_SECRET && safeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`);
  if (!cronOk && !isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!mail.configured()) return res.status(500).json({ error: 'SMTP is not configured' });

  const today = D.todayIST();
  const horizon = D.addDays(today, 31);
  const subs = (await query('SELECT id, name, email, token, profile FROM subscribers WHERE active = TRUE')).rows;
  let emails = 0;
  let failures = 0;
  const digest = [];

  for (const s of subs) {
    const items = [];
    for (const e of D.generate(s.profile, today, horizon)) {
      const daysLeft = D.daysBetween(today, e.date);
      if (daysLeft < 0) continue;
      const w = dueWindow(e.lead, daysLeft);
      if (w == null) continue;
      const claimed = await query(
        'INSERT INTO reminder_log (subscriber_id, event_key, lead_days) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_key',
        [s.id, e.key, w]
      );
      if (claimed.rows.length) items.push({ e, daysLeft, w });
    }
    if (!items.length) continue;

    const e = mail.esc;
    const rows = items.map((i) => `<tr>
      <td style="padding:8px 12px 8px 0;white-space:nowrap;vertical-align:top"><strong>${D.fmt(i.e.date)}</strong><br><span style="font-size:13px;color:${i.daysLeft <= 7 ? '#9B1C1C' : '#A35A00'}">${i.daysLeft === 0 ? 'due today' : i.daysLeft === 1 ? 'tomorrow' : i.daysLeft + ' days left'}</span></td>
      <td style="padding:8px 0;vertical-align:top"><strong>${e(i.e.form)}</strong> — ${e(i.e.title)}${i.e.note ? `<br><span style="font-size:13px;color:#7E786F">${e(i.e.note)}</span>` : ''}</td></tr>`).join('');
    const soonest = Math.min(...items.map((i) => i.daysLeft));
    const subject = items.length === 1
      ? `${items[0].e.form} due ${D.fmt(items[0].e.date)} (${soonest === 0 ? 'today' : soonest + ' day' + (soonest === 1 ? '' : 's')})`
      : `${items.length} compliance deadlines coming up — first in ${soonest} day${soonest === 1 ? '' : 's'}`;
    try {
      await mail.send({
        to: s.email,
        subject,
        html: mail.layout('Upcoming due dates', `
          <p>Hi ${e(String(s.name).split(' ')[0])}, these deadlines are coming up for your ${s.profile.entity === 'llp' ? 'LLP' : 'company'}:</p>
          <table cellpadding="0" cellspacing="0" style="font-size:15px;width:100%">${rows}</table>
          <p style="margin-top:18px"><a href="https://wa.me/918919232657?text=${waText(items)}" style="display:inline-block;background:#1FA855;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Ask us to file these</a></p>
          <p>Or reply to this email for a fixed quote.</p>
          <p style="font-size:13px;color:#7E786F">Statutory due dates as we understand them today; extensions by MCA or CBDT can change them. <a href="${SITE}/api/subscribe?unsubscribe=${s.token}" style="color:#7E786F">Unsubscribe</a></p>`),
      });
      emails++;
      digest.push(`${s.name} <${s.email}>: ${items.map((i) => i.e.form + ' ' + D.fmt(i.e.date)).join(', ')}`);
    } catch (err) {
      failures++;
      console.error('reminder failed for', s.id, err.message);
      for (const i of items) await query('DELETE FROM reminder_log WHERE subscriber_id=$1 AND event_key=$2 AND lead_days=$3', [s.id, i.e.key, i.w]);
    }
  }

  if (digest.length) {
    await mail.send({
      to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
      subject: `Reminders sent today: ${digest.length} — follow up for work`,
      html: mail.layout('Reminders sent today', `<p>These subscribers were reminded today. Each one is a chance to offer the filing:</p><ul>${digest.map((d) => `<li>${mail.esc(d)}</li>`).join('')}</ul>`),
    }).catch((err) => console.error('digest failed:', err.message));
  }

  return res.status(200).json({ ok: true, subscribers: subs.length, emails, failures, date: D.iso(today) });
};
