# Phase 2 — relayer lane (claude-relayer)

Plan (22:50): **002** drain guard (no DB) · **003** limits, budget, pause, multi-instance lock (Neon) · **004** MerchantPay wiring (ABI from `packages/shared`). Vercel deploy only after 003 (human decision at the 001 gate: no `RELAYER_PRIVATE_KEY` in Vercel before the guard).

## Batch 002-P2-drain-guard — closed 2026-11-06 02:52
**Built:** the drain guard in `apps/relayer/src/relayer.ts`: free checks (window 30 s–15 min, ≥ 1 USDT, EIP-712 signature, sent set) → one RPC round (replay, payer code incl. EIP-7702, balance, gas price ≤ 6 gwei, gas-capped simulation) → in-process send lock (re-check expiry, re-simulate ‖ pending nonce, re-check expiry before signing, sign with gas 400k / maxFee 6 gwei / tip 0.001 gwei, `eth_sendRawTransactionSync`, receipt-hash check). `/health` WBT cached ≤ 5 s with a 3 s background refresh. dev.ts: Host check (403), streaming 4 KB cap (413), content-type forwarded; api/relay.ts 415. Scoped `apps/relayer/.env` (relayer key only).
**Verified:** 36/36 tests (5 guards each killed by a mutant), tsc 0, CI green run 42102535928 on `09410af`; live: every rejection code with relayer nonce unchanged at 3 after > 300 rejected requests; `/health` paced p95 3.5 ms (was 545); local rejects < 1 ms; RPC-round rejects 176–366 ms warm from the venue. Rounds: tester CHANGES ×2 (F1/F2, F5/F6/F7), round 3 all PASS.
**Not done live:** the valid relayed pull (team wallet had 0 USDT at the gate) → proven in the G2 joint run through MerchantPay (human 02:51).
**Human decisions (gate 02:44):** breaker = ban a payer after 1 mined revert, 503 after 3 mined reverts per hour; `/relay` requires a shared secret header from the web server (relayer limits per payer + merchant, web app per IP); `RPC_URL` → `https://rpc.testnet.whitechain.io`; 6 gwei cap (00:45).

See `.batches/002-P2-drain-guard/` (spec, build report, rounds). Request flow: parse → free checks (window 30 s–15 min, ≥ 1 USDT, signature, sent set) → one RPC round (replay, payer code, balance, gas price, gas-capped simulation) → send lock (re-simulate, sign with fixed gas/fees, `eth_sendRawTransactionSync`, receipt-hash check).

## Batch 003 draft (Neon ready since 00:58; breaker numbers decided 02:44)
**SRS:** FR-REL-5 (rate limits per payer / merchant / IP, daily WBT budget, 503 when exhausted), FR-REL-6 (`gasSpentToday`, `budgetLeft` in `/health`), ARCHITECTURE §3 points 7, 8, 10 and "serialized sends (Postgres advisory lock)", NFR-14 (still ≤ 500 ms rejects).

**Why it can't wait for later:** the demo web app on Vercel must reach a deployed relayer, and Vercel runs several instances, so the in-process lock and sent set from 002 stop being enough.

**Tables (`rel_*`, owned by the relayer):**
- `rel_sends(tx_hash pk, payer, nonce, target, gas_used, fee_wei, status, created_at)` — unique `(payer, nonce)` replaces the in-process sent set; `sum(fee_wei) where created_at >= today` = `gasSpentToday`.
- `rel_hits(bucket, key, window_start, count)` — fixed-window counters for payer / merchant / IP (one `insert … on conflict do update … returning count`).
- `rel_settings(key pk, value)` — `paused`, `daily_budget_wei`.

**Behaviour to add:** paused → 503 `paused`; budget spent → 503 `budget_exhausted`; over a limit → 429 `rate_limited` (all before the RPC round, one SQL round trip). The send lock becomes `pg_advisory_xact_lock(<relayer key id>)` held in a transaction around re-simulate → sign → sync send → `rel_sends` insert. Any failed or reverted send sets `rel_settings.last_failure` (the "alert"), shown in `/health`.

**Questions for the human (PIPELINE §11):**
1. Daily WBT budget. Proposal: **0.1 WBT/day** (≈ 215 relays at 0.00046 WBT; the hot wallet holds ≤ 0.5).
2. Rate limits. Proposal: payer **10/hour**, merchant **200/hour**, IP **30/hour** (demo traffic is far below this).
3. Pause switch: an SQL update by the operator (Neon console), or an env var? Proposal: SQL row, so it works without a redeploy.
4. New dependency: `@neondatabase/serverless` (WebSocket `Pool`; the HTTP driver can't hold a session for the advisory lock).
5. Neon project: created via the Neon tools once the OAuth link is approved (human 22:53).

## Carried into batch 003 (from batch 002 round 3)
- Unit tests for three untested guards: the refresh `timer.unref()`, the refresh `.catch` (without it a failing refresh would crash the dev server), and `relayerClient()` starting the refresh. Log refresh failures (they are swallowed today).
- spec text: mention the 3 s refresh (human 01:14) in the relayer section the next spec cites.
- On Vercel every `/relay` instance would also run the refresh; with batch 003's shared storage, one refresher (or none, reading the balance on demand from a warm pool) is enough.
- Gate live run uses a throwaway in-memory payer funded with exactly 1 USDT (no shared G1 payer, no `.env` change).
