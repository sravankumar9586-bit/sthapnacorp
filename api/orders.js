const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');
const M = require('./_lib/market');
const C = require('../assets/catalogue.js');

const e = mail.esc;

function publicView(o, provider, events) {
  const showPro = provider && ['accepted', 'in_progress', 'completed'].includes(o.status);
  return {
    ref: o.ref, service: o.service, city: o.city, created_at: o.created_at, status: o.status,
    status_label: M.STATUS_LABEL[o.status] || o.status,
    professional: showPro ? { name: provider.name, qualification: provider.qualification, firm: provider.firm, city: provider.city } : null,
    events: events.map((v) => ({ at: v.at, message: v.message })),
  };
}

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
        email: M.clean(b.email, 160),
        company: M.clean(b.company, 160),
        page: M.clean(b.page, 200),
        utm: b.utm && typeof b.utm === 'object' ? b.utm : {},
      };
      if (!o.service) return res.status(400).json({ error: 'Choose the service you need.' });
      if (!o.name) return res.status(400).json({ error: 'Please enter your name.' });
      if (o.mobile.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a 10-digit mobile number.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return res.status(400).json({ error: 'Please enter your email so we can send order updates.' });
      if (!o.city) return res.status(400).json({ error: 'Please enter your city.' });

      let row;
      try {
        const recent = await query(
          "SELECT COUNT(*)::int AS n FROM orders WHERE created_at > NOW() - INTERVAL '1 hour' AND regexp_replace(mobile, '\\D', '', 'g') = $1",
          [o.mobile.replace(/\D/g, '')]
        );
        if (recent.rows[0].n >= 5) return res.status(429).json({ error: 'We already have your orders from this number. We will be in touch shortly.' });
        row = (await query(
          `INSERT INTO orders (token, service_slug, service, category, details, city, name, mobile, email, company, page, utm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [M.token(), o.service_slug, o.service, o.category, o.details || null, o.city, o.name, o.mobile, o.email, o.company || null, o.page || null, JSON.stringify(o.utm)]
        )).rows[0];
        row.ref = 'SC-' + String(1000 + row.id);
        await query('UPDATE orders SET ref = $1 WHERE id = $2', [row.ref, row.id]);
        await M.addEvent(row.id, 'client', 'created', 'Order received');
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
        M.clientEmail(row, `Order ${row.ref} received: ${o.service}`, 'We have your order', `
          <p>Hi ${e(o.name.split(' ')[0])}, thank you for ordering <strong>${e(o.service)}</strong> on SthapnaCorp.</p>
          <p>${pro ? 'We have matched it to a verified professional, who will review it and contact you with a written quote, usually within one working day.' : 'We are matching it to a verified professional and will contact you within one working day.'}</p>
          <p>No work starts and nothing is payable until you approve the quote.</p>`),
        M.safeSend({
          to: M.OWNER(), replyTo: o.email,
          subject: `New order ${row.ref}: ${o.service} — ${o.name}${pro ? ' → ' + pro.name : ' (unassigned)'}`,
          html: mail.layout('New order', `<p><strong>${e(o.service)}</strong> · ${e(o.city)}</p>
            <p>${e(o.name)} · <a href="https://wa.me/${digits.length === 10 ? '91' + digits : digits}">${e(o.mobile)}</a> · ${e(o.email)} · ${e(o.company || '—')}</p>
            <p>${e(o.details || '')}</p><p>Assigned to: <strong>${pro ? e(pro.name) : 'nobody yet'}</strong></p><p><a href="${M.SITE}/admin">Open admin panel</a></p>`),
        }),
      ]);
      return res.status(200).json({ ok: true, ref: row.ref, track: `/track?t=${row.token}` });
    }

    // ── track an order (public, by secret link) ──
    if (req.method === 'GET' && req.query.t && !isAdmin(req)) {
      const o = (await query('SELECT * FROM orders WHERE token = $1', [String(req.query.t)])).rows[0];
      if (!o) return res.status(404).json({ error: 'We could not find this order. Check the link in your email.' });
      const p = o.provider_id ? (await query('SELECT name, qualification, firm, city FROM providers WHERE id = $1', [o.provider_id])).rows[0] : null;
      const ev = (await query('SELECT at, message FROM order_events WHERE order_id = $1 AND public = TRUE ORDER BY at, id', [o.id])).rows;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(publicView(o, p, ev));
    }

    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    // ── admin ──
    if (req.method === 'GET') {
      await M.reassignStale().catch((err) => console.error('stale check failed:', err.message));
      if (req.query.id) {
        const id = Number(req.query.id);
        const ev = (await query('SELECT at, actor, kind, message, public FROM order_events WHERE order_id = $1 ORDER BY at, id', [id])).rows;
        return res.status(200).json({ events: ev });
      }
      const r = await query(
        `SELECT o.id, o.created_at, o.ref, o.token, o.service, o.category, o.details, o.city, o.name, o.mobile, o.email, o.company, o.page, o.utm,
                o.status, o.provider_id, o.assigned_at, o.accepted_at, o.completed_at, o.quote_amount, o.admin_notes, p.name AS provider_name
         FROM orders o LEFT JOIN providers p ON p.id = o.provider_id ORDER BY o.created_at DESC LIMIT 500`
      );
      return res.status(200).json(r.rows);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = Number(b.order_id);
      const o = (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
      if (!o) return res.status(404).json({ error: 'Order not found' });
      if (b.action === 'assign') {
        if (['completed', 'cancelled'].includes(o.status)) return res.status(400).json({ error: 'This order is closed.' });
        if (b.provider_id) {
          const p = (await query("SELECT * FROM providers WHERE id = $1 AND status = 'approved'", [Number(b.provider_id)])).rows[0];
          if (!p) return res.status(400).json({ error: 'Choose an approved professional.' });
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
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('orders error:', err.message);
    return res.status(500).json({ error: 'Server error. Please WhatsApp us on +91 86861 45656.' });
  }
};
