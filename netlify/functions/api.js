const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;

async function getClient(){
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

exports.handler = async function(event, context){
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const path   = event.path.replace('/.netlify/functions/api','') || '/';
  const method = event.httpMethod;
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Welcome@3';

  let client;
  try {
    client = await getClient();

    // ── POST /applications — save new application (called on payment) ──
    if(method === 'POST' && path === '/applications'){
      const data = JSON.parse(event.body);
      await client.query(`
        INSERT INTO applications (
          id, created_at, updated_at,
          applicant_name, applicant_email, applicant_mobile,
          entity_type, name_option1, name_option2, name_option3, name_option4,
          nic_code, main_object_1, main_object_2, main_object_3,
          trademark, trademark_details,
          payment_status, razorpay_id, paid_at, filing_status
        ) VALUES (
          $1, NOW(), NOW(),
          $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15,
          $16, $17, NOW(), 'name_pending'
        )
        ON CONFLICT (id) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          razorpay_id    = EXCLUDED.razorpay_id,
          paid_at        = EXCLUDED.paid_at,
          updated_at     = NOW()
      `, [
        data.id,
        data.applicant_name, data.applicant_email, data.applicant_mobile,
        data.entity_type, data.name_option1, data.name_option2, data.name_option3||'', data.name_option4||'',
        data.nic_code, data.main_object_1, data.main_object_2||'', data.main_object_3||'',
        data.trademark||'no', data.trademark_details||'',
        data.payment_status||'paid', data.razorpay_id||''
      ]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── PATCH /applications/:id — update company details + directors ──
    if(method === 'PATCH' && path.startsWith('/applications/')){
      const id   = path.split('/')[2];
      const data = JSON.parse(event.body);
      await client.query(`
        UPDATE applications SET
          company_email   = $2, company_mobile = $3,
          office_address  = $4, office_state   = $5,
          ownership       = $6, auth_capital    = $7,
          paidup_capital  = $8, face_value      = $9,
          section5        = $10, directors      = $11,
          filing_status   = COALESCE($12, filing_status),
          admin_notes     = COALESCE($13, admin_notes),
          updated_at      = NOW()
        WHERE id = $1
      `, [
        id,
        data.company_email||'', data.company_mobile||'',
        data.office_address||'', data.office_state||'',
        data.ownership||'', data.auth_capital||'',
        data.paidup_capital||'', data.face_value||'10',
        JSON.stringify(data.section5||{}), JSON.stringify(data.directors||[]),
        data.filing_status||null, data.admin_notes||null
      ]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── GET /applications — admin: list all (requires password) ──
    if(method === 'GET' && path === '/applications'){
      const pass = event.headers['x-admin-password'];
      if(pass !== ADMIN_PASS) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      const result = await client.query('SELECT * FROM applications ORDER BY created_at DESC');
      return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
    }

    // ── GET /applications/:id — admin: single application ──
    if(method === 'GET' && path.startsWith('/applications/')){
      const pass = event.headers['x-admin-password'];
      if(pass !== ADMIN_PASS) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      const id = path.split('/')[2];
      const result = await client.query('SELECT * FROM applications WHERE id = $1', [id]);
      if(!result.rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
      return { statusCode: 200, headers, body: JSON.stringify(result.rows[0]) };
    }

    // ── DELETE /applications/:id — admin: delete ──
    if(method === 'DELETE' && path.startsWith('/applications/')){
      const pass = event.headers['x-admin-password'];
      if(pass !== ADMIN_PASS) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      const id = path.split('/')[2];
      await client.query('DELETE FROM applications WHERE id = $1', [id]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

  } catch(err){
    console.error('API error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    if(client) await client.end();
  }
};
