VERDICT: PASS

# 049-PW4-port-stage2 — round 1 ci (phase mode, lane-run; Money: yes → review-security.md also required)

Tree: branch `wf/stage2-port` = snapshot (6 import commits on base 3cd0dc9) merged with origin/main e7e41bf. Host: Windows 11.
Runtime: **Node v26.13.0** (CI's major; official win-x64 zip, SHA-256 `dcc60d59…150a` matched nodejs.org SHASUMS256.txt), Foundry 1.8.6.

| Check (CI job) | Command | Result |
|---|---|---|
| web | `npm run typecheck` | pass (route types generated, tsc clean) |
| web | `npm run lint` | 0 errors, 0 warnings |
| web | `npm test` | **769 tests: 762 pass, 5 fail, 2 skipped**. The 5 are `docs-reference.test.mjs` building `P:\P:\…` paths on Windows (ENOENT) — the same 5 recorded before the merge in batch 031 round-4 ci.md; Linux CI unaffected |
| web | `npm run build` | exit 0 (all routes built, incl. /merchant/{invoices,connections,settings}) |
| relayer | `npm run typecheck`; `npm test` | tsc clean; **100 tests: 99 pass, 1 fail** = the host-timer test "background refresh … 20 ms interval in 75 ms" (fails 2 of 3 isolated runs on this host with unchanged code; recorded as pre-existing in 031 round-4) |
| sdk | `npm run typecheck`; `npm test` | 47/47 (after restoring the CRLF checkout copy of `public/v1/button.js`; git content identical) |
| mcp | `npm run typecheck`; `npm test` | 25/25 |
| contracts | `forge build`; `forge test` | 12 suites, **164/164 pass**; `git diff origin/main -- contracts` empty |
| real Postgres (Neon production driver, isolated `wf_s2_relayer`/`_prev`) | `node tools/stage2/relayer-neon.ts P:/Whiteflow/.env` | **8/8**: clean schema (001, 003, 004 twice), 12-process lease race, 10-process duplicate authorization, uncertain-commit recovery, durable tx reference, stale-holder fencing, restart persistence, **previous schema = main's batch-037 `001_rel.sql` + legacy rows → upgraded twice: rows, fees, old lock kept, statuses `unknown`/`reverted`** |
| real Postgres (isolated `wf_s2_web`/`_prev`) | `node tools/stage2/web-neon.mjs P:/Whiteflow/.env` | **8/8** (15 migrations twice; enqueue-once, claim, lease-expiry, fenced outcome, fair dispatch, shared rate limit, previous schema) |

Only `DATABASE_URL` was read from `.env` (via `parseEnv`); no value printed; the live app database was not touched (each harness asserts `current_database()` before DDL).

## Merge resolutions that are new code (review focus)
- `apps/relayer/db/003_rel_state.sql` — forward migration from main's batch-037 `rel_sent`/`rel_lock` to the batch-031 state (rel_lease, tx_nonce/fence/status/reverted_at, NUMERIC wei, honest backfill). `004` = 031's round-3 file renumbered. `005_relayer_role_state.sql` — grants for main's least-privilege `mcplus_relayer` role (no INSERT on unblocks).
- `db/statements.ts isSchemaFile` — migrate/tests/harnesses skip owner-run `*_role*.sql`.
- Main's `store.ts` + `db/pglite.ts` retired (superseded by 031's `state.ts`/`db.ts`); `dev.ts` rewired.
- New tests: `test/forward-migration.test.ts`; role end-to-end test in `relayer.test.ts` (relay works as `mcplus_relayer`; other tables, deletes and unblock inserts refused).
- `app/api/v1/{sessions,invoices}/[id]/funds` (main's 032-P5) moved from the per-instance `rateLimit()` to `sharedRateLimit(…, "memory")` (FR-OPS-9; caught by 031's route-limit test).
- UI: Nav = Whiteflow five destinations + main's soft navigation, FoldedMenu, Capital (legacy) and Webhooks links; home = main's Shell fallback, parallel reads, Vouchers-used tile, Get paid early kept; the hard-coded "T+0" tile dropped (FR-UX-1/3).
- Docs: SRS 3.0.1 header records main's 2.3 Privy payer note; FR-GW-15/AT-18 annotated "built on main, kept working, outside Whiteflow scope".
