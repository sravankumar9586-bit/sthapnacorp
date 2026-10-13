// Professionals joining the platform (public application) and their approval (admin).
const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');
const M = require('./_lib/market');
const C = require('../assets/catalogue.js');

const e = mail.esc;
const QUALS = ['Company Secretary (CS)', 'Chartered Accountant (CA)', 'Cost Accountant (CMA)', 'Advocate', 'Trademark agent', 'Other professional'];
const CAT_IDS = C.CATS.map((c) => c.id);
const CAT_NAME = Object.fromEntries(C.CATS.map((c) => [c.id, c.name]));

module.exports = async function (req, res) {
  try {
    if (req.method === 'POST' && !isAdmin(req)) {
      const b = req.body || {};
      if (b.website) return res.status(200).json({ ok: true });
      const p = {
        name: M.clean(b.name, 100), firm: M.clean(b.firm, 160), email: M.clean(b.email, 160).toLowerCase(),
        mobile: M.clean(b.mobile, 20), qualification: M.clean(b.qualification, 60), membership_no: M.clean(b.membership_no, 40),
        city: M.clean(b.city, 80), remote_ok: b.remote_ok !== false && b.remote_ok !== 'false',
        categories: (Array.isArray(b.categories) ? b.categories : []).filter((c) => CAT_IDS.includes(c)),
        about: M.clean(b.about, 1500),
      };
      if (!p.name) return res.status(400).json({ error: 'Please enter your name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return res.status(400).json({ error: 'Please enter a valid email.' });
      if (p.mobile.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a 10-digit mobile number.' });
      if (!QUALS.includes(p.qualification)) return res.status(400).json({ error: 'Choose your qualification.' });
      if (!p.city) return res.status(400).json({ error: 'Please enter your city.' });
      if (!p.categories.length) return res.status(400).json({ error: 'Choose at least one type of work you take on.' });
      const exists = (await query('SELECT id FROM providers WHERE email = $1', [p.email])).rows[0];
      if (exists) return res.status(409).json({ error: 'This email has already applied. We will be in touch, or log in from the professional login page if you are approved.' });
      const r = await query(
        `INSERT INTO providers (name, firm, email, mobile, qualification, membership_no, city, remote_ok, categories, about)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [p.name, p.firm || null, p.email, p.mobile, p.qualification, p.membership_no || null, p.city, p.remote_ok, p.categories, p.about || null]
      );
      await Promise.all([
        M.safeSend({
          to: p.email, replyTo: M.OWNER(), subject: 'Your application to join SthapnaCorp',
          html: mail.layout('Application received', `<p>Hi ${e(p.name.split(' ')[0])}, thank you for applying to take orders through SthapnaCorp.</p>
            <p>We verify every professional's membership before approval, usually within two working days. Once approved, you will receive orders by email for: ${p.categories.map((c) => e(CAT_NAME[c])).join(', ')}.</p>`),
        }),
        M.safeSend({
          to: M.OWNER(), replyTo: p.email, subject: `Professional applied: ${p.name} (${p.qualification}, ${p.city})`,
          html: mail.layout('New professional application', `<p><strong>${e(p.name)}</strong>${p.firm ? ' · ' + e(p.firm) : ''}<br>${e(p.qualification)} ${p.membership_no ? '· No. ' + e(p.membership_no) : ''}<br>
            ${e(p.city)}${p.remote_ok ? ' · takes work from anywhere in India' : ''}<br>${e(p.email)} · ${e(p.mobile)}</p>
            <p>Work: ${p.categories.map((c) => e(CAT_NAME[c])).join(', ')}</p><p>${e(p.about || '')}</p>
            <p>Verify the membership number, then approve in the <a href="${M.SITE}/admin">admin panel</a>.</p>`),
        }),
      ]);
      return res.status(200).json({ ok: true, id: r.rows[0].id });
    }

    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const r = await query(
        `SELECT p.*,
           (SELECT COUNT(*)::int FROM orders o WHERE o.provider_id = p.id AND o.status = ANY($1)) AS open_count,
           (SELECT COUNT(*)::int FROM orders o WHERE o.provider_id = p.id AND o.status = 'completed') AS done_count
         FROM providers p ORDER BY (p.status = 'pending') DESC, p.created_at DESC`, [M.OPEN]);
      return res.status(200).json({ providers: r.rows, categories: C.CATS.map((c) => [c.id, c.name]), qualifications: QUALS });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = Number(b.provider_id);
      const p = (await query('SELECT * FROM providers WHERE id = $1', [id])).rows[0];
      if (!p) return res.status(404).json({ error: 'Not found' });
      if (b.action === 'approve' || b.action === 'suspend') {
        const status = b.action === 'approve' ? 'approved' : 'suspended';
        await query('UPDATE providers SET status = $1 WHERE id = $2', [status, id]);
        if (status === 'approved' && p.status !== 'approved') {
          await M.safeSend({
            to: p.email, replyTo: M.OWNER(), subject: 'You are approved on SthapnaCorp',
            html: mail.layout('Welcome aboard', `<p>Hi ${e(p.name.split(' ')[0])}, your profile is approved. Orders that match your work and city will now be emailed to you.</p>
              <p>Accept each order within ${M.ACCEPT_HOURS} hours; after that it moves to the next professional. Log in with your email; we send you a one-time link, no password needed.</p>
              <p><a href="${M.SITE}/provider" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open my orders</a></p>`),
          });
          // Orders that were waiting for someone in these categories go out now.
          const waiting = await query("SELECT id FROM orders WHERE status = 'unassigned' AND category = ANY($1) ORDER BY created_at", [p.categories]);
          for (const w of waiting.rows) await M.allocate(w.id, 'system');
        }
        if (status === 'suspended') {
          // Pending (not yet accepted) orders move on; accepted work stays with them for the admin to handle.
          const pending = await query("UPDATE orders SET declined_by = array_append(declined_by, provider_id), status = 'new', provider_id = NULL WHERE provider_id = $1 AND status = 'assigned' RETURNING id", [id]);
          for (const w of pending.rows) await M.allocate(w.id, 'system');
          await query("DELETE FROM provider_tokens WHERE provider_id = $1", [id]);
        }
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'update') {
        const cats = Array.isArray(b.categories) ? b.categories.filter((c) => CAT_IDS.includes(c)) : p.categories;
        const cap = Number.isFinite(Number(b.capacity)) ? Math.max(0, Math.min(200, Math.round(Number(b.capacity)))) : p.capacity;
        await query('UPDATE providers SET categories = $1, capacity = $2, admin_notes = $3, remote_ok = $4 WHERE id = $5',
          [cats, cap, b.admin_notes !== undefined ? (M.clean(b.admin_notes, 2000) || null) : p.admin_notes, b.remote_ok !== undefined ? !!b.remote_ok : p.remote_ok, id]);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('providers error:', err.message);
    return res.status(500).json({ error: 'Server error. Please WhatsApp us on +91 86861 45656.' });
  }
};
