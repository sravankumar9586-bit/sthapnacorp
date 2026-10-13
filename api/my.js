// The customer's side of the app: sign in with an emailed code, see orders, chat with the expert,
// accept the quote and pay SthapnaCorp, rate the expert.
const crypto = require('crypto');
const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const M = require('./_lib/market');
const CU = require('./_lib/customer');

const e = mail.esc;
const RANK = { new: 0, unassigned: 0, assigned: 0, accepted: 1, quoted: 2, approved: 2, paid: 3, in_progress: 4, completed: 5 };

function summary(o) {
  return { id: o.id, ref: o.ref, token: o.token, service: o.service, created_at: o.created_at, status: o.status,
    status_label: M.STATUS_LABEL[o.status] || o.status, step: RANK[o.status], price: o.quote_amount, payment_status: o.payment_status,
    needs_action: (o.status === 'quoted') || (o.status === 'completed' && o.rating == null) };
}

async function detail(o) {
  const [ev, msgs, files, expert] = await Promise.all([
    query('SELECT at, message FROM order_events WHERE order_id = $1 AND public = TRUE ORDER BY at, id', [o.id]),
    query('SELECT id, at, sender, body FROM order_messages WHERE order_id = $1 ORDER BY at, id', [o.id]),
    query('SELECT id, at, uploaded_by, name, size FROM order_files WHERE order_id = $1 ORDER BY at', [o.id]),
    M.WORKING.concat('completed').includes(o.status) ? M.expertCard(o.provider_id) : null,
  ]);
  const pay = M.payments();
  const unpaid = o.payment_status !== 'paid';
  return Object.assign(summary(o), {
    details: o.details, city: o.city, company: o.company, quote_note: o.quote_note, rating: o.rating, review: o.review,
    expert, events: ev.rows, messages: msgs.rows, files: files.rows, support_phone: M.SUPPORT_PHONE,
    payments: pay,
    can: {
      pay: o.status === 'quoted' && unpaid && pay.online,
      approve: o.status === 'quoted' && unpaid && !pay.online,
      rate: o.status === 'completed' && o.rating == null,
      cancel: unpaid && !['completed', 'cancelled'].includes(o.status),
      message: o.status !== 'cancelled',
      upload: o.status !== 'cancelled',
    },
  });
}

// The order this request may act on: the signed-in customer's own order, or the secret link from the email.
async function findOrder(req, cust) {
  const src = req.method === 'GET' ? req.query : (req.body || {});
  if (src.t) return (await query('SELECT * FROM orders WHERE token = $1', [String(src.t)])).rows[0] || null;
  if (src.id && cust) return (await query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [Number(src.id), cust.id])).rows[0] || null;
  return null;
}

async function razorpay(path, body) {
  const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1' + path, { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.description) || 'Payment gateway error');
  return j;
}

module.exports = async function (req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const b = req.body || {};

    // ── sign in with a code ──
    if (req.method === 'POST' && b.action === 'code') {
      const email = M.clean(b.email, 160).toLowerCase();
      const c = (await query('SELECT * FROM customers WHERE email = $1', [email])).rows[0];
      if (c) {
        const recent = await query("SELECT COUNT(*)::int AS n FROM customer_tokens WHERE customer_id = $1 AND kind = 'code' AND expires_at > NOW()", [c.id]);
        if (recent.rows[0].n < 3) {
          const code = String(crypto.randomInt(100000, 1000000));
          await query("INSERT INTO customer_tokens (token_hash, customer_id, kind, expires_at) VALUES ($1,$2,'code', NOW() + INTERVAL '10 minutes') ON CONFLICT (token_hash) DO UPDATE SET used = FALSE, attempts = 0, expires_at = EXCLUDED.expires_at", [M.hash(c.id + ':' + code), c.id]);
          await M.safeSend({ to: c.email, subject: `${code} is your SthapnaCorp sign-in code`, html: mail.layout('Your sign-in code', `<p>Hi ${e(M.firstName(c.name))}, enter this code to see your orders. It is valid for 10 minutes.</p><p style="font:bold 30px monospace;letter-spacing:6px;color:#0D1B3E">${code}</p><p style="font-size:13px;color:#7E786F">If you did not ask for this, ignore this email.</p>`) });
        }
      }
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && b.action === 'verify') {
      const email = M.clean(b.email, 160).toLowerCase();
      const code = String(b.code || '').replace(/\D/g, '');
      const c = (await query('SELECT id FROM customers WHERE email = $1', [email])).rows[0];
      if (c) {
        // Limit guesses: every wrong try counts against all of this customer's live codes.
        const live = await query("SELECT COALESCE(MAX(attempts),0)::int AS a FROM customer_tokens WHERE customer_id = $1 AND kind = 'code' AND expires_at > NOW() AND used = FALSE", [c.id]);
        if (live.rows[0].a < 5) {
          const hit = await query(`UPDATE customer_tokens SET used = TRUE WHERE token_hash = $1 AND customer_id = $2 AND kind = 'code' AND used = FALSE AND expires_at > NOW() RETURNING customer_id`, [M.hash(c.id + ':' + code), c.id]);
          if (hit.rows.length) { await CU.startSession(req, res, c.id); return res.status(200).json({ ok: true }); }
          await query("UPDATE customer_tokens SET attempts = attempts + 1 WHERE customer_id = $1 AND kind = 'code' AND used = FALSE", [c.id]);
        }
      }
      return res.status(400).json({ error: 'That code is not right or has expired. Request a new one.' });
    }
    if (req.method === 'POST' && b.action === 'logout') {
      await CU.endSession(req, res);
      return res.status(200).json({ ok: true });
    }

    const cust = await CU.currentCustomer(req);

    if (req.method === 'GET') {
      if (req.query.t || req.query.id) {
        const o = await findOrder(req, cust);
        if (!o) return res.status(404).json({ error: 'We could not find this order. Sign in, or use the link in your order email.' });
        return res.status(200).json(Object.assign(await detail(o), { signed_in: !!cust && cust.id === o.customer_id }));
      }
      if (!cust) return res.status(401).json({ error: 'Please sign in.' });
      const r = await query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200', [cust.id]);
      return res.status(200).json({ me: { name: cust.name, email: cust.email, mobile: cust.mobile }, orders: r.rows.map(summary) });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const o = await findOrder(req, cust);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    const d = await detail(o);

    if (b.action === 'message') {
      const body = M.clean(b.body, 3000);
      if (!body) return res.status(400).json({ error: 'Write a message.' });
      if (!d.can.message) return res.status(400).json({ error: 'This order is closed.' });
      await M.postMessage(o, 'client', body);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'pay') {
      if (!d.can.pay) return res.status(400).json({ error: 'There is nothing to pay on this order right now.' });
      const rz = await razorpay('/orders', { amount: Math.round(Number(o.quote_amount) * 100), currency: 'INR', receipt: o.ref, notes: { order: o.ref, service: o.service.slice(0, 200) } });
      await query('UPDATE orders SET rzp_order_id = $1 WHERE id = $2', [rz.id, o.id]);
      return res.status(200).json({ key_id: d.payments.key_id, rzp_order_id: rz.id, amount: rz.amount, name: o.name, email: o.email, mobile: o.mobile, description: `${o.ref} · ${o.service}` });
    }
    if (b.action === 'paid') {
      if (o.payment_status === 'paid') return res.status(200).json({ ok: true });
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const expected = secret && o.rzp_order_id ? crypto.createHmac('sha256', secret).update(o.rzp_order_id + '|' + String(b.razorpay_payment_id || '')).digest('hex') : '';
      const sig = String(b.razorpay_signature || '');
      if (!expected || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return res.status(400).json({ error: 'We could not confirm the payment. If money was debited, WhatsApp us on ' + M.SUPPORT_PHONE + ' with your order number.' });
      }
      await M.markPaid(o, M.clean(b.razorpay_payment_id, 80), 'client');
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'approve') {
      if (!d.can.approve) return res.status(400).json({ error: 'There is no quote to accept right now.' });
      await query("UPDATE orders SET status = 'approved' WHERE id = $1", [o.id]);
      await M.addEvent(o.id, 'client', 'approved', `You accepted the quote of ${M.rupees(o.quote_amount)}. SthapnaCorp will send you a payment link.`);
      await M.safeSend({ to: M.OWNER(), subject: `Collect payment: ${o.ref} ${M.rupees(o.quote_amount)} (${o.name})`, html: mail.layout('Quote accepted — collect payment', `<p>${e(o.name)} accepted ${M.rupees(o.quote_amount)} for <strong>${e(o.service)}</strong>.</p><p>Send a payment link or UPI request to ${e(o.mobile)} / ${e(o.email)}, then click <strong>Mark paid</strong> on the order in the admin panel so the expert can start.</p><p><a href="${M.SITE}/admin">Open admin panel</a></p>`) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'rate') {
      if (!d.can.rate) return res.status(400).json({ error: 'You can rate once the order is completed.' });
      const stars = Math.round(Number(b.stars));
      if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Choose 1 to 5 stars.' });
      await query('UPDATE orders SET rating = $1, review = $2 WHERE id = $3', [stars, M.clean(b.review, 1000) || null, o.id]);
      await M.safeSend({ to: M.OWNER(), subject: `${'★'.repeat(stars)} rating on ${o.ref}`, html: mail.layout('New rating', `<p>${stars}/5 for ${e(o.service)}.</p><p>${e(b.review || '')}</p>`) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'cancel') {
      if (!d.can.cancel) return res.status(400).json({ error: 'This order can no longer be cancelled here. Message us on WhatsApp.' });
      await query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [o.id]);
      await M.addEvent(o.id, 'client', 'status', 'You cancelled this order.' + (b.reason ? ' Reason: ' + M.clean(b.reason, 300) : ''));
      await M.safeSend({ to: M.OWNER(), subject: `Order ${o.ref} cancelled by customer`, html: mail.layout('Order cancelled', `<p>${e(o.name)} cancelled ${e(o.service)}. ${e(b.reason || '')}</p>`) });
      if (o.provider_id) {
        const p = (await query('SELECT email FROM providers WHERE id = $1', [o.provider_id])).rows[0];
        if (p) await M.safeSend({ to: p.email, subject: `Job ${o.ref} was cancelled by the customer`, html: mail.layout('Job cancelled', `<p>The customer cancelled <strong>${e(o.service)}</strong>. No further work is needed.</p>`) });
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('my error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again or WhatsApp ' + M.SUPPORT_PHONE + '.' });
  }
};
