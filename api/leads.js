const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');

const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];

function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

module.exports = async function (req, res) {
  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.website) return res.status(200).json({ ok: true }); // honeypot: bots fill hidden fields
      const lead = {
        name: clean(b.name, 100),
        mobile: clean(b.mobile, 20),
        email: clean(b.email, 160),
        company: clean(b.company, 160),
        service: clean(b.service, 120),
        message: clean(b.message, 2000),
        page: clean(b.page, 200),
        utm: b.utm && typeof b.utm === 'object' ? b.utm : {},
      };
      if (!lead.name) return res.status(400).json({ error: 'Please enter your name.' });
      if (lead.mobile.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a 10-digit mobile number.' });
      if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return res.status(400).json({ error: 'Please check the email address.' });

      const recent = await query(
        "SELECT COUNT(*)::int AS n FROM leads WHERE created_at > NOW() - INTERVAL '1 hour' AND (regexp_replace(mobile, '\\D', '', 'g') = $1 OR (email IS NOT NULL AND lower(email) = lower($2)))",
        [lead.mobile.replace(/\D/g, ''), lead.email || null]
      );
      if (recent.rows[0].n >= 3) return res.status(429).json({ error: 'We already have your enquiry and will call you shortly.' });

      const r = await query(
        `INSERT INTO leads (name, mobile, email, company, service, message, page, utm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [lead.name, lead.mobile, lead.email || null, lead.company || null, lead.service || null, lead.message || null, lead.page || null, JSON.stringify(lead.utm)]
      );

      if (mail.configured()) {
        const e = mail.esc;
        const digits = lead.mobile.replace(/\D/g, '');
        const wa = 'https://wa.me/' + (digits.length === 10 ? '91' + digits : digits);
        const source = Object.entries(lead.utm).map(([k, v]) => `${e(k)}=${e(v)}`).join(', ');
        const jobs = [
          mail.send({
            to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
            replyTo: lead.email || undefined,
            subject: `New enquiry #${r.rows[0].id}: ${lead.service || 'General'} — ${lead.name}`,
            html: mail.layout('New website enquiry', `
              <p><strong>${e(lead.name)}</strong>${lead.company ? ' · ' + e(lead.company) : ''}</p>
              <p>Mobile: <a href="tel:${e(lead.mobile)}">${e(lead.mobile)}</a> · <a href="${wa}">WhatsApp</a><br>
              Email: ${e(lead.email || '—')}<br>Service: ${e(lead.service || '—')}<br>Page: ${e(lead.page || '—')}${source ? '<br>Source: ' + source : ''}</p>
              <p style="white-space:pre-wrap;background:#F2EEE6;padding:12px;border-radius:6px">${e(lead.message || 'No message')}</p>`),
          }),
        ];
        if (lead.email) {
          jobs.push(mail.send({
            to: lead.email,
            subject: 'We have your enquiry — SthapnaCorp',
            html: mail.layout(`Thanks, ${lead.name.split(' ')[0]}`, `
              <p>We have received your enquiry${lead.service ? ' about <strong>' + e(lead.service) + '</strong>' : ''}. We will call you on ${e(lead.mobile)} within one working day with a written quote and a document checklist.</p>
              <p>If it is urgent, message us on <a href="https://wa.me/918686145656">WhatsApp</a> or reply to this email.</p>`),
          }));
        }
        const results = await Promise.allSettled(jobs);
        results.filter((x) => x.status === 'rejected').forEach((x) => console.error('lead mail failed:', x.reason && x.reason.message));
      }
      return res.status(200).json({ ok: true });
    }

    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const r = await query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 1000');
      return res.status(200).json(r.rows);
    }

    if (req.method === 'PATCH') {
      const id = Number(req.query.id);
      const b = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
      await query('UPDATE leads SET status = COALESCE($2, status), notes = COALESCE($3, notes) WHERE id = $1',
        [id, b.status || null, b.notes == null ? null : clean(b.notes, 4000)]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('leads error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try WhatsApp instead.' });
  }
};
