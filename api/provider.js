// The professional's side: email-link login, their orders, accept / decline / progress updates.
const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const M = require('./_lib/market');

const e = mail.esc;
const COOKIE = 'sc_pro';

function cookieValue(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(req, res, value, maxAge) {
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers.host || ''));
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local ? '' : '; Secure'}`);
}
async function currentProvider(req) {
  const t = cookieValue(req);
  if (!t) return null;
  const r = await query(
    `SELECT p.* FROM provider_tokens t JOIN providers p ON p.id = t.provider_id
     WHERE t.token_hash = $1 AND t.kind = 'session' AND t.expires_at > NOW() AND p.status = 'approved'`, [M.hash(t)]);
  return r.rows[0] || null;
}

function orderForProvider(o) {
  const base = { id: o.id, ref: o.ref, service: o.service, details: o.details, city: o.city, company: o.company, status: o.status,
    created_at: o.created_at, assigned_at: o.assigned_at, quote_amount: o.quote_amount };
  if (o.status === 'assigned') {
    base.accept_by = new Date(new Date(o.assigned_at).getTime() + M.ACCEPT_HOURS * 3600000).toISOString();
    return base; // client contact stays hidden until the order is accepted
  }
  return Object.assign(base, { name: o.name, mobile: o.mobile, email: o.email, accepted_at: o.accepted_at, completed_at: o.completed_at });
}

module.exports = async function (req, res) {
  try {
    // One-time login link from the email → session cookie → dashboard.
    if (req.method === 'GET' && req.query.login) {
      const r = await query(
        `UPDATE provider_tokens SET used = TRUE WHERE token_hash = $1 AND kind = 'login' AND used = FALSE AND expires_at > NOW() RETURNING provider_id`,
        [M.hash(req.query.login)]);
      res.statusCode = 302;
      if (!r.rows.length) { res.setHeader('Location', '/provider?expired=1'); return res.end(); }
      const t = M.token();
      await query("INSERT INTO provider_tokens (token_hash, provider_id, kind, expires_at) VALUES ($1,$2,'session', NOW() + INTERVAL '30 days')", [M.hash(t), r.rows[0].provider_id]);
      setCookie(req, res, t, 30 * 86400);
      res.setHeader('Location', '/provider');
      return res.end();
    }

    if (req.method === 'POST' && (req.body || {}).action === 'login') {
      const email = M.clean(req.body.email, 160).toLowerCase();
      const p = (await query("SELECT id, name, email, status FROM providers WHERE email = $1", [email])).rows[0];
      if (p && p.status === 'approved') {
        const recent = await query("SELECT COUNT(*)::int AS n FROM provider_tokens WHERE provider_id = $1 AND kind = 'login' AND expires_at > NOW() + INTERVAL '20 minutes'", [p.id]);
        if (recent.rows[0].n < 3) {
          const t = M.token();
          await query("INSERT INTO provider_tokens (token_hash, provider_id, kind, expires_at) VALUES ($1,$2,'login', NOW() + INTERVAL '30 minutes')", [M.hash(t), p.id]);
          await M.safeSend({
            to: p.email, subject: 'Your SthapnaCorp login link',
            html: mail.layout('Log in to your orders', `<p>Hi ${e(p.name.split(' ')[0])}, use this link within 30 minutes. It works once.</p>
              <p><a href="${M.SITE}/api/provider?login=${t}" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Log in</a></p>
              <p style="font-size:13px;color:#7E786F">If you did not ask for this, ignore this email.</p>`),
          });
        }
      }
      // Same answer either way, so the form does not reveal who is registered.
      return res.status(200).json({ ok: true });
    }

    const p = await currentProvider(req);
    if (!p) return res.status(401).json({ error: 'Please log in.' });

    if (req.method === 'GET') {
      await M.reassignStale().catch((err) => console.error('stale check failed:', err.message));
      const r = await query(
        `SELECT * FROM orders WHERE provider_id = $1 AND status IN ('assigned','accepted','in_progress','completed')
         ORDER BY (status = 'assigned') DESC, (status = 'completed'), created_at DESC LIMIT 300`, [p.id]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        me: { name: p.name, firm: p.firm, email: p.email, qualification: p.qualification, city: p.city, capacity: p.capacity },
        accept_hours: M.ACCEPT_HOURS,
        orders: r.rows.map(orderForProvider),
      });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'logout') {
        await query('DELETE FROM provider_tokens WHERE token_hash = $1', [M.hash(cookieValue(req))]);
        setCookie(req, res, '', 0);
        return res.status(200).json({ ok: true });
      }
      const o = (await query('SELECT * FROM orders WHERE id = $1 AND provider_id = $2', [Number(b.order_id), p.id])).rows[0];
      if (!o) return res.status(404).json({ error: 'This order is no longer assigned to you.' });
      const quote = b.quote_amount === undefined || b.quote_amount === '' || b.quote_amount === null ? undefined : Math.round(Number(b.quote_amount));
      if (quote !== undefined && !(quote >= 0 && quote < 100000000)) return res.status(400).json({ error: 'Enter the fee in rupees.' });

      if (b.action === 'accept') {
        if (o.status !== 'assigned') return res.status(400).json({ error: 'This order was already handled.' });
        await query("UPDATE orders SET status = 'accepted', accepted_at = NOW() WHERE id = $1", [o.id]);
        await M.addEvent(o.id, 'provider', 'status', `${p.name} (${p.qualification}) accepted your order and will contact you with a written quote.`);
        await M.clientEmail(o, `Order ${o.ref}: ${p.name} will handle your ${o.service}`, 'Your professional is ready', `
          <p>Hi ${e(o.name.split(' ')[0])}, <strong>${e(p.name)}</strong> (${e(p.qualification)}${p.firm ? ', ' + e(p.firm) : ''}, ${e(p.city)}) has accepted your order for <strong>${e(o.service)}</strong>.</p>
          <p>They will contact you shortly with a written quote and the documents needed. No work starts until you approve the quote.</p>`);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'decline') {
        if (o.status !== 'assigned') return res.status(400).json({ error: 'Accepted orders cannot be declined here. Contact SthapnaCorp.' });
        await query("UPDATE orders SET declined_by = array_append(declined_by, provider_id), status = 'new', provider_id = NULL WHERE id = $1", [o.id]);
        await M.addEvent(o.id, 'provider', 'declined', `${p.name} declined${b.reason ? ': ' + M.clean(b.reason, 300) : ''}`, false);
        await M.allocate(o.id, 'system');
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'update') {
        if (!['accepted', 'in_progress', 'completed'].includes(o.status)) return res.status(400).json({ error: 'Accept the order first.' });
        const status = ['in_progress', 'completed'].includes(b.status) ? b.status : o.status;
        const message = M.clean(b.message, 1000);
        if (status === o.status && !message && quote === undefined) return res.status(400).json({ error: 'Nothing to update.' });
        await query(`UPDATE orders SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
                     quote_amount = COALESCE($2, quote_amount) WHERE id = $3`, [status, quote === undefined ? null : quote, o.id]);
        const label = status !== o.status ? M.STATUS_LABEL[status] : '';
        if (label || message) await M.addEvent(o.id, 'provider', 'update', [label, message].filter(Boolean).join(': '));
        if (quote !== undefined) await M.addEvent(o.id, 'provider', 'quote', `Fee agreed: ₹${quote.toLocaleString('en-IN')}`, false);
        if (label || message) {
          await M.clientEmail(o, `Order ${o.ref}: ${label || 'update from your professional'}`, label || 'Update on your order', `
            <p>Hi ${e(o.name.split(' ')[0])}, there is an update on your <strong>${e(o.service)}</strong> order from ${e(p.name)}:</p>
            <p style="background:#E8EDF5;padding:12px;border-radius:6px">${label ? '<strong>' + e(label) + '</strong><br>' : ''}${e(message)}</p>
            ${status === 'completed' ? '<p>Thank you for using SthapnaCorp. Reply to this email to tell us how it went.</p>' : ''}`);
        }
        if (status === 'completed' && o.status !== 'completed') {
          await M.safeSend({ to: M.OWNER(), subject: `Order ${o.ref} completed by ${p.name}`, html: mail.layout('Order completed', `<p>${e(o.service)} for ${e(o.name)}. Fee recorded: ${quote !== undefined ? '₹' + quote.toLocaleString('en-IN') : (o.quote_amount ? '₹' + o.quote_amount.toLocaleString('en-IN') : 'not entered')}.</p>`) });
        }
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('provider error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
