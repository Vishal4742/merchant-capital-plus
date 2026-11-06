# Phase 2 — relayer lane (claude-relayer)

Plan (22:50): **002** drain guard (no DB) · **003** limits, budget, pause, multi-instance lock (Neon) · **004** MerchantPay wiring (ABI from `packages/shared`). Vercel deploy only after 003 (human decision at the 001 gate: no `RELAYER_PRIVATE_KEY` in Vercel before the guard).

## Batch 002-P2-drain-guard — closed 2026-11-06 02:52
**Built:** the drain guard in `apps/relayer/src/relayer.ts`: free checks (window 30 s–15 min, ≥ 1 USDT, EIP-712 signature, sent set) → one RPC round (replay, payer code incl. EIP-7702, balance, gas price ≤ 6 gwei, gas-capped simulation) → in-process send lock (re-check expiry, re-simulate ‖ pending nonce, re-check expiry before signing, sign with gas 400k / maxFee 6 gwei / tip 0.001 gwei, `eth_sendRawTransactionSync`, receipt-hash check). `/health` WBT cached ≤ 5 s with a 3 s background refresh. dev.ts: Host check (403), streaming 4 KB cap (413), content-type forwarded; api/relay.ts 415. Scoped `apps/relayer/.env` (relayer key only).
**Verified:** 36/36 tests (5 guards each killed by a mutant), tsc 0, CI green run 42102535928 on `09410af`; live: every rejection code with relayer nonce unchanged at 3 after > 300 rejected requests; `/health` paced p95 3.5 ms (was 545); local rejects < 1 ms; RPC-round rejects 176–366 ms warm from the venue. Rounds: tester CHANGES ×2 (F1/F2, F5/F6/F7), round 3 all PASS.
**Not done live:** the valid relayed pull (team wallet had 0 USDT at the gate) → proven in the G2 joint run through MerchantPay (human 02:51).
**Human decisions (gate 02:44):** breaker = ban a payer after 1 mined revert, 503 after 3 mined reverts per hour; `/relay` requires a shared secret header from the web server (relayer limits per payer + merchant, web app per IP); `RPC_URL` → `https://rpc.testnet.whitechain.io`; 6 gwei cap (00:45).

See `.batches/002-P2-drain-guard/` (spec, build report, rounds). Request flow: parse → free checks (window 30 s–15 min, ≥ 1 USDT, signature, sent set) → one RPC round (replay, payer code, balance, gas price, gas-capped simulation) → send lock (re-simulate, sign with fixed gas/fees, `eth_sendRawTransactionSync`, receipt-hash check).

## Batch 007-P2-merchantpay-relay — closed 2026-11-06 03:35
**Built:** `/relay` calls exactly MerchantPay `0xab81…4251` `paySale` / `payInvoice` (PullStub `pull` removed). The authorization nonce is recomputed as MerchantPay does (checked equal to the on-chain `saleNonce` / `invoiceNonce`); invoices sign `amount + relayFee` (fee read single-flight, cached 60 s); local `bad_merchant`; reverts map to `order_paid` / `wrong_amount` / `bad_merchant`; 200 adds `paymentId` (own `Paid` log), `gasUsed`, `gasCostWei`. Default RPC = Whitechain's.
**Verified:** 42/42, tsc 0, CI green run 42116814002; live rejects (Whitechain RPC) p50 146 / p95 266 ms; relayer nonce 3 unchanged. One round, all five PASS.
**Follow-ups → batch 006:** `gasCostWei` must add the OP-Stack `receipt.l1Fee` (reviewer-code MEDIUM; the budget uses it); a zero `orderRef` → local 400 instead of `bad_merchant` after a round; `EnforcedPause` → its own 503 code; refuse when `relayFee == 0`; drop the test-only `USDT` / `USDT_DOMAIN` exports.

## Batch 006-P2-neon-limits (LEAN) — closed 2026-11-06 06:22
**Built:** `x-relay-secret` auth (401, fail closed), per-relayer in-process ledger: breaker (ban after 1 mined revert, 503 after 3/hour), 0.1 WBT/day budget (pre-RPC and inside the lock), 10 sends/h per payer and 200/h per merchant; `gasCostWei` + L1 fee; zero orderRef 400; `EnforcedPause` 503; `/health` spend fields. Hotfix `f67c892`: default RPC back to Ankr (Whitechain's RPC refuses `eth_sendRawTransactionSync`).
**Verified:** 49/49, CI green (42137270799, 42138995632); live on a throwaway-key server (:8788, 0 WBT): 401s, 400, 422s, /health spend fields.
**G2 (06:16–06:19):** AT-1 `0x7e03b5d0…7a11` (207,983 gas, L1 fee 5,341 wei) relayed by the batch-007 server; AT-10 every code live, relayer nonce 4 → 4; NFR-14 /health 2 ms, local 6 ms, RPC-round 736 ms (venue). **NFR-4 missed: 10.08 s** — Ankr's sync send waits ~7 s.
**Lesson:** a live check after any RPC change must include one real send; rejections alone never exercise the send path.

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

## Batch 008 draft — Vercel deploy (research queue item 4; needs the human's go for the project + env vars)
- `apps/relayer/vercel.json`: rewrites `/relay` → `/api/relay`, `/health` → `/api/health`; function region `iad1` (same as Neon us-east-1, close to the RPC); `maxDuration` ≥ 30 s (two 8 s RPC timeouts + queue).
- `package.json` `engines.node` → `"26.x"` (type stripping for the `.ts` imports).
- Unknowns to prove with a **preview deploy that has no secrets** (fails closed: 500 without the key, 401 without the secret): (1) Vercel resolves `../src/relayer.ts` specifiers; (2) it bundles `packages/shared/contracts.ts` from outside the root directory ("include files outside the root directory"). Fallback for (2): a `prebuild` copy of the generated file into `apps/relayer/src/`.
- Then, with the human's go: env vars `RELAYER_PRIVATE_KEY`, `RELAY_API_SECRET`, `RPC_URL` (production only), promote, give claude-frontend the URL + header; NFR-14 timings from the deployed URL (G2-1).
- Known limit (human 05:51): in-process ledger and lock are per instance; Postgres version after G2.
- **D1 (CRITICAL if missed, batch 006 security review):** Vercel CLI 64.3.1 does not read `.gitignore` and does not ignore a plain `.env` — a CLI deploy from `apps/relayer` would upload the relayer key (or ~10 root keys) and could serve them. Add `apps/relayer/.vercelignore` (`.env`, `.env.*`, `node_modules`, `test`) and an empty `public/`, or deploy through Git only; verify `GET <url>/.env` → 404 before adding any secret.
- D2: `RELAYER_PRIVATE_KEY` + `RELAY_API_SECRET` in **Production only**, marked Sensitive; nothing in Preview. D3: claude-frontend sends `x-relay-secret` (same deploy). D5: `maxDuration` ≥ 35 s.
