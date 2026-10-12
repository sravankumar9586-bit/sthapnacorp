const nodemailer = require('nodemailer');

let transport;

function configured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!configured()) throw new Error('SMTP is not configured');
  return getTransport().sendMail({
    from: process.env.SMTP_FROM || `SthapnaCorp <${process.env.SMTP_USER}>`,
    to, subject, html, text, replyTo,
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#FAF8F4;font-family:Georgia,serif;color:#1C1A17">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F4;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #E5DFD4;border-radius:10px">
<tr><td style="background:#0D1B3E;padding:18px 24px;border-radius:10px 10px 0 0;color:#fff;font-size:20px;font-weight:bold">SthapnaCorp</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.6">
<h1 style="font-size:21px;color:#0D1B3E;margin:0 0 14px">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E5DFD4;font-size:13px;color:#7E786F">
SthapnaCorp · Hyderabad · +91 86861 45656 · <a href="https://wa.me/918686145656" style="color:#1A2F5A">WhatsApp</a>
</td></tr></table></td></tr></table></body></html>`;
}

module.exports = { configured, send, esc, layout };
