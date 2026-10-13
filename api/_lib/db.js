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
CREATE TABLE IF NOT EXISTS providers (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name          TEXT NOT NULL,
  firm          TEXT,
  email         TEXT NOT NULL UNIQUE,
  mobile        TEXT NOT NULL,
  qualification TEXT NOT NULL,
  membership_no TEXT,
  city          TEXT NOT NULL,
  remote_ok     BOOLEAN NOT NULL DEFAULT TRUE,
  categories    TEXT[] NOT NULL DEFAULT '{}',
  about         TEXT,
  capacity      INTEGER NOT NULL DEFAULT 10,
  status        TEXT NOT NULL DEFAULT 'pending',
  last_assigned_at TIMESTAMPTZ,
  admin_notes   TEXT
);
CREATE TABLE IF NOT EXISTS provider_tokens (
  token_hash  TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ref           TEXT UNIQUE,
  token         TEXT NOT NULL UNIQUE,
  service_slug  TEXT,
  service       TEXT NOT NULL,
  category      TEXT,
  details       TEXT,
  city          TEXT,
  name          TEXT NOT NULL,
  mobile        TEXT NOT NULL,
  email         TEXT,
  company       TEXT,
  page          TEXT,
  utm           JSONB,
  status        TEXT NOT NULL DEFAULT 'new',
  provider_id   INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ,
  accepted_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  declined_by   INTEGER[] NOT NULL DEFAULT '{}',
  quote_amount  INTEGER,
  admin_notes   TEXT
);
CREATE TABLE IF NOT EXISTS order_events (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  message    TEXT,
  public     BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rzp_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_pct NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS commission_pct NUMERIC NOT NULL DEFAULT 20;
CREATE TABLE IF NOT EXISTS customers (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  mobile      TEXT
);
CREATE TABLE IF NOT EXISTS customer_tokens (
  token_hash  TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_messages (
  id        SERIAL PRIMARY KEY,
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender    TEXT NOT NULL,
  body      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_files (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BYTEA NOT NULL
);
CREATE TABLE IF NOT EXISTS service_settings (
  slug        TEXT PRIMARY KEY,
  price       INTEGER,
  turnaround  TEXT,
  note        TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_provider_idx ON orders (provider_id, status);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS order_messages_idx ON order_messages (order_id, at);
CREATE INDEX IF NOT EXISTS order_files_idx ON order_files (order_id);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, at);
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
