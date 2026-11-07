# Batch 031 / Stage 2 — human gate packet

Requirements: FR-GW-7, FR-PAY-10, FR-REL-5, FR-REL-6, FR-REL-10 (SRS v2.2, unchanged in v3.0). Last round: `round-4/ci.md` VERDICT: PASS, `round-4/review-security.md` VERDICT: PASS (phase mode, Money: yes → both required by `tools/batch-close.sh`).

## Stage 2 acceptance (owner's list) → result
| Outcome | Result | Evidence |
|---|---|---|
| Unknown/pending relayer attempts keep a recoverable tx reference and accurate status | verified locally | `pendingTxHash` on status; tx hash stored on 502/unknown and on relayed-200 + failed chain read (checkout and invoice); unknown-recovery 8/8, pending-ref 3/3, invoice-pay 25/25 |
| Durable nonce coordination; no reuse after uncertain broadcasts | verified on real Postgres (local + Neon adapter) | lease + fence + write-ahead `rel_sent` (tx hash, nonce before broadcast); new holder cannot rebroadcast an authorization; stale fence refused. Full Unknown→reconcile with a nonce floor = Stage 5 (FR-OPS-4) |
| DB outage stops new execution, no in-memory fallback | verified locally | ~1.5 s transient retry, then 503 before signing; relayer B4/B8 tests |
| No "nothing charged" unless established | verified locally | only a relayer pre-sign 503 says it; replay → "already submitted, don't pay again yet"; refused + failed chain read → pending "Don't pay again" (review F4) |
| Payer cooldown per owner policy; no penalty for spoofed victims/infra | verified locally + real PG | 3 attributable failures/10 min → 15 min; attribution = authorization unused AND balance below signed value at the revert block; audited unblock CLI |
| Webhook address validation holds through the connection | verified on a controlled local TLS fixture | pinned connect, hostname-validated TLS, SNI/Host, no redirects, timeout releases socket (pinned-https 4/4) — **not** an outbound/deployed smoke test |
| One hanging destination can't consume others' retries or block progress | verified locally + real PG | c-ares with cancel; DNS timeouts deferred not counted; ≤ 3 per destination per run (gw-isolation 7/7; Neon fair-claim check) |
| Event marker/delivery atomicity and leases intact | verified on real PG | enqueue-once race, claim race, lease expiry, fenced outcome (local 6/6, Neon 8/8) |
| Restart persistence of limits and budgets | verified on Neon adapter | fresh processes see cooldown + spend; shared web rate limit 12 concurrent → 1…12 |
| Tests terminate normally | verified | docs-limits root cause (PGlite never closed + mocked Date) fixed by teardown; exit 0 |

## Migrations, rollout, rollback
- Isolated results: relayer 001+002 clean ×2 and previous-schema (001 + synthetic rows → 002) rows preserved; web all 15 files clean ×2 and previous-schema (≤ 050 + synthetic rows → 051/052) rows preserved — on Neon via the production driver and on local Postgres 18.4.
- Rollout order (needs separate deployment approval): (1) apply web `051`, `052` (`node --env-file=… db/migrate.mjs` from apps/web, or the same files via the migrate splitter); (2) set `DATABASE_URL` on the relayer project and run `npm run db:migrate` in apps/relayer (001+002); (3) deploy the relayer **with all old relayer instances drained first** — never run the pre-031 per-process relayer and the new one against the same `RELAYER_PRIVATE_KEY` at the same time (one authoritative nonce coordinator); (4) deploy web; (5) re-measure NFR-4/NFR-14.
- Rollback: redeploy the previous builds (they ignore `leased_until`, `app_web_rate_limits`, `rel_*`); stop the new relayer before starting the old one (same single-coordinator rule); tables may stay (additive); optional drops are listed in each migration header.

## Independent review
Part A r3–4 by an independent reviewer agent + re-review of its fixes (0 critical/high; F1/F2/F4 fixed; F3 follow-up); Part B by subagent panels + lead; Part C by lead; harnesses run by lead. Details: `round-4/review-security.md`, `round-4/review-partC.md`, `round-3/review-security-partB.md`.

## Remaining limitations / external blockers
V1 MerchantPay still lets a direct on-chain payment at another amount consume a checkout reference (Stage 4 contract change); outbound HTTPS and deployed latency not measured; settled records don't yet carry the relayer's tx hash (F3); helpers whiteflow-b7/0f/fb were interrupted mid-task (their completed code was run, reviewed and integrated by the lead); live chain transactions not authorized.
