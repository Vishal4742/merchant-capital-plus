-- FR-REL-10: relayer state shared by every instance (batch 037). Applied once by the database owner; the relayer's own
-- role (mcplus_relayer) only gets SELECT/INSERT/UPDATE on these two tables. Times are BIGINT unix ms, fees BIGINT wei.

-- One row per send attempt, written before the broadcast with the worst-case fee, then updated from the receipt.
CREATE TABLE IF NOT EXISTS rel_sent (
  auth_key TEXT PRIMARY KEY,          -- lowercase "payer:nonce" of the USDT authorization: never broadcast twice
  relayer TEXT NOT NULL,              -- lowercase relayer address (budget and breaker are per relayer)
  payer TEXT NOT NULL,                -- lowercase
  merchant TEXT,                      -- lowercase; sales only
  tx_hash TEXT NOT NULL,
  fee_wei BIGINT NOT NULL,
  reverted BOOLEAN NOT NULL DEFAULT false,
  sent_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rel_sent_relayer_time ON rel_sent (relayer, sent_at);
CREATE INDEX IF NOT EXISTS rel_sent_payer ON rel_sent (payer);

-- The send lock: a lease per relayer address. Free when until_ms <= now (released rows hold 0).
CREATE TABLE IF NOT EXISTS rel_lock (
  relayer TEXT PRIMARY KEY,
  holder TEXT,
  until_ms BIGINT NOT NULL
);
