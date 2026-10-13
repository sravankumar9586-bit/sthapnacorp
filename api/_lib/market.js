// Marketplace core: matching orders to service providers, order history and notification emails.
const crypto = require('crypto');
const { query } = require('./db');
const mail = require('./mail');

const SITE = process.env.SITE_URL || 'https://sthapnacorp.com';
const OWNER = () => process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
const ACCEPT_HOURS = 12; // a provider who has not accepted by then loses the order to the next match
const OPEN = ['assigned', 'accepted', 'in_progress'];

const STATUS_LABEL = {
  new: 'Received', unassigned: 'Finding a professional', assigned: 'Professional assigned',
  accepted: 'Accepted by professional', in_progress: 'Work in progress', completed: 'Completed', cancelled: 'Cancelled',
};

function token() { return crypto.randomBytes(24).toString('base64url'); }
function hash(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function normCity(c) { return clean(c, 80).toLowerCase().replace(/[^a-z]/g, '').replace(/^secunderabad$|^cyberabad$/, 'hyderabad'); }

async function addEvent(orderId, actor, kind, message, isPublic) {
  await query('INSERT INTO order_events (order_id, actor, kind, message, public) VALUES ($1,$2,$3,$4,$5)',
    [orderId, actor, kind, message || null, isPublic !== false]);
}

function safeSend(msg) {
  if (!mail.configured() || !msg.to) return Promise.resolve();
  return mail.send(msg).catch((err) => console.error('mail failed:', msg.subject, err.message));
}

function trackUrl(o) { return `${SITE}/track?t=${o.token}`; }

// Best provider for an order: offers the category, has room, has not declined it;
// same city first, then the lightest current load, then whoever waited longest for work.
async function pickProvider(o) {
  const r = await query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM orders x WHERE x.provider_id = p.id AND x.status = ANY($3)) AS open_count
     FROM providers p
     WHERE p.status = 'approved' AND $1 = ANY(p.categories) AND NOT (p.id = ANY($2::int[]))`,
    [o.category, o.declined_by || [], OPEN]
  );
  const city = normCity(o.city);
  const fits = r.rows.filter((p) => p.open_count < p.capacity && (normCity(p.city) === city || p.remote_ok));
  fits.sort((a, b) =>
    (normCity(b.city) === city) - (normCity(a.city) === city) ||
    a.open_count - b.open_count ||
    (a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0) - (b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0) ||
    a.id - b.id);
  return fits[0] || null;
}

async function assignTo(o, p, actor) {
  await query("UPDATE orders SET provider_id = $1, status = 'assigned', assigned_at = NOW(), accepted_at = NULL WHERE id = $2", [p.id, o.id]);
  await query('UPDATE providers SET last_assigned_at = NOW() WHERE id = $1', [p.id]);
  await addEvent(o.id, actor, 'assigned', `Assigned to ${p.name} (${p.qualification})`, false);
  await addEvent(o.id, 'system', 'status', 'A verified professional has been assigned and is reviewing your request.');
  const e = mail.esc;
  await safeSend({
    to: p.email,
    subject: `New order ${o.ref}: ${o.service}${o.city ? ' · ' + o.city : ''} — please accept within ${ACCEPT_HOURS} hours`,
    html: mail.layout('New order for you', `
      <p>Hi ${e(p.name.split(' ')[0])}, SthapnaCorp has matched a new order to you.</p>
      <p style="background:#E8EDF5;padding:12px;border-radius:6px"><strong>${e(o.service)}</strong><br>
      City: ${e(o.city || '—')}<br>${o.company ? 'Business: ' + e(o.company) + '<br>' : ''}
      ${o.details ? 'Requirement: ' + e(o.details) : ''}</p>
      <p>Accept it within ${ACCEPT_HOURS} hours to see the client's contact details. If you cannot take it, decline so it goes to the next professional.</p>
      <p><a href="${SITE}/provider" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open my orders</a></p>`),
  });
}

// Assigns the order to the next match, or flags it for the owner when nobody fits.
async function allocate(orderId, actor) {
  const o = (await query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  if (!o || ['completed', 'cancelled', 'accepted', 'in_progress'].includes(o.status)) return null;
  const p = await pickProvider(o);
  if (p) { await assignTo(o, p, actor || 'system'); return p; }
  if (o.status !== 'unassigned') {
    await query("UPDATE orders SET status = 'unassigned', provider_id = NULL, assigned_at = NULL WHERE id = $1", [o.id]);
    await addEvent(o.id, 'system', 'unassigned', 'No available professional matched; owner alerted', false);
    await safeSend({
      to: OWNER(),
      subject: `Order ${o.ref} needs a professional: ${o.service}`,
      html: mail.layout('Order waiting for a professional', `
        <p>No approved professional currently covers <strong>${mail.esc(o.service)}</strong>${o.city ? ' in ' + mail.esc(o.city) : ''} with free capacity.</p>
        <p>Assign it yourself in the admin panel, or approve a professional who covers this category.</p>
        <p><a href="${SITE}/admin">Open admin panel</a></p>`),
    });
  }
  return null;
}

// Orders a provider sat on past the acceptance window move to the next match.
async function reassignStale() {
  const r = await query(
    `UPDATE orders SET declined_by = array_append(declined_by, provider_id), status = 'new'
     WHERE status = 'assigned' AND assigned_at < NOW() - ($1 || ' hours')::interval RETURNING id, provider_id`,
    [String(ACCEPT_HOURS)]
  );
  for (const row of r.rows) {
    await addEvent(row.id, 'system', 'expired', 'Not accepted in time; moved to the next professional', false);
    await allocate(row.id, 'system');
  }
  return r.rows.length;
}

async function clientEmail(o, subject, title, bodyHtml) {
  if (!o.email) return;
  await safeSend({
    to: o.email, replyTo: OWNER(), subject, html: mail.layout(title, bodyHtml + `
      <p><a href="${trackUrl(o)}" style="display:inline-block;background:#0D1B3E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Track order ${mail.esc(o.ref)}</a></p>
      <p style="font-size:13px;color:#7E786F">Questions? Reply to this email or WhatsApp +91 86861 45656 quoting ${mail.esc(o.ref)}.</p>`),
  });
}

module.exports = { ACCEPT_HOURS, OPEN, STATUS_LABEL, SITE, OWNER, token, hash, clean, addEvent, allocate, assignTo, reassignStale, clientEmail, safeSend, trackUrl };
