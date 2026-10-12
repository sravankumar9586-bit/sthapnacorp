const { query } = require('./db');
const D = require('../../assets/deadlines.js');

// Loads approved extensions into the shared due-date engine and returns them.
async function loadOverrides() {
  const r = await query(
    `SELECT id, form_key, fy_end, to_char(original_due, 'YYYY-MM-DD') AS original_due, to_char(new_due, 'YYYY-MM-DD') AS new_due,
            kind, note, source_url, source_title
     FROM due_overrides WHERE active = TRUE ORDER BY new_due`
  );
  D.setOverrides(r.rows);
  return r.rows;
}

module.exports = { loadOverrides };
