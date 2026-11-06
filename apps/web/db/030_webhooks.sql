-- FR-GW-7 / FR-PAY-10 webhooks. The secret signs every delivery (MC-Signature), so it is stored as is and never returned
-- after creation. A delivery keeps one body for all its attempts; each attempt re-signs it with a fresh timestamp.
CREATE TABLE IF NOT EXISTS app_gw_webhooks (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_gw_webhooks_merchant ON app_gw_webhooks (merchant);
CREATE TABLE IF NOT EXISTS app_gw_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES app_gw_webhooks (id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT,
  response_status INTEGER,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_gw_deliveries_due ON app_gw_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS app_gw_deliveries_webhook ON app_gw_deliveries (webhook_id, created_at);
