-- Batch 023: the web app's checkout store (lib/sessions.ts) moves out of process memory, so every Vercel instance sees
-- the same checkout, lock, attempt, Idempotency-Key and used nonce. Our own app_web_ prefix (claude-contracts 10:27).
-- House rules (lib/server/db.ts): times BIGINT unix ms, money BIGINT 6-decimal USDT units, read back as ::text.
-- JSON columns hold bigints as decimal strings (never a float). Idempotent: safe to re-run on Neon.
CREATE TABLE IF NOT EXISTS app_web_sessions (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  amount BIGINT NOT NULL,
  order_ref TEXT NOT NULL,
  reference TEXT NOT NULL,
  items JSONB NOT NULL,
  priced JSONB,
  return_url TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  payment JSONB,
  pending JSONB
);
-- the dashboard's and GET /api/v1/payments' list: one merchant's paid checkouts
CREATE INDEX IF NOT EXISTS app_web_sessions_paid ON app_web_sessions (lower(merchant)) WHERE payment IS NOT NULL;

-- One payment in flight per checkout (key: the session id) or invoice (key: "invoice:<id>"), across instances. A row
-- lives while its payment is relayed; one left by a crashed instance is re-taken once `until` passes.
CREATE TABLE IF NOT EXISTS app_web_locks (
  key TEXT PRIMARY KEY,
  until TIMESTAMPTZ NOT NULL
);

-- What the server remembers about paying one invoice (FR-PAY-3): {pending?: {from, validBefore}, receipt?: {...}}.
CREATE TABLE IF NOT EXISTS app_web_invoice_attempts (
  id TEXT PRIMARY KEY,
  attempt JSONB NOT NULL
);

-- POST /api/v1/sessions Idempotency-Key slots ("<merchant>:<key>"), 24 h. status NULL: the first request is still
-- creating; owner: that request, so it frees or fills only its own row.
CREATE TABLE IF NOT EXISTS app_web_idempotency (
  slot TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  hash TEXT NOT NULL,
  status INTEGER,
  body JSONB,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_web_idempotency_created ON app_web_idempotency (created_at);

-- SIWE nonces already used for a sign-in, until their cookie would have expired anyway (lib/auth.ts consumeNonce).
CREATE TABLE IF NOT EXISTS app_web_nonces (
  nonce TEXT PRIMARY KEY,
  used_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_web_nonces_used ON app_web_nonces (used_at);
