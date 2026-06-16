const { Client } = require('pg');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');

  if(req.method === 'OPTIONS') return res.status(200).end();

  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Welcome@3';
  const id = req.query.id;

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // POST /api/applications — save new application on payment
    if(req.method === 'POST' && !id){
      const d = req.body;
      await client.query(`
        INSERT INTO applications (
          id, created_at, updated_at,
          applicant_name, applicant_email, applicant_mobile,
          entity_type, name_option1, name_option2, name_option3, name_option4,
          nic_code, main_object_1, main_object_2, main_object_3,
          trademark, trademark_details,
          payment_status, razorpay_id, paid_at, filing_status
        ) VALUES (
          $1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, NOW(), 'name_pending'
        )
        ON CONFLICT (id) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          razorpay_id    = EXCLUDED.razorpay_id,
          paid_at        = EXCLUDED.paid_at,
          updated_at     = NOW()
      `, [
        d.id,
        d.applicant_name, d.applicant_email, d.applicant_mobile,
        d.entity_type, d.name_option1, d.name_option2, d.name_option3||'', d.name_option4||'',
        d.nic_code, d.main_object_1, d.main_object_2||'', d.main_object_3||'',
        d.trademark||'no', d.trademark_details||'',
        d.payment_status||'paid', d.razorpay_id||''
      ]);
      return res.status(200).json({ success: true });
    }

    // PATCH /api/applications?id=xxx — update company+director details
    if(req.method === 'PATCH' && id){
      const d = req.body;
      await client.query(`
        UPDATE applications SET
          company_email  = $2, company_mobile = $3,
          office_address = $4, office_state   = $5,
          ownership      = $6, auth_capital    = $7,
          paidup_capital = $8, face_value      = $9,
          section5       = $10, directors      = $11,
          filing_status  = COALESCE($12, filing_status),
          admin_notes    = COALESCE($13, admin_notes),
          updated_at     = NOW()
        WHERE id = $1
      `, [
        id,
        d.company_email||'', d.company_mobile||'',
        d.office_address||'', d.office_state||'',
        d.ownership||'', d.auth_capital||'',
        d.paidup_capital||'', d.face_value||'10',
        JSON.stringify(d.section5||{}), JSON.stringify(d.directors||[]),
        d.filing_status||null, d.admin_notes||null
      ]);
      return res.status(200).json({ success: true });
    }

    // GET /api/applications — admin: list all
    if(req.method === 'GET' && !id){
      if(req.headers['x-admin-password'] !== ADMIN_PASS)
        return res.status(401).json({ error: 'Unauthorized' });
      const result = await client.query('SELECT * FROM applications ORDER BY created_at DESC');
      return res.status(200).json(result.rows);
    }

    // GET /api/applications?id=xxx — single application
    if(req.method === 'GET' && id){
      if(req.headers['x-admin-password'] !== ADMIN_PASS)
        return res.status(401).json({ error: 'Unauthorized' });
      const result = await client.query('SELECT * FROM applications WHERE id = $1', [id]);
      if(!result.rows.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(result.rows[0]);
    }

    // DELETE /api/applications?id=xxx
    if(req.method === 'DELETE' && id){
      if(req.headers['x-admin-password'] !== ADMIN_PASS)
        return res.status(401).json({ error: 'Unauthorized' });
      await client.query('DELETE FROM applications WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch(err){
    console.error('API error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};
