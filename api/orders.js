// Placing orders (public) and running them (admin).
const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');
const M = require('./_lib/market');
const CU = require('./_lib/customer');
const C = require('../assets/catalogue.js');

const e = mail.esc;

module.exports = async function (req, res) {
  try {
    // ── place an order (public) ──
    if (req.method === 'POST' && !isAdmin(req)) {
      const b = req.body || {};
      if (b.website) return res.status(200).json({ ok: true, ref: 'SC-0000' }); // honeypot
      const svc = C.find(M.clean(b.service_slug, 120));
      const o = {
        service_slug: svc ? svc.slug : null,
        service: svc ? svc.name : M.clean(b.service, 160),
        category: svc ? svc.cat : null,
        details: M.clean(b.details, 3000),
        city: M.clean(b.city, 80),
        name: M.clean(b.name, 100),
        mobile: M.clean(b.mobile, 20),
        email: M.clean(b.email, 160).toLowerCase(),
        company: M.clean(b.company, 160),
        page: M.clean(b.page, 200),
        utm: b.utm && typeof b.utm === 'object' ? b.utm : {},
      };
      if (!o.service) return res.status(400).json({ error: 'Choose the service you need.' });
      if (!o.name) return res.status(400).json({ error: 'Please enter your name.' });
      if (o.mobile.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a 10-digit mobile number.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return res.status(400).json({ error: 'Please enter your email so we can send order updates.' });
      if (!o.city) return res.status(400).json({ error: 'Please enter your city.' });

      let row, newSession = false;
      try {
        const recent = await query(
          "SELECT COUNT(*)::int AS n FROM orders WHERE created_at > NOW() - INTERVAL '1 hour' AND regexp_replace(mobile, '\\D', '', 'g') = $1",
          [o.mobile.replace(/\D/g, '')]
        );
        if (recent.rows[0].n >= 5) return res.status(429).json({ error: 'We already have your orders from this number. We will be in touch shortly.' });
        // Menu price, if SthapnaCorp has fixed one for this service.
        const setting = o.service_slug ? (await query('SELECT price FROM service_settings WHERE slug = $1 AND active', [o.service_slug])).rows[0] : null;
        // Customer account: a brand-new customer is signed in straight away; an existing one only if
        // this browser is already signed in as them (so nobody can open another person's orders by typing their email).
        const signedIn = await CU.currentCustomer(req);
        let cust = (await query('SELECT * FROM customers WHERE email = $1', [o.email])).rows[0];
        if (!cust) {
          cust = (await query('INSERT INTO customers (email, name, mobile) VALUES ($1,$2,$3) RETURNING *', [o.email, o.name, o.mobile])).rows[0];
          if (!signedIn || signedIn.id !== cust.id) { await CU.startSession(req, res, cust.id); newSession = true; }
        }
        row = (await query(
          `INSERT INTO orders (token, service_slug, service, category, details, city, name, mobile, email, company, page, utm, customer_id, quote_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [M.token(), o.service_slug, o.service, o.category, o.details || null, o.city, o.name, o.mobile, o.email, o.company || null, o.page || null,
            JSON.stringify(o.utm), cust.id, setting && setting.price != null ? setting.price : null]
        )).rows[0];
        row.ref = 'SC-' + String(1000 + row.id);
        await query('UPDATE orders SET ref = $1 WHERE id = $2', [row.ref, row.id]);
        await M.addEvent(row.id, 'client', 'created', 'Order placed');
      } catch (err) {
        console.error('order not saved:', err.message);
        if (!mail.configured()) throw err;
        await mail.send({
          to: M.OWNER(), replyTo: o.email,
          subject: `ORDER NOT SAVED (database down): ${o.service} — ${o.name}`,
          html: mail.layout('Order not saved', `<p style="background:#F8E9E9;color:#9B1C1C;padding:10px;border-radius:6px">The database is unavailable, so this order was not saved or assigned. Handle it from this email.</p>
            <p><strong>${e(o.service)}</strong> · ${e(o.city)}</p><p>${e(o.name)} · ${e(o.mobile)} · ${e(o.email)} · ${e(o.company || '—')}</p><p>${e(o.details || '')}</p>`),
        });
        return res.status(200).json({ ok: true, queued: true });
      }

      await M.reassignStale().catch((err) => console.error('stale check failed:', err.message));
      const pro = await M.allocate(row.id, 'system').catch((err) => { console.error('allocate failed:', err.message); return null; });
      const digits = o.mobile.replace(/\D/g, '');
      await Promise.all([
        M.clientEmail(row, `Order ${row.ref} placed: ${o.service}`, 'Your order is placed', `
          <p>Hi ${e(M.firstName(o.name))}, thank you for ordering <strong>${e(o.service)}</strong> on SthapnaCorp.</p>
          <p>We are assigning a verified expert to your order. ${row.quote_amount != null ? `The price is ${M.rupees(row.quote_amount)}; you pay once your expert confirms.` : 'Your expert will send you a quote on your order page; nothing is payable until you accept it.'}</p>
          <p>You can chat with your expert, share documents and follow every step on your order page.</p>`),
        M.safeSend({
          to: M.OWNER(), replyTo: o.email,
          subject: `New order ${row.ref}: ${o.service} — ${o.name}${pro ? ' → ' + pro.name : ' (unassigned)'}`,
          html: mail.layout('New order', `<p><strong>${e(o.service)}</strong> · ${e(o.city)}${row.quote_amount != null ? ' · ' + M.rupees(row.quote_amount) : ''}</p>
            <p>${e(o.name)} · <a href="https://wa.me/${digits.length === 10 ? '91' + digits : digits}">${e(o.mobile)}</a> · ${e(o.email)} · ${e(o.company || '—')}</p>
            <p>${e(o.details || '')}</p><p>Offered to: <strong>${pro ? e(pro.name) : 'nobody yet'}</strong></p><p><a href="${M.SITE}/admin">Open admin panel</a></p>`),
        }),
      ]);
      return res.status(200).json({ ok: true, ref: row.ref, url: `/my?t=${row.token}`, signed_in: newSession });
    }

    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    // ── admin ──
    if (req.method === 'GET') {
      await M.reassignStale().catch((err) => console.error('stale check failed:', err.message));
      if (req.query.id) {
        const id = Number(req.query.id);
        const [ev, msgs, files] = await Promise.all([
          query('SELECT at, actor, kind, message, public FROM order_events WHERE order_id = $1 ORDER BY at, id', [id]),
          query('SELECT id, at, sender, body FROM order_messages WHERE order_id = $1 ORDER BY at, id', [id]),
          query('SELECT id, at, uploaded_by, name, mime, size FROM order_files WHERE order_id = $1 ORDER BY at', [id]),
        ]);
        return res.status(200).json({ events: ev.rows, messages: msgs.rows, files: files.rows });
      }
      const r = await query(
        `SELECT o.id, o.created_at, o.ref, o.token, o.service, o.category, o.details, o.city, o.name, o.mobile, o.email, o.company, o.page, o.utm,
                o.status, o.provider_id, o.assigned_at, o.accepted_at, o.completed_at, o.quote_amount, o.admin_notes, o.payment_status, o.paid_at,
                o.payment_ref, o.commission_pct, o.payout_status, o.payout_at, o.rating, o.review, p.name AS provider_name,
                (SELECT COUNT(*)::int FROM order_messages m WHERE m.order_id = o.id) AS message_count
         FROM orders o LEFT JOIN providers p ON p.id = o.provider_id ORDER BY o.created_at DESC LIMIT 500`
      );
      return res.status(200).json(r.rows.map((o) => Object.assign(o, { money: M.payout(o) })));
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = Number(b.order_id);
      const o = (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
      if (!o) return res.status(404).json({ error: 'Order not found' });
      if (b.action === 'assign') {
        if (!['new', 'unassigned', 'assigned'].includes(o.status)) return res.status(400).json({ error: 'An expert has already accepted this order. Cancel it or message the expert instead.' });
        if (b.provider_id) {
          const p = (await query("SELECT * FROM providers WHERE id = $1 AND status = 'approved'", [Number(b.provider_id)])).rows[0];
          if (!p) return res.status(400).json({ error: 'Choose an approved expert.' });
          if (o.provider_id && o.provider_id !== p.id) await query('UPDATE orders SET declined_by = array_append(declined_by, provider_id) WHERE id = $1', [id]);
          await M.assignTo(o, p, 'admin');
        } else {
          if (o.provider_id) await query("UPDATE orders SET declined_by = array_append(declined_by, provider_id), status = 'new', provider_id = NULL WHERE id = $1", [id]);
          await M.allocate(id, 'admin');
        }
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'cancel') {
        await query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [id]);
        await M.addEvent(id, 'admin', 'status', M.clean(b.message, 500) || 'Order cancelled');
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'notes') {
        await query('UPDATE orders SET admin_notes = $1 WHERE id = $2', [M.clean(b.notes, 3000) || null, id]);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'price') {
        const v = Math.round(Number(b.amount));
        if (!(v > 0 && v < 100000000)) return res.status(400).json({ error: 'Enter the amount in rupees.' });
        if (o.payment_status === 'paid') return res.status(400).json({ error: 'Already paid.' });
        await query(`UPDATE orders SET quote_amount = $1, status = CASE WHEN status IN ('accepted','approved') THEN 'quoted' ELSE status END WHERE id = $2`, [v, id]);
        await M.addEvent(id, 'admin', 'quote', `Price set: ${M.rupees(v)}`);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'mark_paid') {
        if (o.payment_status === 'paid') return res.status(400).json({ error: 'Already marked paid.' });
        if (o.quote_amount == null) return res.status(400).json({ error: 'Set the price first.' });
        await M.markPaid(o, M.clean(b.ref, 120) || 'marked paid by admin', 'admin');
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'payout') {
        if (o.status !== 'completed' || o.payment_status !== 'paid') return res.status(400).json({ error: 'Pay out only completed, paid orders.' });
        await query("UPDATE orders SET payout_status = 'paid', payout_at = NOW() WHERE id = $1", [id]);
        await M.addEvent(id, 'admin', 'payout', `Expert paid ${M.rupees(M.payout(o).expert_earning)}`, false);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'message') {
        const body = M.clean(b.body, 3000);
        if (!body) return res.status(400).json({ error: 'Write a message.' });
        await M.postMessage(o, 'admin', body);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('orders error:', err.message);
    return res.status(500).json({ error: 'Server error. Please WhatsApp us on +91 86861 45656.' });
  }
};
