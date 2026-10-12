const { query } = require('./_lib/db');
const mail = require('./_lib/mail');
const { isAdmin } = require('./_lib/auth');

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out after ' + ms / 1000 + 's')), ms))]);
}

// Admin-only health check: verifies the password without touching the database,
// then reports whether the database and email are working.
module.exports = async function (req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const out = {
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SMTP_USER: !!process.env.SMTP_USER,
      SMTP_PASS: !!process.env.SMTP_PASS,
      CRON_SECRET: !!process.env.CRON_SECRET,
    },
  };

  try {
    await withTimeout(query('SELECT 1'), 10000, 'Database connection');
    out.database = { ok: true };
  } catch (e) {
    const msg = String(e && e.message || e);
    let hint = 'Check DATABASE_URL in Vercel and that the database is running.';
    if (/ENOTFOUND|getaddrinfo/i.test(msg)) hint = 'The database host does not exist. The Railway database may have been deleted or its address changed: copy the current public connection URL from Railway into DATABASE_URL.';
    else if (/timed out|ETIMEDOUT|ECONNREFUSED|terminated|Connection terminated/i.test(msg)) hint = 'The database is not responding. It may be paused or out of credit in Railway.';
    else if (/password authentication|authentication failed/i.test(msg)) hint = 'The database password in DATABASE_URL is wrong. Copy the current connection URL from Railway.';
    else if (/does not exist/i.test(msg)) hint = 'The database name in DATABASE_URL does not exist.';
    else if (/not set/i.test(msg)) hint = 'DATABASE_URL is missing in Vercel.';
    out.database = { ok: false, error: msg.slice(0, 300), hint };
  }

  if (mail.configured()) {
    try {
      await withTimeout(mail.verify(), 10000, 'Email login');
      out.email = { ok: true };
    } catch (e) {
      const msg = String(e && e.message || e);
      out.email = { ok: false, error: msg.slice(0, 300), hint: /Invalid login|Username and Password not accepted|535/i.test(msg) ? 'Gmail rejected the app password. Create a new one and update SMTP_PASS.' : 'Check SMTP_USER and SMTP_PASS in Vercel.' };
    }
  } else {
    out.email = { ok: false, error: 'SMTP_USER or SMTP_PASS is not set', hint: 'Add a Gmail app password as SMTP_PASS in Vercel.' };
  }

  return res.status(200).json(out);
};
