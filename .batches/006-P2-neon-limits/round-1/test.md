VERDICT: PASS

## Evidence
- `cd apps/relayer && npx tsc --noEmit` -> 0 errors. `npm test` -> tests 49, pass 49, fail 0 (breaker, budget, budget accounting, rate limit, EnforcedPause, auth 401 cases all green).
- Live :8788 (throwaway key, no txs sent):
  - POST /relay, no secret -> 401 `unauthorized`; wrong secret -> 401; right secret + `{}` -> 400 bad_request (auth passes first); right secret, no JSON content-type -> 415.
  - Local reject: paySale with zero orderRef, valid signature -> 400 `args.orderRef must be 32 non-zero bytes of hex`.
  - RPC reject: two fresh random payers (0 USDT), valid signatures -> 422 `insufficient_funds` each.
  - GET /health -> `{"wbt":"0","gasSpentToday":"0","budgetLeft":"0.1",...}` 200, unchanged after the rejects (rejects are not counted as sends).
- Code read (api/relay.ts, src/relayer.ts diff): auth uses sha256 digests + timingSafeEqual (equal length, constant time), unset/empty secret -> 401, checked before media type and body read. Day rollover keeps reverts/bans/sends and resets only spend. Budget and breaker checked in `localChecks` (before RPC) and again in `send` after the nonce read, inside the lock, before signing. Only broadcast attempts count as sends (receipt, mismatch, timeout/error at cap); simulation rejects do not. Batch 007 behaviour (replay set, expiry guard, receipt checks) unchanged; tests pass.

## DONE
- No HIGH/CRITICAL defects found.

## OPEN
- none blocking.

## FOLLOW-UP (MEDIUM/LOW)
- MEDIUM, src/relayer.ts:120 (relayer lane): the ledger is per process. On Vercel, each instance has its own budget, ban list, breaker and rate counters, so the 0.1 WBT cap and bans are not global and reset on cold start. Acceptable for the demo only if deployed as a single long-lived server; the Postgres spec is the real fix (already marked `ponytail:`).
- LOW, src/relayer.ts:127: `sends` map keys (one per payer) are pruned only when the same payer sends again; unbounded growth over a long run. Negligible at hackathon scale.
- LOW, src/relayer.ts:333-339: a `receipt_mismatch` is booked at the cap fee and not as a revert, so it never feeds the breaker. Intended per the code comment; note it.
- LOW, GET /health is unauthenticated and now exposes daily spend and budget left. Low-sensitivity, but gate it if the relayer URL becomes public.
- LOW (not tested): the real revert path (ban + ALERT) is proven only by the fake-node unit test; the live server cannot send (0 WBT).
