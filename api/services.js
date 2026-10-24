// SthapnaCorp's menu: optional fixed price, turnaround and note per service, set from the admin panel.
// Services with no price show "Quote in 1 working day" and the expert quotes on the order.
const { query } = require('./_lib/db');
const { isAdmin } = require('./_lib/auth');
const M = require('./_lib/market');
const C = require('../assets/catalogue.js');

module.exports = async function (req, res) {
  try {
    if (req.method === 'GET') {
      const r = await query('SELECT slug, price, turnaround, note, active FROM service_settings');
      const settings = Object.fromEntries(r.rows.map((s) => [s.slug, { price: s.price, turnaround: s.turnaround, note: s.note, active: s.active }]));
      if (!isAdmin(req)) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        res.setHeader('CDN-Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
      }
      return res.status(200).json({ settings });
    }
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    if (!C.find(b.slug)) return res.status(400).json({ error: 'Unknown service' });
    const price = b.price === '' || b.price == null ? null : Math.round(Number(b.price));
    if (price !== null && !(price > 0 && price < 100000000)) return res.status(400).json({ error: 'Enter the price in rupees, or leave it blank for "quote on request".' });
    await query(
      `INSERT INTO service_settings (slug, price, turnaround, note, active, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (slug) DO UPDATE SET price = $2, turnaround = $3, note = $4, active = $5, updated_at = NOW()`,
      [b.slug, price, M.clean(b.turnaround, 60) || null, M.clean(b.note, 200) || null, b.active !== false]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('services error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
