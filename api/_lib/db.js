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
CREATE TABLE IF NOT EXISTS due_overrides (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  form_key     TEXT NOT NULL,
  fy_end       INTEGER,
  original_due DATE,
  new_due      DATE NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'extension',
  note         TEXT,
  source_url   TEXT,
  source_title TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  notified_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS watch_items (
  id           SERIAL PRIMARY KEY,
  found_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  suggestion   JSONB,
  status       TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS watch_sources (
  source       TEXT PRIMARY KEY,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok           BOOLEAN NOT NULL,
  scanned      INTEGER NOT NULL DEFAULT 0,
  matched      INTEGER NOT NULL DEFAULT 0,
  error        TEXT
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
    // Tolerate stray whitespace or quotes pasted into the Vercel setting.
    let conn = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
    let mode = null;
    try {
      const url = new URL(conn);
      mode = url.searchParams.get('sslmode');
      url.searchParams.delete('sslmode');
      conn = url.toString();
    } catch (e) { /* leave the string as is and let pg report the problem */ }
    pool = new Pool({
      connectionString: conn,
      ssl: mode === 'disable' ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 8000,
    });
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
