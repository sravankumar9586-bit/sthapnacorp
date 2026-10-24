// Field expense app (/expense): employees send each out-of-pocket expense from their phone with a
// photo of the bill, the site supervisor passes or cuts it, and the office exports the month.
// Nobody types a password: each person opens a personal link the office sends on WhatsApp.
// Served through /api/services?x=expense (see vercel.json) to stay within the plan's function limit.
const { query } = require('./db');
const { isAdmin } = require('./auth');
const M = require('./market');

const COOKIE = 'sc_exp';
const SESSION_DAYS = 365;
const MAX_PHOTO = 1.5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ROLES = ['employee', 'supervisor', 'office'];
const PAY_MODES = ['UPI', 'Cash', 'Card', 'Bank'];
// Account heads match the Site Voucher Desk, so the export drops straight into the monthly vouchers.
const HEADS = ['Diesel', 'Petrol', 'Travelling Exp. / Local Conveyance', 'Rent / Elect.', 'Service Exp.',
  'Printing & Stationery', 'Office Maint. / Courier', 'Repairs & Maint.', 'Chemicals', 'Misc. Exp.'];
const FUEL = ['Diesel', 'Petrol'];

class Fail extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new Fail(status, msg); };

function linkFor(key) { return `${process.env.SITE_URL || 'https://www.sthapnacorp.com'}/expense?k=${key}`; }
function money(v) { const n = Math.round(Number(v) * 100) / 100; return isFinite(n) ? n : NaN; }
function monthRange(m) {
  if (!/^\d{4}-\d{2}$/.test(String(m || ''))) fail(400, 'Choose a month.');
  const [y, mm] = m.split('-').map(Number);
  const next = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
  return [`${m}-01`, next];
}

async function currentPerson(req) {
  const t = M.cookie(req, COOKIE);
  if (!t) return null;
  const r = await query(
    `SELECT p.*, c.name AS company_name, c.address AS company_address, c.gstin AS company_gstin, c.cash_limit, c.nobill_limit,
            s.code AS site_code, s.name AS site_name
     FROM exp_tokens t JOIN exp_people p ON p.id = t.person_id JOIN exp_companies c ON c.id = p.company_id
     LEFT JOIN exp_sites s ON s.id = p.site_id
     WHERE t.token_hash = $1 AND t.expires_at > NOW() AND p.active AND c.active`, [M.hash(t)]);
  return r.rows[0] || null;
}

async function newLink(personId) {
  const key = M.token();
  await query('UPDATE exp_people SET link_hash = $1 WHERE id = $2', [M.hash(key), personId]);
  await query('DELETE FROM exp_tokens WHERE person_id = $1', [personId]);
  return linkFor(key);
}

// Which claims a person may see: their own; a supervisor also sees their site's; the office sees all.
function scope(me, alias) {
  const a = alias || 'x';
  if (me.role === 'office') return { sql: `${a}.company_id = $1`, params: [me.company_id] };
  if (me.role === 'supervisor' && me.site_id) return { sql: `${a}.company_id = $1 AND (${a}.site_id = $2 OR ${a}.person_id = $3)`, params: [me.company_id, me.site_id, me.id] };
  return { sql: `${a}.company_id = $1 AND ${a}.person_id = $2`, params: [me.company_id, me.id] };
}

function claimOut(c) {
  return {
    id: c.id, ev_no: c.ev_no, created_at: c.created_at, spent_on: c.spent_on instanceof Date ? c.spent_on.toISOString().slice(0, 10) : c.spent_on,
    head: c.head, amount: Number(c.amount), litres: c.litres == null ? null : Number(c.litres), vehicle: c.vehicle,
    bill: c.bill, bill_no: c.bill_no, payee: c.payee, pay_mode: c.pay_mode, note: c.note, has_photo: !!c.photo_id,
    status: c.status, passed_amount: c.passed_amount == null ? null : Number(c.passed_amount), reason: c.reason,
    person_id: c.person_id, person_name: c.person_name, site_id: c.site_id, site_code: c.site_code,
    entered_by_name: c.entered_by !== c.person_id ? c.entered_by_name : null, reviewed_by_name: c.reviewed_by_name,
  };
}

async function listClaims(me, month, siteId) {
  const [from, to] = monthRange(month);
  const s = scope(me, 'x');
  const p = s.params.slice();
  let where = `${s.sql} AND x.spent_on >= $${p.push(from)} AND x.spent_on < $${p.push(to)}`;
  if (siteId) where += ` AND x.site_id = $${p.push(Number(siteId))}`;
  const r = await query(
    `SELECT x.*, pe.name AS person_name, eb.name AS entered_by_name, rv.name AS reviewed_by_name, s.code AS site_code
     FROM exp_claims x JOIN exp_people pe ON pe.id = x.person_id LEFT JOIN exp_people eb ON eb.id = x.entered_by
     LEFT JOIN exp_people rv ON rv.id = x.reviewed_by LEFT JOIN exp_sites s ON s.id = x.site_id
     WHERE ${where} ORDER BY x.spent_on DESC, x.ev_no DESC`, p);
  return r.rows.map(claimOut);
}

async function submit(me, b) {
  let person = me;
  if (b.for_person_id && Number(b.for_person_id) !== me.id) {
    if (me.role === 'employee') fail(403, 'Only a supervisor can enter expenses for someone else.');
    person = (await query('SELECT * FROM exp_people WHERE id = $1 AND company_id = $2 AND active', [Number(b.for_person_id), me.company_id])).rows[0];
    if (!person) fail(404, 'Employee not found.');
    if (me.role === 'supervisor' && person.site_id !== me.site_id) fail(403, 'That employee is not at your site.');
  }
  const head = String(b.head || '');
  if (!HEADS.includes(head)) fail(400, 'Choose what the money was spent on.');
  const amount = money(b.amount);
  if (!(amount > 0 && amount < 1000000)) fail(400, 'Enter the amount.');
  const fuel = FUEL.includes(head);
  const litres = fuel ? money(b.litres) : null;
  if (fuel && !(litres > 0 && litres < 10000)) fail(400, 'Enter the litres.');
  const date = String(b.spent_on || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) fail(400, 'Choose the date.');
  if (Date.parse(date) > Date.now() + 36e5 * 30) fail(400, 'The date cannot be in the future.');
  if (Date.parse(date) < Date.now() - 864e5 * 120) fail(400, 'This date is too old. Ask the office.');
  const bill = !!b.bill;
  const payMode = PAY_MODES.includes(b.pay_mode) ? b.pay_mode : null;
  let photoId = null;
  if (b.photo && b.photo.data) {
    if (!PHOTO_TYPES.includes(b.photo.mime)) fail(400, 'The bill photo must be a JPG, PNG or WebP image.');
    const data = Buffer.from(String(b.photo.data), 'base64');
    if (!data.length || data.length > MAX_PHOTO) fail(400, 'The bill photo is too large. Take it again.');
    photoId = (await query('INSERT INTO exp_photos (company_id, mime, data) VALUES ($1,$2,$3) RETURNING id', [me.company_id, b.photo.mime, data])).rows[0].id;
  }
  const vals = [me.company_id, person.site_id, person.id, me.id, date, head, amount, litres, fuel ? M.clean(b.vehicle, 40) || null : null,
    bill, bill ? M.clean(b.bill_no, 60) || null : null, M.clean(b.payee, 120) || null, payMode, M.clean(b.note, 300) || null, photoId];
  // EV numbers run per company; retry if two phones take the same number at once.
  for (let i = 0; i < 3; i++) {
    try {
      const r = await query(
        `INSERT INTO exp_claims (company_id, site_id, person_id, entered_by, ev_no, spent_on, head, amount, litres, vehicle, bill, bill_no, payee, pay_mode, note, photo_id)
         VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ev_no),0)+1 FROM exp_claims WHERE company_id = $1),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, ev_no`, vals);
      return r.rows[0];
    } catch (e) { if (e.code !== '23505' || i === 2) throw e; }
  }
}

async function review(me, b) {
  if (me.role === 'employee') fail(403, 'Only a supervisor or the office can pass expenses.');
  const c = (await query('SELECT * FROM exp_claims WHERE id = $1 AND company_id = $2', [Number(b.id), me.company_id])).rows[0];
  if (!c) fail(404, 'Expense not found.');
  if (me.role === 'supervisor') {
    if (c.site_id !== me.site_id) fail(403, 'That expense is not from your site.');
    if (c.person_id === me.id) fail(403, 'Your own expenses are passed by the office.');
  }
  const status = String(b.status || '');
  if (!['passed', 'rejected', 'submitted'].includes(status)) fail(400, 'Choose pass or reject.');
  let passed = null;
  if (status === 'passed') {
    passed = b.passed_amount === '' || b.passed_amount == null ? Number(c.amount) : money(b.passed_amount);
    if (!(passed >= 0 && passed <= Number(c.amount))) fail(400, 'The passed amount must be between 0 and the amount claimed.');
  }
  const reason = M.clean(b.reason, 200) || null;
  if ((status === 'rejected' || (status === 'passed' && passed < Number(c.amount))) && !reason) fail(400, 'Write the reason, so the employee knows why.');
  await query(`UPDATE exp_claims SET status = $1, passed_amount = $2, reason = $3, reviewed_by = $4, reviewed_at = NOW() WHERE id = $5`,
    [status, passed, status === 'submitted' ? null : reason, status === 'submitted' ? null : me.id, c.id]);
}

async function removeClaim(me, b) {
  const c = (await query('SELECT * FROM exp_claims WHERE id = $1 AND company_id = $2', [Number(b.id), me.company_id])).rows[0];
  if (!c) fail(404, 'Expense not found.');
  const own = c.person_id === me.id || c.entered_by === me.id;
  if (!(me.role === 'office' || (own && c.status === 'submitted'))) fail(403, 'This expense has already been checked. Ask your supervisor.');
  await query('DELETE FROM exp_claims WHERE id = $1', [c.id]);
  if (c.photo_id) await query('DELETE FROM exp_photos WHERE id = $1', [c.photo_id]);
}

async function team(me) {
  const s = me.role === 'office' ? ['company_id = $1', [me.company_id]] : ['company_id = $1 AND site_id = $2', [me.company_id, me.site_id]];
  return (await query(`SELECT id, name, mobile, role, site_id, active, link_hash IS NOT NULL AS has_link FROM exp_people WHERE ${s[0]} ORDER BY active DESC, role DESC, name`, s[1])).rows;
}

async function sites(companyId) {
  return (await query('SELECT id, code, name, active FROM exp_sites WHERE company_id = $1 ORDER BY active DESC, id', [companyId])).rows;
}

async function savePerson(me, b) {
  if (me.role !== 'office') fail(403, 'Only the office can add people.');
  const name = M.clean(b.name, 80);
  if (!name) fail(400, 'Enter the name.');
  const role = ROLES.includes(b.role) ? b.role : 'employee';
  const siteId = b.site_id ? Number(b.site_id) : null;
  if (siteId && !(await query('SELECT 1 FROM exp_sites WHERE id = $1 AND company_id = $2', [siteId, me.company_id])).rows.length) fail(400, 'Choose a site.');
  if (role !== 'office' && !siteId) fail(400, 'Choose the site this person works at.');
  const mobile = M.clean(b.mobile, 20).replace(/[^\d+]/g, '') || null;
  const active = b.active !== false;
  if (b.id) {
    if (Number(b.id) === me.id && (!active || role !== 'office')) fail(400, 'You cannot remove your own office access.');
    const r = await query('UPDATE exp_people SET name=$1, mobile=$2, role=$3, site_id=$4, active=$5 WHERE id=$6 AND company_id=$7 RETURNING id',
      [name, mobile, role, siteId, active, Number(b.id), me.company_id]);
    if (!r.rows.length) fail(404, 'Person not found.');
    if (!active) await query('DELETE FROM exp_tokens WHERE person_id = $1', [Number(b.id)]);
    return { id: Number(b.id) };
  }
  const id = (await query('INSERT INTO exp_people (company_id, site_id, name, mobile, role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [me.company_id, siteId, name, mobile, role])).rows[0].id;
  return { id, link: await newLink(id) };
}

async function saveSite(me, b) {
  if (me.role !== 'office') fail(403, 'Only the office can change sites.');
  const code = M.clean(b.code, 20).toUpperCase(), name = M.clean(b.name, 80) || code;
  if (!code) fail(400, 'Enter a short site code, like HSC.');
  if (b.id) {
    const r = await query('UPDATE exp_sites SET code=$1, name=$2, active=$3 WHERE id=$4 AND company_id=$5 RETURNING id', [code, name, b.active !== false, Number(b.id), me.company_id]);
    if (!r.rows.length) fail(404, 'Site not found.');
    return;
  }
  await query('INSERT INTO exp_sites (company_id, code, name) VALUES ($1,$2,$3)', [me.company_id, code, name]);
}

async function exportCsv(me, month, res) {
  if (me.role === 'employee') fail(403, 'Only a supervisor or the office can export.');
  const rows = (await listClaims(me, month)).reverse();
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const d = (iso) => iso.split('-').reverse().join('.');
  const out = [['EV No', 'Date', 'Site', 'Employee', 'Account Head', 'Particulars', 'Bill', 'Bill No / Paid to', 'Paid by', 'Vehicle / Machine', 'Litres', 'Rate', 'Claimed', 'Status', 'Passed', 'Reason', 'Bill photo']];
  for (const c of rows) {
    const passed = c.status === 'passed' ? c.passed_amount : c.status === 'rejected' ? 0 : '';
    out.push([c.ev_no, d(c.spent_on), c.site_code || '', c.person_name, c.head, c.note || '', c.bill ? 'With bill' : 'Without bill', c.bill ? c.bill_no || '' : c.payee || '',
      c.pay_mode || '', c.vehicle || '', c.litres == null ? '' : c.litres, c.litres ? (c.amount / c.litres).toFixed(2) : '', c.amount.toFixed(2),
      { submitted: 'Waiting', passed: 'Passed', rejected: 'Rejected' }[c.status], passed === '' ? '' : Number(passed).toFixed(2), c.reason || '', c.has_photo ? 'Yes' : 'No']);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Expenses_${month}.csv"`);
  return res.status(200).send('﻿' + out.map((r) => r.map(q).join(',')).join('\r\n'));
}

function meOut(me) {
  return { id: me.id, name: me.name, role: me.role, site_id: me.site_id, site_code: me.site_code, site_name: me.site_name,
    company: { name: me.company_name, address: me.company_address, gstin: me.company_gstin, cash_limit: me.cash_limit, nobill_limit: me.nobill_limit } };
}

// SthapnaCorp sets up each client company and its first office login.
async function adminAction(req, res, b) {
  if (!isAdmin(req)) fail(401, 'Wrong admin password.');
  if (req.method === 'GET') {
    const r = await query(`SELECT c.*, (SELECT COUNT(*)::int FROM exp_people p WHERE p.company_id = c.id AND p.active) AS people,
      (SELECT COUNT(*)::int FROM exp_claims x WHERE x.company_id = c.id) AS claims FROM exp_companies c ORDER BY c.id`);
    return res.status(200).json({ companies: r.rows });
  }
  if (b.action === 'company_save') {
    const name = M.clean(b.name, 120);
    if (!name) fail(400, 'Enter the company name.');
    const office = M.clean(b.office_name, 80);
    if (!office) fail(400, "Enter the office person's name.");
    const c = (await query('INSERT INTO exp_companies (name, address, gstin) VALUES ($1,$2,$3) RETURNING id', [name, M.clean(b.address, 200) || null, M.clean(b.gstin, 15).toUpperCase() || null])).rows[0];
    const p = (await query("INSERT INTO exp_people (company_id, name, mobile, role) VALUES ($1,$2,$3,'office') RETURNING id", [c.id, office, M.clean(b.office_mobile, 20) || null])).rows[0];
    return res.status(200).json({ ok: true, company_id: c.id, link: await newLink(p.id) });
  }
  if (b.action === 'office_link') {
    const p = (await query("SELECT id FROM exp_people WHERE company_id = $1 AND role = 'office' AND active ORDER BY id LIMIT 1", [Number(b.company_id)])).rows[0];
    if (!p) fail(404, 'This company has no office person.');
    return res.status(200).json({ ok: true, link: await newLink(p.id) });
  }
  fail(400, 'Unknown action.');
}

module.exports = async function (req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const b = req.method === 'GET' ? req.query : (req.body || {});
    const action = String(b.action || '');
    if (req.headers['x-admin-password'] !== undefined) return await adminAction(req, res, b);

    if (action === 'login') {
      const p = (await query('SELECT p.id FROM exp_people p JOIN exp_companies c ON c.id = p.company_id WHERE p.link_hash = $1 AND p.active AND c.active', [M.hash(String(b.k || ''))])).rows[0];
      if (!p) fail(404, 'This link no longer works. Ask your office for a new one.');
      const t = M.token();
      await query(`INSERT INTO exp_tokens (token_hash, person_id, expires_at) VALUES ($1,$2, NOW() + ($3 || ' days')::interval)`, [M.hash(t), p.id, String(SESSION_DAYS)]);
      M.setCookie(req, res, COOKIE, t, SESSION_DAYS * 86400);
      return res.status(200).json({ ok: true });
    }

    const me = await currentPerson(req);
    if (!me) fail(401, 'Open the link your office sent you.');

    if (req.method === 'GET') {
      if (action === 'photo') {
        const r = await query(`SELECT ph.mime, ph.data FROM exp_claims x JOIN exp_photos ph ON ph.id = x.photo_id WHERE x.id = $${scope(me).params.length + 1} AND ${scope(me).sql}`,
          scope(me).params.concat(Number(b.id)));
        if (!r.rows.length) fail(404, 'Photo not found.');
        res.setHeader('Content-Type', r.rows[0].mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.status(200).send(r.rows[0].data);
      }
      if (action === 'export') return await exportCsv(me, String(b.month), res);
      const month = String(b.month || new Date(Date.now() + 19800e3).toISOString().slice(0, 7));
      const out = { me: meOut(me), heads: HEADS, claims: await listClaims(me, month, b.site_id) };
      if (me.role !== 'employee') { out.team = await team(me); out.sites = await sites(me.company_id); }
      return res.status(200).json(out);
    }
    if (req.method !== 'POST') fail(405, 'Method not allowed');
    if (action === 'submit') return res.status(200).json(Object.assign({ ok: true }, await submit(me, b)));
    if (action === 'review') { await review(me, b); return res.status(200).json({ ok: true }); }
    if (action === 'delete') { await removeClaim(me, b); return res.status(200).json({ ok: true }); }
    if (action === 'person_save') return res.status(200).json(Object.assign({ ok: true }, await savePerson(me, b)));
    if (action === 'person_link') {
      if (me.role !== 'office') fail(403, 'Only the office can send links.');
      const p = (await query('SELECT id FROM exp_people WHERE id = $1 AND company_id = $2 AND active', [Number(b.id), me.company_id])).rows[0];
      if (!p) fail(404, 'Person not found.');
      return res.status(200).json({ ok: true, link: await newLink(p.id) });
    }
    if (action === 'site_save') { await saveSite(me, b); return res.status(200).json({ ok: true }); }
    if (action === 'settings') {
      if (me.role !== 'office') fail(403, 'Only the office can change settings.');
      await query('UPDATE exp_companies SET cash_limit = $1, nobill_limit = $2 WHERE id = $3',
        [Math.max(0, Math.round(Number(b.cash_limit) || 10000)), Math.max(0, Math.round(Number(b.nobill_limit) || 0)), me.company_id]);
      return res.status(200).json({ ok: true });
    }
    if (action === 'logout') {
      const t = M.cookie(req, COOKIE);
      if (t) await query('DELETE FROM exp_tokens WHERE token_hash = $1', [M.hash(t)]);
      M.setCookie(req, res, COOKIE, '', 0);
      return res.status(200).json({ ok: true });
    }
    fail(400, 'Unknown action.');
  } catch (err) {
    if (err instanceof Fail) return res.status(err.status).json({ error: err.message });
    console.error('expense error:', err.message);
    return res.status(500).json({ error: 'Server error. Try again.' });
  }
};
