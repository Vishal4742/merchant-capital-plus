VERDICT: PASS

# Code review: 006-P2-neon-limits (LEAN), round 1, fast mode (PIPELINE.md §3a)

Diff: `git diff e88665e~1 84dd5af -- apps/relayer` (5 files, +209 / -29). The only files touched are the ones the spec lists.

## Evidence
- `cd apps/relayer && npx tsc --noEmit`: exit 0. `npm test`: tests 49, pass 49, fail 0.
- NFR-3: `process.env` reads are `PORT` (dev.ts:8), `RELAY_API_SECRET` (api/relay.ts:8), `RELAYER_PRIVATE_KEY` and `RPC_URL` (src/relayer.ts:79, 87). Nothing else.
- L1 fee: viem 2.57.13 `whitechainSepolia` spreads the OP-stack `chainConfig`, and its receipt formatter turns `l1Fee` into a bigint (`op-stack/formatters.js:51`). The `typeof === 'bigint'` guard in src/relayer.ts:340 therefore works, and the test proves it, since the fake node returns `l1Fee` as hex.
- `/health` shape matches ARCHITECTURE §2 line 93 `{relayer, wbt, gasSpentToday, budgetLeft, usdtFeesUnswapped, paused}`.

## Spec trace (all present)
- §3 point 13 / Behaviour 1: api/relay.ts:6-14. Uses sha256 + `timingSafeEqual`, unset or empty secret gives 401, and the check runs before the media type and the body. dev.ts:29 forwards the header. `/health` is untouched (stays open).
- Behaviour 2: src/relayer.ts:249. An all-zero `orderRef` gives 400.
- Behaviour 3/4: `ledgerChecks` runs in spec order (breaker, ban, budget `spent + cap > budget`, payer 10/h, merchant 200/h for sales only, since `merchant` is undefined for invoices). It runs as the last free check (:281) and again inside the lock before signing (:326).
- Behaviour 5: `recordSend` books receipt cost + l1Fee, or the cap on a timeout, error or mismatch. A mined revert bans the payer, feeds the breaker and writes `ALERT reverted` to stderr. Every broadcast attempt counts as a send, simulation rejects don't.
- Behaviour 6: :210 maps `EnforcedPause` to 503 `paused`.
- Scope creep: none. No dependency, no DB, and the `ponytail:` marker is present (:120).
- Regressions vs batch 007: replay set, expiry re-checks, receipt hash check, single send and fee caps are unchanged. The 415 test was rewritten to send the secret, and the dev 413 test passes the secret.

## FOLLOW-UP (MEDIUM/LOW; fix next batch)
1. **MEDIUM, cross-lane deploy order, apps/web/lib/relay.ts (on `main`), owner: web lane.** The web server's `relaySale` / `relayPayInvoice` / `relayerHealth` do not send `x-relay-secret` (`git grep x-relay-secret main -- apps/web` finds nothing). If this relayer is deployed before the web change, every sale and invoice payment returns 401. Fix: the web server adds `x-relay-secret: process.env.RELAY_API_SECRET` to the POST, and the two ship in the same deploy. Tell the web lane before the Vercel step.
2. **MEDIUM, src/relayer.ts:387, owner: relayer.** `/health` still returns `paused: false` as a hard-coded value. spec.md's FR-REL-6 line says `paused` reflects MerchantPay's own pause, but neither Behaviour nor the acceptance criteria cover it, so the dashboard can say "not paused" while every pay gets 503 `paused`. Fix: read `paused()` (it is in `merchantPayAbi`) in the same `Promise.all` as the balance, with the balance's 5 s TTL.
3. **LOW, src/relayer.ts:326, owner: relayer (ponytail).** The in-lock `ledgerChecks` runs after the simulate + nonce RPC round. The ledger only changes in `recordSend`, which runs inside the same lock, so moving the check to the top of `send()` (next to the REPLAY check) behaves the same. It would save 2 RPCs for every queued request that gets refused.
4. **LOW, src/relayer.ts:37, owner: relayer.** `CAP_FEE_WEI` (gas x maxFeePerGas) leaves out the OP L1 fee. The "worst case" booked on a timeout, and the budget edge, can each be short by one l1Fee (about 9k wei on this testnet). This is negligible; just note in the comment that it is "≈ worst case".
5. **LOW, test/relayer.test.ts:832, owner: relayer.** The budget test uses one 0.10002 WBT send, so it never tests the exact edge (`spent + cap == budget` passes, one more wei refuses). Nothing tests the 200/h merchant limit or the "invoices: payer only" rule. Add one boundary case and one merchant-limit case when this moves to Postgres.
6. **LOW, note.** The tester's follow-ups (ledger is per process, `sends` map growth, a mismatch doesn't feed the breaker, `/health` exposes spend) are confirmed and not repeated here. Bans never expire, and they survive the UTC day rollover. The spec ("has a mined revert") allows this.
