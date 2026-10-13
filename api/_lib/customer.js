// Customer sessions: created when someone places their first order, or by a 6-digit code sent to their email.
const { query } = require('./db');
const M = require('./market');

const COOKIE = 'sc_cus';
const SESSION_DAYS = 60;

async function currentCustomer(req) {
  const t = M.cookie(req, COOKIE);
  if (!t) return null;
  const r = await query(
    `SELECT c.* FROM customer_tokens t JOIN customers c ON c.id = t.customer_id
     WHERE t.token_hash = $1 AND t.kind = 'session' AND t.expires_at > NOW()`, [M.hash(t)]);
  return r.rows[0] || null;
}

async function startSession(req, res, customerId) {
  const t = M.token();
  await query(`INSERT INTO customer_tokens (token_hash, customer_id, kind, expires_at) VALUES ($1,$2,'session', NOW() + ($3 || ' days')::interval)`,
    [M.hash(t), customerId, String(SESSION_DAYS)]);
  M.setCookie(req, res, COOKIE, t, SESSION_DAYS * 86400);
}

async function endSession(req, res) {
  const t = M.cookie(req, COOKIE);
  if (t) await query('DELETE FROM customer_tokens WHERE token_hash = $1', [M.hash(t)]);
  M.setCookie(req, res, COOKIE, '', 0);
}

module.exports = { COOKIE, currentCustomer, startSession, endSession };
