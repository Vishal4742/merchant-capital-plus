-- One row per payment event the gateway has acted on (lib/server/events.ts), so a retried onSessionPaid / onRefund
-- call never sends a second webhook. key = "paid:<session>" or "refund:<session>:<total refunded units>".
CREATE TABLE IF NOT EXISTS app_gw_events (
  key TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL
);
