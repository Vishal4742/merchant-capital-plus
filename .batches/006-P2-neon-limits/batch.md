# 006-P2-neon-limits
Phase: 2 (PHASES.md)   Round: spec   Owner lane: claude-relayer
Request (verbatim):
Agent ids (builders, for SendMessage resumes):
Log:
Log:
- 03:00 spec written (Postgres lock, rel_sent, limits, budget, pause, breaker, /relay secret)
- 03:09 human: budget 0.1 WBT/day; payer 10/h, merchant 200/h; dependency pg 8.23.1 (+ @types/pg) OK; secrets: copy DATABASE_URL, generate RELAY_API_SECRET into apps/relayer/.env + root .env (nothing printed)
- 03:09 plan-reviewer: READY WITH CHANGES. Blocking, to fold into the spec before building: (1) pool deadlock: keep an in-process serialized() in front of the advisory lock, connectionTimeoutMillis 3000, SET LOCAL lock_timeout 10s + idle_in_transaction_session_timeout 30s; (2) re-check paused / breaker / ban / spent+cap>budget INSIDE the lock with the rel_sent check; (3) rate limits = count rel_sent SENDS per payer and per target over the last hour (drop rel_hits; target is a server constant so attempts would be one global counter); (4) run the verdict tests against Postgres too when DATABASE_URL is set (throwaway schema), lock test with pool.max + 2 senders. Follow-ups: sha256-digest compare for the secret, spent + capFee > budget, fixed storage_error text, failed insert = no broadcast, dev forwards x-relay-secret, reconcile pending rows, migrate on pool start
- 03:10 PARKED (claude-research 03:01 reorder: MerchantPay paySale/payInvoice first for G2). ACTIVE → 007; resume 006 after 007 closes
