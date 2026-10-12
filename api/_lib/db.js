const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name        TEXT NOT NULL,
  mobile      TEXT NOT NULL,
  email       TEXT,
  company     TEXT,
  service     TEXT,
  message     TEXT,
  page        TEXT,
  utm         JSONB,
  status      TEXT NOT NULL DEFAULT 'new',
  notes       TEXT
);
CREATE TABLE IF NOT EXISTS subscribers (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  mobile      TEXT,
  company     TEXT,
  profile     JSONB NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS reminder_log (
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  event_key     TEXT NOT NULL,
  lead_days     INTEGER NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscriber_id, event_key, lead_days)
);
`;

let pool;
let ready;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!pool) {
    const url = new URL(process.env.DATABASE_URL);
    const mode = url.searchParams.get('sslmode');
    url.searchParams.delete('sslmode');
    pool = new Pool({ connectionString: url.toString(), ssl: mode === 'disable' ? false : { rejectUnauthorized: false }, max: 3 });
  }
  return pool;
}

function ensureSchema() {
  if (!ready) ready = getPool().query(SCHEMA).catch((e) => { ready = null; throw e; });
  return ready;
}

async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

module.exports = { query };
