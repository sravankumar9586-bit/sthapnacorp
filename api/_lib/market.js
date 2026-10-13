// Marketplace core: matching orders to experts, order history, payments config and notification emails.
// SthapnaCorp owns the customer: experts see the requirement and talk to the customer only through
// the order chat; the customer pays SthapnaCorp, and experts are paid out after commission.
const crypto = require('crypto');
const { query } = require('./db');
const mail = require('./mail');

const SITE = process.env.SITE_URL || 'https://www.sthapnacorp.com';
const OWNER = () => process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
const ACCEPT_HOURS = 12; // an expert who has not accepted by then loses the order to the next match
const OPEN = ['assigned', 'accepted', 'quoted', 'approved', 'paid', 'in_progress'];
const WORKING = ['accepted', 'quoted', 'approved', 'paid', 'in_progress'];
const SUPPORT_PHONE = '+91 86861 45656';

// What the customer sees. Reassignments between experts stay invisible to them.
const STATUS_LABEL = {
  new: 'Finding your expert', unassigned: 'Finding your expert', assigned: 'Finding your expert',
  accepted: 'Expert is preparing your quote', quoted: 'Quote ready for you', approved: 'Waiting for payment',
  paid: 'Paid · work starting', in_progress: 'Work in progress', completed: 'Completed', cancelled: 'Cancelled',
};

function token() { return crypto.randomBytes(24).toString('base64url'); }
function hash(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function normCity(c) { return clean(c, 80).toLowerCase().replace(/[^a-z]/g, '').replace(/^secunderabad$|^cyberabad$/, 'hyderabad'); }
function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
function firstName(n) { return String(n || '').trim().split(/\s+/)[0]; }
function shortName(n) { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1].charAt(0) + '.' : p[0]; }

function payments() {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  return { online: !!(id && secret), key_id: id && secret ? id : null };
}

function cookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(req, res, name, value, maxAge) {
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers.host || ''));
  const prev = res.getHeader('Set-Cookie');
  const c = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

async function addEvent(orderId, actor, kind, message, isPublic) {
  await query('INSERT INTO order_events (order_id, actor, kind, message, public) VALUES ($1,$2,$3,$4,$5)',
    [orderId, actor, kind, message || null, isPublic !== false]);
}

function safeSend(msg) {
  if (!mail.configured() || !msg.to) return Promise.resolve();
  return mail.send(msg).catch((err) => console.error('mail failed:', msg.subject, err.message));
}

function orderUrl(o) { return `${SITE}/my?t=${o.token}`; }

// Public face of an expert: short name, qualification, city, rating. No firm or contact details.
async function expertCard(providerId) {
  if (!providerId) return null;
  const r = await query(
    `SELECT p.name, p.qualification, p.city,
       (SELECT ROUND(AVG(rating)::numeric, 1) FROM orders WHERE provider_id = p.id AND rating IS NOT NULL) AS rating,
       (SELECT COUNT(*)::int FROM orders WHERE provider_id = p.id AND rating IS NOT NULL) AS ratings,
       (SELECT COUNT(*)::int FROM orders WHERE provider_id = p.id AND status = 'completed') AS completed
     FROM providers p WHERE p.id = $1`, [providerId]);
  const p = r.rows[0];
  return p ? { name: shortName(p.name), qualification: p.qualification, city: p.city, rating: p.rating ? Number(p.rating) : null, ratings: p.ratings, completed: p.completed } : null;
}

// Best expert for an order: online, offers the category, has room, has not declined it;
// same city first, then the lightest current load, then the better rating, then whoever waited longest.
async function pickProvider(o) {
  const r = await query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM orders x WHERE x.provider_id = p.id AND x.status = ANY($3)) AS open_count,
            (SELECT AVG(rating) FROM orders x WHERE x.provider_id = p.id AND x.rating IS NOT NULL) AS avg_rating
     FROM providers p
     WHERE p.status = 'approved' AND p.available AND $1 = ANY(p.categories) AND NOT (p.id = ANY($2::int[]))`,
    [o.category, o.declined_by || [], OPEN]
  );
  const city = normCity(o.city);
  const fits = r.rows.filter((p) => p.open_count < p.capacity && (normCity(p.city) === city || p.remote_ok));
  fits.sort((a, b) =>
    (normCity(b.city) === city) - (normCity(a.city) === city) ||
    a.open_count - b.open_count ||
    (Number(b.avg_rating) || 4) - (Number(a.avg_rating) || 4) ||
    (a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0) - (b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0) ||
    a.id - b.id);
  return fits[0] || null;
}

async function assignTo(o, p, actor) {
  await query("UPDATE orders SET provider_id = $1, status = 'assigned', assigned_at = NOW(), accepted_at = NULL, commission_pct = $3 WHERE id = $2",
    [p.id, o.id, p.commission_pct]);
  await query('UPDATE providers SET last_assigned_at = NOW() WHERE id = $1', [p.id]);
  await addEvent(o.id, actor, 'assigned', `Offered to ${p.name} (${p.qualification})`, false);
  const e = mail.esc;
  await safeSend({
    to: p.email,
    subject: `New job ${o.ref}: ${o.service}${o.city ? ' · ' + o.city : ''} — accept within ${ACCEPT_HOURS} hours`,
    html: mail.layout('New job for you', `
      <p>Hi ${e(firstName(p.name))}, a new SthapnaCorp job matches your work.</p>
      <p style="background:#E8EDF5;padding:12px;border-radius:6px"><strong>${e(o.service)}</strong><br>
      City: ${e(o.city || '—')}<br>${o.company ? 'Business: ' + e(o.company) + '<br>' : ''}
      ${o.quote_amount != null ? 'Fixed price: ' + rupees(o.quote_amount) + '<br>' : ''}
      ${o.details ? 'Requirement: ' + e(o.details) : ''}</p>
      <p>Accept it within ${ACCEPT_HOURS} hours, or decline so it goes to the next expert.</p>
      <p><a href="${SITE}/provider" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open my jobs</a></p>`),
  });
}

// Assigns the order to the next match, or flags it for the owner when nobody fits.
async function allocate(orderId, actor) {
  const o = (await query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  if (!o || !['new', 'unassigned', 'assigned'].includes(o.status)) return null;
  const p = await pickProvider(o);
  if (p) { await assignTo(o, p, actor || 'system'); return p; }
  if (o.status !== 'unassigned') {
    await query("UPDATE orders SET status = 'unassigned', provider_id = NULL, assigned_at = NULL WHERE id = $1", [o.id]);
    await addEvent(o.id, 'system', 'unassigned', 'No available expert matched; owner alerted', false);
    await safeSend({
      to: OWNER(),
      subject: `Order ${o.ref} needs an expert: ${o.service}`,
      html: mail.layout('Order waiting for an expert', `
        <p>No approved, online expert currently covers <strong>${mail.esc(o.service)}</strong>${o.city ? ' in ' + mail.esc(o.city) : ''} with free capacity.</p>
        <p>Assign it yourself in the admin panel, or approve an expert who covers this category.</p>
        <p><a href="${SITE}/admin">Open admin panel</a></p>`),
    });
  }
  return null;
}

// Orders an expert sat on past the acceptance window move to the next match.
async function reassignStale() {
  const r = await query(
    `UPDATE orders SET declined_by = array_append(declined_by, provider_id), status = 'new'
     WHERE status = 'assigned' AND assigned_at < NOW() - ($1 || ' hours')::interval RETURNING id`,
    [String(ACCEPT_HOURS)]
  );
  for (const row of r.rows) {
    await addEvent(row.id, 'system', 'expired', 'Not accepted in time; moved to the next expert', false);
    await allocate(row.id, 'system');
  }
  return r.rows.length;
}

async function clientEmail(o, subject, title, bodyHtml) {
  if (!o.email) return;
  await safeSend({
    to: o.email, replyTo: OWNER(), subject, html: mail.layout(title, bodyHtml + `
      <p><a href="${orderUrl(o)}" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open order ${mail.esc(o.ref)}</a></p>
      <p style="font-size:13px;color:#7E786F">Questions? Reply to this email or WhatsApp ${SUPPORT_PHONE} quoting ${mail.esc(o.ref)}.</p>`),
  });
}

// Message in the order chat, with an email to whoever did not write it.
async function postMessage(o, sender, body) {
  const r = await query('INSERT INTO order_messages (order_id, sender, body) VALUES ($1,$2,$3) RETURNING id, at, sender, body', [o.id, sender, body]);
  const e = mail.esc;
  const quote = `<p style="background:#F2EEE6;padding:12px;border-radius:6px;white-space:pre-wrap">${e(body)}</p>`;
  if (sender !== 'client') {
    await clientEmail(o, `New message on order ${o.ref}`, sender === 'admin' ? 'Message from SthapnaCorp' : 'Message from your expert', quote + '<p>Reply from your order page.</p>');
  }
  if (sender !== 'expert' && o.provider_id && WORKING.concat('completed').includes(o.status)) {
    const p = (await query('SELECT name, email FROM providers WHERE id = $1', [o.provider_id])).rows[0];
    if (p) await safeSend({ to: p.email, subject: `Message on job ${o.ref} from ${sender === 'admin' ? 'SthapnaCorp' : 'the customer'}`, html: mail.layout('New message', quote + `<p><a href="${SITE}/provider">Reply from your jobs page</a></p>`) });
  }
  if (sender !== 'admin') await safeSend({ to: OWNER(), subject: `[${o.ref}] ${sender} wrote: ${body.slice(0, 60)}`, html: mail.layout('Order chat', quote + `<p><a href="${SITE}/admin">Open admin panel</a></p>`) });
  return r.rows[0];
}

// Payment received (online or marked by admin): the expert can start.
async function markPaid(o, ref, actor) {
  await query(`UPDATE orders SET payment_status = 'paid', paid_at = NOW(), payment_ref = $1,
               status = CASE WHEN status IN ('quoted','approved','accepted') THEN 'paid' ELSE status END WHERE id = $2`, [ref || null, o.id]);
  await addEvent(o.id, actor, 'paid', `Payment of ${rupees(o.quote_amount || 0)} received. Your expert will start now.`);
  await clientEmail(o, `Payment received for order ${o.ref}`, 'Payment received', `<p>Thank you. We have received ${rupees(o.quote_amount || 0)} for <strong>${mail.esc(o.service)}</strong>. Your expert will start work and keep you updated on your order page.</p>`);
  if (o.provider_id) {
    const p = (await query('SELECT name, email FROM providers WHERE id = $1', [o.provider_id])).rows[0];
    if (p) await safeSend({ to: p.email, subject: `Paid: start job ${o.ref} (${o.service})`, html: mail.layout('Customer has paid', `<p>The customer has paid for <strong>${mail.esc(o.service)}</strong>. Please start the work and post updates on your jobs page.</p><p><a href="${SITE}/provider">Open my jobs</a></p>`) });
  }
  await safeSend({ to: OWNER(), subject: `Payment received: ${o.ref} ${rupees(o.quote_amount || 0)}`, html: mail.layout('Payment received', `<p>${mail.esc(o.service)} · ${mail.esc(o.name)} · ${rupees(o.quote_amount || 0)} · ref ${mail.esc(ref || actor)}</p>`) });
}

function payout(o) {
  const price = Number(o.quote_amount || 0);
  const pct = o.commission_pct == null ? 20 : Number(o.commission_pct);
  const fee = Math.round(price * pct / 100);
  return { price, pct, platform_fee: fee, expert_earning: price - fee };
}

module.exports = {
  ACCEPT_HOURS, OPEN, WORKING, STATUS_LABEL, SITE, OWNER, SUPPORT_PHONE,
  token, hash, clean, rupees, firstName, shortName, payments, cookie, setCookie,
  addEvent, allocate, assignTo, reassignStale, clientEmail, safeSend, orderUrl, expertCard, postMessage, markPaid, payout,
};
