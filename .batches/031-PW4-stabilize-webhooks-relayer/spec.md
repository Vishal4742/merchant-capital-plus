# Spec: 031-PW4-stabilize-webhooks-relayer

Fix two existing reliability defects in already-approved features before any Whiteflow payment automation (PRD §16 G0). No new product behaviour, no UI, no contract change.

## Requirements (cite docs/SRS.md IDs)
- **FR-GW-7** Webhooks: `payment.succeeded` / `payment.refunded` sent signed with retries. **FR-PAY-10** the shop receives signed webhooks.
- **FR-REL-10** The send lock, daily gas budget and per-payer limits hold across all relayer instances (shared Postgres lock and counters), not per process.
- **FR-REL-5** (gas caps, rate limits, daily WBT budget) and **FR-REL-6** (health reports WBT balance, gas spent today, budget left, pause state) — must stay true once the state is shared.
- **FR-REL-3** never send a transaction that would revert; **FR-REL-2** allowlist — unchanged and must stay covered by tests.

## Part A — web webhook outbox (whiteflow-ef)
Defects (W0 inventory): HIGH `events.ts:91` dedupe key committed before delivery rows → a crash in between suppresses the event forever. MEDIUM `webhooks.ts:164` per-endpoint inserts not atomic → duplicate deliveries on partial failure. MEDIUM `webhooks.ts:200` replay takes no lease → can double-send alongside dispatch and can overwrite `succeeded`.

Acceptance criteria:
- [ ] A1 The event's dedupe key and one pending delivery per merchant endpoint are written by **one SQL statement** (atomic): either both exist or neither. Test: make the delivery write fail → no `app_gw_events` row remains → a re-announce delivers the event (same event id).
- [ ] A2 Two concurrent `onSessionPaid` calls for one session produce exactly one delivery per endpoint (PGlite, two module instances).
- [ ] A3 A delivery row's id is derived from (webhook id, event id), so the same event can never create two deliveries for one endpoint.
- [ ] A4 Attempts claim a lease (`leased_until`): `dispatchDue` and `replayDelivery` skip/refuse a delivery whose lease is live; a replay during a live lease returns 409 and sends nothing.
- [ ] A5 A replay of a `succeeded` delivery that fails keeps status `succeeded` (no downgrade) and schedules no retry.
- [ ] A6 After commit, a crash before the inline attempt leaves deliveries `pending` and due, and `dispatchDue` sends them (no user traffic needed besides the dispatcher call).
- [ ] A7 Existing webhook, events, dispatch, refund-sync and SDK-compat tests still pass (AT-14 path). Only change to an existing test: `gw-events.test.mjs`'s recorder moves from the old seam (`enqueueEvent`) to `enqueueEventOnce` and keeps the same contract; its assertions are unchanged. Direct `enqueueEvent` calls (test sends, existing tests) keep today's semantics.
- [ ] A8 Migration `051_webhook_outbox.sql` is idempotent (re-run safe), additive only (`ADD COLUMN IF NOT EXISTS`), splitter-compatible (no DO blocks/functions), and applies to PGlite in tests.

Out of scope for A (tracked, W4 with new IDs once SRS v3.0 is approved): full transactional outbox committed in the same transaction as the payment/refund state change (FR-OPS-6), DNS-rebinding IP pinning, a sub-daily scheduler (depends on the hosting plan — NEEDS THE USER), versioned migration runner (FR-OPS-1).

## Part B — relayer state across instances (whiteflow-b7)
Defect (W0 inventory): HIGH `apps/relayer/src/relayer.ts:141/189` send lock, nonce choice, replay set, budget, rate limits and breaker are process-local while `apps/relayer/vercel.json` sets `"fluid": true` (multi-instance). PHASES/AI_USAGE claim a Postgres lock from batch 006, but code and notes say per process (doc drift to report, not to edit).

Acceptance criteria:
- [ ] B1 Send serialization per relayer address holds across instances: two relayer instances sharing one database never sign the same nonce concurrently (test with two module instances on one PGlite DB).
- [ ] B2 The replay set (authorization already sent) is durable and shared: an authorization accepted by instance 1 is refused by instance 2 as replay; the signed tx hash and nonce are persisted **before** broadcast.
- [ ] B3 Daily WBT budget, per-payer/merchant rate limits and the breaker (ban after a mined revert; 503 after 3 mined reverts/hour) are shared counters; instance 2 sees instance 1's spend/bans.
- [ ] B4 Fail closed: with the database unavailable or unconfigured in production mode, `/relay` refuses (5xx, no transaction signed or sent). No silent fallback to in-memory state outside tests/dev.
- [ ] B5 `/health` reports the shared budget/spend and the real breaker/pause state (FR-REL-6) instead of hard-coded `paused:false`.
- [ ] B6 All existing relayer tests (62 baseline, fresh run 2026-11-06) still pass; AT-10 behaviour (invalid/unprofitable call rejected before sending, no gas) unchanged.
- [ ] B7 Schema for `rel_*` tables is idempotent and documented with its apply command; no secret is logged; RELAYER_PRIVATE_KEY handling unchanged.

Design constraints for B: Neon's HTTP driver cannot hold a session-level advisory lock across statements — use a lease row with fencing (or an interactive transaction via a pooled/WebSocket client) and justify the choice in build-relayer.md. Reuse the web app's pinned versions if a DB client is added (`@neondatabase/serverless` 1.2.0; `@electric-sql/pglite` 0.5.11 as a devDependency) — a new relayer dependency is flagged to the human (PIPELINE §11). Full "Unknown → reconcile" handling of uncertain broadcasts is FR-OPS-4 (W4, needs SRS v3.0); B2 only persists the attempt before broadcast.

## Round 3 — owner decisions at the human gate (2026-11-06)
The owner accepted the new relayer dependency and asked for these changes before close:

**Part B (whiteflow-b7):**
- [ ] B8 DB outage: retry transient DB failures briefly (≈ 1.5 s total budget) before answering 503; still never sign or broadcast with unknown DB state. Retries must be idempotent: a statement whose first try committed but whose reply was lost is recognised as ours (e.g. take-lease holder id, write-ahead row with our tx hash), never misread as `busy`/`replay`.
- [ ] B9 Replace the automatic payer ban (owner policy, verbatim intent):
  - Do **not** automatically ban a payer after one reverted transaction.
  - Reject retries of the same failed authorization without rebroadcasting.
  - Infrastructure failures, token/contract pauses and duplicate requests must not penalize the payer.
  - For repeated, independently validated payer-attributable failures, use a configurable temporary cooldown. Initial **testnet** policy: 3 distinct qualifying failures within 10 minutes → 15-minute cooldown.
  - Persist counters and expiry across restarts. Provide an audited unblock mechanism.
  - Invalid signatures submitted by someone else must never count against the claimed payer.
  - Keep global gas budgets and rate limits (and the global revert breaker) as separate safeguards.
  - Thresholds are provisional testnet settings, not production-validated limits.

**Part A (whiteflow-ef):**
- [ ] A9 The DNS-deadline trade-off is fixed now (not a follow-up): a DNS-deadline expiry is not counted as a delivery attempt (lease released, retried later) within a bounded window, so one merchant's hanging DNS can delay but not exhaust other merchants' retries; NXDOMAIN and other errors still count; creating a webhook distinguishes "DNS timed out, try again" from "couldn't find that host".
- [ ] A10 The web shows a payer in cooldown a specific message (nothing charged, when they can retry) instead of the generic "busy" text; it never invites paying again while a payment may be in flight.

Sign-in decision (recorded for W2, not this batch): wallet-only SIWE for testnet; "no recovery" stated as a known testnet limitation; revisit before pilots.


## Round 4 — owner supervision prompt (2026-11-06) + "use all 4 active chats in parallel"
Required before close: webhook connection isolation; real-Postgres concurrency evidence with independent connections/processes (embedded PGlite alone is not enough); reviewers independent of implementers. Work stays under this batch's approved IDs (FR-GW-7, FR-PAY-10, FR-REL-5, FR-REL-6, FR-REL-10); SRS v3.0 is still pending the owner's edits.

| Part | Owner (one writer per file) | Acceptance | Files |
|---|---|---|---|
| A11 isolation | whiteflow-ef | DNS via a per-attempt c-ares `dns.Resolver` with a real deadline that `cancel()`s outstanding queries (no getaddrinfo, no shared threadpool); the connection goes only to the vetted address (pinned `lookup`, SNI/Host = hostname, no redirects, 5 s bound) so a DNS answer can't change between the SSRF check and connect; dispatch takes at most 3 due deliveries per destination per run (fair scheduling); lease recovery unchanged; tests for each, including a pinned-connect test and a hanging-destination-vs-healthy-destination test | apps/web/lib/server/webhooks.ts, apps/web/test/gw-helpers.mjs (test net adapter only), apps/web/test/gw-outbox.test.mjs, apps/web/test/gw-isolation.test.mjs (new) |
| A12 replay message | whiteflow-ef | A relayer `422 replay` (authorization already written ahead, possibly broadcast) is never shown as "nothing was charged, start again": the existing on-chain check still runs (receipt if paid) and the checkout is still not locked (existing anti-lockout rule, test 'a 422 replay never locks the checkout'), but the customer is told the approval was already submitted and not to pay again yet (contracts already stop a double charge: OrderPaid / invoice capacity) | apps/web/lib/relay.ts, apps/web/test/relay-cooldown.test.mjs |
| A13 SQL exports | whiteflow-ef | The concurrency-critical webhook SQL texts are exported constants used by the code, so the real-Postgres harness runs the exact production SQL | apps/web/lib/server/webhooks.ts |
| A14 recoverable tx reference | whiteflow-ef | Owner Stage-2 outcome "unknown/pending relayer attempts have recoverable transaction references and accurate status": a relayer 502/unknown answer's valid `txHash` is kept on the unknown relay result and persisted with the pending attempt (checkout `pending`, invoice `attempt.pending`); status still comes from the chain (settlePending/invoiceState); malformed hashes are ignored | apps/web/lib/relay.ts, apps/web/lib/sessions.ts (pending shape only), apps/web/app/api/v1/sessions/[id]/pay/route.ts, apps/web/app/api/v1/invoices/[id]/pay/route.ts, apps/web/app/api/v1/sessions/[id]/route.ts (status exposes `pendingTxHash` while pending), apps/web/test/pending-ref.test.mjs, apps/web/test/unknown-recovery.test.mjs (new) |
| B10 relayer real PG | whiteflow-b7 | Opt-in `npm run test:pg` in apps/relayer: temp cluster from local Postgres 18 binaries, migrations 001+002, independent concurrent connections running the exact exported state.ts SQL (lease race, lost-reply retries, write-ahead race and idempotent retry, stale fence, cooldown counters); loud SKIP (distinct exit code) when binaries are absent | apps/relayer/** |
| C durable web limits | whiteflow-fb | The web app's per-IP/abuse rate limits on payment and money-adjacent routes hold across instances and restarts (Postgres, `app_web_`-prefixed table so test resets truncate it); fail behaviour stated (closed for payment routes); `resetRateLimits` kept for tests; no change to limits' values | apps/web/lib/server/http.ts (rate-limit functions only), the app/api/** routes that call rateLimit, apps/web/db/052_*.sql (new), apps/web/test/rate-limit-db.test.mjs (new) |
| D web real PG | whiteflow-0f | Opt-in `npm run test:pg` in apps/web: temp cluster, all apps/web/db migrations, independent concurrent connections running the exported webhook SQL (enqueue-once CTE race → one marker + one delivery per endpoint; claim-lease race → one winner; dispatch claim vs replay vs inline claim; fenced outcome after takeover dropped); loud SKIP when binaries are absent | apps/web/test-pg/** (new), apps/web/package.json (`test:pg` script line only) |

Reviews: whiteflow-b7 and whiteflow-fb review Part A; whiteflow-ef reviews Parts B, C and D. Nobody reviews their own part.

## Files to touch (only these)
- A: apps/web/lib/server/events.ts, apps/web/lib/server/webhooks.ts, apps/web/db/051_webhook_outbox.sql (new), apps/web/test/gw-outbox.test.mjs (new), apps/web/test/gw-events.test.mjs (recorder seam only); round 3: apps/web/lib/relay.ts, apps/web/lib/server/capital-fund.ts (cooldown message on both relay paths), apps/web/test/relay-cooldown.test.mjs (new), apps/web/test/capital-fund.test.mjs (one added case)
- B: apps/relayer/** (src, api, test, package.json/lock, a schema file under apps/relayer/)
- Batch docs: .batches/031-…/** (build-web.md, build-relayer.md, round-1/*)

## Ponytail ladder
- Needed at all? Yes: both are HIGH defects on existing money/notification paths.
- Already in repo? A reuses the existing tables, lease idea (dispatchDue) and PGlite harness; B mirrors the web app's Postgres lock/idempotency patterns (db/050) and its DB client.
- Minimum code: A = one CTE statement + one column + guarded updates; B = shared tables replacing in-memory maps behind the existing functions.

## Verification (phase mode §3b; Money: yes → one reviewer-security pass)
- Web: `npx next typegen && npx tsc --noEmit`, `npm run lint`, web tests (per-file runner; `node --test test/` directory form fails on local Node 24.14 — CI uses Node 26), `npm run build`.
- Relayer: `npm run typecheck`, `npm test`.
- reviewer-security over both parts; ci.md with real output. Human gate before close.
