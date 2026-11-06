STATUS: READY

# Build: 006-P2-neon-limits — LEAN (claude-relayer; human 05:51)

## DONE
- `api/relay.ts`: 401 `unauthorized` unless `x-relay-secret` = `RELAY_API_SECRET` (sha256 digests + `timingSafeEqual`; unset secret → every request 401), checked before the media type and before the body is read.
- `dev.ts`: forwards `x-relay-secret`.
- `src/relayer.ts`: per-relayer in-process ledger (`ponytail:` → the plan-reviewed Postgres spec): breaker (≥ 3 mined reverts in the last hour → 503 `breaker_open`), ban (a payer with a mined revert → 422 `payer_banned`), daily budget (`spent + 0.0024 WBT cap > 0.1 WBT` per UTC day → 503 `budget_exhausted`), rate limits (≥ 10 sends/hour per payer, ≥ 200 per sale merchant → 429 `rate_limited`). Checked as the last free check (no RPC) and again inside the lock before signing. Accounting after every broadcast attempt: `gasUsed × effectiveGasPrice + l1Fee` on a receipt, the cap when unknown; a mined revert bans the payer, counts for the breaker and logs `ALERT reverted <hash> payer <from>`. `gasCostWei` now includes the OP-Stack L1 fee. Zero `orderRef` → 400. `EnforcedPause` → 503 `paused`. `/health` reports `gasSpentToday` / `budgetLeft`.
- `.env`: one generated `RELAY_API_SECRET` appended to `apps/relayer/.env` and the root `.env` (same value, nothing printed; approved 03:09).
- Commits: `e88665e` test (RED: 9 failing, run completed) → `84dd5af` feat (GREEN).

## Verified
- `npx tsc --noEmit` → 0 · `npm test` → `tests 49, pass 49, fail 0`.
- NFR-3 env names: `PORT`, `RELAY_API_SECRET`, `RELAYER_PRIVATE_KEY`, `RPC_URL`; `cut -d= -f1 apps/relayer/.env` → `RELAYER_PRIVATE_KEY`, `RELAY_API_SECRET`; root `.env` holds the same secret (values compared without printing).

## For the round
- The G2 live run uses the merged batch-007 server on :8787 (not this code). For live checks of THIS code the builder runs a second server on :8788 with a **throwaway relayer key (0 WBT: it cannot send)** and a test-only secret in `round-1/test-secret.txt` (not a real secret).
