const crypto = require('crypto');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Admin endpoints are closed unless ADMIN_PASSWORD is set in the Vercel environment.
function isAdmin(req) {
  const pass = process.env.ADMIN_PASSWORD;
  return !!pass && safeEqual(req.headers['x-admin-password'], pass);
}

module.exports = { isAdmin, safeEqual };
