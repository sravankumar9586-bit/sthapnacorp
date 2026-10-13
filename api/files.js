// Documents shared on an order (PAN, address proof, drafts, certificates). Only the customer,
// the expert who accepted the order and the admin can upload or download them.
const { query } = require('./_lib/db');
const { isAdmin } = require('./_lib/auth');
const M = require('./_lib/market');
const CU = require('./_lib/customer');

const MAX_BYTES = 3 * 1024 * 1024; // keeps the base64 request under Vercel's 4.5 MB body limit
const TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

// Who is asking, and may they touch this order?
async function access(req, order) {
  if (isAdmin(req)) return 'admin';
  const src = req.method === 'GET' ? req.query : (req.body || {});
  if (src.t && src.t === order.token) return 'client';
  const cust = await CU.currentCustomer(req);
  if (cust && cust.id === order.customer_id) return 'client';
  const pt = M.cookie(req, 'sc_pro');
  if (pt && order.provider_id && order.status !== 'assigned') {
    const r = await query(`SELECT 1 FROM provider_tokens t JOIN providers p ON p.id = t.provider_id
      WHERE t.token_hash = $1 AND t.kind = 'session' AND t.expires_at > NOW() AND p.status = 'approved' AND p.id = $2`, [M.hash(pt), order.provider_id]);
    if (r.rows.length) return 'expert';
  }
  return null;
}

module.exports = async function (req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const f = (await query('SELECT f.*, o.token, o.customer_id, o.provider_id, o.status FROM order_files f JOIN orders o ON o.id = f.order_id WHERE f.id = $1', [Number(req.query.id)])).rows[0];
      if (!f || !(await access(req, f))) return res.status(404).json({ error: 'File not found.' });
      res.setHeader('Content-Type', f.mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/[^\w.\- ]+/g, '_')}"`);
      return res.status(200).send(f.data);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    const order = b.t
      ? (await query('SELECT * FROM orders WHERE token = $1', [String(b.t)])).rows[0]
      : (await query('SELECT * FROM orders WHERE id = $1', [Number(b.order_id)])).rows[0];
    const who = order && (await access(req, order));
    if (!who) return res.status(404).json({ error: 'Order not found.' });
    if (order.status === 'cancelled') return res.status(400).json({ error: 'This order is closed.' });
    const ext = TYPES[b.mime];
    if (!ext) return res.status(400).json({ error: 'Upload a PDF, image, Word or Excel file.' });
    const data = Buffer.from(String(b.data || ''), 'base64');
    if (!data.length) return res.status(400).json({ error: 'The file is empty.' });
    if (data.length > MAX_BYTES) return res.status(400).json({ error: 'Files must be under 3 MB. Compress the PDF or photo and try again.' });
    const count = (await query('SELECT COUNT(*)::int AS n FROM order_files WHERE order_id = $1', [order.id])).rows[0].n;
    if (count >= 40) return res.status(400).json({ error: 'This order already has 40 files. Message us to share more.' });
    let name = M.clean(b.name, 120).replace(/[\\/]/g, '_') || 'document';
    if (!new RegExp('\\.' + ext + '$', 'i').test(name) && !(ext === 'jpg' && /\.jpe?g$/i.test(name))) name += '.' + ext;
    const r = await query('INSERT INTO order_files (order_id, uploaded_by, name, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [order.id, who, name, b.mime, data.length, data]);
    const label = who === 'client' ? 'The customer' : who === 'expert' ? 'Your expert' : 'SthapnaCorp';
    await M.addEvent(order.id, who, 'file', `${label} shared a document: ${name}`, who !== 'admin');
    if (who !== 'client') await M.clientEmail(order, `New document on order ${order.ref}`, 'New document for you', `<p>${label} shared <strong>${M.clean(name, 120).replace(/[<>&"]/g, '')}</strong> on your order.</p>`);
    if (who !== 'expert' && order.provider_id && order.status !== 'assigned') {
      const p = (await query('SELECT email FROM providers WHERE id = $1', [order.provider_id])).rows[0];
      if (p) await M.safeSend({ to: p.email, subject: `New document on job ${order.ref}`, html: `<p>${label} shared a document on job ${order.ref}. <a href="${M.SITE}/provider">Open my jobs</a></p>` });
    }
    return res.status(200).json({ ok: true, id: r.rows[0].id, name });
  } catch (err) {
    console.error('files error:', err.message);
    return res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
};
