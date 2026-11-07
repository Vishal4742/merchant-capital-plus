-- Batch 058 phase B/C: the remote MCP connection's shared state (FR-MCP-1..3; SRS-CHANGE FR-MCP-18..20 proposed).
-- House rules (lib/server/db.ts): merchant addresses lowercase, times BIGINT unix ms.
-- NOT applied to any shared database by this batch: an owner runs it (apps/web/db/migrate.mjs) after review.

-- The write journal for the remote endpoint: one document per tenant scope (a hash of backend + environment + merchant,
-- packages/mcp Journal.scope), changed only by compare-and-swap on `version`, so concurrent requests on any instance
-- serialize without interactive transactions (Neon's HTTP driver has none).
-- ponytail: one document per merchant scope, capped by the journal's own pruning (200 unresolved, 2,000 settled);
-- upgrade to a row per entry if a single merchant ever approaches that.
CREATE TABLE IF NOT EXISTS app_mcp_journal (
  scope TEXT PRIMARY KEY,
  version BIGINT NOT NULL,
  entries JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
