VERDICT: PASS
# Batch 031 · round 4 (final) · ci — phase mode §3b (lane-run checks; no GitHub CI: not a git checkout)

**Runtime:** project-required **Node v26.13.0** (official win-x64 build, SHA-256 `dcc60d59…150a` matched nodejs.org SHASUMS256) for the definitive run; Node v24.14.0 results kept for comparison. Windows 11. Database: isolated Neon databases `wf_s2_relayer`, `wf_s2_relayer_prev`, `wf_s2_web`, `wf_s2_web_prev` (created by this batch, verified empty before use; the live app DB untouched). Only `DATABASE_URL` read from `P:\Whiteflow\.env`; no credential text in any log (grep count 0).

## Definitive — Node 26.13.0, CI's exact commands
| Package | Command | Result |
|---|---|---|
| apps/web | `npx next typegen && npx tsc --noEmit` | exit 0 |
| apps/web | `npm run lint` | exit 0 |
| apps/web | `npm test` (`node --experimental-test-module-mocks --test test/`) | exit 1 — **652 tests: 645 pass, 5 fail, 2 skipped, 0 cancelled; process terminated normally in 53 s**. All 5 failures are `docs-reference.test.mjs` on Windows path separators (`no app\api\v1\sessions\route.ts`), identical before the batch; not product behaviour. The Node 24-only failures (anon, guest-wallet, arkiv-probe, merchant-wallet) pass on Node 26. |
| apps/web | `npm run build` | exit 0 |
| apps/relayer | `npm run typecheck` | exit 0 |
| apps/relayer | `npm test` | **97/98** — the 1 failure is the pre-existing host-timer test ("background refresh…": ≥ 3 ticks of a 20 ms interval in 75 ms); a bare probe with no relayer code fails the same way on this host. The earlier Node 26 failure "local pre-checks … window_too_long" was a test second-boundary flake (the guard `validBefore ≤ now + 15 min` behaved correctly); test now computes each case's times when sent — 3/3 on Node 26, 1/1 on Node 24. |
| apps/relayer | `npm run test:pg` (local Postgres 18.4 cluster, 389 independent psql connections, barrier release) | **8/8 scenarios, exit 0** |
| apps/web | `node test-pg/run.mjs` (local Postgres 18.4, up to 384 connections/scenario, gate release) | **6/6 scenarios, exit 0** |
| production adapter | `node tools/stage2/relayer-neon.ts P:/Whiteflow/.env` (relayer's real `state.ts`/`db.ts`, Neon HTTP driver, child processes released by one GO) | **8/8, exit 0** — lease race (12 processes → 1 winner), duplicate authorization (1 written / 9 replay), uncertain-commit recovery, durable tx reference/nonce after an uncertain send, stale-holder fencing, restart persistence of cooldown + spend, clean schema ×2, previous schema (001 + synthetic rows → 002 ×2, rows preserved) |
| production adapter | `node --experimental-test-module-mocks tools/stage2/web-neon.mjs P:/Whiteflow/.env` (web's real `db.ts` + exported `SQL_*`/`RATE_LIMIT_SQL`) | **8/8, exit 0** — enqueue-once race (1 marker, 3 deliveries, 1 queuer), claim race (1 winner), lease expiry → 1 takeover, fenced outcome after takeover (stale 0 rows), fair dispatch (no duplicates, ≤ 3 per destination per claim), shared rate limit (12 concurrent → 1…12), clean schema ×2, previous schema (≤ 050 + synthetic rows → 051/052 ×2, rows preserved) |
| packages/sdk | `npm run typecheck` / `npm test` (`node --test test/` — works on Node 26) | exit 0 / **47/47** |
| apps/shop | `npm test` | **5/5** |
| contracts | `forge build && forge test -vv -j 1` | not re-run: no contract file changed in this batch; fresh run earlier today **154/154** (Foundry 1.8.6) |
| secrets | grep for private keys / API tokens / `postgres://user:pass@` / `npg_` over every file this batch touched + notes + docs (excluding .env*, node_modules, .next) | only deliberately fake test fixtures (`SECRETPW`, `hunter2`, `user:pass@host` inside tests of redaction); no real secret |

## Comparison — Node 24.14.0 (same tree, before the last review fixes)
web per-file: 68 files, 629 pass / 13 fail / 2 skipped (failures: docs-reference 5 + Node-24 module-mock/timing files); tsc/lint/build 0; relayer 98/98; sdk 47/47; shop 5/5. After the review fixes (Node 24): invoice-pay 25/25, unknown-recovery 8/8, gw-isolation 7/7, checkout-api 32/32, checkout-edges 22/22, gw-webhooks 21/21, gw-outbox 15/15, pinned-https 4/4, pending-ref 3/3, docs-limits 13/13 **exit 0 (8 s)**, gw-refunds 18/18.

## Not verified here (labelled, not claimed)
Outbound/deployed HTTPS smoke test (only a controlled local TLS fixture); deployed latency NFR-4/NFR-14; migrations on the shared/production database (only isolated targets); live chain transactions (no authorization).
