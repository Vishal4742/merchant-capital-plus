# Spec: 006-P2-neon-limits — LEAN (human 05:51: lean 006, then Vercel)

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-5**: rate limits per payer and per merchant (counted on sends; per-IP limiting is the web app's, human 02:44) and a **daily WBT budget**, 503 when exhausted. Numbers (human 03:09): **0.1 WBT/day**, **10 sends/hour per payer**, **200 sends/hour per merchant**.
- **FR-REL-6**: `/health` reports `gasSpentToday` and `budgetLeft` (WBT strings); `paused` reflects MerchantPay's own pause.
- ARCHITECTURE §3 point **12** (breaker: ban a payer after 1 mined revert; 503 after 3 mined reverts in an hour) and point **13** (`/relay` requires the web server's `RELAY_API_SECRET` header).
- **NFR-3**: the relayer reads `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`, `RELAY_API_SECRET` and nothing else.
- Batch 007 follow-ups: `gasCostWei` includes the OP-Stack L1 data fee (`receipt.l1Fee`); an all-zero `orderRef` → 400; MerchantPay `EnforcedPause` → 503 `paused`.

## Why lean is safe enough for the demo deploy (human 05:51)
With the secret required, only our web server can reach `/relay`, so outsiders can't trigger a send. The remaining multi-instance risk (drain review R3) is honest concurrent sales on two Vercel instances: one gets 502 `nonce too low`, rejected by the node with no gas spent. State below is **per process** (`ponytail:` → Postgres lock + `rel_sent`, the reviewed full spec in batch.md's log, after G2).

## Behaviour
1. **Auth first** (`api/relay.ts`, before reading the body): `x-relay-secret` must equal `RELAY_API_SECRET`, compared as sha256 digests with `timingSafeEqual` → else **401** `unauthorized`; `RELAY_API_SECRET` unset → every `/relay` is 401 (fail closed). `dev.ts` forwards the header. `/health` stays open.
2. Parse: an all-zero `orderRef` → 400.
3. Free checks (before any RPC), in order, after the batch-007 ones:
   - **503 `breaker_open`**: ≥ 3 mined reverts in the last hour (rolling)
   - **422 `payer_banned`**: this payer has a mined revert
   - **503 `budget_exhausted`**: `spentToday + capFee > 0.1 WBT` (UTC day; capFee = 400k × 6 gwei = 0.0024 WBT)
   - **429 `rate_limited`**: this payer's sends in the last hour ≥ 10, or this sale merchant's ≥ 200 (invoices: payer only)
4. **Inside the lock**, before signing: the same four checks again (queued requests can't overshoot the budget or slip past a freshly opened breaker).
5. Accounting after each send: `spent += gasUsed × effectiveGasPrice + l1Fee` on a receipt; on a sync timeout or send error, `spent += capFee` (worst case). A mined revert bans the payer, counts toward the breaker, and logs `ALERT reverted <txHash> payer <from>` to stderr. A send (any outcome) counts toward the payer's and merchant's hourly limit.
6. Simulation revert `EnforcedPause` → **503** `paused`.

## Acceptance criteria
- [ ] `npx tsc --noEmit && npm test` pass; tests first.
- [ ] Unit tests: 401 for no / wrong / wrong-length secret and for an unset `RELAY_API_SECRET`, before any RPC; a correct secret reaches `relay()`; zero `orderRef` → 400; `breaker_open` after 3 mined reverts (and not before), `payer_banned` after 1; `budget_exhausted` at the edge (`spent + cap > budget`); the in-lock re-check (several queued, the budget is crossed by the first → the rest get `budget_exhausted`, nothing more sent); `rate_limited` at the 11th payer send; `gasCostWei` includes `l1Fee`; a timeout counts the capped fee; `/health` reports `gasSpentToday` / `budgetLeft`; `EnforcedPause` → 503 `paused`; `dev.ts` forwards `x-relay-secret`.
- [ ] Live, no tx: no secret → 401; with the secret, a local and an RPC reject; `/health` shows the spend fields.
- [ ] NFR-3 grep: `PORT`, `RELAY_API_SECRET`, `RELAYER_PRIVATE_KEY`, `RPC_URL`; `cut -d= -f1 apps/relayer/.env` → `RELAYER_PRIVATE_KEY`, `RELAY_API_SECRET`; the root `.env` also has `RELAY_API_SECRET` (same value, for the web server).

## Files (claude-relayer only)
- `apps/relayer/src/relayer.ts`, `apps/relayer/api/relay.ts`, `apps/relayer/dev.ts`, `apps/relayer/test/*`
- `apps/relayer/.env` and the root `.env`: append one generated `RELAY_API_SECRET` (openssl, nothing printed; approved 03:09)
- `.batches/006-P2-neon-limits/*`, `notes/phase-2-relayer.md`

## Ponytail ladder
- No database, no new dependency: in-process counters (a revert list, a banned set, a spend total per UTC day, send timestamps per payer/merchant). `ponytail:` per process; upgrade = the reviewed Postgres spec.
- `node:crypto` for the digest compare.

## Out of scope (after G2)
- Postgres advisory lock, `rel_sent`, cross-instance counters, operator pause switch (the contract's own pause is surfaced instead), fee swap, CapitalMarket funding.

## NEEDS THE USER
- Approved: numbers (03:09), secret files (03:09), lean scope (05:51). Vercel deploy and its env vars are the next step and need the human's go.
