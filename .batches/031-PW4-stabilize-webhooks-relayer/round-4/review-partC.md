VERDICT: PASS
# Batch 031 · round 4 · Part C (durable web rate limits) — independent review by whiteflow-ef (author: whiteflow-fb)

The author's own report (build-webC.md) is missing: whiteflow-fb stopped at ~19:52 (account interruption) after finishing the code. This review is from the code and fresh runs.

Read: `apps/web/lib/server/http.ts` (`sharedRateLimit`, `RATE_LIMIT_SQL`, `PRUNE_SQL`, `RATE_LIMIT_DOWN`, in-memory `rateLimit` kept only as the "memory" fallback), `apps/web/db/052_rate_limits.sql`, every call site (15 routes + `lib/server/links.ts limitCheckouts`).

Checked:
- **Atomic counting:** one `INSERT … ON CONFLICT (key) DO UPDATE … RETURNING count` statement per call; real Postgres via the production Neon adapter: 12 concurrent increments of one key returned exactly 1…12 (`tools/stage2/web-neon.mjs`), and the local-cluster harness agrees.
- **Fail modes:** `"closed"` (503 `RATE_LIMIT_DOWN`, before any action — the "nothing was charged" wording is therefore true) on payment and mutation routes: demo-checkout, capital fund, capital publish, refund sync, quotes, sessions, session voucher, vouchers create/publish, webhook test/replay, public link/page checkout. `"memory"` (per-instance window) only on read routes: capital offers/quote/transfer-check and the per-merchant capital read.
- **Limits unchanged** (values identical to the pre-031 in-memory calls); keys > 200 chars stored as `sha256:<hex>`; driver messages never logged (error name only); prune every 100 calls per instance with a 60 s grace.
- **Migration 052:** additive, idempotent; previous-schema test (≤ 050 + synthetic rows → 051/052 twice) preserved all rows on Neon.
- Fresh tests: rate-limit-db 18/18, gw-links 21/21, gw-pages 14/14, hosted-pages 9/9, gw-single-use 10/10, gw-refunds 18/18 (after the lead's test fix below), docs-limits 13/13 **exit 0**.

Follow-ups found and fixed by the lead (recorded in batch.md):
1. `test/gw-refunds.test.mjs` relied on the in-memory `resetRateLimits()` between tests; the refund-sync window now lives in Postgres → test now also clears `app_web_rate_limits` per test (no assertion changed).
2. `docs-limits` never exited: root cause = the test harness never closed its PGlite; with `Date` mocked and advanced by a rate-limit window while PGlite ran Part C's SQL, PGlite's internal `setitimer` armed a ~1 h timer (traced by a diagnostic preload: `setTimeout ms=3599913` from `@electric-sql/pglite … __setitimer_js`). Fix: `test/gw-helpers.mjs` closes the file's PGlite in `after()`. No forced exit, unref or timeout change.

Notes (not defects): each limited request adds one DB round trip (re-measure NFR-4/NFR-14 after deploy); IP keys still trust the first `x-forwarded-for` hop (unchanged behaviour; correct on Vercel).
