// The expert's side: email-link login, jobs, accept / decline, quote, chat, progress, earnings, online switch.
// Experts never see the customer's phone or email: all contact goes through the order chat.
const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const M = require('./_lib/market');

const e = mail.esc;
const COOKIE = 'sc_pro';

async function currentProvider(req) {
  const t = M.cookie(req, COOKIE);
  if (!t) return null;
  const r = await query(
    `SELECT p.* FROM provider_tokens t JOIN providers p ON p.id = t.provider_id
     WHERE t.token_hash = $1 AND t.kind = 'session' AND t.expires_at > NOW() AND p.status = 'approved'`, [M.hash(t)]);
  return r.rows[0] || null;
}

function job(o) {
  const base = { id: o.id, ref: o.ref, service: o.service, details: o.details, city: o.city, company: o.company, status: o.status,
    created_at: o.created_at, assigned_at: o.assigned_at, price: o.quote_amount, quote_note: o.quote_note, payment_status: o.payment_status,
    message_count: o.message_count, money: M.payout(o), payout_status: o.payout_status, rating: o.rating };
  if (o.status === 'assigned') {
    base.accept_by = new Date(new Date(o.assigned_at).getTime() + M.ACCEPT_HOURS * 3600000).toISOString();
    return base;
  }
  return Object.assign(base, { customer: M.firstName(o.name), accepted_at: o.accepted_at, completed_at: o.completed_at });
}

module.exports = async function (req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    // One-time login link from the email → session cookie → dashboard.
    if (req.method === 'GET' && req.query.login) {
      const r = await query(
        `UPDATE provider_tokens SET used = TRUE WHERE token_hash = $1 AND kind = 'login' AND used = FALSE AND expires_at > NOW() RETURNING provider_id`,
        [M.hash(req.query.login)]);
      res.statusCode = 302;
      if (!r.rows.length) { res.setHeader('Location', '/provider?expired=1'); return res.end(); }
      const t = M.token();
      await query("INSERT INTO provider_tokens (token_hash, provider_id, kind, expires_at) VALUES ($1,$2,'session', NOW() + INTERVAL '30 days')", [M.hash(t), r.rows[0].provider_id]);
      M.setCookie(req, res, COOKIE, t, 30 * 86400);
      res.setHeader('Location', '/provider');
      return res.end();
    }

    if (req.method === 'POST' && (req.body || {}).action === 'login') {
      const email = M.clean(req.body.email, 160).toLowerCase();
      const p = (await query('SELECT id, name, email, status FROM providers WHERE email = $1', [email])).rows[0];
      if (p && p.status === 'approved') {
        const recent = await query("SELECT COUNT(*)::int AS n FROM provider_tokens WHERE provider_id = $1 AND kind = 'login' AND expires_at > NOW() + INTERVAL '20 minutes'", [p.id]);
        if (recent.rows[0].n < 3) {
          const t = M.token();
          await query("INSERT INTO provider_tokens (token_hash, provider_id, kind, expires_at) VALUES ($1,$2,'login', NOW() + INTERVAL '30 minutes')", [M.hash(t), p.id]);
          await M.safeSend({
            to: p.email, subject: 'Your SthapnaCorp login link',
            html: mail.layout('Log in to your jobs', `<p>Hi ${e(M.firstName(p.name))}, use this link within 30 minutes. It works once.</p>
              <p><a href="${M.SITE}/api/provider?login=${t}" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Log in</a></p>
              <p style="font-size:13px;color:#7E786F">If you did not ask for this, ignore this email.</p>`),
          });
        }
      }
      return res.status(200).json({ ok: true }); // same answer either way
    }

    const p = await currentProvider(req);
    if (!p) return res.status(401).json({ error: 'Please log in.' });

    if (req.method === 'GET') {
      if (req.query.order) {
        const o = (await query('SELECT * FROM orders WHERE id = $1 AND provider_id = $2', [Number(req.query.order), p.id])).rows[0];
        if (!o || o.status === 'assigned') return res.status(404).json({ error: 'Not found' });
        const [msgs, files] = await Promise.all([
          query('SELECT id, at, sender, body FROM order_messages WHERE order_id = $1 ORDER BY at, id', [o.id]),
          query('SELECT id, at, uploaded_by, name, size FROM order_files WHERE order_id = $1 ORDER BY at', [o.id]),
        ]);
        return res.status(200).json({ messages: msgs.rows, files: files.rows });
      }
      await M.reassignStale().catch((err) => console.error('stale check failed:', err.message));
      const r = await query(
        `SELECT o.*, (SELECT COUNT(*)::int FROM order_messages m WHERE m.order_id = o.id) AS message_count FROM orders o
         WHERE o.provider_id = $1 AND o.status <> 'new' AND o.status <> 'unassigned'
         ORDER BY (o.status = 'assigned') DESC, (o.status IN ('completed','cancelled')), o.created_at DESC LIMIT 300`, [p.id]);
      const jobs = r.rows.map(job);
      const done = r.rows.filter((o) => o.status === 'completed' && o.payment_status === 'paid');
      const rating = (await M.expertCard(p.id)) || {};
      return res.status(200).json({
        me: { name: p.name, firm: p.firm, email: p.email, qualification: p.qualification, city: p.city, capacity: p.capacity, available: p.available,
          commission_pct: Number(p.commission_pct), rating: rating.rating, ratings: rating.ratings },
        accept_hours: M.ACCEPT_HOURS,
        earnings: {
          paid_out: done.filter((o) => o.payout_status === 'paid').reduce((a, o) => a + M.payout(o).expert_earning, 0),
          due: done.filter((o) => o.payout_status !== 'paid').reduce((a, o) => a + M.payout(o).expert_earning, 0),
        },
        jobs,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    if (b.action === 'logout') {
      await query('DELETE FROM provider_tokens WHERE token_hash = $1', [M.hash(M.cookie(req, COOKIE))]);
      M.setCookie(req, res, COOKIE, '', 0);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'availability') {
      await query('UPDATE providers SET available = $1 WHERE id = $2', [!!b.available, p.id]);
      return res.status(200).json({ ok: true });
    }
    const o = (await query('SELECT * FROM orders WHERE id = $1 AND provider_id = $2', [Number(b.order_id), p.id])).rows[0];
    if (!o) return res.status(404).json({ error: 'This job is no longer assigned to you.' });
    if (o.status === 'cancelled') return res.status(400).json({ error: 'This job was cancelled.' });

    if (b.action === 'accept') {
      if (o.status !== 'assigned') return res.status(400).json({ error: 'This job was already handled.' });
      const next = o.quote_amount != null ? 'quoted' : 'accepted';
      await query('UPDATE orders SET status = $1, accepted_at = NOW() WHERE id = $2', [next, o.id]);
      await M.addEvent(o.id, 'provider', 'status', next === 'quoted'
        ? `Your expert ${M.shortName(p.name)} (${p.qualification}) is ready. Pay ${M.rupees(o.quote_amount)} to start.`
        : `Your expert ${M.shortName(p.name)} (${p.qualification}) has taken your order and will share a quote here shortly.`);
      await M.clientEmail(o, `Order ${o.ref}: your expert is ready`, 'Your expert is ready', `
        <p>Hi ${e(M.firstName(o.name))}, <strong>${e(M.shortName(p.name))}</strong>, a ${e(p.qualification)} on SthapnaCorp, is handling your <strong>${e(o.service)}</strong>.</p>
        <p>${next === 'quoted' ? `Pay ${M.rupees(o.quote_amount)} on your order page and work starts right away.` : 'They will review your requirement and send a quote on your order page. You can message them there and share documents.'}</p>`);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'decline') {
      if (o.status !== 'assigned') return res.status(400).json({ error: 'Accepted jobs cannot be declined here. Message SthapnaCorp in the job chat.' });
      await query("UPDATE orders SET declined_by = array_append(declined_by, provider_id), status = 'new', provider_id = NULL WHERE id = $1", [o.id]);
      await M.addEvent(o.id, 'provider', 'declined', `${p.name} declined${b.reason ? ': ' + M.clean(b.reason, 300) : ''}`, false);
      await M.allocate(o.id, 'system');
      return res.status(200).json({ ok: true });
    }
    if (o.status === 'assigned') return res.status(400).json({ error: 'Accept the job first.' });

    if (b.action === 'quote') {
      if (o.payment_status === 'paid') return res.status(400).json({ error: 'The customer has already paid; the price cannot change.' });
      if (!['accepted', 'quoted', 'approved'].includes(o.status)) return res.status(400).json({ error: 'You cannot quote on this job now.' });
      const amount = Math.round(Number(b.amount));
      if (!(amount > 0 && amount < 100000000)) return res.status(400).json({ error: 'Enter your total fee in rupees.' });
      const note = M.clean(b.note, 1500);
      await query("UPDATE orders SET quote_amount = $1, quote_note = $2, status = 'quoted' WHERE id = $3", [amount, note || null, o.id]);
      await M.addEvent(o.id, 'provider', 'quote', `Quote: ${M.rupees(amount)}${note ? ' — ' + note : ''}`);
      await M.clientEmail(o, `Quote for order ${o.ref}: ${M.rupees(amount)}`, 'Your quote is ready', `
        <p>Hi ${e(M.firstName(o.name))}, your quote for <strong>${e(o.service)}</strong> is <strong>${M.rupees(amount)}</strong>.</p>
        ${note ? `<p style="background:#F2EEE6;padding:12px;border-radius:6px;white-space:pre-wrap">${e(note)}</p>` : ''}
        <p>Accept and pay on your order page, or ask your expert a question there first.</p>`);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'message') {
      const body = M.clean(b.body, 3000);
      if (!body) return res.status(400).json({ error: 'Write a message.' });
      await M.postMessage(o, 'expert', body);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'update') {
      const status = ['in_progress', 'completed'].includes(b.status) ? b.status : o.status;
      const message = M.clean(b.message, 1000);
      if (status !== o.status && o.payment_status !== 'paid') return res.status(400).json({ error: 'Wait for the customer to pay before starting. You can message them in the chat.' });
      if (status === o.status && !message) return res.status(400).json({ error: 'Nothing to update.' });
      await query(`UPDATE orders SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END WHERE id = $2`, [status, o.id]);
      const label = status !== o.status ? M.STATUS_LABEL[status] : '';
      await M.addEvent(o.id, 'provider', 'update', [label, message].filter(Boolean).join(': '));
      await M.clientEmail(o, `Order ${o.ref}: ${label || 'update from your expert'}`, label || 'Update on your order', `
        <p>Hi ${e(M.firstName(o.name))}, there is an update on your <strong>${e(o.service)}</strong>:</p>
        <p style="background:#E8EDF5;padding:12px;border-radius:6px">${label ? '<strong>' + e(label) + '</strong><br>' : ''}${e(message)}</p>
        ${status === 'completed' ? '<p>Thank you for using SthapnaCorp. Please rate your expert on your order page; it takes ten seconds.</p>' : ''}`);
      if (status === 'completed' && o.status !== 'completed') {
        const m = M.payout(o);
        await M.safeSend({ to: M.OWNER(), subject: `Order ${o.ref} completed by ${p.name} — pay out ${M.rupees(m.expert_earning)}`, html: mail.layout('Order completed', `<p>${e(o.service)} for ${e(o.name)}.</p><p>Price ${M.rupees(m.price)} · platform fee ${M.rupees(m.platform_fee)} (${m.pct}%) · due to expert ${M.rupees(m.expert_earning)}.</p><p>Mark the payout in the admin panel once paid.</p>`) });
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('provider error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
