# 006-P2-neon-limits
Phase: 2 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request (verbatim):
Agent ids (builders, for SendMessage resumes):
Log:
Log:
- 03:00 spec written (Postgres lock, rel_sent, limits, budget, pause, breaker, /relay secret)
- 03:09 human: budget 0.1 WBT/day; payer 10/h, merchant 200/h; dependency pg 8.23.1 (+ @types/pg) OK; secrets: copy DATABASE_URL, generate RELAY_API_SECRET into apps/relayer/.env + root .env (nothing printed)
- 03:09 plan-reviewer: READY WITH CHANGES. Blocking, to fold into the spec before building: (1) pool deadlock: keep an in-process serialized() in front of the advisory lock, connectionTimeoutMillis 3000, SET LOCAL lock_timeout 10s + idle_in_transaction_session_timeout 30s; (2) re-check paused / breaker / ban / spent+cap>budget INSIDE the lock with the rel_sent check; (3) rate limits = count rel_sent SENDS per payer and per target over the last hour (drop rel_hits; target is a server constant so attempts would be one global counter); (4) run the verdict tests against Postgres too when DATABASE_URL is set (throwaway schema), lock test with pool.max + 2 senders. Follow-ups: sha256-digest compare for the secret, spent + capFee > budget, fixed storage_error text, failed insert = no broadcast, dev forwards x-relay-secret, reconcile pending rows, migrate on pool start
- 03:10 PARKED (claude-research 03:01 reorder: MerchantPay paySale/payInvoice first for G2). ACTIVE → 007; resume 006 after 007 closes
- 05:51 human: LEAN 006 (secret + in-process breaker/budget/limits + L1 fee), then Vercel; the full Postgres spec (plan-reviewed, 03:30) becomes the post-G2 follow-up. Spec rewritten
- 06:15 post-review hotfix (live G2 finding): DEFAULT_RPC back to Ankr (Whitechain RPC refuses eth_sendRawTransactionSync). tsc 0, 49/49; CI re-run on the new head before merge
- 06:09 all five PASS (round 1). Human gate 06:10: ship 006; deploy steps approved (preview with no secrets, then Production-only keys once the web sends the header). Security D1: .vercelignore before any CLI deploy
- 06:19 G2: AT-1 0x7e03b5d0…7a11 relayed (batch-007 server on Ankr); AT-10 live all codes, relayer nonce 4 → 4. NFR-4 missed (10 s): ~7 s inside Ankr's eth_sendRawTransactionSync → next batch (async send + 300 ms receipt polling + batched read rounds)
